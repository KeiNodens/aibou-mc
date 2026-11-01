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
  const menuFor = (m) => {
    const product = m === 'enrich' ? 'mekanism:dust_iron' : 'minecraft:iron_ingot';
    const raw = m === 'enrich' ? 'minecraft:raw_iron' : 'mekanism:dust_iron';
    const slots = [
      { slot: 0, container_idx: 0, empty: true },
      { slot: 1, container_idx: 0, empty: true },
      { slot: 2, container_idx: 0, empty: true },
      { slot: 3, container_idx: 0, empty: false, id: product, count: 8 },
    ];
    for (let i = 4; i < 40; i++) {
      slots.push(i === 4
        ? { slot: i, container_idx: 1, empty: false, id: raw, count: 64 }
        : { slot: i, container_idx: 1, empty: true });
    }
    return {
      menu_id: m === 'enrich' ? 'mekanism:enrichment_chamber' : 'mekanism:energized_smelter',
      slots,
    };
  };
  const ctx = baseCtx({
    'obs.block': (p) => p.block === 'mekanism:enrichment_chamber'
      ? { found: [{ x: 5, y: 64, z: 0, dist: 5 }] }
      : { found: [{ x: 9, y: 64, z: 0, dist: 9 }] },
    'baritone.goto': { task_id: 'g' },
    'use_item': (p) => { menu = p.x === 5 ? 'enrich' : 'smelter'; return { ok: true }; },
    'container.read': () => menuFor(menu),
    'container.click': (p) => {
      if (p.slot === 3 && p.action === 'quick_move' && menu === 'smelter') ironStock = 10;
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
