// 指定ブロックをBaritoneのmineで採集する。完了まで待って結果をchatで報告する。
export default {
  name: 'gather',
  description:
    'Gather blocks of a type (e.g. minecraft:oak_log, mekanism:osmium_ore). ' +
    'Runs Baritone mine until the count is collected, then reports in chat.',
  params: {
    block: { type: 'string', required: true, description: 'block registry name' },
    count: { type: 'integer', required: false, description: 'how many to gather (default 1)' },
  },
  async run(ctx, { block, count = 1 }) {
    const short = block.includes(':') ? block.split(':')[1] : block;
    await ctx.say(`${short} を${count}個集めてくるね`);
    // ensure: 合計count個を目標。既に十分持っていれば掘らずに済ませる
    const r = await ctx.call('baritone.mine', { block, count, mode: 'ensure' });
    const d = await ctx.waitTask(r.task_id, 300_000);
    if (!d) {
      await ctx.say('時間切れ…まだ探してる');
      return { done: false, reason: 'timeout' };
    }
    if (d.state === 'succeeded') {
      if (d.result?.already_satisfied) {
        await ctx.say(`${short} はもう${d.result.held}個持ってるよ`);
        return { done: true, held: d.result.held, gathered: 0 };
      }
      const g = d.result?.gathered ?? count;
      const held = d.result?.held;
      await ctx.say(held != null
        ? `${short} を${g}個掘って、合計${held}個になったよ`
        : `${short} を${g}個集めたよ`);
      return { done: true, gathered: g, held };
    }
    await ctx.say(d.state === 'cancelled' ? '中断した' : `${short} が見つからなかった`);
    return { done: false, state: d.state, error: d.error_code };
  },
};
