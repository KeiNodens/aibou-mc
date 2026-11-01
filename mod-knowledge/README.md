# mod-knowledge (D40 layer 3, shared across instances/packs)

Source-analysis results live here and are COMMITTED, unlike the
per-pack layer-2 extraction output (knowledge/, gitignored).
The same mod at the same version is analysed once and reused by
every instance and pack — the cache key is mod id + version +
source commit.

CONSUMER NOTE: every file in mod-knowledge/ is read by AI agents
(via the knowledge tool), not by humans. Write for AI readability:
structured statements, explicit units on every number,
self-contained rules (no cross-references to "above"), no idioms,
no narrative framing. Human-oriented prose is a defect here.

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

## Analysis playbook (consumer: AI agents)

### Version pinning
Input: exact jar filename from the pack (ground truth for the
version string to match).
- scheme=tag | examples: AE2 "forge/v15.4.11", Mekanism
  "v1.20.1-10.4.16.80" | action: pin the tag;
  tools/fetch_mod_source.py resolves tags by version substring.
- scheme=release_commit_on_version_branch | example: ProjectE
  (no tags exist; branch "mc1.20.x"; release commit title =
  "ProjectE-1.20.1-PE1.0.1") | action: pin that commit.
- scheme=ci_build_number | example: Twilight Forest "4.3.2508"
  (= base version + CI build number; the exact build commit is
  NOT recorded in the repo) | action: pin the branch tip; the
  rule file's source_ref MUST state this approximation.
- scheme=branch_per_mc_version | example: RFToolsDimensions
  branch "1.20", gradle.properties "version=1.20-11.0.11" |
  action: verify the version string in gradle.properties AT the
  pinned commit.
- repo identity traps: Twilight Forest repo owner =
  "TeamTwilight" (not "TwilightForest"). MekanismGenerators is
  NOT a separate repo; it is the module src/generators inside
  mekanism/Mekanism.

### Rule locations by codebase pattern
- pattern=config_class -> numeric defaults appear as
  defineInRange/define arguments. Citation rule: state the value
  AS a config default; live server values may differ.
- pattern=multiblock_data_class -> operative constants and
  formulas (damage thresholds, burn temperatures, cost math).
- pattern=generated_resources (src/generated/resources) ->
  shipped data. Advancement JSON: field "parent" = progression
  edge; field "requirements" = array of AND-sets with OR
  between sets (read ALL sets before stating a requirement).
  Restriction JSON: biome/structure gates verbatim.
- pattern=enum_table -> tier data (rates, capacities). Highest
  citation reliability of all patterns.
- pattern=container_class -> slot index = addSlot call order in
  the constructor.
- pattern=gui_class -> CLIENT SIDE ONLY. Before designing an
  interaction, classify each state field: client presentation
  (example: ProjectE TransmutationInventory.searchpage and
  .filter) vs server truth (example: SlotOutput.remove performs
  the EMC deduction server-side).
- pattern=datapack_json (src/main/resources/data/<modid>/) ->
  jar defaults; packs and servers may override. Cite AS
  defaults; prefer live layer-2 extraction for exact live
  values.

### Verified gotchas (each observed in D52-D56; do not repeat)
- gotcha=commented_out_code: RFToolsDim 11.0.11 — the zero-power
  lethal damage in PowerHandler.handleLowPower is commented
  out. Rule form: record the ABSENCE as a version-specific fact.
- gotcha=unused_constant_lookalike: Mekanism EXPLOSION_CHANCE is
  an argument to createMeltdown, NOT the meltdown probability;
  the probability is GeneratorsConfig meltdownChance (default
  0.001). Check: trace a constant's call sites before citing it
  as a rate.
- gotcha=hidden_factor_config: ProjectE sell value = EMC value
  x config difficulty.covalenceLoss (default 1.0). Check for a
  factor config before quoting any derived number.
- gotcha=graph_computed_values: ProjectE EMC values are computed
  from seed values plus the recipe graph; most items appear in
  NO table. Rule form: cite the seed values and the computation
  model; never state a computed value as if it were sourced.
- gotcha=requirements_semantics: see pattern=generated_resources
  (OR of AND sets) — a single-set reading overstates what a
  player must do.

### Procedure per mod
1. Resolve the pin (section: Version pinning). Cache a shallow
   clone at mod-knowledge/.sources/<modid>@<version>/. Use a
   blobless clone (--filter=blob:none) as the reading copy.
2. During reading, record line numbers (grep -n) in the same
   pass; do not reconstruct them afterwards.
3. Outputs: rules/<modid>@<version>.json (values; schema in the
   Layout section) and rules/<modid>@<version>.md (consequences
   for companion operation; explicit units; no idioms).
4. Verification: knowledge tool action=rules lists the file AND
   action=search returns at least one rule hit from it. Fixture
   pattern: tools/fixtures/p33-projecte-rules.mjs. Fixture
   environment requirement: TEMP and TMP must equal the repo
   root (the fixture bridge runs with cwd = a temp dir, and the
   bridge resolves mod-knowledge relative to cwd / cwd/..).
