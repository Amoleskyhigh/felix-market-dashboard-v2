#!/usr/bin/env python3
"""
update_snapshot.py
Fetch fresh market data from Alpha Vantage, FRED, and CNN Fear & Greed,
then write the updated market-data-snapshot.json in-place.

Data sources:
  - Alpha Vantage GLOBAL_QUOTE : SPY, QQQ, SMH, VIX, TNX, DXY, Copper, SPX, IXIC
  - Alpha Vantage TIME_SERIES_DAILY: SPY(250), QQQ/SMH/TNX/DXY/Copper(100 each)
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

# ── Config ───────────────────────────────────────────────────────────────────────

AV_KEY   = os.environ.get("AV_KEY", "G82DB8ZUK7E0FBKV")
SNAPSHOT = "market-data-snapshot.json"
AV_BASE  = "https://www.alphavantage.co/query"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
CNN_URL  = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"

# Alpha Vantage free tier: 5 requests/min, 25/day → sleep 15s between calls
RATE_SLEEP = 15

# ── Utilities ────────────────────────────────────────────────────────────────────

def log(msg):
    ts = datetime.datetime.utcnow().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def date_to_ms(date_str):
    "'YYYY-MM-DD' → UTC midnight milliseconds (int)."
    dt = datetime.datetime.strptime(date_str, "%Y-%m-%d").replace(
        tzinfo=datetime.timezone.utc)
    return int(dt.timestamp() * 1000)


# ── Alpha Vantage ────────────────────────────────────────────────────────────────

def av_global_quote(symbol):
    """Return (price: float|None, prev_close: float|None)."""
    try:
        r = requests.get(AV_BASE, params=dict(
            function="GLOBAL_QUOTE", symbol=symbol, apikey=AV_KEY), timeout=20)
        r.raise_for_status()
        gq = r.json().get("Global Quote", {})
        price = float(gq["05. price"])           if gq.get("05. price")       else None
        prev  = float(gq["08. previous close"])  if gq.get("08. previous close") else None
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


# ── FRED ─────────────────────────────────────────────────────────────────────────

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


# ── CNN Fear & Greed ─────────────────────────────────────────────────────────────

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


# ── Snapshot helpers ─────────────────────────────────────────────────────────────

def set_series(snap, key, series, max_bars):
    """Replace closes/timestamps in snap[key] with TIME_SERIES_DAILY data."""
    if not series:
        return
    subset = series[:max_bars]
    if key not in snap:
        snap[key] = {}
    snap[key]["closes"]     = [c for _, c in subset]
    snap[key]["timestamps"] = [t for t, _ in subset]


def prepend_price(snap, key, price, now_ms, max_bars=None):
    """Prepend today's price to snap[key] closes/timestamps arrays."""
    if price is None:
        return
    if key not in snap:
        snap[key] = {}
    closes = [price] + snap[key].get("closes", [])
    # Guard: filter out corrupted timestamps (non-integer values from past bugs)
    existing_tss = [t for t in snap[key].get("timestamps", []) if isinstance(t, int)]
    tss = [now_ms] + existing_tss
    if max_bars:
        closes = closes[:max_bars]
        tss    = tss[:max_bars]
    snap[key]["closes"]     = closes
    snap[key]["timestamps"] = tss


# ── Main ─────────────────────────────────────────────────────────────────────────

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

    # ── 1. GLOBAL_QUOTE ──────────────────────────────────────────────────────────
    GQ_SYMBOLS = [
        ("SPY",      "spy",    True),
        ("QQQ",      "qqq",    True),
        ("SMH",      "smh",    True),
        ("^VIX",     "vix",    False),   # no previousClose in snapshot
        ("^TNX",     "tnx",    False),
        ("DX-Y.NYB", "dxy",    False),
        ("HG=F",     "copper", False),
        ("^GSPC",    "spx",    True),
        ("^IXIC",    "ixic",   True),
    ]
    gq_cache = {}
    for sym, key, has_prev in GQ_SYMBOLS:
        log(f"GLOBAL_QUOTE {sym} …")
        price, prev = av_global_quote(sym)
        gq_cache[key] = (price, prev)
        if price is not None:
            if key not in snap:
                snap[key] = {}
            snap[key]["currentPrice"] = price
            if has_prev and prev is not None and "previousClose" in snap.get(key, {}):
                snap[key]["previousClose"] = prev
        time.sleep(RATE_SLEEP)

    # ── 2. TIME_SERIES_DAILY ─────────────────────────────────────────────────────
    TS_SYMBOLS = [
        ("SPY",      "spy",    250, "full"),
        ("QQQ",      "qqq",    100, "compact"),
        ("SMH",      "smh",    100, "compact"),
        ("^TNX",     "tnx",    100, "compact"),
        ("DX-Y.NYB", "dxy",    100, "compact"),
        ("HG=F",     "copper", 100, "compact"),
    ]
    for sym, key, max_bars, size in TS_SYMBOLS:
        log(f"TIME_SERIES_DAILY {sym} ({max_bars} bars) …")
        series = av_time_series(sym, size)
        if series:
            set_series(snap, key, series, max_bars)
            # Keep currentPrice from GLOBAL_QUOTE; fall back to latest bar
            if snap.get(key, {}).get("currentPrice") is None:
                if key not in snap:
                    snap[key] = {}
                snap[key]["currentPrice"] = series[0][1]
        else:
            # GQ fallback: prepend today's price to existing array
            price = gq_cache.get(key, (None, None))[0]
            prepend_price(snap, key, price, now_ms, max_bars)
        time.sleep(RATE_SLEEP)

    # VIX / SPX / IXIC – GLOBAL_QUOTE only: prepend to closes array
    for key in ("vix", "spx", "ixic"):
        price = gq_cache.get(key, (None, None))[0]
        prepend_price(snap, key, price, now_ms)

    # ── 3. FRED ──────────────────────────────────────────────────────────────────
    log("FRED BAMLH0A0HYM2 (HY OAS) …")
    hy_rows = fred_series("BAMLH0A0HYM2")
    if hy_rows:
        latest_hy = hy_rows[-1]
        hy_bp = int(round(latest_hy["value"] * 100))  # % → basis points (int)
        if "hyOAS" not in snap:
            snap["hyOAS"] = {"current": hy_bp, "history": []}
        snap["hyOAS"]["current"] = hy_bp
        existing = {h["date"] for h in snap["hyOAS"].get("history", [])}
        if today_str not in existing:
            snap["hyOAS"]["history"] = (
                [{"date": today_str, "value": hy_bp}]
                + snap["hyOAS"].get("history", []))

    log("FRED CAPE (Shiller PE) …")
    cape_rows = fred_series("CAPE")
    if cape_rows:
        latest_cape = cape_rows[-1]
        if "shiller" not in snap:
            snap["shiller"] = {"current": latest_cape["value"], "history": []}
        snap["shiller"]["current"] = latest_cape["value"]
        existing = {h["date"] for h in snap["shiller"].get("history", [])}
        if latest_cape["date"] not in existing:
            snap["shiller"]["history"] = (
                [{"date": latest_cape["date"], "value": latest_cape["value"]}]
                + snap["shiller"].get("history", []))

    # ── 4. CNN Fear & Greed ──────────────────────────────────────────────────────
    log("CNN Fear & Greed …")
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

    # ── 5. Finalize & write ──────────────────────────────────────────────────────
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
