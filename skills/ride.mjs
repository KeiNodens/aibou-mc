// 乗車 (D27): 近くのコントラプションの座席に座る / 降りる。
// 動いている間は座っていれば運んでもらえる、が前提の割り切り。
export default {
  name: 'ride',
  description:
    'Sit on a seat of a nearby contraption (Create train, rotating ' +
    'platform, elevator...), or get off with leave:true. While ' +
    'seated the bot is carried by the contraption. Reports the ' +
    'actual riding state afterwards.',
  params: {
    seat: { type: 'integer', required: false, description: 'seat index (default 0)' },
    entity_id: { type: 'integer', required: false, description: 'contraption entity id' },
    leave: { type: 'boolean', required: false, description: 'get off instead of sitting down' },
  },
  async run(ctx, args) {
    if (args.leave) {
      await ctx.call('move.set', { sneak: true });
      await ctx.sleep(450);
      await ctx.call('move.set', { sneak: false });
      await ctx.sleep(300);
      const st = await ctx.call('contraption.status').catch(() => null);
      return { done: !(st?.riding ?? false), left: !(st?.riding ?? false) };
    }
    const before = await ctx.call('contraption.status').catch(() => null);
    if (!before?.found?.length)
      return { done: false, reason: 'no_contraption_nearby' };
    const r = await ctx.call('contraption.ride', {
      entity_id: args.entity_id, seat: args.seat ?? 0,
    }).catch((e) => ({ error: String(e) }));
    await ctx.sleep(600);
    const after = await ctx.call('contraption.status').catch(() => null);
    const riding = after?.riding ?? r?.riding ?? false;
    if (riding) await ctx.say('乗れたよ');
    return {
      done: riding, riding, via: r?.via,
      contraption: before.found[0]?.class,
      seats: before.found[0]?.seats,
    };
  },
};
