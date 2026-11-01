// P46 fixture (layer 3): the four committed AE2-addon rule files are
// served by the knowledge tool — provenance and search hits checked.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const expect = [
      ['aeadditions', 3, 'c562c03b'],
      ['appliede', 3, 'b57292fd'],
      ['applied_mekanistics', 3, '7480d79c'],
      ['applied_botanics', 3, '13791485'],
    ];
    for (const [mod, n, commit] of expect) {
      const f = (list?.rule_files ?? []).find((x) => x.mod === mod);
      if (!f) throw new Error(`${mod} rule file not listed: ${JSON.stringify(list)}`);
      if (f.rules !== n) throw new Error(`expected ${n} ${mod} rules, got ${f.rules}`);
      if (!String(f.source_commit).startsWith(commit)) {
        throw new Error(`wrong ${mod} source commit: ${f.source_commit}`);
      }
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'chemical' });
    const hit = (found?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('radioactive'));
    if (!hit) throw new Error(`chemical rule search wrong: ${JSON.stringify(found)}`);
    const mana = await h.mcp('knowledge', { action: 'search', query: 'mana cell' });
    const mhit = (mana?.matches ?? []).filter((m) => m.kind === 'rule')
      .find((m) => JSON.stringify(m).includes('128000000'));
    if (!mhit) throw new Error(`mana cell rule search wrong: ${JSON.stringify(mana)}`);
  },
};
