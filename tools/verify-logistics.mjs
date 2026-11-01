// F1 検証 (fake-ctx): 大チェスト (54) + プレイヤー (36) の menu で
// logistics の fetch/deposit が正しい側を操作すること。
// 旧ヒューリスティクス (最大 container = プレイヤー側) では向きが
// 逆転していた。mod は player_container_idx を正確に返す。
// Run: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-logistics.mjs
import logistics from '../skills/logistics.mjs';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label} ${extra}`);
  if (!cond) fails++;
};

function doubleChestMenu() {
  const slots = [];
  for (let i = 0; i < 54; i++) {
    slots.push(i === 0
      ? { slot: i, container_idx: 0, empty: false, id: 'minecraft:iron_ingot', count: 10 }
      : { slot: i, container_idx: 0, empty: true });
  }
  for (let i = 54; i < 90; i++) {
    slots.push(i === 54
      ? { slot: i, container_idx: 1, empty: false, id: 'minecraft:iron_ingot', count: 10 }
      : { slot: i, container_idx: 1, empty: true });
  }
  return {
    menu_id: 'minecraft:chest',
    container_sizes: { 0: 54, 1: 36 },
    player_container_idx: 1,
    carried: null,
    slots,
  };
}

function makeCtx(clicks) {
  return {
    async call(method, params) {
      switch (method) {
        case 'baritone.goto': return { task_id: 'g' };
        case 'look_at': return {};
        case 'use_item': return { ok: true };
        case 'obs.block': return { found: [{ x: 1, y: 64, z: 1, dist: 2 }] };
        case 'obs.entity': return { entities: [] };
        case 'container.read': return doubleChestMenu();
        case 'container.click': clicks.push(params); return {};
        case 'container.close': return {};
        default: throw new Error('no handler: ' + method);
      }
    },
    async state() {
      return {
        pos: { x: 0, y: 64, z: 0 },
        inventory: { 'minecraft:iron_ingot': 10 },
        inventory_detail: [{ slot: 0, id: 'minecraft:iron_ingot', count: 10 }],
      };
    },
    async sleep() {},
    async say() {},
    async waitTask() { return { state: 'succeeded', result: {} }; },
    throwIfCancelled() {},
    signal: new AbortController().signal,
    journal: { facilities: () => [], note() {}, checkpoint() {}, noteFacility() {}, graphStart() {}, graphSet() {} },
  };
}

// fetch: チェスト側 (slot 0) から取り、プレイヤー側 (slot 54) を触らない
{
  const clicks = [];
  const r = await logistics.run(makeCtx(clicks),
    { action: 'fetch', item: 'minecraft:iron_ingot', count: 5, x: 1, y: 64, z: 1 });
  const slots = clicks.map((c) => c.slot);
  check('fetch clicks the chest slot', slots.includes(0), JSON.stringify(r).slice(0, 160));
  check('fetch never clicks the player slot', !slots.includes(54), slots.join(','));
}

// deposit: プレイヤー側 (slot 54) から預け、チェスト側 (slot 0) を触らない
{
  const clicks = [];
  const r = await logistics.run(makeCtx(clicks),
    { action: 'deposit', x: 1, y: 64, z: 1 });
  const slots = clicks.map((c) => c.slot);
  check('deposit clicks the player slot', slots.includes(54), JSON.stringify(r).slice(0, 160));
  check('deposit never clicks the chest slot', !slots.includes(0), slots.join(','));
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
