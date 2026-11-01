// P39 fixture (layer 3): the committed Botania rule file is served by
// the knowledge tool — rules list carries provenance, search hits rules.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'botania');
    if (!mine) throw new Error(`botania rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 10) throw new Error(`expected 10 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('361ddf3e')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'spreader' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('640'));
    if (!hit) throw new Error(`spreader rule search wrong: ${JSON.stringify(found)}`);
    const terra = await h.mcp('knowledge', { action: 'search', query: 'terrasteel' });
    const thit = (terra?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('500000'));
    if (!thit) throw new Error(`terrasteel rule search wrong: ${JSON.stringify(terra)}`);
  },
};
