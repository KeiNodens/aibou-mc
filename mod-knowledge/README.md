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

## Analysis playbook — tips earned from the D52–D56 passes

Read this before deepening a mod whose rules turn out insufficient.
The point of layer 3 is cited accuracy; these notes keep the next
pass from re-learning the craft.

### Pinning a version (check the pack jar name first — it is truth)
- Tags, when they exist: AE2 `forge/v15.4.11`, Mekanism
  `v1.20.1-10.4.16.80`. fetch_mod_source.py resolves these.
- No tags, per-MC branch: ProjectE — pin the release COMMIT on the
  version branch (its title carries the version).
- CI build numbers: Twilight Forest (`4.3.2508`) — the exact build
  commit is not recorded in the repo; pin the branch tip and SAY SO
  in the rule file's source_ref.
- McJty-style: one branch per MC version; verify the version string
  in gradle.properties at the pinned commit.
- Org/repo names lie: TwilightForest lives under TeamTwilight;
  MekanismGenerators is a module (src/generators) of the main
  Mekanism repo, not a separate repo anymore.

### Where the rules live, by codebase shape
- Config classes: defaults come from defineInRange/define calls.
  Quote them AS config defaults, never as absolutes.
- Multiblock data/logic classes hold the operative constants
  (damage thresholds, burn temperatures, cost formulas).
- src/generated/resources is shipped data: advancement JSONs give
  progression DAGs via their parent fields; restriction/lock JSONs
  give biome and structure gates verbatim.
- Enum tables are the cleanest tier data (rates, capacities).
- Container classes: slot indices follow addSlot order in the
  constructor. GUI classes are CLIENT side — before designing an
  interaction, check whether the state is client presentation
  (ProjectE searchpage/filter) or server truth (SlotOutput.remove).
- Datapack JSONs under src/main/resources/data/<modid>/ are jar
  defaults that packs/servers can override (RFToolsDim dimlet
  costs). Cite as defaults; prefer live layer-2 data when the
  exact live value matters.

### Gotchas that already bit once
- Commented-out code is a FINDING (version-specific absence),
  not a rule: RFToolsDim's zero-power death is disabled in
  11.0.11. Record the absence explicitly.
- Verify a constant is USED on the path you claim. Mekanism's
  EXPLOSION_CHANCE looks like the meltdown probability but is a
  createMeltdown parameter; the probability is a config value in
  a different file.
- Headline numbers may pass through a factor config (ProjectE
  sell value x covalenceLoss). Find the factor before quoting.
- Graph-computed values (ProjectE EMC) live in NO table: quote
  the seed inputs and the computation model, never an invented
  output value.
- Requirements arrays in advancements are OR-of-AND sets; read
  all sets before claiming what a player must do.

### Process
- Clone blobless (--filter=blob:none) for reading, shallow for
  the PC cache in .sources/<mod>@<version>/.
- Capture grep -n line numbers in the same pass as the reading.
- Verify each finished file through the knowledge tool (rules
  list + one search hit) with a fixture like p33. Fixture runs
  need TEMP/TMP pointed at the repo root — the fixture bridge's
  cwd is a temp dir and bridge assets resolve cwd-relatively.
- Keep the .json about values and the .md about consequences:
  what the number means for the companion's operations.
