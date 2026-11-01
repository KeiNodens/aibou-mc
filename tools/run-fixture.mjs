// fixture実行器: mock-mod + bridge を一時環境で起動し、fixtureモジュールの
// script(mock側) と assert(bridge側) を実行する。node:test からも直接使える。
//
//   node tools/run-fixture.mjs tools/fixtures/xxx.mjs
//
// fixtureモジュール形式:
//   export default {
//     async script(ctx) { ... },   // mock-mod内で実行 (ctx=mock ctx)
//     async assert(h) { ... },     // bridge側で実行 (h={mcp,file,log,sleep})
//   }
// scriptだけのfixtureは export default async (ctx)=>{} の関数でもよい。
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// D59/P2-24: 既定はエフェメラルポート。旧実装は固定ポート (25687/25689)
// で、前回実行の bridge が kill 失敗で残っていると、その旧プロセスに
// 対して assert が走って現行コードが壊れていても PASS になり得た
let MOCK_PORT = Number(process.env.FIXTURE_MOCK_PORT ?? 0);
let MCP_PORT = Number(process.env.FIXTURE_MCP_PORT ?? 0);
const STARTUP_TIMEOUT = 15_000;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const fixtureFile = process.argv[2];
if (!fixtureFile) {
  console.error('usage: node tools/run-fixture.mjs <fixture.mjs>');
  process.exit(2);
}

const work = mkdtempSync(path.join(tmpdir(), 'mcfix-'));
const procs = [];
const log = (...a) => console.log('[fixture]', ...a);

function spawnProc(name, command, args, opts = {}) {
  const p = spawn(command, args, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // D59: bridge/mock は shell:false で直接 spawn できる (下記)。
    // ラッパー (cmd/npx) を挟むとプロセスツリーになり、権限制限の
    // ある環境で kill が届かず残存プロセス化する
    // POSIXではdetachedでグループkillを有効化 (Windowsはtaskkill /Tで対処)
    detached: process.platform !== 'win32',
    ...opts,
  });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`));
  // D59/P2-24: 子プロセスの終了を監視する (起動失敗の未検知防止)
  p.__name = name;
  p.__exited = null;
  p.on('exit', (code, sig) => { p.__exited = { code, sig }; });
  procs.push(p);
  return p;
}

// shell:trueだとcmd.exeラッパー経由でnode孫プロセスが残るためツリーkillする
function killTree(p) {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      // D59/P2-24: kill の成否を確認する (失敗した残存プロセスが
      // 次回実行のポートを握るのが固定ポート問題の元だった)。
      // taskkill /T が権限で失敗する環境 (rin) では、WMI で子孫を
      // 列挙して Stop-Process で個別に止める (深い順)。
      if (r.status !== 0) {
        const script =
          `$root=${p.pid}; $all=Get-CimInstance Win32_Process; ` +
          '$desc=@(); $front=@($root); ' +
          'while($front.Count){ $next=@(); foreach($f in $front){ ' +
          '$kids=@($all | Where-Object { $_.ParentProcessId -eq $f } ' +
          '| ForEach-Object { $_.ProcessId }); $desc += $kids; $next += $kids }; ' +
          '$front=$next }; [array]::Reverse($desc); ' +
          'foreach($d in $desc){ Stop-Process -Id $d -Force -ErrorAction SilentlyContinue }; ' +
          'Stop-Process -Id $root -Force -ErrorAction SilentlyContinue';
        const ps = spawnSync('powershell', ['-NoProfile', '-Command', script],
          { stdio: 'ignore' });
        if (ps.status !== 0) {
          console.log(`[fixture] WARN: kill fallback failed for ${p.__name ?? 'proc'} pid=${p.pid}`);
        }
      }
    } else {
      process.kill(-p.pid, 'SIGKILL');
    }
  } catch { /* 既に終了 */ }
}

async function waitHealthz(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`healthz timeout: ${url}`);
}

// MCPツール呼出 (initialize→tools/call の2段)
let mcpId = 0;
async function mcp(tool, args = {}) {
  const url = `http://127.0.0.1:${MCP_PORT}/mcp`;
  const call = async (method, params) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method, params }),
    });
    const body = await r.text();
    // SSE形式の場合は data: 行を拾う
    const dataLine = body.split('\n').find((l) => l.startsWith('data:'));
    const json = JSON.parse(dataLine ? dataLine.slice(5).trim() : body);
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
  };
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fixture', version: '0.0.1' },
  });
  const res = await call('tools/call', { name: tool, arguments: args });
  const text = res?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}

let bridgeProc = null;
let fixtureEnv = {};
function startBridge() {
  // npx tsx の代わりに tsx の cli を node で直接起動する (単一
  // プロセス化し、kill を確実にする)
  bridgeProc = spawnProc('bridge', 'node', [
    path.join(ROOT, 'bridge/node_modules/tsx/dist/cli.mjs'),
    path.join(ROOT, 'bridge/src/index.ts'),
  ], {
    shell: false,
    cwd: work,
    env: {
      ...process.env,
      // fixture は全ツール有効が前提 (toolgate の DEFAULT_OFF /
      // mod ゲートは実運用向け)。D59 で発覚: これが無いと
      // reload_skills や deck_walk 等が無効化され fixture が空転する
      AIBOU_TOOL_PROFILE: 'full',
      ...fixtureEnv,
      MOD_URL: `ws://127.0.0.1:${MOCK_PORT}`,
      MCP_PORT: String(MCP_PORT),
      BOT_NAME: 'Rin',
      SKILLS_DIR: path.join(ROOT, 'skills'),
      // runnerのspawn(command, args, {shell:true})は「command + args」を
      // shell連結するため、node <script> をcommand全体に含める
      RUNNER_COMMAND: `node "${path.join(ROOT, 'tools/fixture-codex.mjs').replace(/\\/g, '/')}"`,
      FIXTURE_PROMPT_OUT: helpers.promptLog,
    },
  });
}

