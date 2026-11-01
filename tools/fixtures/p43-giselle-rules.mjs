// P43 fixture (layer 3): the committed Giselle Addon rule file is served
// by the knowledge tool — rules list carries provenance, search hits rules.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'ad_astra_giselle_addon');
    if (!mine) throw new Error(`giselle rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 5) throw new Error(`expected 5 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('68925857')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'gravity' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('9600'));
    if (!hit) throw new Error(`gravity rule search wrong: ${JSON.stringify(found)}`);
  },
};
