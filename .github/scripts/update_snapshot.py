#!/usr/bin/env python3
"""
update_snapshot.py
Fetch fresh market data from Alpha Vantage, FRED, CNN Fear & Greed, and yfinance,
then write the updated market-data-snapshot.json in-place.

Data sources:
  - Alpha Vantage GLOBAL_QUOTE : SPY, QQQ, SMH, SPX, IXIC
  - Alpha Vantage TIME_SERIES_DAILY: SPY(250), QQQ/SMH(100 each)
  - yfinance                    : ^VIX, ^TNX, HG=F (Copper), DX-Y.NYB (DXY), Forward P/E
  - FRED CSV                    : BAMLH0A0HYM2 (HY OAS), CAPE (Shiller PE)
  - CNN Fear & Greed            : score, rating, history
"""

import base64
import json
import os
import sys
import time
import datetime
import traceback
import requests

try:
    import yfinance as yf
    HAS_YF = True
except ImportError:
    HAS_YF = False

# ── Config ─────────────────────────────────────────────────────────────────────

AV_KEY   = os.environ.get("AV_KEY", "G82DB8ZUK7E0FBKV")
SNAPSHOT = "market-data-snapshot.json"
AV_BASE  = "https://www.alphavantage.co/query"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
CNN_URL  = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"

# Alpha Vantage free tier: 5 requests/min, 25/day → sleep 15s between calls
RATE_SLEEP = 15

# 每個 ticker 的 closes/timestamps 最多保留 60 筆
MAX_CLOSES = 60

# ── Utilities ──────────────────────────────────────────────────────────────────

def log(msg):
    ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def date_to_ms(date_str):
    "'YYYY-MM-DD' → UTC midnight milliseconds (int)."
    dt = datetime.datetime.strptime(date_str, "%Y-%m-%d").replace(
        tzinfo=datetime.timezone.utc)
    return int(dt.timestamp() * 1000)


# ── Alpha Vantage ──────────────────────────────────────────────────────────────

def av_global_quote(symbol):
    """Return (price: float|None, prev_close: float|None)."""
    try:
        r = requests.get(AV_BASE, params=dict(
            function="GLOBAL_QUOTE", symbol=symbol, apikey=AV_KEY), timeout=20)
        r.raise_for_status()
        gq = r.json().get("Global Quote", {})
        price = float(gq["05. price"])           if gq.get("05. price")           else None
        prev  = float(gq["08. previous close"])  if gq.get("08. previous close")  else None
        return price, prev
    except Exception as e:
        log(f"WARN GLOBAL_QUOTE({symbol}): {e}")
        return None, None


def av_time_series(symbol, outputsize="compact"):
    """
    Return list of (ts_ms, close) sorted newest-first, or [] on failure.
    outputsize: 'compact' = ~100 bars, 'full' = up to 20+ years.
    """
    try:
        r = requests.get(AV_BASE, params=dict(
            function="TIME_SERIES_DAILY", symbol=symbol,
            outputsize=outputsize, apikey=AV_KEY), timeout=40)
        r.raise_for_status()
        daily = r.json().get("Time Series (Daily)", {})
        if not daily:
            log(f"WARN TIME_SERIES({symbol}): empty – keys={list(r.json().keys())[:5]}")
            return []
        results = sorted(
            [(date_to_ms(d), float(v.get("4. close", 0))) for d, v in daily.items()],
            key=lambda x: x[0], reverse=True)
        return results
    except Exception as e:
        log(f"WARN TIME_SERIES({symbol}): {e}")
        return []


# ── yfinance helpers ───────────────────────────────────────────────────────────

