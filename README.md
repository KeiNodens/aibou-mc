# aibou-mc

English | [日本語](README.ja.md) | [For AI agents](README_FOR_AGENTS.md)

An AI companion for **modded Minecraft 1.20.1 (Forge)** — play together with an
LLM-driven player that chats, follows you, gathers resources, and acts in the
world like a real companion, not a chatbot overlay.

Unlike most Minecraft AI projects, this targets **modded environments from day
one**: every address (items, blocks, entities) is a `modid:name` registry ID,
so `mekanism:osmium_ore` works exactly like `minecraft:rabbit`.

```
Minecraft client (bot account)
  └─ agent-mod (Forge) ── Baritone pathing, WebSocket server :25587
         │  ws://127.0.0.1:25587
         ▼
  bridge (Node/TS) ── MCP server :25589/mcp, skill loader, event buffer,
         │           chat→LLM runner
         ▼
  MCP host (Codex and Muse connected; others pluggable)
```

The bot is a **separate Minecraft client** (second account/instance) that joins
your dedicated Forge server like any player. In-game chat is the primary
interface: you type "砂を5個集めて", the companion acknowledges in chat, goes
mining, and reports back in chat.

## Features

- **Chat-driven companion** — talk in game chat; it answers and acts
- **Skills layer** — 47 skills (`follow_player`, `gather`, `cave_assist`,
  `branch_mine`, `build_schematic`, `process_in_machine`, `process_chain`,
  `craft`, `quest`-aware helpers, …), each a single hot-reloadable JS file in
  `skills/` exposed as an MCP tool
- **Two-layer API** — high-level skills for the LLM, low-level primitives
  (`move`, `dig`, `look_at`, `equip`, `toss`, Baritone `goto`/`mine`/`follow`)
  as an escape hatch
- **Plays *with* you, not instead of you** — companion/solo presence modes:
  near a player it announces notable finds (diamond veins are left for joint
  digging), yields your work area, and splits digging roles by who holds the
  Fortune pickaxe; alone it works quietly and journals what it did
- **Mod-aware** — registry IDs for modded blocks/entities, modded ore drop
  counting (`mekanism:tin_ore` → `raw_tin` verified), Japanese display-name
  item search (`find_item`), 143 machine GUI definitions and 21 station
  definitions for modded processing
- **Safety model** — autonomy levels with an approval gate: dangerous
  operations (server commands, throwing items, claiming quest rewards, …)
  stop and ask in chat instead of executing silently
- **Knowledge built in** — the companion can look up the pack's own data:
  registries, recipes, in-jar guide books (Patchouli/lang extraction), and
  source-derived rule files with citations (`knowledge` tool)
- **Real-world capabilities** — waypoint memory, screenshots, entity lookup,
  area scans, emotes, server commands (op-gated), task lifecycle with
  `task_id`/status/result/cancel events
- **Hot-reload skills** — drop a `.mjs` file in `skills/`, it becomes a tool

## Repository layout

| Path | What |
|---|---|
| `agent-mod/` | Forge 1.20.1 client mod (Java). WS API, Baritone integration, task system |
| `bridge/` | Node/TypeScript MCP server + WS client + skill loader + chat runner |
| `skills/` | One JS module per skill: `{name, description, params, run(ctx, args)}` |
| `tools/mock-mod/` | Mock game-side WS impl — test the bridge with no Minecraft |
| `tools/fixtures/` | End-to-end bridge fixtures against the mock mod |
| `machines/` | Machine GUI slot definitions (`*.json`) read by `process_in_machine` / `craft_plan` |
| `stations/` | Station definitions for the generic `world_craft` executor |
| `mod-knowledge/` | Source-derived rule files, keyed by mod id + version + source commit |
| `docs/` | Design, spec, verification log, mod-compat notes (mostly Japanese) |

## Quickstart

Requires: JDK 17, Node 18+, a Forge 1.20.1 dedicated server, a second
Minecraft instance for the bot (Prism Launcher recommended), Baritone
(`baritone-api-forge`) + agent-mod in the bot instance.

```bash
# 1. Build the client mod → deploy jar into the bot instance's mods/
cd agent-mod && ./gradlew build
cp build/libs/agentmod-*-all.jar <bot instance>/.minecraft/mods/

# 2. Run the dedicated server in your own Forge 1.20.1 server directory
#    (not part of this repo; same mod set as clients — see docs/mod-compat.md)
cd <your-forge-server> && ./run.bat        # or run.sh on Linux

# 3. Run the bridge
cd bridge && npm install && npm run build
node dist/index.js            # listens on http://127.0.0.1:25589/mcp

# 4. Launch the bot client — it auto-connects to the server and to the bridge
```

