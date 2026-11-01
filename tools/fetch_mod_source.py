#!/usr/bin/env python3
"""D40 layer 3 prep: fetch a mod's source at the version a pack uses.

Resolution: mod id -> repo via mod-knowledge/sources.json (or
--repo). The tag is chosen from `git ls-remote --tags`: exact
version match first, then tags containing the version string
(prefer ones also containing 'forge', then the shortest name).
The clone is shallow (--depth 1) into the cache
mod-knowledge/.sources/<modid>@<version>/ — if that directory
already exists the fetch is skipped (CACHED), so multiple
instances/packs sharing this repo reuse one analysis source.

Usage:
  python tools/fetch_mod_source.py --mod ae2 --version 15.2.1
Prints JSON: {mod, version, repo, tag, commit, path, cached}.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


def pick_tag(tags: list[str], version: str) -> str | None:
    if version in tags:
        return version
    cand = [t for t in tags if version in t]
    if not cand:
        return None
    forge = [t for t in cand if "forge" in t.lower()]
    pool = forge or cand
    return sorted(pool, key=len)[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mod", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--repo")
    ap.add_argument("--cache", default=str(ROOT / "mod-knowledge" / ".sources"))
    args = ap.parse_args()

    repo = args.repo
    if not repo:
        reg = json.loads((ROOT / "mod-knowledge" / "sources.json")
                         .read_text(encoding="utf-8"))
        entry = reg.get("mods", {}).get(args.mod)
        if not entry:
            print(json.dumps({"error": f"no source registered for mod "
                                        f"'{args.mod}' — add it to "
                                        f"mod-knowledge/sources.json or pass --repo"}))
            return 1
        repo = entry["repo"]

    dest = Path(args.cache) / f"{args.mod}@{args.version}"
    if dest.exists() and (dest / ".git").exists():
        commit = git("-C", str(dest), "rev-parse", "HEAD").strip()
        print(json.dumps({"mod": args.mod, "version": args.version,
                          "repo": repo, "commit": commit,
                          "path": str(dest), "cached": True}))
        return 0

    remote = git("ls-remote", "--tags", repo)
    tags = []
    for line in remote.splitlines():
        parts = line.split("refs/tags/")
        if len(parts) == 2:
            tags.append(parts[1].removesuffix("^{}"))
    tags = sorted(set(tags))
    tag = None
    tried = []
    for cand in dict.fromkeys([args.version,
                               args.version.split("+")[0],
                               args.version.split("-")[0]]):
        tried.append(cand)
        tag = pick_tag(tags, cand)
        if tag:
            break
    if not tag:
        print(json.dumps({"error": f"no tag matching version "
                                   f"{args.version} in {repo}",
                          "tags_sample": tags[:20]}))
        return 1
    dest.parent.mkdir(parents=True, exist_ok=True)
    git("clone", "--depth", "1", "--branch", tag, repo, str(dest))
    commit = git("-C", str(dest), "rev-parse", "HEAD").strip()
    print(json.dumps({"mod": args.mod, "version": args.version,
                      "repo": repo, "tag": tag, "commit": commit,
                      "path": str(dest), "cached": False}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
