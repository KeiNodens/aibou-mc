// P48 fixture (layer 3): the committed Immersive rule files are
// served by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const expect = [
      ['immersiveengineering', 6, 'e63e4824'],
      ['immersivepetroleum', 4, '5dbeb9cf'],
    ];
    for (const [mod, n, commit] of expect) {
      const f = (list?.rule_files ?? []).find((x) => x.mod === mod);
      if (!f) throw new Error(`${mod} rule file not listed: ${JSON.stringify(list)}`);
      if (f.rules !== n) throw new Error(`expected ${n} ${mod} rules, got ${f.rules}`);
      if (!String(f.source_commit).startsWith(commit)) {
        throw new Error(`wrong ${mod} source commit: ${f.source_commit}`);
      }
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'connector' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('4096'));
    if (!hit) throw new Error(`connector rule search wrong: ${JSON.stringify(found)}`);
    const oil = await h.mcp('knowledge', { action: 'search', query: 'reservoir' });
    const ohit = (oil?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('32500000'));
    if (!ohit) throw new Error(`reservoir rule search wrong: ${JSON.stringify(oil)}`);
  },
};
