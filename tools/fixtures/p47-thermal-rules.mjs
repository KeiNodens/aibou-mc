// P47 fixture (layer 3): the committed Thermal suite rule files are
// served by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const expect = [
      ['thermal_foundation', 5, '9a9b4977'],
      ['thermal_expansion', 2, 'fecc6f0d'],
      ['thermal_dynamics', 3, 'c748b5b1'],
    ];
    for (const [mod, n, commit] of expect) {
      const f = (list?.rule_files ?? []).find((x) => x.mod === mod);
      if (!f) throw new Error(`${mod} rule file not listed: ${JSON.stringify(list)}`);
      if (f.rules !== n) throw new Error(`expected ${n} ${mod} rules, got ${f.rules}`);
      if (!String(f.source_commit).startsWith(commit)) {
        throw new Error(`wrong ${mod} source commit: ${f.source_commit}`);
      }
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'gourmand' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('1600'));
    if (!hit) throw new Error(`gourmand rule search wrong: ${JSON.stringify(found)}`);
    const lim = await h.mcp('knowledge', { action: 'search', query: 'limiter' });
    const lhit = (lim?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('64000'));
    if (!lhit) throw new Error(`limiter rule search wrong: ${JSON.stringify(lim)}`);
  },
};
