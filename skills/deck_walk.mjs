// 甲板歩行 v2 (D33): 追跡制御は mod 側 DeckFollowTask に移した。
// bridge は op を起動して結果を訳すだけ。
export default {
  name: 'deck_walk',
  description:
    'Walk to a point given in contraption-local coordinates on a ' +
    'moving contraption deck. The mod-side task converts the target ' +
    'to global coordinates every tick and steers with plain movement ' +
    'input (Baritone cannot path on moving blocks). Aborts if the ' +
    'bot falls below the deck or loses the contraption.',
  params: {
    local_x: { type: 'number', required: true, description: 'target X in contraption-local blocks' },
    local_y: { type: 'number', required: true },
    local_z: { type: 'number', required: true },
    timeout_s: { type: 'integer', required: false, description: 'default 30' },
  },
  async run(ctx, args) {
    const timeout = args.timeout_s ?? 30;
    const t = await ctx.call('contraption.follow_local', {
      local: { x: args.local_x, y: args.local_y, z: args.local_z },
      max_seconds: timeout,
    }).catch(() => null);
    if (!t?.task_id) return { done: false, reason: 'op_unavailable' };
    const ev = await ctx.waitTask(t.task_id, (timeout + 5) * 1000)
      .catch(() => null);
    if (!ev) return { done: false, reason: 'timeout' };
    if (ev.state === 'succeeded') {
      return { done: true, arrived: true, distance: ev.result?.distance };
    }
    const code = ev.error_code ?? '';
    if (code === 'FELL_OFF_DECK') return { done: false, reason: 'fell_off_deck' };
    if (code === 'CONTRAPTION_LOST') return { done: false, reason: 'contraption_lost' };
    if (code === 'TIMEOUT') return { done: false, reason: 'timeout' };
    return { done: false, reason: code || 'failed' };
  },
};
