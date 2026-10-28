# aibou-mc

English | [日本語](README.ja.md)

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
  MCP host (Codex tested; Muse and others pluggable)
```

The bot is a **separate Minecraft client** (second account/instance) that joins
your dedicated Forge server like any player. In-game chat is the primary
interface: you type "砂を5個集めて", the companion acknowledges in chat, goes
mining, and reports back in chat.

## Features

- **Chat-driven companion** — talk in game chat; it answers and acts
- **Skills layer** — `follow_player`, `gather`, `come_here`, `give`, `stop_all`,
  each a single hot-reloadable JS file in `skills/` exposed as an MCP tool
- **Two-layer API** — high-level skills for the LLM, low-level primitives
  (`move`, `dig`, `look_at`, `equip`, `toss`, Baritone `goto`/`mine`/`follow`)
  as an escape hatch
- **Mod-aware** — registry IDs for modded blocks/entities, modded ore drop
  counting (`mekanism:tin_ore` → `raw_tin` verified), Japanese display-name
  item search (`find_item`)
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
| `docs/` | Design, spec, verification log, mod-compat notes (mostly Japanese) |

## Quickstart

Requires: JDK 17, Node 18+, a Forge 1.20.1 dedicated server, a second
Minecraft instance for the bot (Prism Launcher recommended), Baritone
(`baritone-api-forge`) + agent-mod in the bot instance.

```bash
# 1. Build the client mod → deploy jar into the bot instance's mods/
cd agent-mod && ./gradlew build
cp build/libs/agentmod-*-all.jar <bot instance>/.minecraft/mods/

# 2. Run the dedicated server (same mod set as clients — see docs/mod-compat.md)
cd server && ./run.bat        # or run.sh on Linux

# 3. Run the bridge
cd bridge && npm install && npm run build
node dist/index.js            # listens on http://127.0.0.1:25589/mcp

# 4. Launch the bot client — it auto-connects to the server and to the bridge
```

Endpoints: agent-mod WS `ws://127.0.0.1:25587`, bridge MCP
`http://127.0.0.1:25589/mcp`, health `GET /healthz`. Point your MCP host
(Codex config, etc.) at the MCP URL. Set `BRIDGE_TOKEN` to require
`Authorization: Bearer <token>` when exposing the endpoint via a tunnel.

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
(cancellation). Files are watched and hot-reloaded; `reload_skills` forces it.

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
- **`run_command` requires the bot to be op** on the server. Powerful: an
  LLM with op can `/give` but also `/stop`. Use on private servers only.

## Safety

- Everything binds `127.0.0.1` by default — nothing is exposed unless you
  tunnel it (then set `BRIDGE_TOKEN`).
- `run_command` executes server commands with the bot's permission level.
  Keep the bot un-op'd on servers you don't control.
- `skills/debug_entity.mjs` is a dev/debug skill; delete before publishing
  your own deployment if unwanted.

## Status & roadmap

Milestones M0–M5 verified live on a **262-mod pack** (see
`docs/verification-m2.5.md` for the full field log and `docs/mod-compat.md`
for the mod compatibility notes — several mods needed removal/patching).

Done: environment, mod skeleton, primitives, Baritone, skills, companion MVP,
full-pack validation, crafting + meaning-level container/GUI ops
(`container.read/click/button/trade`, `machines/*.json` — 113 machine defs,
see `docs/mod-support.md`), entity interactions (feed/tame/shear/leash/mount/
trade), `use_item` incl. charge-and-release (`hold_ticks`), Jade-powered
`look_info`, AE2 ME-network ops (`container_repo` read +
`container_repo_action` withdraw/autocraft + quick_move deposit), death-screen
`respawn`, inventory desync recovery (`inventory_resync`), craft planning
(`craft_plan` skill incl. machine-processing steps), named waypoints
(`waypoint` skill, mirrored into JourneyMap when installed), reflex layer
(damage/proximity interrupts + Baritone retreat), persistent work journal
(`work_journal`/`work_checkpoint` — generation-independent), schematic
ingestion (`schematic_inspect`/`schematic_plan` for .litematic/.schem), and
FTB Quests progress ops (`quest_list`/`quest_inspect`), armor/offhand equip
(`equip{item,slot_name}`), sneak-modified use (`use_item{sneak}`), item state
inspection (`item_info` — energy/durability/enchants/NBT), NBT-variant
visibility in `get_state` (`inventory_detail[].attrs` — `nbt_keys` +
`energy_stored`), dig auto-tool-selection plus explicit `tool_slot` override,
Curios accessory equipping (`container_open_curios` + `curios_id` slot
labels — backpack/jetpack/charm slots reachable via semantic clicks), and
verified AoE mining through the normal dig path. Not done:
positive-path `give`/`come_here` tests, Muse host connection, long-duration
soak.

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
- **JourneyMap** — when installed on the bot client, `waypoint_save` /
  `waypoint_delete` mirror named waypoints into JourneyMap's `agentmod`
  group, so they show up as beacons on the bot's map (journeymap-api v2,
  reflection-based soft dep).
- **FTB Quests** — when installed on client+server, `quest_list` /
  `quest_inspect` read chapters, tasks, rewards and started/completed state
  from `ClientQuestFile` (reflection-based soft dep; empty until the pack
  ships quest definitions).
- **Curios** — `container_open_curios` asks the server to open the Curios
  accessory menu; `container_read` then labels each slot with its
  `curios_id` (back / jetpack / charm / ring…), so `container_click`
  equips a backpack or gadget the same way as any other menu.
  (reflection-based soft dep)

## License

MIT — see [LICENSE](LICENSE).
