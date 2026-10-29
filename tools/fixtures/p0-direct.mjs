// P0 fixture: 「来て」→直パースでcome_here起動 (codex非起動)、
// 未対応文→codex起動でbounded promptが組まれること。
export default {
  async script(ctx) {
    ctx.stub('obs.entity', (p) => ({
      count: 1,
      entities: [{ name: p.name, entity_id: 7, x: 1, y: 2, z: 3, dist: 3.0 }],
    }));
    ctx.stub('baritone.follow', () => ({ task_id: 'follow-t1' }));
    ctx.stub('baritone.stop', () => ({}));
    ctx.stub('task.cancel', () => ({ state: 'cancelled' }));
    await ctx.sleep(500);
    ctx.injectChat('Tester', '来て');
    const r = await ctx.waitReq('baritone.follow', 8000);
    if (!r) throw new Error('baritone.follow not called (direct parse failed)');
    if (r.params.target !== 'Tester') throw new Error('follow target mismatch');
    // 未対応の文章はcodexへ回る
    ctx.injectChat('Tester', '今日のご飯なに？');
    await ctx.sleep(3500);
  },
  async assert(h) {
    const prompts = await h.waitFor(() => h.rawfile('prompts.md'));
    if (!prompts.includes('直近の会話')) throw new Error('bounded recent section missing');
    if (!prompts.includes('世界の状況')) throw new Error('worldCtx section missing');
    if (!prompts.includes('今日のご飯なに？')) throw new Error('latest chat missing');
    if (!prompts.includes('技能一覧')) throw new Error('skill catalog missing');
    // 「来て」は直パースで消費されるのでcodex起動は未対応文の1回のみ
    const count = (prompts.match(/===== /g) || []).length;
    if (count !== 1) throw new Error(`expected 1 codex run, got ${count}`);
    // journalにskill実行(work.start/end)が残る
    const j = h.file('journal.jsonl');
    if (!j || !j.includes('come_here')) throw new Error('come_here not journaled');
  },
};
