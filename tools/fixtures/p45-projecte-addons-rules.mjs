// P45 fixture (layer 3): the committed ProjectExpansion and ProjectE
// Integration rule files are served by the knowledge tool.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const px = (list?.rule_files ?? []).find((f) => f.mod === 'projectexpansion');
    if (!px) throw new Error(`projectexpansion rule file not listed: ${JSON.stringify(list)}`);
    if (px.rules !== 8) throw new Error(`expected 8 PX rules, got ${px.rules}`);
    if (!String(px.source_commit).startsWith('4436aa66')) {
      throw new Error(`wrong PX source commit: ${px.source_commit}`);
    }
    const pei = (list?.rule_files ?? []).find((f) => f.mod === 'projecte_integration');
    if (!pei) throw new Error(`projecte_integration rule file not listed: ${JSON.stringify(list)}`);
    if (pei.rules !== 3) throw new Error(`expected 3 PEI rules, got ${pei.rules}`);
    if (!String(pei.source_commit).startsWith('8ea22bc9')) {
      throw new Error(`wrong PEI source commit: ${pei.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'star' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('204800000'));
    if (!hit) throw new Error(`star rule search wrong: ${JSON.stringify(found)}`);
  },
};