def yfinance_ticker(yf_symbol, period="1y", max_bars=252, label=None):
    """
    Generic yfinance daily history fetcher.
    Returns (current_price: float|None, series: [(ts_ms, close), ...] newest-first).
    """
    label = label or yf_symbol
    if not HAS_YF:
        log(f"WARN yfinance not installed, skipping {label}")
        return None, []
    try:
        ticker = yf.Ticker(yf_symbol)
        info = ticker.fast_info
        current = getattr(info, "last_price", None)
        if current is None or current == 0:
            current = getattr(info, "previous_close", None)

        hist = ticker.history(period=period, interval="1d", auto_adjust=True)
        if hist.empty:
            log(f"WARN yfinance {label}: empty history")
            return current, []

        series = []
        for dt_idx, row in hist.iterrows():
            ts_ms = int(dt_idx.timestamp() * 1000)
            close = float(row["Close"])
            if close > 0:
                series.append((ts_ms, close))

        series.sort(key=lambda x: x[0], reverse=True)  # newest-first
        series = series[:max_bars]

        if current is None and series:
            current = series[0][1]

        log(f"yfinance {label} OK: current={current}, {len(series)} bars")
        return current, series
    except Exception as e:
        log(f"WARN yfinance {label}: {e}")
        traceback.print_exc()
        return None, []


def yfinance_copper(max_bars=100):
    """Fetch copper futures (HG=F) via yfinance."""
    return yfinance_ticker("HG=F", period="6mo", max_bars=max_bars, label="copper HG=F")


def yfinance_dxy(max_bars=252):
    """
    Fetch DXY (US Dollar Index) via yfinance.
    AV's DX-Y.NYB history is unreliable/incomplete; yfinance gives clean 1-2yr daily data.
    """
    return yfinance_ticker("DX-Y.NYB", period="2y", max_bars=max_bars, label="DXY DX-Y.NYB")


def yfinance_vix(max_bars=100):
    """Fetch VIX via yfinance. AV ^VIX stopped returning data reliably (May 2026)."""
    return yfinance_ticker("^VIX", period="6mo", max_bars=max_bars, label="VIX ^VIX")


def yfinance_tnx(max_bars=252):
    """Fetch 10Y Treasury Yield via yfinance. AV ^TNX stopped returning data reliably (May 2026)."""
    return yfinance_ticker("^TNX", period="2y", max_bars=max_bars, label="TNX ^TNX")


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


# ── FRED ───────────────────────────────────────────────────────────────────────

def fred_series(series_id):
    """
    Return list of {'date': 'YYYY-MM-DD', 'value': float} in chronological
    order (oldest-first), or [] on failure. Skips missing-value rows ('.').
    """
    try:
        r = requests.get(FRED_CSV, params={"id": series_id}, timeout=20)
        r.raise_for_status()
        rows = []
        for line in r.text.strip().splitlines()[1:]:   # skip header
            parts = line.split(",")
            if len(parts) != 2:
                continue
            date_str, val_str = parts[0].strip(), parts[1].strip()
            if not val_str or val_str == ".":
                continue
            try:
                rows.append({"date": date_str, "value": float(val_str)})
            except ValueError:
                pass
        return rows
    except Exception as e:
        log(f"WARN FRED({series_id}): {e}")
        return []


