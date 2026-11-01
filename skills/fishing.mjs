// 釣り (P5): 竿を投げて浮き (fishing_bobber) の沈み込みでアタリを検知し、
// 合わせて引き上げる。釣果はインベントリ差分で数える。
const FISH_ITEMS = [
  'minecraft:cod', 'minecraft:salmon', 'minecraft:tropical_fish',
  'minecraft:pufferfish', 'minecraft:enchanted_book', 'minecraft:bow',
  'minecraft:fishing_rod', 'minecraft:name_tag', 'minecraft:nautilus_shell',
  'minecraft:lily_pad', 'minecraft:bowl', 'minecraft:leather',
  'minecraft:leather_boots', 'minecraft:rotten_flesh', 'minecraft:stick',
  'minecraft:string', 'minecraft:glass_bottle', 'minecraft:tripwire_hook',
  'minecraft:ink_sac', 'minecraft:bamboo', 'minecraft:cocoa_beans',
];

function totalFish(state) {
  const sum = state.inventory_summary ?? {};
  let n = 0;
  for (const id of FISH_ITEMS) n += sum[id] ?? 0;
  return n;
}

export default {
  name: 'fishing',
  description:
    'Fish at the current spot: cast the rod, watch the bobber for a bite, ' +
    'reel in, and repeat. The rod must be in the hotbar. Stops after the ' +
    'requested number of catches or casts.',
  params: {
    catches: { type: 'integer', required: false, description: 'stop after this many catches (default 3)' },
    max_casts: { type: 'integer', required: false, description: 'give up after this many casts (default 10)' },
    mode: { type: 'string', required: false, description: 'auto (default) / together / solo — together: set up next to a nearby player first' },
  },
  async run(ctx, { catches = 3, max_casts = 10, mode = 'auto' }) {
    const st0 = await ctx.state();
    // 同伴: 近くにプレイヤーがいたら、その隣に陣取ってから釣る (D36)
    if (mode !== 'solo') {
      const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
      const all = ents(await ctx.call('obs.entity', { name: 'minecraft:player', radius: 24 }).catch(() => null));
      const mate = all.find((e) => e.name && e.name !== st0?.name);
      if (mate && (mode === 'together' || mode === 'auto')) {
        const d0 = Math.hypot(mate.x - st0.pos.x, mate.z - st0.pos.z);
        if (d0 > 3.5) {
          const g = await ctx.call('baritone.goto', {
            x: Math.floor(mate.x) + 2, y: Math.floor(mate.y), z: Math.floor(mate.z),
          }).catch(() => null);
          if (g?.task_id) await ctx.waitTask(g.task_id, 20_000).catch(() => null);
          await ctx.say('隣で釣るね').catch(() => {});
        }
      }
    }
    const rod = (st0.inventory_detail ?? []).find(
      (s) => s.id === 'minecraft:fishing_rod' && s.slot <= 8);
    if (!rod) {
      await ctx.say('釣り竿がホットバーに無い');
      return { done: false, reason: 'no_rod_in_hotbar' };
    }
    await ctx.call('equip', { slot: rod.slot });
    // D33: 投げる→アタリ検知→合わせる のループは mod 側 FishingTask。
    // 釣果の数え上げ (インベントリ差分) は bridge に残す
    const before = totalFish(await ctx.state());
    const t = await ctx.call('fishing.start', {
      max_casts,
      timeout_seconds: max_casts * 50,
    }).catch(() => null);
    if (!t?.task_id) return { done: false, reason: 'op_unavailable' };
    const ev = await ctx.waitTask(t.task_id, (max_casts * 50 + 15) * 1000)
      .catch(() => null);
    const r = ev?.result ?? {};
    const got = Math.max(0, totalFish(await ctx.state()) - before);
    if (got > 0) await ctx.say(`${got}匹釣れた`);
    else if (r.reason === 'rod_gone') await ctx.say('竿が無くなった');
    return {
      done: got > 0, catches: got,
      casts: r.casts ?? 0, bites: r.bites ?? 0,
      reason: r.reason, via: 'fishing_task',
    };
  },
};
