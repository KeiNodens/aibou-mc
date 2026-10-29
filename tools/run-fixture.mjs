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
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = Number(process.env.FIXTURE_MOCK_PORT ?? 25687);
const MCP_PORT = Number(process.env.FIXTURE_MCP_PORT ?? 25689);
const STARTUP_TIMEOUT = 15_000;

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
    // POSIXではdetachedでグループkillを有効化 (Windowsはtaskkill /Tで対処)
    detached: process.platform !== 'win32',
    ...opts,
  });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`));
  procs.push(p);
  return p;
}

// shell:trueだとcmd.exeラッパー経由でnode孫プロセスが残るためツリーkillする
function killTree(p) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
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
function startBridge() {
  bridgeProc = spawnProc('bridge', 'npx', ['tsx', path.join(ROOT, 'bridge/src/index.ts')], {
    cwd: work,
    env: {
      ...process.env,
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
  promptLog: path.join(work, 'prompts.md'),
  // bridgeをkillして再起動 (restart永続化の検証用)。mockは生かしたまま。
  async restartBridge() {
    if (bridgeProc) killTree(bridgeProc);
    await new Promise((r) => setTimeout(r, 500));
    startBridge();
    await waitHealthz(`http://127.0.0.1:${MCP_PORT}`, STARTUP_TIMEOUT);
    log('bridge restarted');
  },
};

async function main() {
  const mod = (await import(pathToFileURL(path.resolve(fixtureFile)).href)).default;
  const scriptFn = typeof mod === 'function' ? mod : mod.script;
  const assertFn = typeof mod === 'object' ? mod.assert : null;

  log(`workdir=${work}`);
  spawnProc('mock', 'node', [
    path.join(ROOT, 'tools/mock-mod/mock-mod.mjs'),
    '--script', path.resolve(fixtureFile),
  ], { env: { ...process.env, MOCK_MOD_PORT: String(MOCK_PORT), FIXTURE_ROLE: 'mock' } });

  await new Promise((r) => setTimeout(r, 800));
  startBridge();
  await waitHealthz(`http://127.0.0.1:${MCP_PORT}`, STARTUP_TIMEOUT);
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
}
