// P42 fixture (layer 3): the committed Ad Astra rule file is served by
// the knowledge tool — rules list carries provenance, search hits rules.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'ad_astra');
    if (!mine) throw new Error(`ad_astra rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 10) throw new Error(`expected 10 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('5a986665')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'rocket' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('3000'));
    if (!hit) throw new Error(`rocket rule search wrong: ${JSON.stringify(found)}`);
    const oxy = await h.mcp('knowledge', { action: 'search', query: 'oxygen' });
    const ohit = (oxy?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('-173'));
    if (!ohit) throw new Error(`planet table search wrong: ${JSON.stringify(oxy)}`);
  },
};
