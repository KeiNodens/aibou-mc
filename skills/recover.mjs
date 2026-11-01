// 死に戻り (D30): journal の deathpoint 記録 (runner が死亡時に残す)
// を読み、死亡地点まで戻って落ちているアイテムを回収する。
import { readFile } from 'node:fs/promises';

const JOURNAL_URL = new URL('../data/journal.jsonl', import.meta.url);
const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));

export default {
  name: 'recover',
  description:
    'Death recovery: read the last recorded deathpoint from the work ' +
    'journal, travel back there, and pick up dropped items nearby.',
  params: {},
  async run(ctx) {
    let death = null;
    try {
      const text = await readFile(JOURNAL_URL, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if ((e.kind === 'deathpoint' || e.type === 'deathpoint') && (e.pos ?? e.data?.pos)) {
            death = e;
          }
        } catch { /* 壊れた行は飛ばす */ }
      }
    } catch { /* journal なし */ }
    const pos = death?.pos ?? death?.data?.pos;
    if (!pos) {
      await ctx.say('死亡地点の記録が見つからない');
      return { done: false, reason: 'no_deathpoint_recorded' };
    }
    await ctx.say('死んだ場所に戻るね');
    const g = await ctx.call('baritone.goto', { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }).catch(() => null);
    if (g?.task_id) await ctx.waitTask(g.task_id, 90_000).catch(() => null);
    let trips = 0;
    const items = ents(await ctx.call('obs.entity', { name: 'minecraft:item' }).catch(() => null)).slice(0, 20);
    for (const it of items) {
      ctx.throwIfCancelled();
      const gi = await ctx.call('baritone.goto', { x: Math.floor(it.x), y: Math.floor(it.y), z: Math.floor(it.z) }).catch(() => null);
      if (gi?.task_id) await ctx.waitTask(gi.task_id, 15_000).catch(() => null);
      await ctx.sleep(250);
      trips++;
    }
    await ctx.say(`戻ってきた。アイテム回収に${trips}件回ったよ`);
    return { done: true, deathpoint: pos, pickup_trips: trips };
  },
};
