// P52 fixture (layer 3): the committed Industrial Foregoing rule
// file is served by the knowledge tool — provenance and hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const f = (list?.rule_files ?? []).find((x) => x.mod === 'industrialforegoing');
    if (!f) throw new Error(`industrialforegoing rule file not listed: ${JSON.stringify(list)}`);
    if (f.rules !== 5) throw new Error(`expected 5 industrialforegoing rules, got ${f.rules}`);
    if (!String(f.source_commit).startsWith('1369806d')) {
      throw new Error(`wrong industrialforegoing source commit: ${f.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'laser drill' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('50000'));
    if (!hit) throw new Error(`laser rule search wrong: ${JSON.stringify(found)}`);
    const addon = await h.mcp('knowledge', { action: 'search', query: 'addon' });
    const ahit = (addon?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('1 + tier'));
    if (!ahit) throw new Error(`addon rule search wrong: ${JSON.stringify(addon)}`);
  },
};
