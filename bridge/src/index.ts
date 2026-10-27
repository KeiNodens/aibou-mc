import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { State } from './state.js';
import { ModClient } from './modclient.js';
import { createMcpServer } from './mcp.js';
import { startRunner } from './runner.js';
import { Skills } from './skills.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOD_URL = process.env.MOD_URL ?? 'ws://127.0.0.1:25587';
const MCP_PORT = Number(process.env.MCP_PORT ?? 25589);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
const RUNNER = process.env.RUNNER !== 'off';
const SKILLS_DIR =
  process.env.SKILLS_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');

const state = new State();
const mod = new ModClient(MOD_URL, state);
mod.start();
const skills = new Skills(state, mod, SKILLS_DIR);
await skills.load();
skills.watch();

const app = express();
app.use(express.json());

// トンネルで /mcp を外部公開する場合の保護。BRIDGE_TOKEN 設定時は
// Authorization: Bearer <token> を要求する。未設定なら従来どおり無認証。
const requireAuth: express.RequestHandler = (req, res, next) => {
  if (!BRIDGE_TOKEN) return next();
  if (req.headers.authorization === `Bearer ${BRIDGE_TOKEN}`) return next();
  res.status(401).json({ error: 'unauthorized' });
};

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, mod: mod.connected, generation: state.generation });
});

// 検証用: mock-modを介さずchatイベントを注入する
app.post('/inject', requireAuth, (req, res) => {
  const { from = 'Tester', text = '' } = req.body ?? {};
  const e = state.push('chat', { from, text });
  res.json({ ok: true, seq: e.seq });
});

// Streamable HTTP はステートレス運用にする。ステートレス transport は
// 1リクエストの処理完了で閉じるため、リクエストごとに server+transport を作る
// （SDK推奨パターン）。
app.all('/mcp', requireAuth, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  transport.onerror = (e) => console.log('[mcp transport]', e);
  const server = createMcpServer(state, mod, skills);
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.log('[mcp handleRequest]', e);
    if (!res.headersSent) res.status(500).send(String(e));
  }
});

app.listen(MCP_PORT, () => console.log(`[bridge] MCP http://127.0.0.1:${MCP_PORT}/mcp`));

if (RUNNER) {
  startRunner(state, {
    mcpUrl: `http://127.0.0.1:${MCP_PORT}/mcp`,
    cwd: process.cwd(),
    logDir: 'logs',
    debounceMs: 1500,
    botName: process.env.BOT_NAME ?? 'Rin',
    promptFile: process.env.RUNNER_PROMPT_FILE,
    runTimeoutMs: Number(process.env.RUNNER_TIMEOUT_MS ?? 600_000),
    command: process.env.RUNNER_COMMAND,
  });
  console.log('[bridge] runner on (chatイベント→codex exec)');
}
