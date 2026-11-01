// M2.5用の偽agent-mod。design §2.3のWS/JSON-RPC風プロトコルを話す。
// stdinの1行=ゲーム内chat注入 (from:Player)。chat.sendは受信表示する。
// --script <file.mjs> でfixtureを再生: モジュールは export default async (ctx) => {} を持ち、
// ctx.injectChat/injectEvent/stub/waitReq/sleep を使ってシナリオを記述する。
import { WebSocketServer } from 'ws';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.MOCK_MOD_PORT ?? 25587);
const SCRIPT = process.argv.find((a, i) => process.argv[i - 1] === '--script');
const wss = new WebSocketServer({ port: PORT, maxPayload: 64 * 1024 });
let taskSeq = 0;
const tasks = new Map();
const stubs = new Map(); // method → (params) => result | {error:{code,message}}
const mockWaypoints = new Map(); // waypoint.* 用 (Java Waypoints の意味論を模倣)
const waiters = []; // {method, resolve} — waitReq用
const requestLog = []; // 全reqの記録 (fixture検証用)

console.log(`[mock-mod] WS server ws://127.0.0.1:${PORT}`);
console.log('[mock-mod] 1行入力=ゲーム内chatとして注入 (from=Player)');

const send = (ws, obj) => ws.send(JSON.stringify(obj));
const reply = (ws, msg, result) => send(ws, { type: 'res', id: msg.id, ok: true, result });
const fail = (ws, msg, code, message) =>
  send(ws, { type: 'res', id: msg.id, ok: false, error: { code, message } });

