// 名前付き地点 (waypoint)。D20: 正は mod 側 Waypoints
// (gameDir/agentmod-waypoints.json)。この skill は薄いアダプタで、
// waypoint.set/get/list/del を叩く。MCP の waypoint_save 等と共有され、
// 登録は JourneyMap にもミラーされる。
// 旧 skills 側ストア (bridge/waypoints.json) は初回実行時に移行する:
// mod 側に無い名前だけを取り込み (同名は mod 側優先)、
// 移行後に waypoints.json.migrated へ改名する。
import { existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_FILE = process.env.AIBOU_LEGACY_WAYPOINTS_FILE ?? path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../bridge/waypoints.json');

let migrationDone = false;

async function migrateLegacy(ctx) {
  if (migrationDone) return;
  let legacy;
  try {
    if (!existsSync(LEGACY_FILE)) { migrationDone = true; return; }
    legacy = JSON.parse(readFileSync(LEGACY_FILE, 'utf8'))?.waypoints ?? {};
  } catch {
    // 壊れたファイルで毎回引っかからないよう退避して終了する
    try { renameSync(LEGACY_FILE, LEGACY_FILE + '.corrupt'); } catch {}
    migrationDone = true;
    return;
  }
  try {
    const cur = await ctx.call('waypoint.list');
    const have = new Set(Object.keys(cur?.waypoints ?? {}));
    let imported = 0;
    for (const [name, w] of Object.entries(legacy)) {
      if (have.has(name)) continue; // mod 側優先
      await ctx.call('waypoint.set', { name, x: w.x, y: w.y, z: w.z });
      imported++;
    }
    try { renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated'); } catch {}
    migrationDone = true;
    if (imported > 0) {
      await ctx.say(`前のwaypointファイルから ${imported} 件を取り込んだよ`);
    }
  } catch {
    // 移行失敗は本処理を止めない (ファイルは残るので次回再試行する)
  }
}

const isNotFound = (e) => String(e?.message ?? e).includes('NOT_FOUND');

export default {
  name: 'waypoint',
  description:
    'Remember and go to named locations (stored mod-side, shared with the ' +
    'waypoint_save/list/delete tools and mirrored to JourneyMap). Actions: ' +
    'remember <name> (save current pos; radius makes it an area waypoint), ' +
    'goto <name>, list, remove <name>. Shared across sessions.',
  params: {
    action: { type: 'string', required: true, description: 'remember|goto|list|remove' },
    name: { type: 'string', required: false, description: 'waypoint name' },
    radius: { type: 'number', required: false, description: 'area radius in blocks (remember only)' },
  },
  async run(ctx, { action, name, radius }) {
    await migrateLegacy(ctx);

    if (action === 'list') {
      const r = await ctx.call('waypoint.list');
      const wp = r?.waypoints ?? {};
      const names = Object.entries(wp).map(
        ([n, w]) => `${n}(${w.x},${w.y},${w.z}${typeof w.r === 'number' ? `,±${w.r}` : ''})`);
      if (!names.length) return { done: true, waypoints: {}, count: 0 };
      await ctx.say(`覚えてる場所: ${names.join(', ')}`);
      return { done: true, waypoints: wp, count: names.length };
    }
    if (!name) return { done: false, error: 'name_required' };

    if (action === 'remember') {
      const params = { name };
      if (typeof radius === 'number' && radius >= 0) params.r = Math.floor(radius);
      const r = await ctx.call('waypoint.set', params);
      await ctx.say(`${name} って覚えたよ (${r.x},${r.y},${r.z})`);
      return { done: true, waypoint: r };
    }
    if (action === 'remove') {
      try {
        await ctx.call('waypoint.del', { name });
      } catch (e) {
        if (isNotFound(e)) return { done: false, error: 'not_found' };
        throw e;
      }
      return { done: true, removed: name };
    }
    if (action === 'goto') {
      let w;
      try {
        w = await ctx.call('waypoint.get', { name });
      } catch (e) {
        if (isNotFound(e)) {
          await ctx.say(`${name} って場所は知らない…`);
          return { done: false, error: 'not_found' };
        }
        throw e;
      }
      await ctx.say(`${name} に行くね`);
      const g = await ctx.call('baritone.goto', { x: w.x, y: w.y, z: w.z });
      const t = await ctx.waitTask(g.task_id, 300_000);
      if (t?.state === 'succeeded') {
        await ctx.say(`${name} に着いたよ`);
        return { done: true };
      }
      await ctx.say(`${name} まで行けなかった…`);
      return { done: false, error: t?.error_code ?? 'goto_failed' };
    }
    return { done: false, error: `unknown action: ${action}` };
  },
};
