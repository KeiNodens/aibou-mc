// P50 fixture (layer 3): the committed Forestry rule file is served
// by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const f = (list?.rule_files ?? []).find((x) => x.mod === 'forestry');
    if (!f) throw new Error(`forestry rule file not listed: ${JSON.stringify(list)}`);
    if (f.rules !== 5) throw new Error(`expected 5 forestry rules, got ${f.rules}`);
    if (!String(f.source_commit).startsWith('f6e36720')) {
      throw new Error(`wrong forestry source commit: ${f.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'bee' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('550'));
    if (!hit) throw new Error(`bee rule search wrong: ${JSON.stringify(found)}`);
    const farm = await h.mcp('knowledge', { action: 'search', query: 'multifarm' });
    const fhit = (farm?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('21'));
    if (!fhit) throw new Error(`multifarm rule search wrong: ${JSON.stringify(farm)}`);
  },
};