// fixture ctx: bridge未接続でも注入はキューせず捨てる (connect後の利用を想定)
const ctx = {
  injectChat(from, text) {
    for (const ws of wss.clients) send(ws, { type: 'evt', name: 'chat', data: { from, text } });
  },
  injectEvent(name, data) {
    for (const ws of wss.clients) send(ws, { type: 'evt', name, data: data ?? {} });
  },
  // methodに対する応答を差替える。handler(params) → result または {error:{code,message}}
  stub(method, handler) { stubs.set(method, handler); },
  unstub(method) { stubs.delete(method); },
  // 指定methodのreqが来るまで待つ (timeoutMsでnull)
  waitReq(method, timeoutMs = 10_000) {
    return new Promise((resolve) => {
      const hit = requestLog.find((r) => r.method === method);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => {
        const i = waiters.findIndex((w) => w.resolve === finish);
        if (i >= 0) waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      const finish = (entry) => { clearTimeout(timer); resolve(entry); };
      waiters.push({ method, resolve: finish });
    });
  },
  requestLog,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

wss.on('connection', (ws) => {
  console.log('[mock-mod] bridge connected');
  send(ws, { type: 'hello', generation: 1 });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // identify (WS堅牢化): role受理だけ行う。不審roleでも従来どおり受理する (mock)
    if (msg.type === 'identify') {
      send(ws, { type: 'identified', role: msg.role ?? 'controller' });
      return;
    }
    if (msg.type !== 'req') return;
    const m = msg.method;
    const p = msg.params ?? {};
    requestLog.push({ method: m, params: p, ts: Date.now() });
    for (const w of [...waiters]) {
      if (w.method === m || w.method === '*') {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(requestLog[requestLog.length - 1]);
      }
    }

    // stubがあれば最優先で応答
    if (stubs.has(m)) {
      const out = stubs.get(m)(p);
      if (out?.error) fail(ws, msg, out.error.code ?? 'STUB', out.error.message ?? 'stubbed');
      else reply(ws, msg, out);
      return;
    }

    if (m === 'chat.send') {
      console.log(`\x1b[36m[GAME CHAT] Rin: ${p.text}\x1b[0m`);
      reply(ws, msg, { sent: true });
      // 実ゲーム同様、自分の発言もchatイベントとして返る
      setTimeout(() => send(ws, { type: 'evt', name: 'chat', data: { from: 'Rin', text: p.text } }), 50);
    } else if (m === 'obs.state') {
      reply(ws, msg, {
        pos: { x: 103.5, y: 64.0, z: -30.2 },
        health: 20.0,
        hunger: 20,
        dimension: 'minecraft:overworld',
        biome: 'minecraft:forest',
        time: { day: 1, ticks: 6000, is_day: true },
        inventory_summary: { 'minecraft:oak_log': 3, 'minecraft:diamond_pickaxe': 1 },
        inventory_detail: [
          { slot: 0, id: 'minecraft:diamond_pickaxe', count: 1, attrs: { damage: 210, enchanted: true, has_nbt: true } },
          { slot: 1, id: 'minecraft:oak_log', count: 3, attrs: {} },
        ],
        container: { menu_id: 'player_inventory', generation: 1 },
        nearby: {
          blocks: { 'minecraft:oak_log': 41, 'minecraft:dirt': 62 },
          entities: { 'minecraft:sheep': 2 },
          nearest: { 'minecraft:sheep': { dist: 9.4 } },
        },
        events_since_last: [],
      });
    } else if (m === 'waypoint.set') {
      // 座標省略時は現在位置 (obs.state の pos を floor した値)
      const wp = {
        x: typeof p.x === 'number' ? p.x : 103,
        y: typeof p.y === 'number' ? p.y : 64,
        z: typeof p.z === 'number' ? p.z : -31,
      };
      if (typeof p.r === 'number' && p.r >= 0) {
        wp.r = p.r;
        wp.dim = 'minecraft:overworld';
      }
      mockWaypoints.set(p.name, wp);
      reply(ws, msg, { saved: p.name, ...wp });
    } else if (m === 'waypoint.get') {
      const wp = mockWaypoints.get(p.name);
      if (!wp) fail(ws, msg, 'NOT_FOUND', 'unknown waypoint');
      else reply(ws, msg, { ...wp });
    } else if (m === 'waypoint.list') {
      reply(ws, msg, { waypoints: Object.fromEntries(mockWaypoints) });
    } else if (m === 'waypoint.del') {
      if (!mockWaypoints.delete(p.name)) {
        fail(ws, msg, 'NOT_FOUND', `unknown waypoint: ${p.name}`);
      } else reply(ws, msg, { deleted: p.name });
    } else if (m === 'obs.scan') {
      reply(ws, msg, {
        blocks: { 'minecraft:oak_log': 41, 'minecraft:dirt': 62, 'minecraft:stone': 88 },
        entities: { 'minecraft:sheep': 2 },
      });
    } else if (m === 'skill.mock_gather') {
      const taskId = `g1-t${++taskSeq}`;
      tasks.set(taskId, { state: 'running' });
      reply(ws, msg, { task_id: taskId });
      setTimeout(() => {
        const result = { gathered: p.count ?? 1, block: p.block };
        tasks.set(taskId, { state: 'succeeded', result });
        send(ws, { type: 'evt', name: 'task.done', data: { task_id: taskId, state: 'succeeded', result } });
        console.log(`[mock-mod] task ${taskId} succeeded`);
      }, 3000);
    } else if (m === 'combat.engage') {
      const taskId = `combat-t${++taskSeq}`;
      tasks.set(taskId, { state: 'running' });
      reply(ws, msg, { task_id: taskId });
      setTimeout(() => {
        const result = { reason: 'cleared', kills: 1, hits: 3, duration_ticks: 60 };
        tasks.set(taskId, { state: 'succeeded', result });
        send(ws, { type: 'evt', name: 'task.done', data: { task_id: taskId, state: 'succeeded', result } });
      }, 500);
    } else if (m === 'wait.condition') {
      const taskId = `wait-t${++taskSeq}`;
      tasks.set(taskId, { state: 'running' });
      reply(ws, msg, { task_id: taskId });
      setTimeout(() => {
        const result = { reason: 'met', elapsed_ticks: 8, met: (p.conditions ?? []).map(() => true) };
        tasks.set(taskId, { state: 'succeeded', result });
        send(ws, { type: 'evt', name: 'task.done', data: { task_id: taskId, state: 'succeeded', result } });
      }, 400);
    } else if (m === 'build.place') {
      const taskId = `build-t${++taskSeq}`;
      tasks.set(taskId, { state: 'running' });
      reply(ws, msg, { task_id: taskId, blocks: (p.blocks ?? []).length });
      setTimeout(() => {
        const result = { reason: 'done', placed: (p.blocks ?? []).length, skipped: 0, mismatched: 0, failed: 0, remaining: 0, missing_items: [], mismatched_at: [] };
        tasks.set(taskId, { state: 'succeeded', result });
        send(ws, { type: 'evt', name: 'task.done', data: { task_id: taskId, state: 'succeeded', result } });
      }, 600);
    } else if (m === 'contraption.follow_local' || m === 'fishing.start'
      || m === 'drive.start' || m === 'glide.start') {
      const taskId = `d33-t${++taskSeq}`;
      tasks.set(taskId, { state: 'running' });
      reply(ws, msg, { task_id: taskId });
      const results = {
        'contraption.follow_local': { arrived: true, distance: 0.3 },
        'fishing.start': { reason: 'casts_done', casts: 3, reels: 2, bites: 2 },
        'drive.start': { reason: 'done', max_speed: 0.8, moved: true, ticks: 160 },
        'glide.start': { reason: 'arrived', ticks: 100 },
      };
      setTimeout(() => {
        const result = results[m];
        tasks.set(taskId, { state: 'succeeded', result });
        send(ws, { type: 'evt', name: 'task.done', data: { task_id: taskId, state: 'succeeded', result } });
      }, 400);
    } else if (m === 'task.status' || m === 'task.result') {
      const t = tasks.get(p.task_id);
      if (t) reply(ws, msg, { task_id: p.task_id, generation: 1, ...t });
      else fail(ws, msg, 'STALE_TASK', 'unknown task_id');
    } else if (m === 'task.cancel' || m === 'task.cancel_all') {
      reply(ws, msg, { state: 'cancelled' });
    } else if (m === 'mod.ping') {
      reply(ws, msg, { pong: true, generation: 1 });
    } else {
      fail(ws, msg, 'UNSUPPORTED', `method ${m} not implemented in mock`);
    }
  });

  ws.on('close', () => console.log('[mock-mod] bridge disconnected'));
});

const rl = readline.createInterface({ input: process.stdin, terminal: true });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  for (const ws of wss.clients) {
    ws.send(JSON.stringify({ type: 'evt', name: 'chat', data: { from: 'Player', text } }));
  }
  console.log(`[mock-mod] injected: ${text}`);
});

// fixture再生: --script指定時のみ。接続を待ってからモジュールを実行する
if (SCRIPT) {
  const run = async () => {
    await new Promise((r) => wss.once('connection', r));
    await new Promise((r) => setTimeout(r, 300)); // hello/identify交換の待ち
    try {
      const mod = (await import(pathToFileURL(SCRIPT).href)).default;
      // 関数形式 or {script, assert} オブジェクト形式の両方を受け付ける
      const fn = typeof mod === 'function' ? mod : mod?.script;
      if (typeof fn !== 'function') throw new Error('fixture has no script');
      await fn(ctx);
      console.log('[mock-mod] fixture script finished');
    } catch (e) {
      console.log('[mock-mod] fixture script error:', e);
      process.exitCode = 1;
    }
  };
  void run();
}
