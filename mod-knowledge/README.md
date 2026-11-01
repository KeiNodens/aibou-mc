# mod-knowledge (D40 layer 3, shared across instances/packs)

Source-analysis results live here and are COMMITTED, unlike the
per-pack layer-2 extraction output (knowledge/, gitignored).
The same mod at the same version is analysed once and reused by
every instance and pack — the cache key is mod id + version +
source commit.

## Layout
- sources.json — mod id -> source repo (seed registry).
- rules/<modid>@<version>.json — machine-consumed rules:
  { mod, version, source_repo, source_commit, extracted_at,
    rules: [{ id, topic, value, quote, source_file, source_line }] }
  Every rule must cite where it came from; numeric values that
  code consumes need a verbatim quote from the source.
- rules/<modid>@<version>.md — LLM-facing distilled notes on the
  same provenance header.
- .sources/ — shallow clones cache (gitignored), populated by
  tools/fetch_mod_source.py.

Tools:
- tools/fetch_mod_source.py --mod <id> --version <v>
- tools/knowledge_coverage.py --pack-index knowledge/index.json
