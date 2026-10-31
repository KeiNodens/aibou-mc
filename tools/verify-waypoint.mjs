// waypoint アダプタ (D20) の単体検証: fake ctx で mod op を模倣し、
// アダプタの各 action と旧ファイル移行を確認する。
// 実行: node tools/verify-waypoint.mjs
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'wp-'));
const legacyFile = path.join(dir, 'waypoints.json');
process.env.AIBOU_LEGACY_WAYPOINTS_FILE = legacyFile;

// fake mod: Java Waypoints の意味論を模倣する
const store = new Map();
store.set('shared', { x: 9, y: 9, z: 9 });
const calls = [];
const ctx = {
  async call(method, params = {}) {
    calls.push({ method, params });
    switch (method) {
      case 'waypoint.set': {
        const wp = {
          x: params.x ?? 100, y: params.y ?? 64, z: params.z ?? -50,
        };
        if (typeof params.r === 'number' && params.r >= 0) {
          wp.r = params.r;
          wp.dim = 'minecraft:overworld';
        }
        store.set(params.name, wp);
        return { saved: params.name, ...wp };
      }
      case 'waypoint.get': {
        const wp = store.get(params.name);
        if (!wp) throw new Error('NOT_FOUND: unknown waypoint');
        return { ...wp };
      }
      case 'waypoint.list':
        return { waypoints: Object.fromEntries(store) };
      case 'waypoint.del': {
        if (!store.delete(params.name)) {
          throw new Error(`NOT_FOUND: unknown waypoint: ${params.name}`);
        }
        return { deleted: params.name };
      }
      case 'baritone.goto':
        return { task_id: 't1' };
      default:
        throw new Error('unexpected call ' + method);
    }
  },
  async say() {},
  async waitTask() { return { state: 'succeeded' }; },
};

writeFileSync(legacyFile, JSON.stringify({
  waypoints: {
    legacy_home: {
      x: 1, y: 2, z: 3, dim: 'minecraft:overworld',
      set_at: '2026-10-28T00:00:00.000Z',
    },
    shared: {
      x: 5, y: 5, z: 5, dim: 'minecraft:overworld',
      set_at: '2026-10-28T00:00:00.000Z',
    },
  },
}));

const skill = (await import('../skills/waypoint.mjs')).default;

// 1. 初回 list で移行が走る: legacy_home が取り込まれ、shared は mod 側優先
const r1 = await skill.run(ctx, { action: 'list' });
if (!store.has('legacy_home') || store.get('legacy_home').x !== 1) {
  throw new Error('legacy_home not imported');
}
if (store.get('shared').x !== 9) throw new Error('shared overwritten by legacy');
if (existsSync(legacyFile)) throw new Error('legacy file not archived');
if (!existsSync(legacyFile + '.migrated')) throw new Error('.migrated missing');
if (r1.count !== 2) throw new Error('list count wrong: ' + r1.count);
console.log('1. migration (import + mod priority + archive): OK');

// 2. remember (現在位置) と radius 付き remember
const r2 = await skill.run(ctx, { action: 'remember', name: 'now' });
if (!r2.done || store.get('now').x !== 100) throw new Error('remember failed');
const r3 = await skill.run(ctx, { action: 'remember', name: 'base_area', radius: 12 });
if (store.get('base_area')?.r !== 12) throw new Error('radius not stored');
console.log('2. remember + radius: OK');

// 3. goto は mod 側の座標を解決する
const r4 = await skill.run(ctx, { action: 'goto', name: 'legacy_home' });
if (!r4.done) throw new Error('goto failed');
const gotoCall = calls.find((c) => c.method === 'baritone.goto');
if (gotoCall.params.x !== 1 || gotoCall.params.z !== 3) {
  throw new Error('goto coords wrong');
}
const r5 = await skill.run(ctx, { action: 'goto', name: 'nope' });
if (r5.done || r5.error !== 'not_found') throw new Error('goto not_found wrong');
console.log('3. goto resolution + not_found: OK');

// 4. remove と not_found
const r6 = await skill.run(ctx, { action: 'remove', name: 'now' });
if (!r6.done || store.has('now')) throw new Error('remove failed');
const r7 = await skill.run(ctx, { action: 'remove', name: 'now' });
if (r7.done || r7.error !== 'not_found') throw new Error('remove not_found wrong');
console.log('4. remove + not_found: OK');
console.log('verify-waypoint: ALL PASS');