def fetch_multpl_cape():
    """Fetch Shiller CAPE (current + monthly history) from multpl.com."""
    import re
    result = {"current": None, "history": {}}
    try:
        # --- Current value ---
        r = requests.get(
            "https://www.multpl.com/shiller-pe",
            timeout=20,
            headers={"User-Agent": "Mozilla/5.0 (compatible; snapshot-bot/1.0)"}
        )
        r.raise_for_status()
        # Use double-quoted raw string to avoid single-quote escaping issues
        match = re.search(r"""id=["'](current|value)["'].*?</b>\s*([\d.]+)""", r.text, re.DOTALL)
        if match:
            result["current"] = float(match.group(2))
            log(f"multpl.com CAPE current OK: {result['current']}")
        else:
            log("WARN multpl.com CAPE: could not parse current value")
    except Exception as e:
        log(f"WARN multpl.com CAPE current: {e}")

    try:
        # --- Monthly history ---
        r2 = requests.get(
            "https://www.multpl.com/shiller-pe/table/by-month",
            timeout=20,
            headers={"User-Agent": "Mozilla/5.0 (compatible; snapshot-bot/1.0)"}
        )
        r2.raise_for_status()
        # Parse table rows: <td>Jan 1, 2026</td><td>42.08</td>
        rows = re.findall(
            r"<td[^>]*>\s*(\w+ \d+,\s*\d{4})\s*</td>\s*<td[^>]*>\s*([\d.]+)\s*</td>",
            r2.text
        )
        from datetime import datetime
        hist = {}
        for date_str, val_str in rows:
            try:
                dt = datetime.strptime(date_str.strip(), "%b %d, %Y")
                key = dt.strftime("%Y-%m")
                hist[key] = float(val_str)
            except Exception:
                continue
        if hist:
            log(f"multpl.com CAPE history OK: {len(hist)} months")
            result["history"] = hist
        else:
            log("WARN multpl.com CAPE: could not parse history table")
    except Exception as e:
        log(f"WARN multpl.com CAPE history: {e}")

    return result


def fetch_cnn():
    """Return (score: int|None, rating: str|None, history: list) newest-first."""
    try:
        r = requests.get(CNN_URL, timeout=20, headers={
            "User-Agent": "Mozilla/5.0 (compatible; snapshot-bot/1.0)"})
        r.raise_for_status()
        data   = r.json()
        fg     = data.get("fear_and_greed", {})
        score  = int(round(float(fg["score"]))) if fg.get("score") is not None else None
        rating = fg.get("rating")
        raw    = data.get("fear_and_greed_historical", {}).get("data", [])
        history = []
        for item in raw:
            x, y = item.get("x"), item.get("y")
            if x is not None and y is not None:
                d = datetime.datetime.utcfromtimestamp(x / 1000).strftime("%Y-%m-%d")
                history.append({"date": d, "value": int(round(float(y)))})
        history.sort(key=lambda h: h["date"], reverse=True)
        return score, rating, history
    except Exception as e:
        log(f"WARN CNN FNG: {e}")
        return None, None, []


# ── Snapshot helpers ───────────────────────────────────────────────────────────

def set_series(snap, key, series, max_bars):
    """Replace closes/timestamps in snap[key] with time series data (最多 MAX_CLOSES 筆)."""
    if not series:
        return
    subset = series[:min(max_bars, MAX_CLOSES)]  # 只保留最近 MAX_CLOSES 筆
    if key not in snap:
        snap[key] = {}
    snap[key]["closes"]     = [c for _, c in subset]
    snap[key]["timestamps"] = [t for t, _ in subset]


