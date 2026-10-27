// M2.5用の偽agent-mod。design §2.3のWS/JSON-RPC風プロトコルを話す。
// stdinの1行=ゲーム内chat注入 (from:Player)。chat.sendは受信表示する。
import { WebSocketServer } from 'ws';
import readline from 'node:readline';

const PORT = Number(process.env.MOCK_MOD_PORT ?? 25587);
const wss = new WebSocketServer({ port: PORT });
let taskSeq = 0;
const tasks = new Map();

console.log(`[mock-mod] WS server ws://127.0.0.1:${PORT}`);
console.log('[mock-mod] 1行入力=ゲーム内chatとして注入 (from=Player)');

const send = (ws, obj) => ws.send(JSON.stringify(obj));
const reply = (ws, msg, result) => send(ws, { type: 'res', id: msg.id, ok: true, result });
const fail = (ws, msg, code, message) =>
  send(ws, { type: 'res', id: msg.id, ok: false, error: { code, message } });

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
    if (msg.type !== 'req') return;
    const m = msg.method;
    const p = msg.params ?? {};

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
