// D23 S2/S3/S4 + D21 world_craft の fake-ctx 単体検証。
// 実スキルモジュールを読み、スクリプト化した ctx で run() を回す。
// Run: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-skills-d23.mjs
import logistics from '../skills/logistics.mjs';
import buildPrepare from '../skills/build_prepare.mjs';
import buildSchematic from '../skills/build_schematic.mjs';
import worldCraft from '../skills/world_craft.mjs';
import farm from '../skills/farm.mjs';
import cook from '../skills/cook.mjs';
import warp from '../skills/warp.mjs';
import fs from 'node:fs';
import path from 'node:path';

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

// ---------- T5: world_craft が target からレシピ材料を引く ----------
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
    'recipe.lookup': {
      recipes: [{
        id: 'botania:mana_infusion/manasteel',
        type: 'botania:mana_infusion',
        ingredients: [{ options: ['minecraft:iron_ingot'], count: 1 }],
        result: { id: 'botania:manasteel_ingot', count: 1 },
      }, {
        id: 'minecraft:manasteel_from_smelting',
        type: 'minecraft:smelting',
        ingredients: [{ options: ['minecraft:iron_ingot'], count: 1 }],
        result: { id: 'botania:manasteel_ingot', count: 1 },
      }],
      count: 2,
    },
  }, {
    state: () => tossed
      ? { inventory_detail: [
          { slot: 0, id: 'minecraft:iron_ingot', count: 1 },
          { slot: 1, id: 'botania:manasteel_ingot', count: 2 },
        ] }
      : { inventory_detail: [{ slot: 0, id: 'minecraft:iron_ingot', count: 3 }] },
  });
  const r = await worldCraft.run(ctx, {
    station: 'botania_mana_infusion', target: 'botania:manasteel_ingot', amount: 2,
  });
  check('T5 recipe filtered by station type',
    r.recipe_used?.type === 'botania:mana_infusion', JSON.stringify(r.recipe_used));
  check('T5 inputs from recipe x2 crafts',
    r.consumed?.['minecraft:iron_ingot'] === 2, JSON.stringify(r.consumed));
  check('T5 produced x2', r.produced?.['botania:manasteel_ingot'] === 2);
  check('T5 inputs_source=recipe', r.inputs_source === 'recipe');
}

// ---------- T6: Farmer's Delight (farm 拡張 / cutting board / cook) ----------
{
  // (a) キャベツ: dig + 植え直し
  const ctxA = makeCtx({
    'obs.block': { found: [{ x: 3, y: 64, z: 3 }] },
    'obs.block_state': { block: 'farmersdelight:cabbages', properties: { age: '7' } },
    'baritone.goto': { task_id: 't' },
    'dig': { task_id: 'd' },
    'equip': {},
    'use_item': {},
  }, {
    state: { inventory_detail: [{ slot: 2, id: 'farmersdelight:cabbage_seeds', count: 5 }] },
  });
  ctxA.waitTask = async () => ({ state: 'succeeded' });
  const ra = await farm.run(ctxA, { crop: 'farmersdelight:cabbages' });
  check('T6a cabbage harvested+replanted', ra.harvested === 1 && ra.replanted === 1, JSON.stringify(ra));

  // (b) トマト: 右クリック収穫 (dig しない、age が下がる)
  let tomatoAge = '7';
  let digCalled = false;
  const ctxB = makeCtx({
    'obs.block': { found: [{ x: 4, y: 64, z: 4 }] },
    'obs.block_state': () => ({ block: 'farmersdelight:tomatoes', properties: { age: tomatoAge } }),
    'baritone.goto': { task_id: 't' },
    'dig': () => { digCalled = true; return { task_id: 'd' }; },
    'use_item': () => { tomatoAge = '3'; return {}; },
  }, { state: { inventory_detail: [] } });
  const rb = await farm.run(ctxB, { crop: 'farmersdelight:tomatoes' });
  check('T6b tomato picked by use, no dig', rb.harvested === 1 && !digCalled, JSON.stringify(rb));

  // (c) cutting board: with_alt でダイヤナイフに落ちる + レシピ解決
  let cut = false;
  let useCount = 0;
  const ctxC = makeCtx({
    'obs.block': { found: [{ x: 7, y: 64, z: 7 }] },
    'baritone.goto': { task_id: 't' },
    'equip': {},
    'use_item': () => { useCount++; if (useCount >= 2) cut = true; return {}; },
    'recipe.lookup': { recipes: [{
      id: 'farmersdelight:cutting/minced_beef', type: 'farmersdelight:cutting',
      ingredients: [{ options: ['minecraft:beef'], count: 1 }],
      result: { id: 'farmersdelight:minced_beef', count: 2 },
    }] },
  }, {
    state: () => cut
      ? { inventory_detail: [
          { slot: 1, id: 'farmersdelight:diamond_knife', count: 1 },
          { slot: 2, id: 'farmersdelight:minced_beef', count: 2 } ] }
      : { inventory_detail: [
          { slot: 0, id: 'minecraft:beef', count: 1 },
          { slot: 1, id: 'farmersdelight:diamond_knife', count: 1 } ] },
  });
  const rc = await worldCraft.run(ctxC, {
    station: 'farmersdelight_cutting_board', target: 'farmersdelight:minced_beef',
  });
  check('T6c cutting board done', rc.done === true, JSON.stringify(rc));
  check('T6c recipe type cutting', rc.recipe_used?.type === 'farmersdelight:cutting');

  // (d) cook: 材料を鍋へ移し、出来上がりを回収する
  const potRead = (withResult) => ({
    menu_id: 'farmersdelight:cooking_pot',
    container_sizes: { 0: 9, 1: 36 },
    slots: [
      ...Array.from({ length: 9 }, (_, i) => ({
        slot: i, container_idx: 0, empty: !(withResult && i === 8),
        ...(withResult && i === 8 ? { id: 'farmersdelight:beef_stew', count: 1 } : {}),
      })),
      { slot: 30, container_idx: 1, id: 'minecraft:beef', count: 2 },
      { slot: 31, container_idx: 1, id: 'minecraft:carrot', count: 2 },
    ],
  });
  const reads = [potRead(false), potRead(false), potRead(false), potRead(true)];
  const ctxD = makeCtx({
    'recipe.lookup': { recipes: [{
      id: 'farmersdelight:cooking/beef_stew', type: 'farmersdelight:cooking',
      ingredients: [
        { options: ['minecraft:beef'], count: 1 },
        { options: ['minecraft:carrot'], count: 1 },
      ],
      result: { id: 'farmersdelight:beef_stew', count: 1 },
    }] },
    'obs.block': { found: [{ x: 9, y: 64, z: 9 }] },
    'baritone.goto': { task_id: 't' },
    'look_at': {},
    'use_item': {},
    'container.read': () => reads.shift() ?? potRead(true),
    'container.click': {},
    'container.close': {},
  }, {
    state: { inventory_detail: [
      { slot: 0, id: 'minecraft:beef', count: 2 },
      { slot: 1, id: 'minecraft:carrot', count: 2 } ] },
  });
  const rd = await cook.run(ctxD, { target: 'farmersdelight:beef_stew' });
  check('T6d cooked 1', rd.done === true && rd.cooked === 1, JSON.stringify(rd));
  check('T6d ingredient transfers happened',
    ctxD.calls.filter((c) => c.method === 'container.click' && c.params.action === 'pickup').length >= 4);
  check('T6d result taken by quick_move',
    ctxD.calls.some((c) => c.method === 'container.click' && c.params.action === 'quick_move' && c.params.slot === 8));
}

