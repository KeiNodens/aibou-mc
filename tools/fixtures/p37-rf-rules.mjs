// P37 fixture (layer 3): the committed RFTools Dimensions rule file
// is served by the knowledge tool.
// NOTE: run with TEMP/TMP pointed at the repo root (see p33).
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'rftoolsdim');
    if (!mine) throw new Error(`rftoolsdim rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 8) throw new Error(`expected 8 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('df74542b')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'upkeep' });
    const hit = (found?.matches ?? []).find((m) => m.kind === 'rule');
    if (!hit) throw new Error(`upkeep rule search wrong: ${JSON.stringify(found)}`);
  },
};
