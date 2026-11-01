// D23/S1a standalone verification: schematic_create round-trip.
// Run: node node_modules/tsx/dist/cli.mjs tools/verify-schematic-create.mjs (cwd=bridge)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSchematicFile, planSchematic } from '../bridge/src/schematic.ts';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label} ${extra}`);
  if (!cond) fails++;
};
const dir = mkdtempSync(join(tmpdir(), 'schem-create-'));

// Case 1: a small hut from primitives.
// floor 5x5 planks (25) + hollow walls y1..3 stone_bricks (25+16+25=66)
// - door carve 2 = 64; stairs ridge line y4 across z=0 (5). Total 94.
const hut = await createSchematicFile({
  name: 'hut', dir,
  ops: [
    { op: 'box', from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 0, z: 4 }, block: 'minecraft:oak_planks' },
    { op: 'box', from: { x: 0, y: 1, z: 0 }, to: { x: 4, y: 3, z: 4 }, block: 'minecraft:stone_bricks', hollow: true },
    { op: 'block', x: 2, y: 1, z: 0, block: 'minecraft:air' },
    { op: 'block', x: 2, y: 2, z: 0, block: 'minecraft:air' },
    { op: 'line', from: { x: 0, y: 4, z: 0 }, to: { x: 4, y: 4, z: 0 }, block: 'minecraft:oak_stairs', props: { facing: 'south' } },
  ],
});
check('size 5x5x5', hut.size.x === 5 && hut.size.y === 5 && hut.size.z === 5, JSON.stringify(hut.size));
check('solid = 94', hut.solid_blocks === 94, `got ${hut.solid_blocks}`);
const mat = Object.fromEntries(hut.materials.map(m => [m.id, m.count]));
check('materials planks=25', mat['minecraft:oak_planks'] === 25, JSON.stringify(mat));
check('materials stone_bricks=64', mat['minecraft:stone_bricks'] === 64);
check('materials oak_stairs=5 (props split from id)', mat['minecraft:oak_stairs'] === 5);

const plan = await planSchematic(hut.path);
const at = (x, y, z) => plan.blocks.find(b => b.x === x && b.y === y && b.z === z);
check('door cell carved (2,1,0)', at(2, 1, 0) === undefined);
check('hollow interior empty (2,2,2)', at(2, 2, 2) === undefined);
check('floor corner (0,0,0) planks', at(0, 0, 0)?.id === 'minecraft:oak_planks');
check('wall corner (4,3,4) stone_bricks', at(4, 3, 4)?.id === 'minecraft:stone_bricks');
const stair = at(2, 4, 0);
check('stairs props round-trip', stair?.id === 'minecraft:oak_stairs' && stair?.props?.facing === 'south',
  JSON.stringify(stair));

// Case 2: explicit blocks only, with props; negative coords get cropped to origin.
const raw = await createSchematicFile({
  name: 'raw', dir,
  blocks: [
    { x: -3, y: 10, z: 7, block: 'minecraft:oak_log', props: { axis: 'y' } },
    { x: -2, y: 10, z: 7, block: 'minecraft:glass' },
  ],
});
check('raw size 2x1x1', raw.size.x === 2 && raw.size.y === 1 && raw.size.z === 1, JSON.stringify(raw.size));
const rawPlan = await planSchematic(raw.path);
check('raw crop to origin', rawPlan.blocks[0].x === 0 && rawPlan.blocks[0].y === 0 && rawPlan.blocks[0].z === 0);
check('raw props round-trip', rawPlan.blocks[0].props?.axis === 'y');

// Case 3: error paths.
const expectThrow = async (label, fn) => {
  try { await fn(); check(label, false, '(no throw)'); }
  catch { check(label, true); }
};
await expectThrow('bad name rejected', () => createSchematicFile({ name: '../evil', dir, blocks: [{ x: 0, y: 0, z: 0, block: 'minecraft:stone' }] }));
await expectThrow('bad block id rejected', () => createSchematicFile({ name: 'x1', dir, blocks: [{ x: 0, y: 0, z: 0, block: 'Stone' }] }));
await expectThrow('empty rejected', () => createSchematicFile({ name: 'x2', dir, ops: [{ op: 'block', x: 0, y: 0, z: 0, block: 'minecraft:air' }] }));
await expectThrow('overwrite guard', () => createSchematicFile({ name: 'hut', dir, blocks: [{ x: 0, y: 0, z: 0, block: 'minecraft:stone' }] }));
const ow = await createSchematicFile({ name: 'hut', dir, overwrite: true, blocks: [{ x: 0, y: 0, z: 0, block: 'minecraft:stone' }] });
check('overwrite works', ow.solid_blocks === 1);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
