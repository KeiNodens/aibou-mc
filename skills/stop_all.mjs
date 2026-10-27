// 全ての移動・経路探索・タスクを止める緊急停止。
export default {
  name: 'stop_all',
  description: 'Stop all movement, pathfinding, and running tasks immediately.',
  params: {},
  async run(ctx) {
    await ctx.call('move.stop').catch(() => {});
    const r = await ctx.call('baritone.stop').catch(() => ({}));
    const c = await ctx.call('task.cancel_all').catch(() => ({}));
    await ctx.say('止まった');
    return { stopped: true, ...r, ...c };
  },
};
