// P55 fixture (layer 3): the committed Mystical rule files are
// served by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const expect = [
      ['mysticalagriculture', 5, '84f16934'],
      ['mysticalagradditions', 3, '1fb72c74'],
    ];
    for (const [mod, n, commit] of expect) {
      const f = (list?.rule_files ?? []).find((x) => x.mod === mod);
      if (!f) throw new Error(`${mod} rule file not listed: ${JSON.stringify(list)}`);
      if (f.rules !== n) throw new Error(`expected ${n} ${mod} rules, got ${f.rules}`);
      if (!String(f.source_commit).startsWith(commit)) {
        throw new Error(`wrong ${mod} source commit: ${f.source_commit}`);
      }
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'inferium' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('0.2'));
    if (!hit) throw new Error(`inferium rule search wrong: ${JSON.stringify(found)}`);
    const ins = await h.mcp('knowledge', { action: 'search', query: 'insanium' });
    const ihit = (ins?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('tier'));
    if (!ihit) throw new Error(`insanium rule search wrong: ${JSON.stringify(ins)}`);
  },
};
