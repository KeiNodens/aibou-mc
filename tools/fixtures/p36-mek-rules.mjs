// P36 fixture (layer 3): the committed Mekanism rule file is served
// by the knowledge tool.
// NOTE: run with TEMP/TMP pointed at the repo root (see p33).
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'mekanism');
    if (!mine) throw new Error(`mekanism rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 7) throw new Error(`expected 7 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('95b03e83')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'meltdown' });
    const hit = (found?.matches ?? []).find((m) => m.kind === 'rule');
    if (!hit || !JSON.stringify(hit).includes('1200')) {
      throw new Error(`meltdown rule search wrong: ${JSON.stringify(found)}`);
    }
  },
};
