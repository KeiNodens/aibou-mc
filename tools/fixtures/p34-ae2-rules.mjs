// P34 fixture (layer 3): the committed AE2 rule file is served by the
// knowledge tool — rules list carries provenance, search hits rules.
// NOTE: run with TEMP/TMP pointed at the repo root so the fixture
// bridge's cwd-relative asset lookup can see mod-knowledge/.
export default {
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const list = await h.mcp('knowledge', { action: 'rules' });
    const mine = (list?.rule_files ?? []).find((f) => f.mod === 'ae2');
    if (!mine) throw new Error(`ae2 rule file not listed: ${JSON.stringify(list)}`);
    if (mine.rules !== 9) throw new Error(`expected 9 rules, got ${mine.rules}`);
    if (!String(mine.source_commit).startsWith('1c2f96e7')) {
      throw new Error(`wrong source commit: ${mine.source_commit}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'channel' });
    const hit = (found?.matches ?? []).find((m) => m.kind === 'rule');
    if (!hit || !JSON.stringify(hit).includes('32')) {
      throw new Error(`channel rule search wrong: ${JSON.stringify(found)}`);
    }
  },
};
