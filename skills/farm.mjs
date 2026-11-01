// 畑仕事 (P5): 成熟した作物を収穫して植え直す。
// obs.block で作物位置を取り、obs.block_state の age で成熟判定する。
// 収穫→(ドロップ回収待ち)→種を植え直し、までを1作物ずつ処理する。
const CROPS = {
  'minecraft:wheat': { maxAge: 7, seed: 'minecraft:wheat_seeds', label: '小麦' },
  'minecraft:carrots': { maxAge: 7, seed: 'minecraft:carrot', label: 'にんじん' },
  'minecraft:potatoes': { maxAge: 7, seed: 'minecraft:potato', label: 'じゃがいも' },
  'minecraft:beetroots': { maxAge: 3, seed: 'minecraft:beetroot_seeds', label: 'ビートルート' },
  'minecraft:nether_wart': { maxAge: 3, seed: 'minecraft:nether_wart', label: 'ネザーウォート' },
  // Farmer's Delight (age は実機で要確認のものを含む)
  'farmersdelight:cabbages': { maxAge: 7, seed: 'farmersdelight:cabbage_seeds', label: 'キャベツ' },
  'farmersdelight:onions': { maxAge: 7, seed: 'farmersdelight:onion', label: 'タマネギ' },
  // トマトは壊さず右クリックで実だけ取る (株は残る)。植え直しなし
  'farmersdelight:tomatoes': { maxAge: 7, seed: null, harvest: 'use', label: 'トマト' },
  // 米 (farmersdelight:rice) は水中+上下二段構造のため未対応
};

async function gotoNear(ctx, p) {
  const g = await ctx.call('baritone.goto', { x: p.x, y: p.y, z: p.z });
  if (g?.task_id) await ctx.waitTask(g.task_id, 60_000);
}

function hotbarSlot(state, item) {
  return (state.inventory_detail ?? []).find((s) => s.id === item && s.slot <= 8);
}

export default {
  name: 'farm',
  description:
    'Harvest mature crops and replant them. Supports wheat, carrots, ' +
    'potatoes, beetroots, nether wart, and Farmer\'s Delight cabbages, ' +
    'onions and tomatoes (tomatoes are picked by right-click, the plant ' +
    'stays). Maturity is judged from the block-state age property; ' +
    'seeds must be in the hotbar to replant.',
  params: {
    crop: { type: 'string', required: false, description: 'crop block id (default minecraft:wheat)' },
    radius: { type: 'integer', required: false, description: 'search radius (default 16, max 64)' },
    max: { type: 'integer', required: false, description: 'max crops to process (default 16)' },
  },
  async run(ctx, { crop = 'minecraft:wheat', radius = 16, max = 16 }) {
    const def = CROPS[crop];
    if (!def) {
      return { done: false, reason: 'unsupported_crop', supported: Object.keys(CROPS) };
    }
    const found = await ctx.call('obs.block', { block: crop, radius: Math.min(radius, 64) });
    const spots = found?.found ?? [];
    if (!spots.length) {
      await ctx.say(`周りに${def.label}が見当たらない`);
      return { done: true, harvested: 0, replanted: 0 };
    }
    ctx.journal?.noteFacility({
      kind: 'farm',
      pos: { x: spots[0].x, y: spots[0].y, z: spots[0].z },
      name: crop,
    });

    let harvested = 0;
    let replanted = 0;
    let checked = 0;
    for (const p of spots) {
      if (checked >= max) break;
      ctx.throwIfCancelled();
      checked++;
      const st = await ctx.call('obs.block_state', { x: p.x, y: p.y, z: p.z })
        .catch(() => null);
      if (!st || st.block !== crop) continue;
      const age = Number(st.properties?.age ?? NaN);
      if (!Number.isFinite(age) || age < def.maxAge) continue;

      await gotoNear(ctx, p);
      if (def.harvest === 'use') {
        // 右クリックで実だけ収穫。age が下がれば成功とみなす
        await ctx.call('use_item', { x: p.x, y: p.y, z: p.z }).catch(() => null);
        await ctx.sleep(400);
        const after = await ctx.call('obs.block_state', { x: p.x, y: p.y, z: p.z })
          .catch(() => null);
        const ageAfter = Number(after?.properties?.age ?? NaN);
        if (Number.isFinite(ageAfter) && ageAfter < age) harvested++;
        continue;
      }
      const d = await ctx.call('dig', { x: p.x, y: p.y, z: p.z }).catch(() => null);
      if (d?.task_id) {
        const dt = await ctx.waitTask(d.task_id, 20_000);
        if (!dt || dt.state !== 'succeeded') continue;
      }
      harvested++;
      ctx.journal?.checkpoint(`harvested_${harvested}`, { crop, x: p.x, y: p.y, z: p.z });
      // ドロップがインベントリに入るのを少し待つ
      await ctx.sleep(600);

      // 植え直し: 種がホットバーにあれば土 (y-1) の上面へ使う
      if (!def.seed) continue;
      const now = await ctx.state();
      const seedSlot = hotbarSlot(now, def.seed);
      if (seedSlot) {
        await ctx.call('equip', { slot: seedSlot.slot });
        const u = await ctx.call('use_item', {
          x: p.x, y: p.y - 1, z: p.z, face: 'up',
        }).catch(() => null);
        if (u) replanted++;
      }
    }
    await ctx.say(
      `${def.label}を${harvested}株収穫したよ` +
      (replanted ? ` (${replanted}株植え直し済み)` : ''));
    return { done: true, harvested, replanted, checked };
  },
};
