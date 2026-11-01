// 帰り道の案内 (D30): cave_assist が残した breadcrumb を逆順に辿って
// 入口 (cave_entry waypoint) まで先導する。trail が無ければ入口へ直行。
import { readFile } from 'node:fs/promises';

const TRAIL_URL = new URL('../data/cave-trail.json', import.meta.url);

export default {
  name: 'lead_back',
  description:
    'Lead the way back to the cave entry: follows the breadcrumb trail ' +
    'recorded by cave_assist in reverse, then heads to the cave_entry ' +
    'waypoint. Without a trail it goes straight to the waypoint.',
  params: {
    name: { type: 'string', required: false, description: 'waypoint name (default cave_entry)' },
  },
  async run(ctx, { name = 'cave_entry' }) {
    let steps = 0;
    let trail = null;
    try {
      trail = JSON.parse(await readFile(TRAIL_URL, 'utf8'));
    } catch { /* trail なし */ }
    const crumbs = Array.isArray(trail?.crumbs) ? trail.crumbs : [];
    const thinned = [];
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const c = crumbs[i];
      const last = thinned[thinned.length - 1];
      if (!last || Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) >= 2.5) thinned.push(c);
    }
    if (thinned.length) await ctx.say('帰り道は覚えてるよ。ついてきて');
    for (const c of thinned) {
      ctx.throwIfCancelled();
      const g = await ctx.call('baritone.goto', { x: c.x, y: c.y, z: c.z }).catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 25_000).catch(() => null);
      steps++;
    }
    const wp = await ctx.call('waypoint.get', { name }).catch(() => null);
    if (wp && typeof wp.x === 'number') {
      const g = await ctx.call('baritone.goto', { x: wp.x, y: wp.y, z: wp.z }).catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 60_000).catch(() => null);
    }
    await ctx.say('入口まで来たよ');
    return { done: true, steps, used_trail: thinned.length > 0, waypoint: wp ?? null };
  },
};
