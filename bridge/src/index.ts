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
import { BotManager } from './bots.js';
import { spawn } from 'node:child_process';
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
// 複数bot管理の土台 (追加botは BOTS_JSON で observer 登録)
const bots = BotManager.fromEnv(process.env.BOT_NAME ?? 'Rin', mod, state);
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

// 終了時: セッション要約を記録してから構造化スナップショットを書き切る
process.on('beforeExit', () => journal.flush());
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try {
      const sum = journal.endSession();
      console.log('[journal] session summary:', sum.line);
    } catch { journal.flush(); }
    process.exit(0);
  });
}

// Prism自動起動 (任意): PRISM_AUTOLAUNCH=1 のとき、mod未接続が続けば
// BOT_INSTANCE の bot クライアントを Prism Launcher 経由で起動する。
// 起動は接続断のたびに最大1回 (再試行間隔つき)。
if (process.env.PRISM_AUTOLAUNCH === '1') {
  const prismExe = process.env.PRISM_EXE ?? 'prismlauncher';
  const instance = process.env.BOT_INSTANCE;
  let lastLaunch = 0;
  if (!instance) {
    console.log('[autolaunch] BOT_INSTANCE not set; disabled');
  } else {
    const timer = setInterval(() => {
      if (mod.connected) return;
      if (Date.now() - lastLaunch < 120_000) return;
      lastLaunch = Date.now();
      console.log(`[autolaunch] launching bot instance '${instance}' via ${prismExe}`);
      try {
        const p = spawn(prismExe, ['--launch', instance],
          { detached: true, stdio: 'ignore' });
        p.on('error', (e) => console.log('[autolaunch] spawn failed:', e.message));
        p.unref();
      } catch (e) {
        console.log('[autolaunch] spawn failed:', e);
      }
    }, 15_000);
    timer.unref?.();
  }
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

// イベントpush (SSE): state の全イベントを購読者へ流す。
// Muse 側はポーリング (wait_event) のままだが、ローカルの通知プロセス等が
// push で受け取れるようにする。認証は /mcp と同じ Bearer。
app.get('/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ name: 'hello', seq: state.latestSeq() })}\n\n`);
  let closed = false;
  state.onEvent((e) => {
    if (closed) return;
    try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { closed = true; }
  });
  const hb = setInterval(() => {
    if (!closed) { try { res.write(': ping\n\n'); } catch { closed = true; } }
  }, 25_000);
  req.on('close', () => { closed = true; clearInterval(hb); });
});

// 承認API + 簡易UI (P6): pending の確認と approve/deny をブラウザから。
app.get('/api/approvals', requireAuth, (_req, res) => {
  res.json({ level: autonomy.level(), pending: autonomy.list() });
});
app.post('/api/approvals/:id/approve', requireAuth, (req, res) => {
  res.json(autonomy.approve(req.params.id));
});
app.post('/api/approvals/:id/deny', requireAuth, (req, res) => {
  res.json(autonomy.deny(req.params.id));
});
app.get('/approvals', (_req, res) => {
  res.type('html').send(APPROVALS_PAGE);
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
  const server = createMcpServer(state, mod, skills, journal, runhold, questGraph, autonomy, bots);
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

const APPROVALS_PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>aibou-mc approvals</title>
<style>body{font-family:system-ui;margin:2em}button{margin:0 .3em}
code{background:#eee;padding:.1em .3em}</style></head>
<body><h1>承認待ち (autonomy gate)</h1>
<p>token: <input id="tok" type="password" size="40">
<button onclick="refresh()">更新</button></p>
<div id="list">...</div>
<script>
const H=()=>({Authorization:'Bearer '+document.getElementById('tok').value});
async function refresh(){
  const r=await fetch('/api/approvals',{headers:H()});
  const d=await r.json();
  const el=document.getElementById('list');
  if(!d.pending||!d.pending.length){el.textContent='承認待ちはありません (level '+d.level+')';return;}
  el.innerHTML=d.pending.map(p=>'<div><code>'+p.id+'</code> '+p.method+
    ' <small>'+JSON.stringify(p.params)+'</small>'+
    ' <button onclick="act(\''+p.id+'\',\'approve\')">承認</button>'+
    '<button onclick="act(\''+p.id+'\',\'deny\')">拒否</button></div>').join('');
}
async function act(id,kind){
  await fetch('/api/approvals/'+id+'/'+kind,{method:'POST',headers:H()});
  refresh();
}
setInterval(refresh,5000);
</script></body></html>`;

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
    runStateFile: path.resolve(process.cwd(), 'data/run-state.json'),
  })
  : undefined;
if (RUNNER) console.log('[bridge] runner on (chatイベント→codex exec)');
