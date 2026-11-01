// P21 fixture (D39): commission ツールが共有実行器 (commission.ts)
// 経由で inline plan を実行できること。
export default {
  async script(ctx) {
    ctx.stub('obs.block_state', () => ({ block: 'mekanism:enrichment_chamber' }));
    ctx.stub('container.button', () => ({ ok: true }));
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const r = await h.mcp('commission', {
      x: 1, y: 64, z: 1,
      plan: [{ do: 'wait', ms: 10 }, { do: 'button', id: 2 }],
    });
    if (!r || r.ok !== true || r.steps?.length !== 2
      || r.block !== 'mekanism:enrichment_chamber') {
      throw new Error(`commission wrong: ${JSON.stringify(r)}`);
    }
  },
};