// ---------- T7: D25 coverage batch (defs validity / warp / new stations) ----------
{
  // (a) machines/*.json と stations/*.json が全て妥当な形か
  let defCount = 0;
  for (const f of fs.readdirSync('machines')) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(fs.readFileSync(path.join('machines', f), 'utf8'));
    if (!d.menu_id || !Array.isArray(d.input) || !Array.isArray(d.output))
      throw new Error('bad machine def: ' + f);
    defCount++;
  }
  check('T7a machine defs valid', defCount >= 126, defCount + ' defs');
  let stCount = 0;
  for (const f of fs.readdirSync('stations')) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(fs.readFileSync(path.join('stations', f), 'utf8'));
    if (!d.id || !d.station?.block || !Array.isArray(d.steps))
      throw new Error('bad station def: ' + f);
    stCount++;
  }
  check('T7a station defs valid', stCount >= 19, stCount + ' stations');

  // (b) warp: 宛先を名前で選んでクリックする
  const ctxW = makeCtx({
    'obs.block': { found: [{ x: 1, y: 64, z: 1 }] },
    'baritone.goto': { task_id: 't' },
    'look_at': {},
    'use_item': {},
    'screen.read': { widgets: [{ text: 'Spawn Base' }, { text: 'Home Sweet' }] },
    'screen.click': {},
  }, { state: { inventory_detail: [] } });
  const rw = await warp.run(ctxW, { name: 'home' });
  check('T7b warp picked destination', rw.done === true && rw.destination === 'Home Sweet', JSON.stringify(rw));

  // (c) world_craft: naturesaura_altar (wait ステップ経由) が通る
  let placed = false;
  const ctxN = makeCtx({
    'obs.block': { found: [{ x: 5, y: 64, z: 5 }] },
    'baritone.goto': { task_id: 't' },
    'look_at': {},
    'equip': {},
    'use_item': () => { placed = true; return {}; },
  }, {
    state: () => placed
      ? { inventory_detail: [{ slot: 0, id: 'naturesaura:infused_iron', count: 1 }] }
      : { inventory_detail: [{ slot: 0, id: 'minecraft:iron_ingot', count: 1 }] },
  });
  const rn = await worldCraft.run(ctxN, {
    station: 'naturesaura_altar', input: 'minecraft:iron_ingot', at: { x: 5, y: 64, z: 5 },
  });
  check('T7c altar run done', rn.done === true, JSON.stringify(rn));
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
