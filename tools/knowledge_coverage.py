#!/usr/bin/env python3
"""D40 layer 3 prep: which mods in a pack already have analysed
rules, and which are still missing?

Reads a pack's layer-2 extraction index (knowledge/index.json)
and the shared rule store (mod-knowledge/rules/), keyed by
mod id + version. Run it per pack/instance: packs sharing mod
versions reuse the same analysis, so coverage grows globally.

Usage:
  python tools/knowledge_coverage.py --pack-index knowledge/index.json
Prints JSON: {fingerprint, covered: [...], missing: [...]}.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack-index", required=True)
    ap.add_argument("--rules-dir", default=str(ROOT / "mod-knowledge" / "rules"))
    args = ap.parse_args()
    pack = json.loads(Path(args.pack_index).read_text(encoding="utf-8"))
    have = {p.name for p in Path(args.rules_dir).glob("*.json")}
    covered, missing = [], []
    for m in pack.get("mods", []):
        key = f"{m['id']}@{m['version']}.json"
        (covered if key in have else missing).append(
            {"id": m["id"], "version": m["version"], "name": m.get("name")})
    print(json.dumps({
        "fingerprint": pack.get("fingerprint"),
        "pack_mods": len(pack.get("mods", [])),
        "covered": covered,
        "missing": missing,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
