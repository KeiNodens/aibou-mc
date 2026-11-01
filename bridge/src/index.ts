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
const ADMIN_TOKEN = process.env.BRIDGE_ADMIN_TOKEN;
// D59/P1-3: 既定は loopback のみ bind する。非 loopback は BRIDGE_HOST 明示 +
// BRIDGE_TOKEN 必須 (無認証のまま LAN/外部へ晒れる構成を起動時に拒否する)。
// Tailscale Serve 経由の Muse 接続は PC 内で localhost へ中継されるため影響なし。
const MCP_HOST = process.env.BRIDGE_HOST ?? '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
if (!LOOPBACK_HOSTS.has(MCP_HOST) && !BRIDGE_TOKEN) {
  console.error(`[bridge] BRIDGE_HOST=${MCP_HOST} requires BRIDGE_TOKEN; refusing to start unauthenticated on a non-loopback interface`);
  process.exit(1);
}
if (BRIDGE_TOKEN && !ADMIN_TOKEN) {
  console.warn('[bridge] BRIDGE_ADMIN_TOKEN is not set: approval/admin operations (approve, deny, loop_resume, /api/approvals decisions) are DISABLED over HTTP. In-game owner .ok/.deny still works.');
}
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

// トンネルで /mcp を外部公開する場合の保護。トークン設定時は
// Authorization: Bearer <token> を要求する。未設定なら従来どおり無認証。
// D59/P1-1: 管理用トークン (BRIDGE_ADMIN_TOKEN) を通常トークンと分離する。
// admin トークンは通常トークンのスーパーセット (全 API を通る)。
// 承認系の「決裁」だけは admin トークン必須にし、runner の Codex (通常
// トークンのみ所持) が自分の危険操作を自己承認できないようにする。
const bearerOf = (req: express.Request) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
};
const requireAuth: express.RequestHandler = (req, res, next) => {
  if (!BRIDGE_TOKEN && !ADMIN_TOKEN) return next();
  const b = bearerOf(req);
  if (b && (b === BRIDGE_TOKEN || b === ADMIN_TOKEN)) return next();
  res.status(401).json({ error: 'unauthorized' });
};
const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (!BRIDGE_TOKEN && !ADMIN_TOKEN) return next(); // ローカル開発 (無認証構成)
  if (ADMIN_TOKEN && bearerOf(req) === ADMIN_TOKEN) return next();
  res.status(403).json({ error: 'admin token required' });
};
const isAdminCaller = (req: express.Request) =>
  (!BRIDGE_TOKEN && !ADMIN_TOKEN) ||
  (!!ADMIN_TOKEN && bearerOf(req) === ADMIN_TOKEN);
/** 管理系 MCP ツール: これらの tools/call は admin 呼び出し元でのみ許可 */
const ADMIN_TOOLS = new Set(['approve', 'deny', 'loop_resume']);
const adminToolInBody = (body: unknown): string | null => {
  const msgs = Array.isArray(body) ? body : [body];
  for (const m of msgs) {
    const r = m as { method?: string; params?: { name?: string } };
    if (r?.method === 'tools/call' && r.params?.name && ADMIN_TOOLS.has(r.params.name)) {
      return r.params.name;
    }
  }
  return null;
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
  // D59/P2-23: 切断時に購読を解除する (旧実装は listener と res 参照が
  // 再接続のたびに単調増加した)
  const off = state.onEvent((e) => {
    if (closed) return;
    try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { closed = true; }
  });
  const hb = setInterval(() => {
    if (!closed) { try { res.write(': ping\n\n'); } catch { closed = true; } }
  }, 25_000);
  req.on('close', () => { closed = true; clearInterval(hb); off(); });
});

// 承認API + 簡易UI (P6): pending の確認と approve/deny をブラウザから。
app.get('/api/approvals', requireAuth, (_req, res) => {
  res.json({ level: autonomy.level(), pending: autonomy.list() });
});
app.post('/api/approvals/:id/approve', requireAdmin, (req, res) => {
  res.json(autonomy.approve(req.params.id));
});
app.post('/api/approvals/:id/deny', requireAdmin, (req, res) => {
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
  // D59/P1-1: 管理系ツール (approve/deny/loop_resume) の呼出は admin
  // 呼び出し元のみ。JSON-RPC の中身を見て HTTP 層で止める
  const adminTool = adminToolInBody(req.body);
  if (adminTool && !isAdminCaller(req)) {
    res.status(403).json({
      jsonrpc: '2.0', id: (req.body as { id?: unknown })?.id ?? null,
      error: { code: -32001, message: `tool '${adminTool}' requires the admin token (BRIDGE_ADMIN_TOKEN)` },
    });
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  transport.onerror = (e) => console.log('[mcp transport]', e);
  const server = await createMcpServer(state, mod, skills, journal, runhold, questGraph, autonomy, bots);
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
<p>admin token: <input id="tok" type="password" size="40">
<button onclick="refresh()">更新</button></p>
<div id="list">...</div>
<script>
// D59/P1-4: pending の内容 (method/params) は LLM や mod が生成し得る
// 非信頼データ。innerHTML へ無エスケープで流す旧実装は、細工した params で
// このページに任意スクリプトを埋め、保持するトークンを窃取できた。
// 表示は全て textContent / DOM API で行う。
const tokEl=document.getElementById('tok');
tokEl.value=localStorage.getItem('aibouAdminTok')||'';
const H=()=>({Authorization:'Bearer '+tokEl.value});
async function refresh(){
  localStorage.setItem('aibouAdminTok',tokEl.value);
  const r=await fetch('/api/approvals',{headers:H()});
  const d=await r.json();
  const el=document.getElementById('list');
  el.textContent='';
  if(!d.pending||!d.pending.length){
    el.textContent='承認待ちはありません (level '+d.level+')';return;
  }
  for(const p of d.pending){
    const row=document.createElement('div');
    const code=document.createElement('code');
    code.textContent=p.id;
    row.append(code,document.createTextNode(' '+p.method+' '));
    const small=document.createElement('small');
    small.textContent=JSON.stringify(p.params);
    row.append(small,document.createTextNode(' '));
    for(const [kind,label] of [['approve','承認'],['deny','拒否']]){
      const b=document.createElement('button');
      b.textContent=label;
      b.onclick=()=>act(p.id,kind);
      row.append(b,document.createTextNode(' '));
    }
    el.append(row);
  }
}
async function act(id,kind){
  await fetch('/api/approvals/'+id+'/'+kind,{method:'POST',headers:H()});
  refresh();
}
setInterval(refresh,5000);
</script></body></html>`;

app.listen(MCP_PORT, MCP_HOST, () => console.log(`[bridge] MCP http://${MCP_HOST}:${MCP_PORT}/mcp`));

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