Endpoints: agent-mod WS `ws://127.0.0.1:25587`, bridge MCP
`http://127.0.0.1:25589/mcp`, health `GET /healthz`. Point your MCP host at
the MCP URL. Set `BRIDGE_TOKEN` to require `Authorization: Bearer <token>`
when exposing the endpoint via a tunnel.

### Bridge env vars

| Var | Default | Purpose |
|---|---|---|
| `MOD_URL` | `ws://127.0.0.1:25587` | agent-mod WebSocket |
| `MCP_PORT` | `25589` | MCP HTTP port |
| `BRIDGE_TOKEN` | (unset = no auth) | bearer token for exposed endpoints |
| `SKILLS_DIR` | `../skills` | skill directory |
| `RUNNER` | `on` | set `off` to disable the chat→LLM runner |
| `RUNNER_COMMAND` | `codex` | LLM CLI invoked per chat batch |
| `RUNNER_PROMPT_FILE` | (built-in) | prompt template; `{chatLog}` is replaced with history |
| `RUNNER_TIMEOUT_MS` | `600000` | kill a hung LLM run |
| `BOT_NAME` | `Rin` | bot's player name (self-message filter) |
| `AIBOU_TOOL_PROFILE` | (gated) | `full` presents every tool (development/fixtures) |

`bridge/mcp-call.mjs` is a small CLI for calling tools directly:

```bash
node mcp-call.mjs get_state '{}'
node mcp-call.mjs gather '{"block":"mekanism:tin_ore","count":4}'
node mcp-call.mjs mine '{"block":"minecraft:stone","count":3,"mode":"additional"}'
```

## Skills

A skill is a default-exported object in `skills/*.mjs`:

```js
export default {
  name: 'gather',
  description: 'Gather blocks via Baritone mine until the count is collected.',
  params: { block: { type: 'string', required: true },
            count: { type: 'integer' } },
  async run(ctx, { block, count = 1 }) {
    await ctx.say(`${block} を${count}個集めてくるね`);
    const r = await ctx.call('baritone.mine', { block, count, mode: 'ensure' });
    const d = await ctx.waitTask(r.task_id, 300_000);
    // ...report in chat, return a result object
  },
};
```

`ctx`: `call` (mod RPC), `state`, `say` (chat), `waitTask`, `sleep`, `signal`
(cancellation), `journal` (persistent work log), `schematicPlan`,
`commission` (post-placement machine configuration). Files are watched and
hot-reloaded; `reload_skills` forces it.

### `mine` semantics — important

`baritone.mine` / the `mine` tool take `mode`:

- `"additional"` (default) — collect N **more** items
- `"ensure"` — target N **total** in inventory; mines only the shortfall and
  succeeds immediately if already held

The `gather` skill uses `ensure`, which is the natural reading of "get me 5
sand" — if you already have 6 it just says so instead of digging anyway.

## Companion prerequisites learned the hard way

- **Give the bot a pickaxe.** Baritone can't path to encased ore/stone
  bare-handed (its mining cost explodes past search limits → endless
  blacklist loop). With an iron pickaxe it works instantly.
- **`obs.entity` excludes the bot itself** — `give`/`come_here` need a *real
  second player*; you can't self-target.
- **`run_command` requires the bot to be op** on the server and sits behind
  the approval gate. Powerful: an LLM with op can `/give` but also `/stop`.
  Use on private servers only.

## Safety

- Everything binds `127.0.0.1` by default — nothing is exposed unless you
  tunnel it (then set `BRIDGE_TOKEN`).
- Dangerous operations are gated by the autonomy system: they pause for an
  in-chat approval (`.ok` / `.deny`) instead of running silently, and an
  approval opens that operation type for a few minutes only.
- `run_command` executes server commands with the bot's permission level.
  Keep the bot un-op'd on servers you don't control.
- `skills/debug_entity.mjs` is a dev/debug skill; delete before publishing
  your own deployment if unwanted.

## Status & roadmap

Milestones M0–M5 are verified live on a **262-mod pack**, and the companion
layer on top (autonomy, memory, quests, exploration, combat, building,
knowledge) is implemented and fixture-verified against a mock mod
(full field log: `docs/verification-m2.5.md`; compatibility notes:
`docs/mod-compat.md`; per-mod support detail: `docs/mod-support.md`).

**Working today**

