// P53 fixture (layer 3): the committed Energized Power rule file is
// served by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const f = (list?.rule_files ?? []).find((x) => x.mod === 'energizedpower');
    if (!f) throw new Error(`energizedpower rule file not listed: ${JSON.stringify(list)}`);
    if (f.rules !== 4) throw new Error(`expected 4 energizedpower rules, got ${f.rules}`);
    if (!String(f.source_commit).startsWith('7df65101')) {
      throw new Error(`wrong energizedpower source commit: ${f.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'solar panel' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('131072'));
    if (!hit) throw new Error(`solar rule search wrong: ${JSON.stringify(found)}`);
  },
};
