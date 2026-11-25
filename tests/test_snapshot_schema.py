#!/usr/bin/env python3
"""Schema and cross-field consistency checks for published dashboard JSON."""

import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "market-data-snapshot.json"
FORWARD_PE = ROOT / "forward-pe-history.json"
REPORT_TZ = ZoneInfo("America/Los_Angeles")
REQUIRED_SERIES = {
    "spy", "qqq", "smh", "igv", "spx", "ixic", "sox", "boxx", "qld",
    "qtum", "vix", "tnx", "copper", "dxy", "twd",
}


def fail(message):
    raise AssertionError(message)


def dated_rows(rows, label):
    if not isinstance(rows, list) or not rows:
        fail(f"{label}: expected non-empty list")
    dates = [row.get("date") for row in rows if isinstance(row, dict)]
    if len(dates) != len(rows) or any(not isinstance(d, str) for d in dates):
        fail(f"{label}: every row must have a date")
    parsed = []
    for value in dates:
        try:
            parsed.append(dt.date.fromisoformat(value))
        except ValueError as exc:
            fail(f"{label}: invalid date {value!r}: {exc}")
    if len(set(dates)) != len(dates):
        fail(f"{label}: duplicate dates")
    return dates, parsed


def check_snapshot(data):
    assert data.get("schemaVersion") == 4
    status = data.get("sourceStatus")
    if not isinstance(status, dict):
        fail("sourceStatus must be an object")

    for key in REQUIRED_SERIES:
        asset = data.get(key)
        if not isinstance(asset, dict):
            fail(f"missing price series: {key}")
        timestamps, closes = asset.get("timestamps"), asset.get("closes")
        if not isinstance(timestamps, list) or not isinstance(closes, list):
            fail(f"{key}: timestamps/closes must be lists")
        if len(timestamps) != len(closes) or not timestamps:
            fail(f"{key}: timestamps/closes length mismatch or empty")
        if asset.get("status") == "unavailable":
            fail(f"{key}: required price series unavailable")

    shiller = data.get("shiller")
    if not isinstance(shiller, dict):
        fail("shiller must be an object")
    sh_status = shiller.get("status")
    sh_source = status.get("shiller")
    if sh_status == "unavailable":
        if sh_source != "failed" or shiller.get("current") is not None:
            fail("unavailable shiller has current data or non-failed source status")
        if shiller.get("history") or shiller.get("dailyHistory"):
            fail("unavailable shiller must not retain chart history")
    elif sh_status in {"available", "stale"}:
        if not isinstance(shiller.get("current"), (int, float)):
            fail("available/stale shiller requires numeric current")
        as_of = shiller.get("asOf")
        try:
            observation = dt.date.fromisoformat(as_of)
        except (TypeError, ValueError):
            fail("shiller asOf must be ISO date")
        today = dt.datetime.now(REPORT_TZ).date()
        age = (today - observation).days
        freshness = shiller.get("freshness")
        if not isinstance(freshness, dict):
            fail("shiller freshness missing")
        if freshness.get("asOf") not in (None, as_of):
            fail("shiller freshness.asOf mismatch")
        if freshness.get("ageDays") != age:
            fail(f"shiller ageDays mismatch: {freshness.get('ageDays')} != {age}")
        expected_fresh = age <= freshness.get("maxAgeDays", -1)
        if freshness.get("isFresh") != expected_fresh:
            fail("shiller freshness.isFresh mismatch")
        if (sh_status == "available") != expected_fresh:
            fail("shiller status/freshness mismatch")
        if sh_source not in {"ok", "stale"}:
            fail("shiller sourceStatus mismatch")
        history_dates, _ = dated_rows(shiller.get("history"), "shiller.history")
        if as_of not in history_dates:
            fail("shiller current/asOf missing from history")
        daily_dates, _ = dated_rows(shiller.get("dailyHistory"), "shiller.dailyHistory")
        if as_of not in daily_dates:
            fail("shiller current/asOf missing from dailyHistory")
    else:
        fail(f"invalid shiller status: {sh_status!r}")

    hy = data.get("hyOAS")
    if not isinstance(hy, dict):
        fail("hyOAS must be an object")
    if hy.get("status") == "unavailable":
        if hy.get("asOf") is not None or hy.get("freshness", {}).get("isFresh"):
            fail("unavailable HY OAS contains current-looking metadata")
    else:
        if hy.get("status") not in {"available", "stale"}:
            fail("invalid HY OAS status")
        if hy.get("fetchStatus") not in {"ok", "failed"}:
            fail("invalid HY OAS fetchStatus")
        freshness = hy.get("freshness", {})
        if freshness.get("isFresh") != (hy.get("status") == "available"):
            fail("HY OAS status/freshness mismatch")

    fg = data.get("fearGreed", {}).get("history")
    dated_rows(fg, "fearGreed.history")


def check_forward_pe(data):
    assert data.get("schemaVersion") == 3
    rows = data.get("snapshots")
    dates, parsed = dated_rows(rows, "forwardPE.snapshots")
    if parsed != sorted(parsed):
        fail("forwardPE.snapshots must be ascending")


def main():
    check_snapshot(json.loads(SNAPSHOT.read_text()))
    check_forward_pe(json.loads(FORWARD_PE.read_text()))
    print("PASS snapshot schema and cross-field consistency")


if __name__ == "__main__":
    main()
