// 資源採掘 (MCAi式): 深さテーブル + 鉱床記憶(journal facilities kind='mine')。
// 1. 資源名→block idと代表深度を解決 (data/mine-depths.json)
// 2. 過去の鉱床記憶が近ければそこへ向かう
// 3. 目標深度より大きく上にいれば階段掘りで降下
// 4. baritone.mine で採掘。成功したら鉱床記憶に座標を残す
import { readFileSync, existsSync } from 'node:fs';

const DEPTHS_FILE = new URL('../data/mine-depths.json', import.meta.url);

function loadDepths() {
  if (!existsSync(DEPTHS_FILE)) return {};
  try { return JSON.parse(readFileSync(DEPTHS_FILE, 'utf8')); }
  catch { return {}; }
}

const pickId = (s) => (s.includes(':') ? s : `minecraft:${s}`);

async function pos(ctx) {
  const s = await ctx.state();
  return { x: s.pos.x, y: s.pos.y, z: s.pos.z };
}

// 簡易階段掘り: 東(+x)方向へ1段ずつ下げる。各段で足元前とその下を掘り、
// 掘った段へ移動する。lava検出はしない (MVP、実機では要注視)。
async function descend(ctx, targetY, maxSteps = 64) {
  for (let i = 0; i < maxSteps; i++) {
    const p = await pos(ctx);
    if (Math.floor(p.y) <= targetY + 1) return true;
    const nx = Math.floor(p.x) + 1;
    const ny = Math.floor(p.y);
    const nz = Math.floor(p.z);
    // 次段の足元 (一段下) と頭上を掘る
    for (const [dx, dy] of [[0, 0], [0, -1], [0, 1]]) {
      const d = await ctx.call('dig', { x: nx + dx, y: ny + dy, z: nz }).catch(() => null);
      if (d?.task_id) await ctx.waitTask(d.task_id, 15_000);
      ctx.throwIfCancelled();
    }
    const g = await ctx.call('baritone.goto', { x: nx, y: ny - 1, z: nz });
    const gt = await ctx.waitTask(g.task_id, 30_000);
    if (!gt || gt.state !== 'succeeded') return false;
  }
  return (await pos(ctx)).y <= targetY + 1;
}

export default {
  name: 'mine_resource',
  description:
    'Mine a resource (coal/iron/diamond/osmium... or full block id). Uses ' +
    'ore depth tables and remembered deposit spots, digs a staircase down ' +
    'when needed, then Baritone-mines the target block.',
  params: {
    resource: { type: 'string', required: true, description: 'resource name or block id' },
    count: { type: 'integer', required: false, description: 'how many to mine (default 1)' },
    depth: { type: 'integer', required: false, description: 'override target Y level' },
  },
  async run(ctx, { resource, count = 1, depth }) {
    const table = loadDepths();
    const key = resource.toLowerCase();
    const entry = table[key];
    const block = entry?.block ?? pickId(resource);
    const targetY = depth ?? entry?.y ?? null;
    const short = block.split(':')[1];

    // 1. 鉱床記憶: 同じblockの採掘地点が近くにあれば優先
    const me = await pos(ctx);
    const known = (ctx.journal?.facilities?.('mine') ?? [])
      .filter((f) => f.name === block)
      .sort((a, b) =>
        Math.hypot(a.pos.x - me.x, a.pos.y - me.y, a.pos.z - me.z)
        - Math.hypot(b.pos.x - me.x, b.pos.y - me.y, b.pos.z - me.z));

    let spot = known[0];
    if (spot) {
      await ctx.say(`${short}の記憶地点へ行くね (${spot.pos.x},${spot.pos.y},${spot.pos.z})`);
      const g = await ctx.call('baritone.goto', spot.pos);
      const gt = await ctx.waitTask(g.task_id, 120_000);
      if (!gt || gt.state !== 'succeeded') {
        ctx.journal?.note(`${block} memory unreachable`);
        spot = null;
      }
    }

    // 2. 深度合わせ: 記憶地点が無ければ代表深度へ降下
    if (!spot && targetY != null) {
      const p = await pos(ctx);
      if (p.y > targetY + 6) {
        await ctx.say(`深度${targetY}あたりまで階段で降りるね`);
        const ok = await descend(ctx, targetY);
        if (!ok) {
          await ctx.say('途中で掘り進めなかった。場所を変えて試してね');
          return { done: false, reason: 'descend_failed' };
        }
      }
    }

    // 3. 採掘本体
    await ctx.say(`${short}を${count}個掘るね`);
    const m = await ctx.call('baritone.mine', { block, count, mode: 'additional' });
    const mt = await ctx.waitTask(m.task_id, 300_000);
    if (!mt || mt.state !== 'succeeded') {
      const why = mt?.error_code ?? 'timeout';
      await ctx.say(`${short}が掘れなかった (${why})`);
      return { done: false, reason: why };
    }

    // 4. 鉱床記憶: 掘れた場所を残す
    const after = await pos(ctx);
    ctx.journal?.noteFacility({
      kind: 'mine', pos: { x: Math.floor(after.x), y: Math.floor(after.y), z: Math.floor(after.z) },
      name: block,
    });
    await ctx.say(`${short}掘れたよ`);
    return { done: true, count, block };
  },
};
