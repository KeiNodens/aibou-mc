// P54 fixture (layer 3): the committed Evolved Mekanism rule file
// is served by the knowledge tool — provenance and hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const f = (list?.rule_files ?? []).find((x) => x.mod === 'evolvedmekanism');
    if (!f) throw new Error(`evolvedmekanism rule file not listed: ${JSON.stringify(list)}`);
    if (f.rules !== 4) throw new Error(`expected 4 evolvedmekanism rules, got ${f.rules}`);
    if (!String(f.source_commit).startsWith('0fd803ff')) {
      throw new Error(`wrong evolvedmekanism source commit: ${f.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'multiversal' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('32768'));
    if (!hit) throw new Error(`multiversal rule search wrong: ${JSON.stringify(found)}`);
  },
};
