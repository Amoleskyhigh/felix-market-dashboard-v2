#!/usr/bin/env python3
"""
update_snapshot.py
Fetch fresh market data and rewrite market-data-snapshot.json in place.

Data sources (no API key needed):
  - yfinance     : all price series (SPY, QQQ, SMH, IGV, QTUM, BOXX, QLD,
                   ^GSPC, ^IXIC, ^SOX, ^VIX, ^TNX, HG=F, DX-Y.NYB, TWD=X)
                   + S&P 500 constituents for market breadth (% > 200MA)
                   + forward P/E of top holdings
  - FRED CSV     : BAMLH0A0HYM2 (HY OAS), history with FRED's real dates
  - multpl.com   : Shiller CAPE (current + monthly history)
  - CNN          : Fear & Greed score + history

Design rules:
  - Every series is rebuilt from its source on each run (never "prepend today
    to whatever was there"), so a missed day heals itself on the next run.
  - If a source fails, the existing values are kept untouched and the failure
    is recorded in snap["sourceStatus"]; the run only fails if nearly
    everything failed.
"""

import datetime
import io
import json
import re
import sys
import traceback

import requests

try:
    import yfinance as yf
    import pandas as pd
    HAS_YF = True
except ImportError:
    HAS_YF = False

SNAPSHOT = "market-data-snapshot.json"
SP500_CACHE = ".github/scripts/sp500-tickers.json"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{start}"
SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# snapshot key -> (yahoo symbol, bars to keep)
# SPY keeps 250 bars so the MA200 line / K-factor have enough history.
PRICE_TICKERS = {
    "spy":    ("SPY",       250),
    "qqq":    ("QQQ",        60),
    "smh":    ("SMH",        60),
    "igv":    ("IGV",        60),
    "qtum":   ("QTUM",       60),
    "boxx":   ("BOXX",       60),
    "qld":    ("QLD",        60),
    "spx":    ("^GSPC",      60),
    "ixic":   ("^IXIC",      60),
    "sox":    ("^SOX",       60),
    "vix":    ("^VIX",       60),
    "tnx":    ("^TNX",       60),
    "copper": ("HG=F",       60),
    "dxy":    ("DX-Y.NYB",   60),
    "twd":    ("TWD=X",      60),
}
BREADTH_BARS = 60
HY_BARS = 60
FNG_BARS = 60
CAPE_MONTHS = 124

status = {}


def log(msg):
    print(f"[{datetime.datetime.utcnow():%H:%M:%S}] {msg}", flush=True)


def ok(name, detail=""):
    status[name] = "ok"
    log(f"OK   {name} {detail}")


def fail(name, err):
    status[name] = f"failed: {str(err)[:120]}"
    log(f"FAIL {name}: {err}")


# ── Prices ─────────────────────────────────────────────────────────────────────

def update_prices(snap):
    symbols = [sym for sym, _ in PRICE_TICKERS.values()]
    data = yf.download(symbols, period="2y", interval="1d", auto_adjust=True,
                       progress=False, threads=True, group_by="column")
    closes = data["Close"]
    for key, (sym, bars) in PRICE_TICKERS.items():
        try:
            s = closes[sym].dropna()
            s = s[s > 0]
            if len(s) < 2:
                raise ValueError("no history returned")
            s = s.iloc[-bars:][::-1]                      # newest-first
            entry = snap.setdefault(key, {})
            entry["closes"] = [round(float(v), 4) for v in s.values]
            entry["timestamps"] = [int(ts.timestamp() * 1000) for ts in s.index]
            entry["currentPrice"] = entry["closes"][0]
            entry["previousClose"] = entry["closes"][1]
            entry["asOf"] = s.index[0].strftime("%Y-%m-%d")
            ok(key, f"{sym} {entry['asOf']} {entry['currentPrice']}")
        except Exception as e:
            fail(key, e)


# ── Market breadth: % of S&P 500 members above their 200-day MA ───────────────

