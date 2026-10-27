// 指定プレイヤーの近くまで移動する。対象は動き得るので
// followで近づき、十分近くなったら停止する。
export default {
  name: 'come_here',
  description: 'Walk to a player and stop when nearby (within ~4 blocks).',
  params: {
    player: { type: 'string', required: true, description: 'player name to approach' },
  },
  async run(ctx, { player }) {
    const found = await ctx.call('obs.entity', { name: player });
    if (!found.count) {
      await ctx.say(`${player} が見つからない`);
      return { arrived: false, error: 'NOT_FOUND' };
    }
    const r = await ctx.call('baritone.follow', { target: player });
    try {
      for (let i = 0; i < 120; i++) {
        ctx.throwIfCancelled();
        const e = await ctx.call('obs.entity', { name: player });
        if (!e.count) break;
        if (e.entities[0].dist <= 4) {
          await ctx.call('baritone.stop');
          await ctx.say('来たよ');
          return { arrived: true };
        }
        await ctx.sleep(500);
      }
      await ctx.say('近くまで行けなかった');
      return { arrived: false, reason: 'timeout' };
    } finally {
      await ctx.call('task.cancel', { task_id: r.task_id }).catch(() => {});
      await ctx.call('baritone.stop').catch(() => {});
    }
  },
};
