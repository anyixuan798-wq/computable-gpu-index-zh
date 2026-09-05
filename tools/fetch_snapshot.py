#!/usr/bin/env python3
"""Computable GPU Index 中文看板 — 快照抓取器 (v2, 含 receipts 变动日志)

从公开 REST API (api.getcomputable.com, 匿名只读) 抓取:
  1) 各 SKU 价格历史   -> data/snapshot.json#skus      (图表)
  2) 各 SKU 最新观测 receipts -> 与上一版快照对比, 生成来源报价变动日志
     -> data/snapshot.json#receipt_log / #receipts_map (实时更新日志面板)

对比基准(按优先级):
  SNAPSHOT_PREV_URL 环境变量(指向已部署的上一版快照, GitHub Actions 用)
  本地 data/snapshot.json (手动种子用)

仅标准库, runner 直接可跑。
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

API = "https://api.getcomputable.com/v1"
SKUS = ["H100", "H200", "B200", "B300"]
PAGE = 2976
MAX_PAGES = 4
LOG_MAX = 160


def fetch(url: str, tries: int = 4) -> dict:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "gpu-index-zh-snapshot/2.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"fetch failed: {url} -> {last}")


def fetch_history(sku: str) -> list:
    rows, cursor, pages = [], None, 0
    while pages < MAX_PAGES:
        q = urllib.parse.urlencode({"limit": PAGE, **({"cursor": cursor} if cursor else {})})
        body = fetch(f"{API}/index/{sku}/history?{q}")["data"]
        vals = body.get("values", [])
        rows.extend(vals)
        cursor = body.get("next_cursor")
        pages += 1
        if not cursor or len(vals) < PAGE:
            break
    return rows


def fetch_receipts(sku: str) -> list:
    body = fetch(f"{API}/index/{sku}/latest?include=receipts").get("data", {})
    return [
        {"src": r.get("source_id"), "price": r.get("price"), "u": (r.get("source_url") or "").split("//")[-1].split("/")[0]}
        for r in body.get("receipts", []) if r.get("source_id")
    ]


def load_prev() -> dict | None:
    url = os.environ.get("SNAPSHOT_PREV_URL", "").strip()
    if url:
        try:
            return fetch(url, tries=2)
        except Exception:
            pass
    if os.path.exists("data/snapshot.json"):
        try:
            with open("data/snapshot.json", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def compact(row: dict) -> list:
    ts = int(datetime.fromisoformat(row["observed_at"].replace("Z", "+00:00")).timestamp())
    return [ts, row["value_usd_gpu_hr"], row.get("stability_band_usd_gpu_hr")]


def main() -> int:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    prev = load_prev()
    prev_map = (prev or {}).get("receipts_map") or {}
    prev_log = (prev or {}).get("receipt_log") or []

    out = {"generated_at": now, "skus": {}, "receipts_map": {}, "receipt_log": list(prev_log)}

    for sku in SKUS:
        rows = fetch_history(sku)
        rows.sort(key=lambda r: r["observed_at"])
        out["skus"][sku] = {
            "unit": "USD/GPU/hour",
            "first": rows[0]["observed_at"] if rows else None,
            "last": rows[-1]["observed_at"] if rows else None,
            "series": [compact(r) for r in rows],
        }
        print(f"{sku}: {len(rows)} rows  {rows[0]['observed_at'] if rows else '-'} .. {rows[-1]['observed_at'] if rows else '-'}", flush=True)

        cur = fetch_receipts(sku)
        out["receipts_map"][sku] = cur
        old = {r["src"]: r for r in prev_map.get(sku, [])}
        new_entries = []
        for r in cur:
            if r["src"] in old and old[r["src"]].get("price") is not None and r.get("price") is not None:
                d = round(r["price"] - old[r["src"]]["price"], 4)
                if abs(d) >= 0.005:
                    new_entries.append({"t": now, "sku": sku, "src": r["src"], "price": r["price"], "d": d, "u": r["u"]})
            elif r["src"] not in old and r.get("price") is not None:
                new_entries.append({"t": now, "sku": sku, "src": r["src"], "price": r["price"], "d": None, "u": r["u"]})
        if new_entries:
            print(f"  receipts changes: {len(new_entries)} -> " + ", ".join(f"{e['src']} {e['price']}{'(' + ('%+.2f' % e['d']) + ')' if e['d'] is not None else '(收录)'}" for e in new_entries), flush=True)
        out["receipt_log"] = new_entries + out["receipt_log"]

    out["receipt_log"] = out["receipt_log"][:LOG_MAX]

    with open("data/snapshot.json", "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    total = sum(len(v["series"]) for v in out["skus"].values())
    print(f"snapshot.json written: {total} history rows, {len(out['receipt_log'])} log entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
