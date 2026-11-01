// P41 fixture (layer 3): the committed Tinkers' Construct rule file is
// served by the knowledge tool — rules list carries provenance, search hits.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'tconstruct');
    if (!mine) throw new Error(`tconstruct rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 10) throw new Error(`expected 10 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('a5a03249')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'smeltery' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('1080'));
    if (!hit) throw new Error(`smeltery rule search wrong: ${JSON.stringify(found)}`);
    const units = await h.mcp('knowledge', { action: 'search', query: 'ingot' });
    const uhit = (units?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('810'));
    if (!uhit) throw new Error(`fluid units rule search wrong: ${JSON.stringify(units)}`);
  },
};
