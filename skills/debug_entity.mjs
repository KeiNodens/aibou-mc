// デバッグ用: obs.entityの生結果をchatに出す (検証用。公開向けではない)
export default {
  name: 'debug_entity',
  description: 'Debug: look up entities/players by name via obs.entity and report raw result in chat.',
  params: {
    name: { type: 'string', required: true, description: 'player name or entity registry name' },
  },
  async run(ctx, { name }) {
    const r = await ctx.call('obs.entity', { name });
    await ctx.say(JSON.stringify(r).slice(0, 200));
    return r;
  },
};
