// D23 S2/S3/S4 + D21 world_craft の fake-ctx 単体検証。
// 実スキルモジュールを読み、スクリプト化した ctx で run() を回す。
// Run: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-skills-d23.mjs
import logistics from '../skills/logistics.mjs';
import buildPrepare from '../skills/build_prepare.mjs';
import buildSchematic from '../skills/build_schematic.mjs';
import worldCraft from '../skills/world_craft.mjs';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label} ${extra}`);
  if (!cond) fails++;
};

function makeCtx(handlers, opts = {}) {
  const calls = [];
  const facilitiesList = [...(opts.facilities ?? [])];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      const h = handlers[method];
      if (!h) throw new Error('no handler: ' + method);
      return typeof h === 'function' ? h(params, calls) : h;
    },
    async state() {
      return typeof opts.state === 'function' ? opts.state() : (opts.state ?? { inventory_detail: [] });
    },
    async schematicPlan() { return opts.plan; },
    async sleep() {},
    async say() {},
    async waitTask() { return { state: 'succeeded' }; },
    throwIfCancelled() {},
    signal: new AbortController().signal,
    journal: {
      noteFacility(f) { facilitiesList.push(f); },
      facilities(kind) { return facilitiesList.filter((f) => !kind || f.kind === kind); },
      checkpoint() {},
      note() {},
    },
  };
}
const chestRead = (chestSlots) => ({
  menu_id: 'minecraft:generic_9x3',
  container_sizes: { 0: 27, 1: 36 },
  slots: [
    ...chestSlots.map((s, i) => ({ slot: i, container_idx: 0, ...s })),
    { slot: 40, container_idx: 1, empty: true },
  ],
});

// ---------- T1: logistics fetch が複数ソースを回る ----------
{
  const reads = [
    chestRead([{ id: 'minecraft:iron_ingot', count: 20 }]),
    chestRead([{ id: 'minecraft:iron_ingot', count: 50 }]),
  ];
  const ctx = makeCtx({
    'obs.block': { found: [{ x: 1, y: 64, z: 1 }] },
    'baritone.goto': { task_id: 't' },
    'look_at': {},
    'use_item': {},
    'container.read': () => reads.shift(),
    'container.click': {},
    'container.close': {},
  }, {
    state: { inventory_detail: [], player: { x: 0, y: 64, z: 0 } },
    facilities: [{ kind: 'chest', pos: { x: 10, y: 64, z: 10 } }],
  });
  const r = await logistics.run(ctx, { action: 'fetch', item: 'minecraft:iron_ingot', count: 48 });
  check('T1 fetched across 2 chests', r.fetched === 70, JSON.stringify(r));
  check('T1 sources = 2', r.sources?.length === 2);
}

// ---------- T2: build_prepare の集計・調達・分類 ----------
{
  const plan = {
    size: { x: 4, y: 1, z: 4 }, total: 18,
    blocks: [
      ...Array(10).fill({ x: 0, y: 0, z: 0, id: 'minecraft:stone' }),
      ...Array(5).fill({ x: 0, y: 0, z: 0, id: 'minecraft:oak_stairs' }),
      ...Array(3).fill({ x: 0, y: 0, z: 0, id: 'mekanism:steel_casing' }),
    ],
  };
  const ctx = makeCtx({
    'obs.block': { found: [{ x: 2, y: 64, z: 2 }] },
    'baritone.goto': { task_id: 't' },
    'look_at': {},
    'use_item': {},
    'container.read': chestRead([
      { id: 'minecraft:stone', count: 6 },
      { id: 'minecraft:oak_stairs', count: 5 },
    ]),
    'container.click': {},
    'container.close': {},
    'recipe.lookup': { recipes: [{ type: 'minecraft:crafting_shaped' }] },
  }, {
    plan,
    state: {
      inventory_detail: [
        { slot: 0, id: 'minecraft:stone', count: 4 },
        { slot: 1, id: 'mekanism:steel_casing', count: 1 },
      ],
      player: { x: 0, y: 64, z: 0 },
    },
  });
  const r = await buildPrepare.run(ctx, { file: 'x.schem' });
  check('T2 from_inventory', r.from_inventory['minecraft:stone'] === 4 &&
    r.from_inventory['mekanism:steel_casing'] === 1, JSON.stringify(r.from_inventory));
  check('T2 fetched', r.fetched['minecraft:stone'] === 6 &&
    r.fetched['minecraft:oak_stairs'] === 5, JSON.stringify(r.fetched));
  check('T2 craftable steel_casing x2',
    r.craftable?.length === 1 && r.craftable[0].count === 2, JSON.stringify(r.craftable));
  check('T2 missing empty', r.missing?.length === 0);
}

// ---------- T3: build_schematic v2 (props不一致 + 回転 + 補充) ----------
{
  // (a) facing 不一致を mismatched として報告する
  const planA = {
    size: { x: 2, y: 1, z: 1 }, total: 2,
    blocks: [
      { x: 0, y: 0, z: 0, id: 'minecraft:oak_stairs', props: { facing: 'north' } },
      { x: 1, y: 0, z: 0, id: 'minecraft:stone' },
    ],
  };
  let placedA = false;
  const ctxA = makeCtx({
    'obs.block_state': (p) => {
      if (p.x === 100 && p.y === 63) return { block: 'minecraft:stone' }; // 支持
      if (p.x === 100 && p.y === 64)
        return placedA
          ? { block: 'minecraft:oak_stairs', properties: { facing: 'south' } }
          : { block: 'minecraft:air' };
      if (p.x === 101) return { block: 'minecraft:stone' };
      return { block: 'minecraft:air' };
    },
    'baritone.goto': { task_id: 't' },
    'equip': {},
    'look_at': {},
    'use_item': () => { placedA = true; return { ok: true }; },
  }, {
    plan: planA,
    state: { inventory_detail: [{ slot: 3, id: 'minecraft:oak_stairs', count: 4 }] },
  });
  const ra = await buildSchematic.run(ctxA, { file: 'x', x: 100, y: 64, z: 100 });
  check('T3a placed 1 / skipped 1', ra.placed === 1 && ra.skipped === 1, JSON.stringify(ra));
  check('T3a mismatched reported', ra.mismatched_count === 1 &&
    ra.mismatched[0].want.facing === 'north', JSON.stringify(ra.mismatched));

  // (b) rotation=90 で座標が変換される + 在庫から補充 (swap) する
  const planB = {
    size: { x: 2, y: 1, z: 2 }, total: 1,
    blocks: [{ x: 0, y: 0, z: 0, id: 'minecraft:stone' }],
  };
  let placedB = false;
  const useItemTargets = [];
  const ctxB = makeCtx({
    'obs.block_state': (p) => {
      if (p.y === 63) return { block: 'minecraft:stone' };
      if (p.x === 201 && p.z === 200 && placedB) return { block: 'minecraft:stone' };
      return { block: 'minecraft:air' };
    },
    'baritone.goto': { task_id: 't' },
    'equip': {},
    'look_at': {},
    'use_item': (p) => { useItemTargets.push(p); placedB = true; return { ok: true }; },
    'container.read': { menu_id: 'player_inventory', container_sizes: { 0: 36 }, slots: [] },
    'container.click': {},
  }, {
    plan: planB,
    state: { inventory_detail: [{ slot: 20, id: 'minecraft:stone', count: 10 }] },
  });
  const rb = await buildSchematic.run(ctxB, { file: 'x', x: 200, y: 64, z: 200, rotation: 90 });
  // rot90: (0,0) → (x: size.z-1-0 = 1, z: 0) → world (201, 64, 200); 支持は真下 (201,63,200)
  check('T3b rotated placement target',
    useItemTargets.some((p) => p.x === 201 && p.y === 63 && p.z === 200),
    JSON.stringify(useItemTargets));
  check('T3b restock swap happened',
    ctxB.calls.some((c) => c.method === 'container.click' && c.params.action === 'swap' && c.params.slot === 20));
  check('T3b placed 1', rb.placed === 1, JSON.stringify(rb));
}

// ---------- T4: world_craft (mana infusion の通し) ----------
{
  let tossed = false;
  let entityCalls = 0;
  const ctx = makeCtx({
    'obs.block': { found: [{ x: 5, y: 64, z: 5 }] },
    'baritone.goto': { task_id: 't' },
    'equip': {},
    'toss': () => { tossed = true; return { dropped: true }; },
    'obs.entity': () => {
      entityCalls++;
      return entityCalls <= 1
        ? { entities: [{ id: 'minecraft:item', x: 5, y: 64, z: 5 }] }
        : { entities: [] };
    },
  }, {
    state: () => tossed
      ? { inventory_detail: [
          { slot: 0, id: 'minecraft:iron_ingot', count: 2 },
          { slot: 1, id: 'botania:manasteel_ingot', count: 1 },
        ] }
      : { inventory_detail: [{ slot: 0, id: 'minecraft:iron_ingot', count: 3 }] },
  });
  const r = await worldCraft.run(ctx, { station: 'botania_mana_infusion' });
  check('T4 done', r.done === true, JSON.stringify(r));
  check('T4 produced manasteel', r.produced?.['botania:manasteel_ingot'] === 1);
  check('T4 consumed iron', r.consumed?.['minecraft:iron_ingot'] === 1);

  const list = await worldCraft.run(makeCtx({}, {}), {});
  check('T4 station list includes drafts',
    list.stations?.some((s) => s.id === 'ae2_fluix') &&
    list.stations?.some((s) => s.id === 'create_millstone' && s.draft === true),
    JSON.stringify(list.stations?.map((s) => s.id)));
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
