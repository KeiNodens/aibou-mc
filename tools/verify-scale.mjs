// D50 検証 (fake-ctx): stock_keeper の補充フロー (mek_2x を
// 協調的な container スタブで完走) と build_site のオフセット。
// Run: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-scale.mjs
import stockKeeper from '../skills/stock_keeper.mjs';
import buildSite from '../skills/build_site.mjs';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label} ${extra}`);
  if (!cond) fails++;
};

function baseCtx(handlers, opts = {}) {
  return {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      const h = handlers[method];
      if (!h) throw new Error('no handler: ' + method);
      return typeof h === 'function' ? h(params) : h;
    },
    async state() { return opts.state(); },
    async schematicPlan() { return opts.plan; },
    async commission() { return { done: true }; },
    async sleep() {},
    async say() {},
    async waitTask() { return { state: 'succeeded', result: { reason: 'met', placed: 1 } }; },
    throwIfCancelled() {},
    signal: new AbortController().signal,
    journal: { facilities: () => [], note() {}, checkpoint() {} },
  };
}

// ---- stock_keeper: 在庫2 < 下限6 → mek_2x で補充 → 10 ----
{
  let menu = null; // 'enrich' | 'smelter'
  let ironStock = 2;
  // F2 以降: クリックの実挙動をモデル化 (右クリック=1個配置、
  // 実数計測)。playerSlot=プレイヤー側、inSlot/outSlot=機械側。
  const playerSlot = { 'minecraft:raw_iron': 64, 'mekanism:dust_iron': 0, 'minecraft:iron_ingot': 0 };
  let carried = null, inSlot = null, outSlot = null;
  const TRANSFORM = {
    enrich: (it) => ({ id: 'mekanism:dust_iron', count: it.count * 2 }),
    smelter: (it) => ({ id: 'minecraft:iron_ingot', count: it.count }),
  };
  const menuFor = (m) => {
    const slots = [
      { slot: 0, container_idx: 0, empty: true },
      { slot: 1, container_idx: 0, empty: true },
      { slot: 2, container_idx: 0, empty: !inSlot, ...(inSlot ?? {}) },
      { slot: 3, container_idx: 0, empty: !outSlot, ...(outSlot ?? {}) },
    ];
    const pItems = ['minecraft:raw_iron', 'mekanism:dust_iron', 'minecraft:iron_ingot'];
    pItems.forEach((id, i) => {
      const c = playerSlot[id] ?? 0;
      slots.push(c > 0
        ? { slot: 4 + i, container_idx: 1, empty: false, id, count: c }
        : { slot: 4 + i, container_idx: 1, empty: true });
    });
    for (let i = 7; i < 40; i++) slots.push({ slot: i, container_idx: 1, empty: true });
    return {
      menu_id: m === 'enrich' ? 'mekanism:enrichment_chamber' : 'mekanism:energized_smelter',
      carried, slots,
    };
  };
  const ctx = baseCtx({
    'obs.block': (p) => p.block === 'mekanism:enrichment_chamber'
      ? { found: [{ x: 5, y: 64, z: 0, dist: 5 }] }
      : { found: [{ x: 9, y: 64, z: 0, dist: 9 }] },
    'baritone.goto': { task_id: 'g' },
    'use_item': (p) => {
      menu = p.x === 5 ? 'enrich' : 'smelter';
      inSlot = null; outSlot = null; carried = null;
      return { ok: true };
    },
    'container.read': () => menuFor(menu),
    'container.click': (p) => {
      const pItems = { 4: 'minecraft:raw_iron', 5: 'mekanism:dust_iron', 6: 'minecraft:iron_ingot' };
      if (p.action === 'pickup' && pItems[p.slot] !== undefined) {
        const id = pItems[p.slot];
        if (!carried && playerSlot[id] > 0) {
          carried = { id, count: playerSlot[id] }; playerSlot[id] = 0;
        } else if (carried && carried.id === id) {
          playerSlot[id] = carried.count; carried = null;
        }
      } else if (p.action === 'pickup' && p.slot === 2 && p.button === 1 && carried) {
        inSlot = { id: carried.id, count: (inSlot?.count ?? 0) + 1 };
        carried = { ...carried, count: carried.count - 1 };
        if (carried.count <= 0) carried = null;
      } else if (p.action === 'pickup' && p.slot === 2 && carried) {
        inSlot = carried; carried = null;
      } else if (p.action === 'quick_move' && p.slot === 3 && outSlot) {
        playerSlot[outSlot.id] = (playerSlot[outSlot.id] ?? 0) + outSlot.count;
        if (menu === 'smelter') ironStock = 2 + outSlot.count;
        outSlot = null;
      }
      if (!carried && inSlot) { outSlot = TRANSFORM[menu](inSlot); inSlot = null; }
      return {};
    },
    'wait.condition': { task_id: 'w' },
  }, {
    state: () => ({
      pos: { x: 0, y: 64, z: 0 },
      inventory: { 'minecraft:iron_ingot': ironStock },
      inventory_detail: [],
    }),
  });
  const r = await stockKeeper.run(ctx, {
    item: 'minecraft:iron_ingot', min: 6, route: 'mek_2x', metal: 'iron',
  });
  check('stock_keeper refills via chain', r.done === true && r.action === 'refill',
    JSON.stringify({ done: r.done, after: r.stock_after, chain: r.chain }).slice(0, 300));
  check('stock_keeper stock after = 10', r.stock_after?.total === 10);
}

// ---- build_site: 2部品のオフセット ----
{
  const placedAt = [];
  const ctx = baseCtx({
    'build.place': (p) => { placedAt.push(p.blocks[0].x); return { task_id: 'b' }; },
    'obs.entity': { entities: [] },
  }, {
    state: () => ({ pos: { x: 100, y: 64, z: 100 }, inventory: {}, inventory_detail: [] }),
    plan: {
      size: { x: 1, y: 1, z: 1 },
      blocks: [{ x: 0, y: 0, z: 0, id: 'minecraft:stone' }],
      materials: { 'minecraft:stone': 1 },
    },
  });
  // build_schematic は waitTask の result.placed を見る
  ctx.waitTask = async () => ({ state: 'succeeded', result: { reason: 'done', placed: 1, skipped: 0, mismatched: 0, failed: 0 } });
  const site = JSON.stringify({
    parts: [
      { file: 'a.schem', dx: 0, dy: 0, dz: 0 },
      { file: 'b.schem', dx: 10, dy: 0, dz: 0 },
    ],
  });
  const r = await buildSite.run(ctx, { site, x: 100, y: 64, z: 100 });
  check('build_site done', r.done === true, JSON.stringify(r).slice(0, 160));
  check('build_site offsets 100/110', placedAt.join(',') === '100,110',
    placedAt.join(','));
  check('build_site placed_total 2', r.placed_total === 2);
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
