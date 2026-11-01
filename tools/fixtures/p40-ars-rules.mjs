// P40 fixture (layer 3): the committed Ars Nouveau rule file is served
// by the knowledge tool — rules list carries provenance, search hits rules.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'ars_nouveau');
    if (!mine) throw new Error(`ars_nouveau rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 10) throw new Error(`expected 10 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('2c74064b')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'source jar' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('10000'));
    if (!hit) throw new Error(`source jar rule search wrong: ${JSON.stringify(found)}`);
    const mana = await h.mcp('knowledge', { action: 'search', query: 'max mana' });
    const mhit = (mana?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('15'));
    if (!mhit) throw new Error(`max mana rule search wrong: ${JSON.stringify(mana)}`);
  },
};
