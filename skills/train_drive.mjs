// 列車運転 (D27、probe 形状): 運転席に座った状態で move.set の
// 前進/後退入力を与え、contraption.status の速度で効果を測る。
// Create の運転入力が通常の移動キーで届くかは実機で確定する。
export default {
  name: 'train_drive',
  description:
    'Drive a Create train from its controls seat: hold forward (or ' +
    'back) movement input for a while and watch the contraption ' +
    'speed via contraption.status. Requires the bot to already sit ' +
    'at the controls (use ride with the right seat first, or pass ' +
    'seat to try sitting here). Probe-grade: whether Create reads ' +
    'plain movement keys is confirmed live.',
  params: {
    seconds: { type: 'integer', required: false, description: 'input duration (default 8, max 60)' },
    direction: { type: 'string', required: false, description: 'forward (default) or back' },
    seat: { type: 'integer', required: false, description: 'controls seat index, if not riding yet' },
  },
  async run(ctx, args) {
    const secs = Math.min(60, Math.max(1, args.seconds ?? 8));
    let st = await ctx.call('contraption.status').catch(() => null);
    if (!st?.riding) {
      const r = await ctx.call('contraption.ride', { seat: args.seat ?? 0 })
        .catch(() => null);
      await ctx.sleep(600);
      st = await ctx.call('contraption.status').catch(() => null);
      if (!st?.riding)
        return { done: false, reason: 'not_riding', ride: r };
    }
    const key = args.direction === 'back' ? 'back' : 'forward';
    const speeds = [];
    try {
      await ctx.call('move.set', { [key]: true });
      for (let i = 0; i < secs; i++) {
        ctx.throwIfCancelled();
        await ctx.sleep(1000);
        const s = await ctx.call('contraption.status').catch(() => null);
        if (!s?.riding) {
          return { done: false, reason: 'fell_off', speeds };
        }
        const mine = (s.found ?? []).find((f) => f.bot_is_passenger)
          ?? s.found?.[0];
        speeds.push(mine?.speed ?? mine?.delta_speed ?? null);
      }
    } finally {
      await ctx.call('move.set', { forward: false, back: false })
        .catch(() => {});
    }
    const numeric = speeds.filter((v) => typeof v === 'number');
    const max = numeric.length ? Math.max(...numeric) : null;
    await ctx.say(max && max > 0.05
      ? `動いたよ (速度 ${max.toFixed(2)})`
      : '入力したけど速度は付かなかった');
    return { done: true, speeds, max_speed: max, moved: !!(max && max > 0.05) };
  },
};
