// 名前付き地点 (waypoint) の記憶・参照・移動。
// bridge/waypoints.json に永続化し、セッションを跨いで共有する。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../bridge/waypoints.json');

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); }
  catch { return { waypoints: {} }; }
}
function save(d) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(d, null, 2));
}

export default {
  name: 'waypoint',
  description:
    'Remember and go to named locations. Actions: remember <name> (save current pos), ' +
    'goto <name>, list, remove <name>. Shared across sessions.',
  params: {
    action: { type: 'string', required: true, description: 'remember|goto|list|remove' },
    name: { type: 'string', required: false, description: 'waypoint name' },
  },
  async run(ctx, { action, name }) {
    const d = load();
    const wp = d.waypoints;

    if (action === 'list') {
      const names = Object.entries(wp).map(([n, w]) => `${n}(${w.x},${w.y},${w.z})`);
      if (!names.length) return { done: true, waypoints: {}, count: 0 };
      await ctx.say(`覚えてる場所: ${names.join(', ')}`);
      return { done: true, waypoints: wp, count: names.length };
    }
    if (!name) return { done: false, error: 'name_required' };

    if (action === 'remember') {
      const st = await ctx.call('obs.state');
      const p = st.pos;
      wp[name] = {
        x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z),
        dim: st.dimension ?? 'minecraft:overworld',
        set_at: new Date().toISOString(),
      };
      save(d);
      await ctx.say(`${name} って覚えたよ (${wp[name].x},${wp[name].y},${wp[name].z})`);
      return { done: true, waypoint: wp[name] };
    }
    if (action === 'remove') {
      if (!wp[name]) return { done: false, error: 'not_found' };
      delete wp[name];
      save(d);
      return { done: true, removed: name };
    }
    if (action === 'goto') {
      const w = wp[name];
      if (!w) {
        await ctx.say(`${name} って場所は知らない…`);
        return { done: false, error: 'not_found' };
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
