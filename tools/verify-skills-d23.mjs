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
import ride from '../skills/ride.mjs';
import trainDrive from '../skills/train_drive.mjs';
import deckWalk from '../skills/deck_walk.mjs';
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
    async waitTask(id) { return opts.waitTask ? opts.waitTask(id) : { state: 'succeeded' }; },
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

// ---------- T3: build_schematic v3 (BuildTask 連携: 回転 + 結果集計) ----------
{
  // BuildTask のエミュレーション: fake world に対して結果を計算する
  const emulateBuild = (world) => (p) => {
    let placed = 0, skipped = 0, mismatched = 0, failed = 0;
    const mismatched_at = [];
    for (const b of p.blocks) {
      const k = `${b.x},${b.y},${b.z}`;
      const cur = world[k];
      const propsOk = (props, entry) => !props ||
        Object.entries(props).every(([kk, v]) => String(entry?.props?.[kk]) === String(v));
      if (cur && cur.id === b.id && propsOk(b.props, cur)) { skipped++; continue; }
      if (cur && cur.id === b.id && b.props) {
        mismatched++;
        mismatched_at.push({ x: b.x, y: b.y, z: b.z, id: b.id, actual: cur.id });
        continue;
      }
      if (cur && cur.id !== 'minecraft:air') { failed++; continue; }
      // 設置: 階段は配置文脈で facing が south になってしまう世界を再現
      const entry = {
        id: b.id,
        props: b.id === 'minecraft:oak_stairs' ? { facing: 'south' } : (b.props ?? {}),
      };
      world[k] = entry;
      if (b.props && !propsOk(b.props, entry)) {
        mismatched++;
        mismatched_at.push({ x: b.x, y: b.y, z: b.z, id: b.id, actual: b.id });
      } else placed++;
    }
    return { task_id: 'bt', _r: { placed, skipped, mismatched, failed,
      remaining: 0, missing_items: [], mismatched_at } };
  };

  // (a) 設置・スキップ・props 不一致が集計される
  const planA = {
    size: { x: 3, y: 1, z: 1 }, total: 3,
    blocks: [
      { x: 0, y: 0, z: 0, id: 'minecraft:oak_stairs', props: { facing: 'north' } },
      { x: 1, y: 0, z: 0, id: 'minecraft:stone' },
      { x: 2, y: 0, z: 0, id: 'minecraft:oak_log' },
    ],
  };
  const worldA = { '101,64,100': { id: 'minecraft:stone', props: {} } };
  let lastA = null;
  const ctxA = makeCtx({
    'build.place': (p) => { const r = emulateBuild(worldA)(p); lastA = r._r; return { task_id: r.task_id }; },
  }, {
    plan: planA,
    waitTask: () => ({ state: 'succeeded', result: lastA }),
  });
  const ra = await buildSchematic.run(ctxA, { file: 'x', x: 100, y: 64, z: 100 });
  check('T3a placed 1 / skipped 1', ra.placed === 1 && ra.skipped === 1, JSON.stringify(ra));
  check('T3a mismatched reported', ra.mismatched_count === 1 &&
    ra.mismatched[0].id === 'minecraft:oak_stairs', JSON.stringify(ra.mismatched));

  // (b) rotation=90 で配置座標が変換されて build.place に渡る
  const planB = {
    size: { x: 2, y: 1, z: 2 }, total: 1,
    blocks: [{ x: 0, y: 0, z: 0, id: 'minecraft:stone' }],
  };
  const worldB = {};
  let lastB = null;
  const ctxB = makeCtx({
    'build.place': (p) => { const r = emulateBuild(worldB)(p); lastB = r._r; return { task_id: r.task_id }; },
  }, {
    plan: planB,
    waitTask: () => ({ state: 'succeeded', result: lastB }),
  });
  const rb = await buildSchematic.run(ctxB, { file: 'x', x: 200, y: 64, z: 200, rotation: 90 });
  // rot90: (0,0) → (x: size.z-1-0 = 1, z: 0) → world (201, 64, 200)
  const placeCall = ctxB.calls.find((c) => c.method === 'build.place');
  check('T3b rotated placement target',
    !!placeCall && placeCall.params.blocks[0].x === 201 &&
    placeCall.params.blocks[0].y === 64 && placeCall.params.blocks[0].z === 200,
    JSON.stringify(placeCall?.params));
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

// ---------- T8: D27 contraption batch ----------
{
  // (a) ride 着席
  let ridingA = false;
  const ctxR = makeCtx({
    'contraption.status': () => ({ riding: ridingA, found: ridingA ? [] : [{ class: 'com.simibubi.create.content.contraptions.ContraptionEntity', seats: 2 }] }),
    'contraption.ride': () => { ridingA = true; return { riding: true, via: 'interactAt(seat 0)' }; },
  }, { state: { inventory_detail: [] } });
  const rr = await ride.run(ctxR, {});
  check('T8a ride seated', rr.done === true && rr.seats === 2, JSON.stringify(rr));

  // (b) ride 離席 (sneak パルスで riding が落ちる)
  let ridingB = true;
  const ctxL = makeCtx({
    'move.set': (params) => { if (params.sneak) ridingB = false; return {}; },
    'contraption.status': () => ({ riding: ridingB, found: [] }),
  }, { state: { inventory_detail: [] } });
  const rl = await ride.run(ctxL, { leave: true });
  check('T8b ride left', rl.done === true && rl.left === true, JSON.stringify(rl));

  // (c) train_drive: 速度が付く
  const speedSeq = [0, 0.5, 1.2];
  const ctxT = makeCtx({
    'contraption.status': () => ({
      riding: true,
      found: [{ bot_is_passenger: true, speed: speedSeq.length ? speedSeq.shift() : 1.2 }],
    }),
    'move.set': {},
  }, { state: { inventory_detail: [] } });
  const rt = await trainDrive.run(ctxT, { seconds: 3 });
  check('T8c train moved', rt.done === true && rt.moved === true && rt.max_speed === 1.2, JSON.stringify(rt));

  // (d) deck_walk: 動く目標に追いつく (自分が少しずつ近づく世界)
  const me = { x: 0, y: 64, z: 0 };
  const ctxD2 = makeCtx({
    'contraption.status': () => ({
      riding: false,
      found: [{ x: 0, y: 64, z: 0, local_global: { x: 5, y: 64, z: 0 } }],
    }),
    'look_at': {},
    'move.set': {},
  }, {
    state: () => {
      me.x = Math.min(me.x + 1.5, 5);
      return { pos: { ...me }, inventory_detail: [] };
    },
  });
  const rd2 = await deckWalk.run(ctxD2, { local_x: 5, local_y: 0, local_z: 0 });
  check('T8d deck walk arrived', rd2.done === true, JSON.stringify(rd2));
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
