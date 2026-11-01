# aibou-mc — README for AI agents

English | [日本語](README_FOR_AGENTS.ja.md) | [Human README](README.md)

You are an AI agent (an MCP host / LLM) about to **operate** or **develop**
aibou-mc: an LLM-driven companion player for modded Minecraft 1.20.1 (Forge).
This document is the operational contract. The human README covers
installation for people; this one covers what *you* need to act correctly.

## System map

```
You (MCP host)
  │  MCP over HTTP  http://127.0.0.1:25589/mcp   (Bearer BRIDGE_TOKEN if set)
  ▼
bridge (Node/TS, bridge/) — MCP tools, skills, journal, tool gate, chat runner
  │  WebSocket JSON-RPC  ws://127.0.0.1:25587
  ▼
agent-mod (Forge client mod, agent-mod/) — game primitives + verb tasks
  ▼
Minecraft client (bot account "Rin") on a Forge 1.20.1 server
```

Facts to rely on:

- Ports: mod WS **25587**, bridge MCP **25589** (`GET /healthz` reports
  bridge + mod connection state; `GET /events` is an SSE event stream).
- The bot is a real client with a real inventory, health and position.
  Everything it does is visible to other players and constrained by the game.
- All item/block/entity addresses are registry IDs (`modid:name`). Never
  guess IDs — look them up (`registry_items`, `find_item`, `knowledge`).

## Connecting

1. Bridge running (`cd bridge && npm run build && node dist/index.js`), bot
   client in game. Check `/healthz` first: `mod: true` means the game side
   is connected.
2. Point your MCP host at `http://127.0.0.1:25589/mcp`. If the endpoint is
   exposed beyond localhost, `BRIDGE_TOKEN` is required and sent as
   `Authorization: Bearer <token>`. Token values are never printed in chat
   or logs by convention — they live outside the repo.
3. If you connect as an external host, the built-in chat→LLM runner should
   be off (`RUNNER=off`) so two hosts don't answer the same chat twice.

## Tool model

Three presentation rules shape what you see:

- **Tool gate (mod-aware).** Tools that need a specific mod (FTB Quests,
  AE2, Create, ProjectE, …) are presented only when that mod is in the
  connected pack. No mod connected → gated tools are hidden, not broken.
- **Groups/defaults.** Low-frequency admin/debug/build tools are off by
  default; `bridge/data/tool-config.json` (`enabled`/`disabled` lists,
  group switches) adjusts this without a restart. Development and fixture
  runs set `AIBOU_TOOL_PROFILE=full` to present everything.
- **Domain tools.** Related thin tools are merged into action-dispatched
  domain tools — use these names, older per-action names no longer exist:
  `quest` (list/inspect/frontier/plan/claim/aside), `schematic`
  (inspect/plan/create), `journal` (read/checkpoint/snapshot/
  session_summary/resume_plan), `approvals` (list/approve/deny), `task`
  (status/result/cancel_all), `screen` (read/click/close), `bots`
  (status/multi/loop_status/loop_resume).

Layers, bottom to top:

1. **Primitives** (mod ops): `get_state`, `get_chat`, `send_chat`,
   observation (`look_info`, `obs_*` via tools), `move`, `dig`, `look_at`,
   `equip`, `toss`, container ops, Baritone (`goto`, `mine`, `follow`), …
2. **Mod tasks** (verb chunks, seconds to tens of seconds): `combat.engage`,
   `combat.shoot`, `build.place`, `wait.condition`, `fishing.start`,
   `glide.start`, `drive.start`, `contraption.follow_local`. Each returns a
   `task_id`; completion arrives as a `task.done` event with a result
   object. **Tasks are deliberately not black boxes**: they emit milestone
   events so you can narrate, stop (`task` cancel) or redirect mid-flight.
3. **Skills** (bridge, `skills/*.mjs`, 47): judgment-heavy procedures —
   `cave_assist`, `branch_mine`, `process_chain`, `build_schematic`,
   `logistics`, `dragon_fight`, etc. Prefer skills over hand-rolled
   primitive sequences; they encode the pack-specific lessons.

## Behavior contract

These are design decisions (docs/decisions.md), not suggestions:

- **Play *with* the player.** Skills take `mode: auto|together|solo`
  (`auto` = presence-based). Together mode: announce what you're about to
  do, share notable discoveries (diamond/emerald/ancient debris are
  announced and left unmined for joint digging), yield the player's work
  area, and split digging by Fortune ownership (observe the player's held
  item, or their `party_tools` declaration). Solo mode: work quietly,
  journal summaries only.
