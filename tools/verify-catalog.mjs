// D23/S1b standalone verification: BlockCatalog paging / cache / search.
// Run: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-catalog.mjs (cwd=repo root)
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlockCatalog } from '../bridge/src/catalog.ts';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label} ${extra}`);
  if (!cond) fails++;
};

const ALL = [
  { id: 'minecraft:oak_stairs', name: 'Oak Stairs', item: 'minecraft:oak_stairs',
    properties: { facing: ['north', 'south', 'east', 'west'], half: ['top', 'bottom'] } },
  { id: 'minecraft:stone', name: 'Stone', item: 'minecraft:stone' },
  { id: 'mekanism:basic_universal_cable', name: 'Basic Universal Cable', item: 'mekanism:basic_universal_cable' },
];
const fakeCall = async (method, params) => {
  if (method !== 'registry.blocks') throw new Error('unexpected ' + method);
  const { offset, limit } = params;
  return { total: ALL.length, offset, blocks: ALL.slice(offset, offset + limit) };
};

const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
const file = join(dir, 'block-catalog.json');
const cat = new BlockCatalog(file);
check('load without cache = false', (await cat.load()) === false);
const n = await cat.refresh(fakeCall);   // limit 2000 internally → single page here
check('refresh returns 3', n === 3, `got ${n}`);
check('cache file written', JSON.parse(readFileSync(file, 'utf8')).length === 3);
check('has()', cat.has('minecraft:stone') && !cat.has('minecraft:nope'));
check('search by id substring', cat.search('stairs').length === 1);
check('search by display name', cat.search('Universal Cable').length === 1);
check('search props kept', cat.search('stairs')[0].properties.facing.includes('south'));
check('suggest for typo', cat.suggest('minecraft:oak_stair').includes('minecraft:oak_stairs'));

// paging: shrink page size by faking a registry that honors small limits
const paged = new BlockCatalog(join(dir, 'paged.json'));
const smallCall = async (m, params) => {
  const { offset } = params;
  return { total: ALL.length, offset, blocks: ALL.slice(offset, offset + 2) };
};
// BlockCatalog.refresh uses limit=2000; emulate paging via repeated responses is
// covered by the loop condition — here verify the loop terminates on total.
check('refresh with 2-per-page fake (limit ignored by fake) still completes',
  (await paged.refresh(smallCall)) === 3);

// reload from cache
const cat2 = new BlockCatalog(file);
check('load from cache = true', (await cat2.load()) === true && cat2.size === 3);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
