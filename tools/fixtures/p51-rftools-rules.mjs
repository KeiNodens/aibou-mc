// P51 fixture (layer 3): the committed RFTools family rule files are
// served by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const expect = [
      ['rftoolsbuilder', 3, '94696e7b'],
      ['rftoolspower', 3, '49459a04'],
      ['rftoolsstorage', 2, '6eac6aa4'],
      ['rftoolsutility', 1, '4a31a65f'],
    ];
    for (const [mod, n, commit] of expect) {
      const f = (list?.rule_files ?? []).find((x) => x.mod === mod);
      if (!f) throw new Error(`${mod} rule file not listed: ${JSON.stringify(list)}`);
      if (f.rules !== n) throw new Error(`expected ${n} ${mod} rules, got ${f.rules}`);
      if (!String(f.source_commit).startsWith(commit)) {
        throw new Error(`wrong ${mod} source commit: ${f.source_commit}`);
      }
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'quarry' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('300'));
    if (!hit) throw new Error(`quarry rule search wrong: ${JSON.stringify(found)}`);
    const cell = await h.mcp('knowledge', { action: 'search', query: 'powercell' });
    const chit = (cell?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('20000000'));
    if (!chit) throw new Error(`powercell rule search wrong: ${JSON.stringify(cell)}`);
  },
};