def sp500_tickers():
    try:
        r = requests.get(SP500_CSV, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        tickers = sorted(str(s).replace(".", "-") for s in df["Symbol"])
        if len(tickers) < 450:
            raise ValueError(f"only {len(tickers)} tickers")
        with open(SP500_CACHE, "w") as f:
            json.dump(tickers, f)
        return tickers
    except Exception as e:
        log(f"WARN constituent list download failed ({e}); using cached list")
        with open(SP500_CACHE) as f:
            return json.load(f)


def update_breadth(snap):
    try:
        tickers = sp500_tickers()
        px = yf.download(tickers, period="2y", interval="1d", auto_adjust=True,
                         progress=False, threads=True)["Close"]
        ma = px.rolling(200, min_periods=200).mean()
        valid = px.notna() & ma.notna()
        n = valid.sum(axis=1)
        pct = ((px > ma) & valid).sum(axis=1) / n * 100
        pct = pct[n >= 400].dropna()          # need most of the index covered
        if pct.empty:
            raise ValueError("not enough constituent data")
        pct = pct.iloc[-BREADTH_BARS:][::-1]
        snap["breadth"] = {
            "pct": round(float(pct.iloc[0]), 2),
            "history": [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
                        for d, v in pct.items()],
            "method": "S&P 500 constituents above 200-day MA (computed)",
        }
        ok("breadth", f"{snap['breadth']['history'][0]}")
    except Exception as e:
        fail("breadth", e)


def fetch_forward_pe():
    """
    Compute weighted-average NTM Forward P/E for SPY, QQQ, SMH
    using yfinance individual-stock forwardPE data.

    Why this approach:
      - yfinance .info.get('forwardPE') works reliably for individual stocks
        but returns None for ETFs.
      - External scraping targets (finviz, WSJ, multpl forward PE, vaneck,
        invesco) are blocked or JS-rendered from GitHub Actions runners.
      - Solution: fetch NTM forwardPE for each ETF's top holdings, then
        compute a coverage-normalised weighted average.

    Accuracy: covers ~40% (SPY) / ~48% (QQQ) / ~65% (SMH) of each ETF
    by market cap. The top holdings dominate index PE so the result is
    typically within +/-1.5x of the true index-level forward PE.

    Returns {"spy": float|None, "qqq": float|None, "smh": float|None,
             "method": "holdings-weighted"}
    """
    if not HAS_YF:
        log("WARN fetch_forward_pe: yfinance not available")
        return {"spy": None, "qqq": None, "smh": None, "method": "holdings-weighted"}

    # ── ETF top-holdings tables ────────────────────────────────────────────────
    # Approximate weights as of mid-2026. Each list covers ~40-65% of the ETF.
    SP500_HOLDINGS = [
        ("AAPL",  0.073), ("MSFT",  0.065), ("NVDA",  0.062),
        ("AMZN",  0.041), ("META",  0.031), ("GOOGL", 0.023),
        ("GOOG",  0.019), ("BRK-B", 0.017), ("AVGO",  0.017),
        ("JPM",   0.015), ("LLY",   0.013), ("TSLA",  0.013),
        ("UNH",   0.011), ("XOM",   0.011), ("V",     0.010),
    ]  # ~40% of S&P 500 market cap

    QQQ_HOLDINGS = [
        ("MSFT",  0.090), ("AAPL",  0.087), ("NVDA",  0.080),
        ("AMZN",  0.053), ("META",  0.042), ("GOOGL", 0.029),
        ("GOOG",  0.025), ("AVGO",  0.022), ("TSLA",  0.017),
        ("COST",  0.015),
    ]  # ~48% of Nasdaq-100

    SMH_HOLDINGS = [
        ("NVDA",  0.205), ("TSM",   0.125), ("AVGO",  0.083),
        ("ASML",  0.056), ("QCOM",  0.044), ("AMD",   0.043),
        ("TXN",   0.038), ("INTC",  0.030), ("AMAT",  0.030),
        ("MU",    0.028),
    ]  # ~65% of SMH

    # ── Fetch forwardPE for all unique tickers via yfinance ───────────────────
    all_syms = sorted({s for h in [SP500_HOLDINGS, QQQ_HOLDINGS, SMH_HOLDINGS]
                       for s, _ in h})
    pe_cache = {}
    log(f"Forward P/E: fetching yfinance forwardPE for {len(all_syms)} tickers ...")
    for sym in all_syms:
        try:
            fpe = yf.Ticker(sym).info.get("forwardPE")
            if fpe is not None and 3.0 < float(fpe) < 500.0:
                pe_cache[sym] = round(float(fpe), 2)
                log(f"  {sym}: {pe_cache[sym]:.1f}x")
            else:
                log(f"  {sym}: forwardPE={fpe} (out-of-range, skipped)")
        except Exception as exc:
            log(f"  WARN {sym}: {exc}")

    # ── Weighted-average helper ───────────────────────────────────────────────
    def weighted_pe(holdings, label):
        covered_w = sum(w for s, w in holdings if s in pe_cache)
        if covered_w < 0.15:  # need at least 15% weight coverage
            log(f"  {label}: only {covered_w:.1%} weight covered — returning None")
            return None
        wpe = sum(pe_cache[s] * w for s, w in holdings if s in pe_cache) / covered_w
        log(f"  {label}: {covered_w:.1%} coverage, weighted fwdPE = {wpe:.1f}x")
        return round(wpe, 1)

    result = {
        "spy":    weighted_pe(SP500_HOLDINGS, "SPY"),
        "qqq":    weighted_pe(QQQ_HOLDINGS,   "QQQ"),
        "smh":    weighted_pe(SMH_HOLDINGS,   "SMH"),
        "method": "holdings-weighted",
    }
    return result


def update_forward_pe(snap):
    try:
        fpe = fetch_forward_pe()
        if not any(fpe.get(k) for k in ("spy", "qqq", "smh")):
            raise ValueError("no forward P/E values")
        snap.setdefault("forwardPE", {}).update(fpe)
        snap["forwardPE"]["updatedAt"] = datetime.datetime.utcnow().strftime("%Y-%m-%d")
        ok("forwardPE", str(fpe))
    except Exception as e:
        fail("forwardPE", e)


# ── HY OAS (FRED) ──────────────────────────────────────────────────────────────

def update_hy_oas(snap):
    try:
        r = requests.get(FRED_CSV, params={"id": "BAMLH0A0HYM2"}, timeout=30, headers=UA)
        r.raise_for_status()
        rows = []
        for line in r.text.strip().splitlines()[1:]:
            parts = line.split(",")
            if len(parts) == 2 and parts[1].strip() not in ("", "."):
                rows.append((parts[0].strip(), float(parts[1])))
        if not rows:
            raise ValueError("empty CSV")
        rows = rows[-HY_BARS:][::-1]
        snap["hyOAS"] = {
            "current": int(round(rows[0][1] * 100)),       # % → bp
            "asOf": rows[0][0],
            "history": [{"date": d, "value": int(round(v * 100))} for d, v in rows],
        }
        ok("hyOAS", f"{rows[0]}")
    except Exception as e:
        fail("hyOAS", e)


# ── Shiller CAPE (multpl.com) ──────────────────────────────────────────────────

def update_cape(snap):
    try:
        r = requests.get("https://www.multpl.com/shiller-pe/table/by-month",
                         timeout=30, headers=UA)
        r.raise_for_status()
        # Values are preceded by an HTML entity (e.g. "&#x2002;"), so allow
        # any non-digit filler between <td> and the number.
        rows = re.findall(
            r"<td[^>]*>\s*([A-Z][a-z]{2} \d{1,2},\s*\d{4})\s*</td>\s*"
            r"<td[^>]*>(?:\s|&[#\w]+;)*([\d.]+)",
            r.text)
        hist = []
        for date_str, val in rows:
            d = datetime.datetime.strptime(re.sub(r"\s+", " ", date_str), "%b %d, %Y")
            hist.append({"date": d.strftime("%Y-%m-%d"), "value": float(val)})
        if len(hist) < 12:
            raise ValueError(f"parsed only {len(hist)} rows (page layout changed?)")
        hist.sort(key=lambda h: h["date"], reverse=True)
        snap.setdefault("shiller", {})
        snap["shiller"]["current"] = hist[0]["value"]
        snap["shiller"]["asOf"] = hist[0]["date"]
        snap["shiller"]["history"] = hist[:CAPE_MONTHS]
        ok("shiller", f"{hist[0]}")
    except Exception as e:
        fail("shiller", e)


# ── CNN Fear & Greed ───────────────────────────────────────────────────────────

def update_fear_greed(snap):
    try:
        start = (datetime.date.today() - datetime.timedelta(days=150)).isoformat()
        r = requests.get(CNN_URL.format(start=start), timeout=30, headers={
            **UA, "Referer": "https://edition.cnn.com/", "Origin": "https://edition.cnn.com"})
        r.raise_for_status()
        data = r.json()
        fg = data["fear_and_greed"]
        by_date = {}
        for item in data.get("fear_and_greed_historical", {}).get("data", []):
            if item.get("x") is not None and item.get("y") is not None:
                d = datetime.datetime.utcfromtimestamp(item["x"] / 1000).strftime("%Y-%m-%d")
                by_date[d] = int(round(float(item["y"])))   # last value per day wins
        score = int(round(float(fg["score"])))
        today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
        by_date[today] = score
        hist = [{"date": d, "value": v} for d, v in sorted(by_date.items(), reverse=True)]
        snap["fearGreed"] = {
            "score": score,
            "rating": fg.get("rating", ""),
            "history": hist[:FNG_BARS],
        }
        ok("fearGreed", f"{score} {fg.get('rating')}")
    except Exception as e:
        fail("fearGreed", e)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    with open(SNAPSHOT) as f:
        snap = json.load(f)

    if not HAS_YF:
        log("ERROR: yfinance/pandas not installed")
        sys.exit(1)

    for step in (update_prices, update_breadth, update_hy_oas, update_cape,
                 update_fear_greed, update_forward_pe):
        try:
            step(snap)
        except Exception:
            traceback.print_exc()

    snap["timestamp"] = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    snap["sourceStatus"] = status

    with open(SNAPSHOT, "w") as f:
        json.dump(snap, f, separators=(",", ":"))

    failed = [k for k, v in status.items() if v != "ok"]
    log(f"Snapshot written. {len(status) - len(failed)}/{len(status)} sources OK.")
    if failed:
        log("Failed (kept previous values): " + ", ".join(failed))
    # Fail the job (→ GitHub e-mails you) only when the core price data is gone.
    if status.get("spy") != "ok" or len(failed) > len(status) // 2:
        sys.exit(1)


if __name__ == "__main__":
    main()