| Area | What works |
|---|---|
| Foundations | Forge client mod + WebSocket API; primitives (`move` / `dig` / `look_at` / `equip` / `toss`); Baritone pathing (`goto` / `mine` / `follow`); task lifecycle with cancel/events |
| Companion skills | Chat-driven runner; 47 hot-reloadable skills — companionship (`follow_player`, `cave_assist`, `give`), work (`gather`, `branch_mine`, `lumber`, `farm`, `ranch`), industry (`process_in_machine`, `process_chain`, `process_batch`, `stock_keeper`), building (`build_schematic`, `build_site`, `light_up`), exploration (`find_stronghold`, `dragon_fight`, `dimension_profile`) |
| Crafting & machine GUI | Meaning-level container ops (`container.read` / `click` / `button` / `trade`); 143 machine GUI definitions (`machines/*.json`); `craft_plan` incl. machine-processing steps; AE2 ME-network ops (read / withdraw / autocraft); `jei_search` |
| World interaction | Entity interactions (feed / tame / shear / leash / mount / trade); `use_item` incl. charge-and-release and sneak variants; Curios accessory equipping; verified AoE mining through the normal dig path; dig auto-tool-selection |
| Input & screens | Key/scroll injection plus a real OS-input path (Mekanism radial menu by hold+scroll, verified); screen ops via the `screen` domain tool; generic text input (`type_text`); `sign_write` |
| Awareness & memory | Jade-powered `look_info`; item/NBT state inspection; persistent work journal & checkpoints; named waypoints (canonical store in the mod, mirrored into JourneyMap); reflex layer (damage/proximity interrupts + retreat); schematic ingestion (`.litematic` / `.schem`); FTB Quests (graph, frontier ranking via `quest_guide`, completion watcher) |
| Autonomy & safety | Autonomy levels 0–2 with approval gate; run/hold lease with stale reclaim; presence-aware runner deferral (no cold autonomous starts next to a player who hasn't spoken) |
| Knowledge | Pack registries/recipes as data; in-jar guide extraction behind the `knowledge` tool; source-derived rule store (`mod-knowledge/`) with per-rule citations |
| Recovery | Death-screen `respawn`; deathpoint recording + `recover`; inventory desync recovery (`inventory_resync`) |

**Not done yet**

| Item | Note |
|---|---|
| Long-duration soak test | Not run yet |
| AE2 autocraft, real job completion | Packet path implemented; end-to-end job on a pattern-provided network unverified |
| Layer-3 rule coverage | Source analysis proceeds mod by mod (ProjectE → AE2 → Twilight Forest → Mekanism → RFTools); endgame mod support builds on these rules |
| Commission plans | Framework + auto-run after builds are in; bundled plans await live GUI data |
| Enchanting & brewing skills | Machine/station definitions exist, but no dedicated skills yet — the enchanting flow (XP, lapis, offer selection) and brewing (bottle handling, potion steps) are not covered |

## Optional integrations

These mods are soft dependencies — aibou-mc works without them but gets
smarter when they're present.

- **Jade** — when installed on the bot client, `look_info` returns Jade's
  rich tooltip data (machine energy, fluids, progress) instead of plain
  registry IDs. The companion literally sees what you see.
  (compile-only dep: drop `jade-11.13.3.jar` into `agent-mod/libs/`)
- **AE2 / Applied Energistics-family terminals** — open any ME-style
  terminal screen and `container_repo` dumps the whole network inventory
  (serial/id/amount/requestable/craftable). `container_repo_action` extracts
  entries by serial via AE2's native `MEInteractionPacket`, and normal
  `container_click` quick_move deposits player-inventory items into the
  network — verified end-to-end on a powered test grid. Autocraft requests
  work through the same op: `AUTO_CRAFT` (amount screen) →
  `CONFIRM_AUTO_CRAFT` (plan screen) → `GUI_ACTION` `startJob`.
- **JourneyMap** — when installed on the bot client, waypoints saved through
  the `waypoint` skill mirror into JourneyMap's `agentmod` group, so they
  show up as beacons on the bot's map (journeymap-api v2, reflection-based
  soft dep).
- **FTB Quests** — when installed on client+server, the `quest` domain tool
  reads chapters, tasks, rewards and started/completed state; the SNBT quest
  book is parsed bridge-side into a dependency graph, so the frontier of
  available quests is always known to the planner.
- **Curios** — `container_open_curios` asks the server to open the Curios
  accessory menu; `container_read` then labels each slot with its
  `curios_id` (back / jetpack / charm / ring…), so `container_click`
  equips a backpack or gadget the same way as any other menu.
  (reflection-based soft dep)

## License

MIT — see [LICENSE](LICENSE).
