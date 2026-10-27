// プレイヤー（または指定エンティティ種類）への追従を開始する。
// followは継続動作なので、この技能は「追従が始まった」時点で完了する。
// 止めるには stop_all / cancel_current を使う。
export default {
  name: 'follow_player',
  description:
    'Follow a player (or entity type like minecraft:rabbit) continuously. ' +
    'Stays active until stop_all or cancel_current is called.',
  params: {
    target: { type: 'string', required: true, description: 'player name or entity registry name' },
  },
  async run(ctx, { target }) {
    const r = await ctx.call('baritone.follow', { target });
    const d = await ctx.waitTask(r.task_id, 5000);
    if (d && d.state === 'failed') {
      await ctx.say(`${target} が見つからない`);
      return { following: false, error: d.error_code };
    }
    await ctx.say(`${target} についていくね`);
    return { following: target, task_id: r.task_id };
  },
};
