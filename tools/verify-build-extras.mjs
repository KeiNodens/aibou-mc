// D39 stage7 検証: build_schematic の mirror 変換と、建築後
// commission 配線 (定義に plan を持つ機械だけが対象)。
// 使い方: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-build-extras.mjs
// (bridge の dist は不要 — スキルは .mjs を直接読む)
import { writeFileSync, rmSync } from 'node:fs';

const skill = (await import(new URL('../skills/build_schematic.mjs', import.meta.url))).default;

const DEF = new URL('../machines/zz_test_commission.json', import.meta.url);
writeFileSync(DEF, JSON.stringify({
  menu_id: 'minecraft:furnace', block: 'minecraft:furnace',
  commission: [{ do: 'wait', ms: 1 }],
}));

const placedBatches = [];
const commissionCalls = [];
const ctx = {
  state: async () => ({ name: 'Rin', pos: { x: 0, y: 64, z: 0 } }),
  say: async () => ({}),
  sleep: async () => {},
  throwIfCancelled: () => {},
  signal: new AbortController().signal,
  journal: { checkpoint: () => {}, note: () => {} },
  schematicPlan: async () => ({
    size: { x: 4, y: 1, z: 2 },
    total: 2,
    blocks: [
      { x: 0, y: 0, z: 0, id: 'minecraft:stone' },
      { x: 3, y: 0, z: 1, id: 'minecraft:furnace', props: { facing: 'east' } },
    ],
  }),
  call: async (method, params) => {
    if (method === 'build.place') {
      placedBatches.push(params.blocks);
      return { task_id: 'bt-1' };
    }
    throw new Error(`unexpected call: ${method}`);
  },
  waitTask: async () => ({
    state: 'succeeded',
    result: { placed: 2, skipped: 0, failed: 0, mismatched: 0, mismatched_at: [], missing_items: [] },
  }),
  commission: async (x, y, z) => {
    commissionCalls.push({ x, y, z });
    return { ok: true, steps: [{ do: 'wait', ok: true }] };
  },
};

let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) failures++;
};

try {
  const r = await skill.run(ctx, {
    file: 'dummy.schem', x: 10, y: 64, z: 10, mirror: 'x', mode: 'solo',
  });
  const all = placedBatches.flat();
  const stone = all.find((b) => b.id === 'minecraft:stone');
  const furnace = all.find((b) => b.id === 'minecraft:furnace');
  check('mirror: stone flipped to x=13', stone?.x === 13 && stone?.z === 10,
    JSON.stringify(stone));
  check('mirror: furnace flipped to x=10, facing west',
    furnace?.x === 10 && furnace?.z === 11 && furnace?.props?.facing === 'west',
    JSON.stringify(furnace));
  check('commission ran once at the furnace', commissionCalls.length === 1
    && commissionCalls[0].x === 10 && commissionCalls[0].z === 11,
    JSON.stringify(commissionCalls));
  check('result lists commissioned', r.commissioned?.length === 1
    && r.commissioned[0].ok === true, JSON.stringify(r.commissioned));
} finally {
  rmSync(DEF, { force: true });
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
