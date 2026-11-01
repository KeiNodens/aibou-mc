// 甲板歩行 (D27): 動くコントラプション上の目標点まで、
// 目標の現在位置を読み直しながら追跡制御で歩く。
// Baritone は使わない (静的世界前提のため)。落下検知で中断する。
function botPos(st) {
  const p = st?.pos ?? st?.player?.pos ?? st;
  if (p && typeof p.x === 'number') return p;
  return null;
}

export default {
  name: 'deck_walk',
  description:
    'Walk to a point given in contraption-local coordinates on a ' +
    'moving contraption deck: re-reads the target\'s global ' +
    'position every step and steers with plain movement input ' +
    '(Baritone cannot path on moving blocks). Aborts if the bot ' +
    'falls below the deck or loses the contraption.',
  params: {
    local_x: { type: 'number', required: true, description: 'target X in contraption-local blocks' },
    local_y: { type: 'number', required: true },
    local_z: { type: 'number', required: true },
    timeout_s: { type: 'integer', required: false, description: 'default 30' },
  },
  async run(ctx, args) {
    const deadline = Date.now() + (args.timeout_s ?? 30) * 1000;
    const local = { x: args.local_x, y: args.local_y, z: args.local_z };
    let lastDist = null;
    try {
      while (Date.now() < deadline) {
        ctx.throwIfCancelled();
        const st = await ctx.call('contraption.status', { local })
          .catch(() => null);
        const c = st?.found?.[0];
        const g = c?.local_global;
        if (!c || !g) return { done: false, reason: 'contraption_lost' };
        const me = botPos(await ctx.state().catch(() => null));
        if (!me) return { done: false, reason: 'no_self_position' };
        if (me.y < c.y - 2.5) {
          return { done: false, reason: 'fell_off_deck', at: me };
        }
        const dx = g.x - me.x;
        const dz = g.z - me.z;
        const dist = Math.hypot(dx, dz);
        lastDist = dist;
        if (dist <= 0.8 && Math.abs(g.y - me.y) <= 1.4) {
          return { done: true, arrived: true, distance: dist };
        }
        await ctx.call('look_at', { x: g.x, y: g.y, z: g.z }).catch(() => {});
        await ctx.call('move.set', { forward: true, jump: g.y - me.y > 0.6 });
        await ctx.sleep(350);
        await ctx.call('move.set', { forward: false, jump: false });
      }
      return { done: false, reason: 'timeout', last_distance: lastDist };
    } finally {
      await ctx.call('move.set', { forward: false, jump: false })
        .catch(() => {});
    }
  },
};
