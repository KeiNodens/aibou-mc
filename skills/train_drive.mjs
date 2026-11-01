// 列車運転 v2 (D33): 入力保持と速度観測は mod 側 DriveTask に移した。
// 着席の段取りだけ bridge。Create が素のキー入力を読むかは実機未検証
// (前提は v1 から不変、置き場所だけ変わった)。
export default {
  name: 'train_drive',
  description:
    'Drive a Create train from its controls seat: the mod-side task ' +
    'holds forward (or back) input and measures the speed. Requires ' +
    'the bot to sit at the controls (use ride first, or pass seat). ' +
    'Probe-grade: whether Create reads plain movement keys is ' +
    'confirmed live.',
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
      if (!st?.riding) return { done: false, reason: 'not_riding', ride: r };
    }
    const t = await ctx.call('drive.start', {
      direction: args.direction === 'back' ? 'back' : 'forward',
      seconds: secs,
    }).catch(() => null);
    if (!t?.task_id) return { done: false, reason: 'op_unavailable' };
    const ev = await ctx.waitTask(t.task_id, (secs + 10) * 1000)
      .catch(() => null);
    const r = ev?.result ?? {};
    if (ev?.state !== 'succeeded') {
      return { done: false, reason: ev?.error_code || 'drive_failed' };
    }
    const max = r.max_speed ?? null;
    await ctx.say(max && max > 0.05
      ? `動いたよ (速度 ${max.toFixed(2)})`
      : '入力したけど速度は付かなかった');
    return { done: true, max_speed: max, moved: !!r.moved, via: 'drive_task' };
  },
};
