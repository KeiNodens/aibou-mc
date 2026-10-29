import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { State } from './state.js';
import { ModClient } from './modclient.js';
import { createMcpServer } from './mcp.js';
import { startRunner } from './runner.js';
import { Skills } from './skills.js';
import { Journal } from './journal.js';
import { Capabilities } from './directparse.js';
import { RunHold } from './runhold.js';
import { QuestGraph } from './questgraph.js';
import { Autonomy } from './autonomy.js';
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
// 自律レベル・承認ゲート (AUTONOMY_LEVEL / AGENT_PROFILE)
const autonomy = new Autonomy(state);
const mod = new ModClient(MOD_URL, state, console.log, autonomy);
mod.start();
// 作業ジャーナル (世代非依存ID + checkpoint永続化)。data/journal.jsonl
const journal = new Journal(path.resolve(process.cwd(), 'data'));
journal.attach(state);
const skills = new Skills(state, mod, SKILLS_DIR, journal);
await skills.load();
skills.watch();
// 直パースのcapability学習 (bridge/data/capabilities.json)
const caps = new Capabilities(path.resolve(process.cwd(), 'data'));

// クエストグラフ (tools/build-quest-graph.mjs 生成物。無ければ薄い機能のみ)
const questGraph = new QuestGraph(
  path.resolve(process.cwd(), 'data/quest-graph.json'));
questGraph.startWatch(state, mod, journal);

// 構造化スナップショット (agent-journal.json) を確実に書き切る
for (const sig of ['beforeExit', 'SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => journal.flush());
}

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

// 検証用: mock-modを介さずイベントを注入する。
// {from,text}はchat、name指定で任意イベント ({name:'death',data:{...}})
app.post('/inject', requireAuth, (req, res) => {
  const { from = 'Tester', text = '', name, data } = req.body ?? {};
  const e = name && name !== 'chat'
    ? state.push(name, data ?? {})
    : state.push('chat', { from, text });
  res.json({ ok: true, seq: e.seq });
});

// Streamable HTTP はステートレス運用にする。ステートレス transport は
// 1リクエストの処理完了で閉じるため、リクエストごとに server+transport を作る
// （SDK推奨パターン）。
app.all('/mcp', requireAuth, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  transport.onerror = (e) => console.log('[mcp transport]', e);
  const server = createMcpServer(state, mod, skills, journal, runhold, questGraph, autonomy);
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

// 実行管理 (Run/Hold)。runner無効時も状態公開用に作っておく
const runhold: RunHold | undefined = RUNNER
  ? startRunner(state, {
    mcpUrl: `http://127.0.0.1:${MCP_PORT}/mcp`,
    cwd: process.cwd(),
    logDir: 'logs',
    debounceMs: 1500,
    botName: process.env.BOT_NAME ?? 'Rin',
    promptFile: process.env.RUNNER_PROMPT_FILE,
    runTimeoutMs: Number(process.env.RUNNER_TIMEOUT_MS ?? 600_000),
    command: process.env.RUNNER_COMMAND,
    skills,
    mod,
    caps,
    journal,
    questGraph,
    autonomy,
  })
  : undefined;
if (RUNNER) console.log('[bridge] runner on (chatイベント→codex exec)');