const helpers = {
  mcp,
  // bridgeのcwd(data/)配下のファイルを読む
  file(rel) {
    const f = path.join(work, 'data', rel);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  },
  rawfile(rel) {
    const f = path.join(work, rel);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  },
  // workdir配下にファイルを書く (fixtureがquest-graph等を注入する用)
  writefile(rel, content) {
    const f = path.join(work, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, content);
    return f;
  },
  log,
  // 生の HTTP (認証境界など MCP ヘルパーを通さない検証用)
  async fetch(p, opts = {}) {
    const r = await fetch(`http://127.0.0.1:${MCP_PORT}${p}`, opts);
    let json = null;
    try { json = await r.json(); } catch { /* 本文なし */ }
    return { status: r.status, json };
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  // 条件が真になるまでpoll (timeoutで例外)
  async waitFor(fn, timeoutMs = 15_000, interval = 300) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error('waitFor timeout');
  },
  workdir: work,
  get mcpPort() { return MCP_PORT; },
  get mockPort() { return MOCK_PORT; },
  promptLog: path.join(work, 'prompts.md'),
  // bridgeをkillして再起動 (restart永続化の検証用)。mockは生かしたまま。
  async restartBridge() {
    if (bridgeProc) killTree(bridgeProc);
    // 旧 bridge がポートを離すまで待つ (kill が遅い/一部失敗する
    // 環境で新 bridge が EADDRINUSE になるのを防ぐ)。制限内に
    // 離さない場合は、旧プロセスに対して検証を続けるより正直に
    // 失敗させる (誤った対象を測って PASS/FAIL するのが最悪)
    const deadline = Date.now() + 30_000;
    let released = false;
    while (Date.now() < deadline) {
      const alive = await fetch(`http://127.0.0.1:${MCP_PORT}/healthz`)
        .then((r) => r.ok).catch(() => false);
      if (!alive) { released = true; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!released) {
      throw new Error('restartBridge: old bridge did not stop within 30s (kill failed in this environment)');
    }
    startBridge();
    await waitHealthz(`http://127.0.0.1:${MCP_PORT}`, STARTUP_TIMEOUT);
    log('bridge restarted');
  },
};

async function main() {
  const mod = (await import(pathToFileURL(path.resolve(fixtureFile)).href)).default;
  const scriptFn = typeof mod === 'function' ? mod : mod.script;
  const assertFn = typeof mod === 'object' ? mod.assert : null;
  fixtureEnv = (typeof mod === 'object' && mod.env) || {};
  if (!MOCK_PORT) MOCK_PORT = await freePort();
  if (!MCP_PORT) MCP_PORT = await freePort();
  // fixture 本体が process.env.FIXTURE_*_PORT を読む場合がある
  // (p3/p6 の /inject 先など)。確定したポートを env にも反映する
  process.env.FIXTURE_MOCK_PORT = String(MOCK_PORT);
  process.env.FIXTURE_MCP_PORT = String(MCP_PORT);
  // 起動前に何も応答しないことを確認 (残存プロセスの同一性チェック)
  const pre = await fetch(`http://127.0.0.1:${MCP_PORT}/healthz`).catch(() => null);
  if (pre && pre.ok) {
    throw new Error(`port ${MCP_PORT} is already serving a bridge; refusing to test against a stale process`);
  }

  log(`workdir=${work} mock=${MOCK_PORT} mcp=${MCP_PORT}`);
  spawnProc('mock', 'node', [
    path.join(ROOT, 'tools/mock-mod/mock-mod.mjs'),
    '--script', path.resolve(fixtureFile),
  ], { shell: false, env: { ...process.env, MOCK_MOD_PORT: String(MOCK_PORT), FIXTURE_ROLE: 'mock' } });

  await new Promise((r) => setTimeout(r, 800));
  startBridge();
  await waitHealthz(`http://127.0.0.1:${MCP_PORT}`, STARTUP_TIMEOUT);
  if (bridgeProc?.__exited) {
    throw new Error(`bridge exited during startup: ${JSON.stringify(bridgeProc.__exited)}`);
  }
  log('bridge up');

  if (assertFn) {
    await assertFn(helpers);
    log('assert done');
  } else {
    // scriptのみのfixture: script側の完了を待つため少し待機
    await new Promise((r) => setTimeout(r, 2000));
  }
}

try {
  await main();
  console.log('[fixture] PASS');
} catch (e) {
  console.error('[fixture] FAIL:', e);
  process.exitCode = 1;
} finally {
  for (const p of procs) killTree(p);
  // 子プロセスの pipe ハンドルが残ると node が終了できない環境がある
  // (kill が権限制限で失敗する場合)。結果は確定済みなので、猶予の
  // 後で明示的に終了する。ポートはエフェメラル化済みのため、
  // 万一の残存プロセスも次回実行と衝突しない
  setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref();
}
