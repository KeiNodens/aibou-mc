# Dev notes for agents

## Layout

Monorepo: `agent-mod` (Forge 1.20.1 client mod, Java), `bridge` (Node/TS MCP
server), `skills` (hot-reloaded JS skills), `tools/mock-mod` (WS stub),
`docs` (design/spec/verification — Japanese). `server/`, `packs/`, `research/`
are local runtime artifacts, gitignored.

## Build & run

```bash
# client mod (JDK 17 via gradle wrapper; produces build/libs/*-all.jar)
cd agent-mod && ./gradlew build

# bridge
cd bridge && npm install && npm run build   # tsc → dist/
node dist/index.js                          # MCP :25589, connects WS :25587
BRIDGE_TOKEN=xxx node dist/index.js         # bearer-auth mode (for tunnels)

# test without Minecraft
node tools/mock-mod/mock-mod.mjs            # WS :25587 stub

# call an MCP tool directly
cd bridge && node mcp-call.mjs <tool> '<json-args>'
node mcp-call.mjs get_state '{}'
```

Deploy jar: copy `agent-mod/build/libs/*-all.jar` (the jarJar-bundled one,
contains Java-WebSocket) into the bot instance `mods/`. Restart the client;
agent-mod WS + bridge reconnect automatically (10s retry on title/disconnect).

Live environment (this workspace): Forge server `server/run.bat` (Windows —
`run.sh` uses `:` classpath separators and won't work), bot via
`prismlauncher --launch bot`, server `localhost:25565`, WS `:25587`, MCP `:25589`.

## Conventions

- All game objects addressed by `modid:name` registry IDs — never vanilla-only
- Mod ops dispatched in `GameOps.dispatch`; the method list MUST stay in sync
  with `AgentWsCapabilities.all()` and the bridge tool registrations in
  `bridge/src/mcp.ts`
- Mod-side code runs on the Minecraft main thread (WS callbacks are handed
  over via `Minecraft#execute`) — keep it that way
- Tasks (`AgentTask`) report via `task.done` events; `task_id` generation is
  per-WS-generation — a task is STALE after reconnect
- `baritone.mine` resolves `modid:name` via `BuiltInRegistries.BLOCK` and calls
  `mine(Block)` — do NOT use `mineByName`, it can't parse namespaces
- Mine counting: `countItems` uses a drop-alias map + `raw_X` heuristics since
  clients have no loot tables — extend `DROP_ALIAS` for special cases
- Skills are chat-facing: report progress/results via `ctx.say`, keep Codex
  replies to one short line (one-shot constraint)
- Code comments in Java/TS are Japanese; user-facing chat strings too
- `BRIDGE_TOKEN` is an env var — never commit secrets

## Verification

`docs/verification-m2.5.md` is the running field log — append results there.
Key live checks: `get_state` (in-world?), `bot_status` (WS connected?),
`scan_area`, `task_status`/`task_result`, `get_chat` (runner loops?).

## Compile-only mod deps

`agent-mod/libs/` jarはgitignore（再配布不可）。`build.gradle`の`blank:xxx`依存は
自前でjarを`agent-mod/libs/`に置くこと:
- `jade-11.13.3.jar` — Jade連携 (soft-dep、無くても動作するがコンパイルには必要)
