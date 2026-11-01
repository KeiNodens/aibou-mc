// P23 fixture (D42): knowledge ツールの層3 ルール対応 —
// テスト用ルールファイルを置き、rules 一覧と search (kind=rule)
// を確認して後始末する。
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';

const RULES = new URL('../../mod-knowledge/rules/', import.meta.url);
const FILE = new URL('testmod@1.0.0.json', RULES);

export default {
  async script(ctx) {
    mkdirSync(RULES, { recursive: true });
    writeFileSync(FILE, JSON.stringify({
      mod: 'testmod', version: '1.0.0',
      source_repo: 'https://example.invalid/testmod',
      source_commit: 'deadbeef',
      rules: [{
        id: 'channel_capacity', topic: 'test cable channel capacity',
        value: 8, quote: 'MAX_CHANNEL = 8', source_file: 'Cable.java',
        source_line: 12,
      }],
    }));
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    try {
      const list = await h.mcp('knowledge', { action: 'rules' });
      const mine = (list?.rule_files ?? []).find((f) => f.mod === 'testmod');
      if (!mine || mine.rules !== 1 || mine.source_commit !== 'deadbeef') {
        throw new Error(`rules list wrong: ${JSON.stringify(list)}`);
      }
      const found = await h.mcp('knowledge', { action: 'search', query: 'channel' });
      const hit = (found?.matches ?? []).find((m) => m.kind === 'rule');
      if (!hit || hit.value !== 8) {
        throw new Error(`rule search wrong: ${JSON.stringify(found)}`);
      }
    } finally {
      rmSync(FILE, { force: true });
    }
  },
};
