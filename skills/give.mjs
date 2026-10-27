// プレイヤーに近づいて手持ちアイテムを渡す（投げる）。
// MVP制約: 渡せるのはホットバー(slot 0-8)にあるアイテムのみ。
export default {
  name: 'give',
  description:
    'Approach a player and toss them an item. The item must be in the hotbar (slots 0-8).',
  params: {
    player: { type: 'string', required: true, description: 'player to give to' },
    item: { type: 'string', required: true, description: 'item registry name e.g. minecraft:sand' },
    count: { type: 'integer', required: false, description: 'how many to give (default: stack)' },
  },
  async run(ctx, { player, item, count }) {
    const st = await ctx.state();
    const slot = (st.inventory_detail ?? []).find((s) => s.id === item && s.slot <= 8);
    if (!slot) {
      const have = st.inventory_summary?.[item] ?? 0;
      await ctx.say(have ? '持ってるけどホットバーに無い' : 'そのアイテムを持っていない');
      return { given: 0, error: have ? 'NOT_IN_HOTBAR' : 'NO_ITEM' };
    }
    // プレイヤーに近づく
    const found = await ctx.call('obs.entity', { name: player });
    if (!found.count) {
      await ctx.say(`${player} が見つからない`);
      return { given: 0, error: 'NOT_FOUND' };
    }
    const f = await ctx.call('baritone.follow', { target: player });
    try {
      for (let i = 0; i < 120; i++) {
        ctx.throwIfCancelled();
        const e = await ctx.call('obs.entity', { name: player });
        if (!e.count) break;
        if (e.entities[0].dist <= 4) break;
        await ctx.sleep(500);
      }
    } finally {
      await ctx.call('task.cancel', { task_id: f.task_id }).catch(() => {});
      await ctx.call('baritone.stop').catch(() => {});
    }
    // 装備して投げる
    await ctx.call('equip', { slot: slot.slot });
    const n = Math.min(count ?? slot.count, slot.count);
    for (let i = 0; i < n; i++) {
      ctx.throwIfCancelled();
      await ctx.call('toss', { full_stack: false });
      await ctx.sleep(350);
    }
    const short = item.includes(':') ? item.split(':')[1] : item;
    await ctx.say(`はい、${short} ${n}個どうぞ`);
    return { given: n };
  },
};
