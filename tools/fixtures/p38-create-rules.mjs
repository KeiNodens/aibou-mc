// P38 fixture (layer 3): the committed Create rule file is served by
// the knowledge tool — rules list carries provenance, search hits rules.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'create');
    if (!mine) throw new Error(`create rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 13) throw new Error(`expected 13 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('1a1a9a28')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'windmill' });
    const hit = (found?.matches ?? []).find((m) => m.kind === 'rule');
    if (!hit || !JSON.stringify(hit).includes('8192')) {
      throw new Error(`windmill rule search wrong: ${JSON.stringify(found)}`);
    }
    const boiler = await h.mcp('knowledge', { action: 'search', query: 'steam' });
    const bhit = (boiler?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('16384'));
    if (!bhit) {
      throw new Error(`steam rule search wrong: ${JSON.stringify(boiler)}`);
    }
  },
};
