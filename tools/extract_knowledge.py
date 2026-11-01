#!/usr/bin/env python3
"""D40 layer 2: extract in-jar documentation from mod jars.

Reads every .jar in --mods-dir, and for each mod found (META-INF/
mods.toml) extracts into <out>/<modid>/:
  - lang_en.json / lang_ja.json   (assets/<modid>/lang/*.json)
  - patchouli/**                  (data/<modid>/patchouli_books/**)
and writes <out>/index.json with per-mod entries (item./block.
lang keys with en/ja names), guide titles, and a pack fingerprint
(sha256 over sorted jar names+sizes), so stale knowledge is
detectable after pack changes.

Usage:
  python tools/extract_knowledge.py --mods-dir <dir> --out knowledge
Stdlib only (zipfile/tomllib), Python 3.11+.
"""
import argparse
import hashlib
import io
import json
import sys
import tomllib
import zipfile
from pathlib import Path


def jar_version(zf: zipfile.ZipFile, mod: dict, jar_name: str) -> str:
    v = str(mod.get("version", "") or "")
    if v and "${" not in v:
        return v
    try:
        mf = zf.read("META-INF/MANIFEST.MF").decode("utf-8", "replace")
        for line in mf.splitlines():
            if line.lower().startswith("implementation-version:"):
                return line.split(":", 1)[1].strip()
    except KeyError:
        pass
    return v or jar_name


def extract_jar(jar_path: Path, out_dir: Path) -> list[dict]:
    results = []
    try:
        zf = zipfile.ZipFile(jar_path)
    except zipfile.BadZipFile:
        return results
    names = set(zf.namelist())
    if "META-INF/mods.toml" not in names:
        return results
    try:
        meta = tomllib.loads(zf.read("META-INF/mods.toml").decode("utf-8"))
    except Exception:
        return results
    for mod in meta.get("mods", []):
        modid = mod.get("modId")
        if not modid:
            continue
        mod_out = out_dir / modid
        entry = {
            "id": modid,
            "name": mod.get("displayName", modid),
            "version": jar_version(zf, mod, jar_path.name),
            "jar": jar_path.name,
            "entries": [],
            "guides": [],
            "lang_entries": 0,
            "guides_count": 0,
        }
        # --- lang files ---
        lang: dict[str, dict] = {}
        for loc, fname in (("en_us", "lang_en.json"), ("ja_jp", "lang_ja.json")):
            src = f"assets/{modid}/lang/{loc}.json"
            if src in names:
                try:
                    data = json.loads(zf.read(src).decode("utf-8"))
                except Exception:
                    data = {}
                lang[loc] = data
                mod_out.mkdir(parents=True, exist_ok=True)
                (mod_out / fname).write_text(
                    json.dumps(data, ensure_ascii=False, indent=1),
                    encoding="utf-8")
        en, ja = lang.get("en_us", {}), lang.get("ja_jp", {})
        for key in sorted(set(en) | set(ja)):
            if key.startswith(("item.", "block.", "entity.")):
                entry["entries"].append({
                    "key": key,
                    "en": en.get(key),
                    "ja": ja.get(key),
                })
        entry["lang_entries"] = len(entry["entries"])
        # --- patchouli books ---
        prefix = f"data/{modid}/patchouli_books/"
        for name in sorted(names):
            if not name.startswith(prefix) or name.endswith("/"):
                continue
            rel = name[len(prefix):]
            dest = mod_out / "patchouli" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(name))
            if rel.endswith("book.json"):
                try:
                    book = json.loads(zf.read(name).decode("utf-8"))
                    entry["guides"].append({
                        "title": book.get("name", rel),
                        "path": f"patchouli/{rel}",
                    })
                except Exception:
                    pass
        entry["guides_count"] = len(entry["guides"])
        results.append(entry)
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mods-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    mods_dir = Path(args.mods_dir)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    jars = sorted(mods_dir.glob("*.jar"))
    h = hashlib.sha256()
    mods: list[dict] = []
    skipped = 0
    for jar in jars:
        h.update(jar.name.encode())
        h.update(str(jar.stat().st_size).encode())
        got = extract_jar(jar, out_dir)
        if got:
            mods.extend(got)
        else:
            skipped += 1
    index = {
        "fingerprint": h.hexdigest()[:16],
        "jars": len(jars),
        "skipped_jars": skipped,
        "mods": mods,
    }
    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"jars={len(jars)} skipped={skipped} mods={len(mods)} "
          f"fingerprint={index['fingerprint']}")
    for m in mods:
        print(f"  {m['id']} ({m['name']}) v{m['version']} "
              f"lang={m['lang_entries']} guides={m['guides_count']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
