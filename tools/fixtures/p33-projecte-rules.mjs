// P33 fixture (layer 3): the committed ProjectE rule file is served by
// the knowledge tool — rules list carries provenance, search hits rules.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'projecte');
    if (!mine) throw new Error(`projecte rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 13) throw new Error(`expected 13 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('68fbb2de')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'klein' });
    const hit = (found?.matches ?? []).find((m) => m.kind === 'rule');
    if (!hit || !JSON.stringify(hit).includes('51200000')) {
      throw new Error(`klein rule search wrong: ${JSON.stringify(found)}`);
    }
    const dia = await h.mcp('knowledge', { action: 'search', query: 'diamond' });
    const dhit = (dia?.matches ?? []).find((m) => m.kind === 'rule');
    if (!dhit || !JSON.stringify(dhit).includes('8192')) {
      throw new Error(`diamond seed search wrong: ${JSON.stringify(dia)}`);
    }
  },
};
