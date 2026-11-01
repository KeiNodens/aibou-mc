// P49 fixture (layer 3): the committed EnderIO rule file is served
// by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const f = (list?.rule_files ?? []).find((x) => x.mod === 'enderio');
    if (!f) throw new Error(`enderio rule file not listed: ${JSON.stringify(list)}`);
    if (f.rules !== 5) throw new Error(`expected 5 enderio rules, got ${f.rules}`);
    if (!String(f.source_commit).startsWith('907a9c37')) {
      throw new Error(`wrong enderio source commit: ${f.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'conduit' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('1000000000'));
    if (!hit) throw new Error(`conduit rule search wrong: ${JSON.stringify(found)}`);
    const cap = await h.mcp('knowledge', { action: 'search', query: 'octadic' });
    const chit = (cap?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('3.0'));
    if (!chit) throw new Error(`capacitor rule search wrong: ${JSON.stringify(cap)}`);
  },
};
