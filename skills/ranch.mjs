// 牧場仕事 (D30): 繁殖 (餌やり)、牛のミルク絞り、羊の毛刈り、
// 落ちている生産物 (卵など) の回収。餌・道具はホットバー優先で、
// メインインベントリにある場合は swap で持ってくる。
const BREED = [
  { type: 'minecraft:cow', food: 'minecraft:wheat', label: '牛' },
  { type: 'minecraft:sheep', food: 'minecraft:wheat', label: '羊' },
  { type: 'minecraft:pig', food: 'minecraft:carrot', label: '豚' },
  { type: 'minecraft:chicken', food: 'minecraft:wheat_seeds', label: '鶏' },
];
const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
const eid = (e) => e.entity_id ?? e.id;

async function gotoNear(ctx, p, timeout = 30_000) {
  const g = await ctx.call('baritone.goto', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }).catch(() => null);
  if (g?.task_id) await ctx.waitTask(g.task_id, timeout).catch(() => null);
}
async function ensureHeld(ctx, item) {
  const st = await ctx.state().catch(() => null);
  const detail = st?.inventory_detail ?? [];
  const inBar = detail.find((s) => s.id === item && s.slot <= 8);
  if (inBar) {
    await ctx.call('equip', { slot: inBar.slot }).catch(() => {});
    return true;
  }
  const inInv = detail.find((s) => s.id === item);
  if (!inInv) return false;
  // メインインベントリ → ホットバー slot 8 へ swap (build_schematic と同じ手筋)
  await ctx.call('container.click', { slot: inInv.slot, button: 8, action: 'swap' }).catch(() => {});
  await ctx.call('equip', { slot: 8 }).catch(() => {});
  return true;
}
const invCount = (st, pred) =>
  Object.entries(st?.inventory ?? {}).reduce((a, [id, n]) => a + (pred(id) ? Number(n) || 0 : 0), 0);

export default {
  name: 'ranch',
  description:
    'Ranch work: breed animals (wheat/carrot/seeds), milk cows, shear ' +
    'sheep, and pick up dropped produce (eggs etc.) around the bot.',
  params: {
    radius: { type: 'integer', required: false, description: 'work radius (default 16, max 32)' },
  },
  async run(ctx, { radius = 16 }) {
    const R = Math.min(radius, 32);
    const bred = {};
    let milked = false;
    let sheared = false;
    let picked = 0;
    // 繁殖: 種ごとに 1 ペア
    for (const sp of BREED) {
      const animals = ents(await ctx.call('obs.entity', { name: sp.type }).catch(() => null))
        .filter((e) => typeof e.x === 'number');
      if (animals.length < 2) continue;
      if (!(await ensureHeld(ctx, sp.food))) continue;
      let fed = 0;
      for (const a of animals.slice(0, 2)) {
        await gotoNear(ctx, a);
        const r = await ctx.call('interact', { entity_id: eid(a) }).catch(() => null);
        if (r) fed++;
        await ctx.sleep(300);
      }
      if (fed >= 2) bred[sp.label] = 1;
    }
    // ミルク
    const st0 = await ctx.state().catch(() => null);
    const cows = ents(await ctx.call('obs.entity', { name: 'minecraft:cow' }).catch(() => null));
    if (cows.length && (st0?.inventory?.['minecraft:bucket'] ?? 0) > 0) {
      const before = st0.inventory?.['minecraft:milk_bucket'] ?? 0;
      if (await ensureHeld(ctx, 'minecraft:bucket')) {
        await gotoNear(ctx, cows[0]);
        await ctx.call('interact', { entity_id: eid(cows[0]) }).catch(() => {});
        await ctx.sleep(400);
        const st1 = await ctx.state().catch(() => null);
        milked = (st1?.inventory?.['minecraft:milk_bucket'] ?? 0) > before;
      }
    }
    // 毛刈り
    const sheep = ents(await ctx.call('obs.entity', { name: 'minecraft:sheep' }).catch(() => null));
    if (sheep.length && (st0?.inventory?.['minecraft:shears'] ?? 0) > 0) {
      const before = invCount(st0, (id) => id.endsWith('_wool'));
      if (await ensureHeld(ctx, 'minecraft:shears')) {
        await gotoNear(ctx, sheep[0]);
        await ctx.call('interact', { entity_id: eid(sheep[0]) }).catch(() => {});
        await ctx.sleep(400);
        const st1 = await ctx.state().catch(() => null);
        sheared = invCount(st1, (id) => id.endsWith('_wool')) > before;
      }
    }
    // 生産物の回収
    const items = ents(await ctx.call('obs.entity', { name: 'minecraft:item' }).catch(() => null))
      .slice(0, 12);
    for (const it of items) {
      await gotoNear(ctx, it, 15_000);
      await ctx.sleep(250);
      picked++;
    }
    const parts = [];
    if (Object.keys(bred).length) parts.push(`繁殖: ${Object.keys(bred).join('・')}`);
    if (milked) parts.push('ミルク絞った');
    if (sheared) parts.push('毛刈りした');
    if (picked) parts.push(`落ちてるもの${picked}件回収に行った`);
    await ctx.say(parts.length ? `牧場まわり終わり。${parts.join('、')}` : '牧場でできることは今なかった');
    return { done: true, bred, milked, sheared, pickup_trips: picked };
  },
};