- **Unknown dimensions: explore, don't pre-solve.** Dimension behavior is
  captured in profiles (`dimension_profile` skill) drafted *while*
  exploring with the player. Layer-3 knowledge may supplement, never
  replace, that first-visit experience.
- **Dangerous operations stop and ask.** The autonomy gate intercepts
  DANGEROUS ops (e.g. `chat.command`, `toss`, `sign.write`,
  `container.repo_action`, `quest.claim`): the call returns
  APPROVAL_REQUIRED, the player answers `.ok`/`.deny` in chat (or you use
  the `approvals` tool on their instruction), and an approval opens that
  method for ~5 minutes. Autonomy levels: 0 = observe, 1 = normal play
  (default), 2 = pre-approved sessions.
- **Memory has exactly one home per kind.** Waypoints live in the mod;
  the journal, places, party declarations and dimension profiles live in
  the bridge (`bridge/data/`); relationship/episode context lives with
  the host LLM. Write checkpoints to the journal as you work — after a
  restart, `journal resume_plan` is how the next session continues.
- **Report outcomes, not intentions.** A skill returning is not proof the
  world changed; verify via state/inventory diffs (skills already do
  postconditions — a `FAILED(POSTCONDITION)` result means the world did
  not reach the expected state).

## Knowledge

Use the `knowledge` tool before inventing mod behavior:

- **Layer 1 — game data**: registries (`registry_items`, `registry_blocks`),
  recipes (`recipe_lookup`), live probes (`probe_energy` — indicative
  client-side values).
- **Layer 2 — in-jar docs**: Patchouli guides and lang files extracted per
  pack into `knowledge/<modid>/`, searchable via `knowledge` (search/get/
  mods). Regenerate with `tools/extract_knowledge.py --mods-dir <dir>`.
- **Layer 3 — source-derived rules**: `mod-knowledge/rules/<mod>@<version>.json`,
  every rule citing repo@commit + file + verbatim quote (`knowledge`
  action `rules`; search also hits rules). Rules are shared across
  instances and packs — check coverage (`tools/knowledge_coverage.py`)
  before re-analyzing a mod.
- **Answering the player**: questions in chat are answered from layers
  1–3; demonstrating by placing a machine nearby is a legitimate answer.

## Development

- Build: `cd agent-mod && ./gradlew build` (Java), `cd bridge && npm run
  build` (tsc). Skills are hot-reloaded `.mjs`; no build step.
- Test without Minecraft: `tools/mock-mod/` emulates the game side;
  fixtures in `tools/fixtures/*.mjs` drive full bridge flows (37,
  covering journal persistence, approvals, combat, building, quests,
  knowledge). Standalone checks: `tools/verify-*.mjs`. Fixture gotchas:
  stub registrations belong in the fixture's `script(ctx)` scope;
  skills surface results through journal `work.end` entries.
- Machine definitions: `machines/*.json` (slot layout for
  `process_in_machine`); station definitions: `stations/*.json`
  (choreography for `world_craft`). Definitions marked unverified are
  drafts — treat their live behavior as unproven.
- Canonical decisions: `docs/decisions.md` (D1…). Layering rationale:
  `docs/design-layering.md`. Knowledge design: `docs/design-knowledge.md`.
  Live-verification backlog: `docs/verification-m2.5.md` +
  `docs/followup-2026-11-01.md`.

## Known limits (do not overclaim)

- AE2 autocraft: packet path implemented, real job completion on a
  pattern-provided network unverified. `pattern_encode` is probe-only.
- `commission` (post-placement machine configuration): framework live,
  zero bundled plans — plans are authored from live GUI data.
- Several Java mechanics (shield blocking, creeper kiting, shoot
  ballistics, effect values) are compile/fixture-verified; live
  confirmation is batched for joint play sessions.
- Secondary bots are observer-only; command routing to them is not
  implemented.
- Long-duration soak test has not been run.

## Safety

- Bindings are localhost by default; never expose the bridge without
  `BRIDGE_TOKEN`. Never ask a human to paste a token into chat.
- `run_command` runs with the bot's permission level. On servers you
  don't control, keep the bot un-op'd.
- The bot's inventory and EMC/knowledge progression are the *bot's*, not
  the player's — don't present them as the player's achievements.
