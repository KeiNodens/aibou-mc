// 在庫維持 (D50): 指定アイテムの在庫 (所持 + 近くの ME 端末内)
// を数え、下限を割っていたら process_chain のルートで補充する。
// 常駐ループではなく1回分の点検+補充 (繰り返しは runner / LLM
// の呼び出しに委ねる)。
import processChain from './process_chain.mjs';

export default {
  name: 'stock_keeper',
  description:
    'Check the stock of one item (bot inventory plus the ME ' +
    'network when the bot is already near the remembered ' +
    'terminal) and top it up to a minimum using a process_chain ' +
    'route when it falls short. One check-and-refill pass; call ' +
    'it periodically for standing stock keeping.',
  params: {
    item: { type: 'string', required: true, description: 'item id to keep stocked (the route product)' },
    min: { type: 'integer', required: true, description: 'minimum stock level' },
    route: { type: 'string', required: true, description: 'process_chain route name (e.g. mek_2x)' },
    metal: { type: 'string', required: true, description: 'process_chain metal key (e.g. iron)' },
    max_batch: { type: 'integer', required: false, description: 'max inputs per pass (default 256)' },
  },
  async run(ctx, { item, min, route, metal, max_batch = 256 }) {
    const countStock = async () => {
      const st = await ctx.state().catch(() => null);
      let n = (st?.inventory ?? {})[item] ?? 0;
      let me = 0;
      // ME 在庫: 記憶した端末の近くにいる時だけ数える (移動しない)
      const fac = ctx.journal?.facilities?.('me_terminal')?.[0];
      const pos = st?.pos;
      if (fac && pos && Math.hypot(fac.pos.x - pos.x, fac.pos.z - pos.z) <= 6) {
        try {
          await ctx.call('use_item', { x: fac.pos.x, y: fac.pos.y, z: fac.pos.z });
          const repo = await ctx.call('container.repo');
          for (const e of repo?.entries ?? []) {
            if (e?.id === item) me += e.amount ?? 0;
          }
          await ctx.call('container.close').catch(() => {});
        } catch { /* ME が読めなければ所持分だけで判定 */ }
      }
      return { held: n, me, total: n + me };
    };
    const before = await countStock();
    if (before.total >= min) {
      return { done: true, action: 'none', item, stock: before };
    }
    const deficit = min - before.total;
    const chain = await processChain.run(ctx, {
      route, metal, count: Math.min(deficit, max_batch),
    }).catch((e) => ({ done: false, reason: String(e?.message ?? e) }));
    const after = await countStock();
    const filled = after.total >= min;
    await ctx.say(filled
      ? `${item.split(':')[1]} を ${after.total} 個まで補充したよ`
      : `${item.split(':')[1]} の補充が届かなかった (在庫 ${after.total}/${min})`);
    return {
      done: filled, action: 'refill', item,
      stock_before: before, stock_after: after, chain,
    };
  },
};
