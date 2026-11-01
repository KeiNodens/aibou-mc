// P44 fixture (layer 3): the committed Enchanting Infuser rule file is
// served by the knowledge tool — rules list carries provenance, search hits.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'enchantinginfuser');
    if (!mine) throw new Error(`enchantinginfuser rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 11) throw new Error(`expected 11 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('cc13b775')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'bookshelves' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('15'));
    if (!hit) throw new Error(`bookshelf rule search wrong: ${JSON.stringify(found)}`);
    const cost = await h.mcp('knowledge', { action: 'search', query: 'treasure' });
    const chit = (cost?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('0.95'));
    if (!chit) throw new Error(`treasure rule search wrong: ${JSON.stringify(cost)}`);
  },
};