def prepend_price(snap, key, price, now_ms, max_bars=MAX_CLOSES):
    """Prepend today's price to snap[key] closes/timestamps arrays (最多 MAX_CLOSES 筆)."""
    if price is None:
        return
    if key not in snap:
        snap[key] = {}
    closes = [price] + snap[key].get("closes", [])
    # Guard: filter out corrupted timestamps (non-integer values from past bugs)
    existing_tss = [t for t in snap[key].get("timestamps", []) if isinstance(t, int)]
    tss = [now_ms] + existing_tss
    closes = closes[:max_bars]  # 只保留最近 max_bars 筆
    tss    = tss[:max_bars]
    snap[key]["closes"]     = closes
    snap[key]["timestamps"] = tss


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    # Load snapshot (with defensive fallback for accidental base64 encoding)
    try:
        with open(SNAPSHOT) as f:
            raw = f.read().strip()

        try:
            snap = json.loads(raw)
        except json.JSONDecodeError:
            # Handle accidental double base64 encoding
            try:
                snap = json.loads(base64.b64decode(raw).decode('utf-8'))
                log("[WARN] Auto-fixed double base64 encoding in snapshot")
            except Exception as e:
                raise RuntimeError(f"Cannot parse snapshot (tried JSON and base64): {e}")
    except Exception as e:
        log(f"ERROR: Cannot read {SNAPSHOT}: {e}")
        traceback.print_exc()
        sys.exit(1)

    now_ms    = int(datetime.datetime.utcnow().replace(
                    tzinfo=datetime.timezone.utc).timestamp() * 1000)
    today_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")

    # ── 1. GLOBAL_QUOTE (AV) ──────────────────────────────────────────────────
    # NOTE: ^VIX, ^TNX, DX-Y.NYB removed from AV — unreliable since May 2026
    GQ_SYMBOLS = [
        ("SPY",   "spy",  True),
        ("QQQ",   "qqq",  True),
        ("SMH",   "smh",  True),
        ("^GSPC", "spx",  True),
        ("^IXIC", "ixic", True),
    ]
    gq_cache = {}
    for sym, key, has_prev in GQ_SYMBOLS:
        log(f"GLOBAL_QUOTE {sym} ...")
        price, prev = av_global_quote(sym)
        gq_cache[key] = (price, prev)
        if price is not None:
            if key not in snap:
                snap[key] = {}
            snap[key]["currentPrice"] = price
            if has_prev and prev is not None and "previousClose" in snap.get(key, {}):
                snap[key]["previousClose"] = prev
        time.sleep(RATE_SLEEP)

    # ── 2. TIME_SERIES_DAILY (AV) ─────────────────────────────────────────────
    TS_SYMBOLS = [
        ("SPY", "spy", 250, "full"),
        ("QQQ", "qqq", 100, "compact"),
        ("SMH", "smh", 100, "compact"),
    ]
    for sym, key, max_bars, size in TS_SYMBOLS:
        log(f"TIME_SERIES_DAILY {sym} ({max_bars} bars, capped at {MAX_CLOSES}) ...")
        series = av_time_series(sym, size)
        if series:
            set_series(snap, key, series, max_bars)
            if snap.get(key, {}).get("currentPrice") is None:
                if key not in snap:
                    snap[key] = {}
                snap[key]["currentPrice"] = series[0][1]
        else:
            price = gq_cache.get(key, (None, None))[0]
            prepend_price(snap, key, price, now_ms, max_bars)
        time.sleep(RATE_SLEEP)

    # SPX / IXIC – GLOBAL_QUOTE only
    for key in ("spx", "ixic"):
        price = gq_cache.get(key, (None, None))[0]
        prepend_price(snap, key, price, now_ms, MAX_CLOSES)

    # ── 2b. VIX via yfinance ──────────────────────────────────────────────────
    log("yfinance ^VIX ...")
    vix_price, vix_series = yfinance_vix(max_bars=100)
    if vix_series:
        set_series(snap, "vix", vix_series, 100)
        if "vix" not in snap:
            snap["vix"] = {}
        snap["vix"]["currentPrice"] = vix_price if vix_price else vix_series[0][1]
        log(f"VIX yfinance OK: current={snap['vix']['currentPrice']:.2f}, {len(snap['vix']['closes'])} bars stored")
    elif vix_price is not None:
        prepend_price(snap, "vix", vix_price, now_ms, max_bars=100)
        if "vix" not in snap:
            snap["vix"] = {}
        snap["vix"]["currentPrice"] = vix_price
        log(f"VIX yfinance price-only: {vix_price}")
    else:
        log("WARN VIX: yfinance failed, keeping existing snapshot values")

    # ── 2c. TNX via yfinance ──────────────────────────────────────────────────
    log("yfinance ^TNX ...")
    tnx_price, tnx_series = yfinance_tnx(max_bars=252)
    if tnx_series:
        set_series(snap, "tnx", tnx_series, 252)
        if "tnx" not in snap:
            snap["tnx"] = {}
        snap["tnx"]["currentPrice"] = tnx_price if tnx_price else tnx_series[0][1]
        log(f"TNX yfinance OK: current={snap['tnx']['currentPrice']:.2f}, {len(snap['tnx']['closes'])} bars stored")
    elif tnx_price is not None:
        prepend_price(snap, "tnx", tnx_price, now_ms, max_bars=252)
        if "tnx" not in snap:
            snap["tnx"] = {}
        snap["tnx"]["currentPrice"] = tnx_price
        log(f"TNX yfinance price-only: {tnx_price}")
    else:
        log("WARN TNX: yfinance failed, keeping existing snapshot values")

    # ── 2d. COPPER via yfinance ───────────────────────────────────────────────
    log("yfinance HG=F (Copper) ...")
    copper_price, copper_series = yfinance_copper(max_bars=100)
    if copper_series:
        set_series(snap, "copper", copper_series, 100)
        if "copper" not in snap:
            snap["copper"] = {}
        snap["copper"]["currentPrice"] = copper_price if copper_price else copper_series[0][1]
    elif copper_price is not None:
        prepend_price(snap, "copper", copper_price, now_ms, max_bars=100)
        if "copper" not in snap:
            snap["copper"] = {}
        snap["copper"]["currentPrice"] = copper_price
    else:
        log("WARN copper: no data from yfinance, keeping existing snapshot values")

    # ── 2e. DXY via yfinance ──────────────────────────────────────────────────
    log("yfinance DX-Y.NYB (DXY) ...")
    dxy_price, dxy_series = yfinance_dxy(max_bars=252)
    if dxy_series:
        set_series(snap, "dxy", dxy_series, 252)
        if "dxy" not in snap:
            snap["dxy"] = {}
        snap["dxy"]["currentPrice"] = dxy_price if dxy_price else dxy_series[0][1]
        log(f"DXY yfinance OK: {len(snap['dxy']['closes'])} bars stored, latest={dxy_series[0][1]:.2f}")
    elif dxy_price is not None:
        prepend_price(snap, "dxy", dxy_price, now_ms, max_bars=252)
        if "dxy" not in snap:
            snap["dxy"] = {}
        snap["dxy"]["currentPrice"] = dxy_price
        log(f"DXY yfinance price-only: {dxy_price}")
    else:
        price = gq_cache.get("dxy", (None, None))[0]
        prepend_price(snap, "dxy", price, now_ms, max_bars=252)
        log("WARN DXY: yfinance failed, using GLOBAL_QUOTE fallback")

    # ── 2f. USD/TWD via yfinance ──────────────────────────────────────────────
    log("yfinance TWD=X (USD/TWD) ...")
    if HAS_YF:
        try:
            twd_ticker = yf.Ticker("TWD=X")
            twd_info = twd_ticker.fast_info
            twd_current = getattr(twd_info, "last_price", None)
            if twd_current is None or twd_current == 0:
                twd_current = getattr(twd_info, "previous_close", None)

            twd_hist = twd_ticker.history(period="6mo", interval="1d", auto_adjust=True)
            twd_series = []
            if not twd_hist.empty:
                for dt_idx, row in twd_hist.iterrows():
                    ts_ms = int(dt_idx.timestamp() * 1000)
                    close = float(row["Close"])
                    if close > 0:
                        twd_series.append((ts_ms, close))
                twd_series.sort(key=lambda x: x[0], reverse=True)
                twd_series = twd_series[:100]

            if twd_series:
                set_series(snap, "twd", twd_series, 100)
                if "twd" not in snap:
                    snap["twd"] = {}
                snap["twd"]["currentPrice"] = twd_current if twd_current else twd_series[0][1]
                log(f"yfinance TWD=X OK: current={twd_current}, {len(snap['twd']['closes'])} bars stored")
            elif twd_current is not None:
                prepend_price(snap, "twd", twd_current, now_ms, max_bars=100)
                if "twd" not in snap:
                    snap["twd"] = {}
                snap["twd"]["currentPrice"] = twd_current
                log(f"yfinance TWD=X OK (price only): {twd_current}")
            else:
                log("WARN TWD=X: no data from yfinance, keeping existing")
        except Exception as e:
            log(f"WARN yfinance TWD=X: {e}")
            traceback.print_exc()
    else:
        log("WARN yfinance not installed, skipping USD/TWD")

    # ── 2g. TRUE Forward P/E via finviz.com (SPY, QQQ, SMH) ──────────────────
    # NTM consensus forward PE, NOT trailing. Primary: finviz. Fallback: computed.
    log("Forward P/E (SPY, QQQ, SMH) via finviz.com [NTM analyst consensus] ...")
    fwd_pe_data = fetch_forward_pe()
    if fwd_pe_data:
        if "forwardPE" not in snap:
            snap["forwardPE"] = {}
        snap["forwardPE"].update(fwd_pe_data)
        snap["forwardPE"]["updatedAt"] = today_str
        log(
            f"Forward P/E stored: "
            f"SPY={fwd_pe_data.get('spy')}x "
            f"QQQ={fwd_pe_data.get('qqq')}x "
            f"SMH={fwd_pe_data.get('smh')}x"
        )
    else:
        log("WARN Forward P/E: no data fetched, keeping existing snapshot values")

    # ── 3. FRED ───────────────────────────────────────────────────────────────
    log("FRED BAMLH0A0HYM2 (HY OAS) ...")
    hy_rows = fred_series("BAMLH0A0HYM2")
    if hy_rows:
        latest_hy = hy_rows[-1]
        hy_bp = int(round(latest_hy["value"] * 100))  # % → basis points
        if "hyOAS" not in snap:
            snap["hyOAS"] = {"current": hy_bp, "history": []}
        snap["hyOAS"]["current"] = hy_bp
        existing = {h["date"] for h in snap["hyOAS"].get("history", [])}
        if today_str not in existing:
            snap["hyOAS"]["history"] = (
                [{"date": today_str, "value": hy_bp}]
                + snap["hyOAS"].get("history", []))
        snap["hyOAS"]["history"] = snap["hyOAS"]["history"][:MAX_CLOSES]  # 只保留最近 MAX_CLOSES 筆

    log("Shiller CAPE (multpl.com) ...")
    cape_data = fetch_multpl_cape()
    snap["shiller"]["current"] = cape_data.get("current")
    new_hist = cape_data.get("history", {})
    if new_hist:
        existing = snap["shiller"].get("history", {})
        existing.update(new_hist)
        snap["shiller"]["history"] = existing

    # ── 4. CNN Fear & Greed ───────────────────────────────────────────────────
    log("CNN Fear & Greed ...")
    score, rating, fng_hist = fetch_cnn()
    if score is not None:
        if "fearGreed" not in snap:
            snap["fearGreed"] = {"score": score, "rating": rating or "", "history": []}
        snap["fearGreed"]["score"] = score
        if rating:
            snap["fearGreed"]["rating"] = rating
        existing = {h["date"] for h in snap["fearGreed"].get("history", [])}
        new_entries = [h for h in fng_hist if h["date"] not in existing]
        if new_entries:
            snap["fearGreed"]["history"] = (
                new_entries + snap["fearGreed"].get("history", []))
        snap["fearGreed"]["history"] = snap["fearGreed"]["history"][:MAX_CLOSES]  # 只保留最近 MAX_CLOSES 筆

    # ── 5. Finalize & write ───────────────────────────────────────────────────
    snap["timestamp"] = now_ms
    with open(SNAPSHOT, "w") as f:
        json.dump(snap, f, separators=(",", ":"))
    log("Snapshot written successfully ✓")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("FATAL UNHANDLED EXCEPTION:")
        traceback.print_exc()
        sys.exit(1)
