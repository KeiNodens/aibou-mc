// P2追加fixture: セッション要約 + 失敗作業の suffix repair 材料。
// skill成功→episodeが貯まる→session_summary(record)でマーカーが進むこと、
// skill失敗→work_resume_plan に checkpoint 付きで載ることを検証する。
export default {
  async script(ctx) {
    ctx.stub('obs.entity', (p) => ({
      count: 1,
      entities: [{ name: p.name, entity_id: 7, x: 1, y: 2, z: 3, dist: 3.0 }],
    }));
    ctx.stub('baritone.follow', () => ({ task_id: 'follow-t1' }));
    ctx.stub('baritone.stop', () => ({}));
    ctx.stub('task.cancel', () => ({ state: 'cancelled' }));
    ctx.stub('chat.send', () => ({ sent: true }));
    // baritone.mine は stub しない → gather が失敗して work.end(ok:false) になる
    await ctx.sleep(500);
    ctx.injectChat('Tester', 'ついてきて');
    await ctx.sleep(1000);
    ctx.injectEvent('task.done', { task_id: 'follow-t1', state: 'succeeded' });
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(2000);
    // 1. 成功episodeが要約対象になる
    const s1 = await h.mcp('session_summary', {});
    if (!(s1.episodes >= 1 && s1.ok >= 1)) {
      throw new Error(`summary should count episodes: ${JSON.stringify(s1)}`);
    }
    // 2. record=true でマーカーが進み、直後の要約は0件になる
    const s2 = await h.mcp('session_summary', { record: true });
    if (!(s2.episodes >= 1)) throw new Error('record summary lost episodes');
    const s3 = await h.mcp('session_summary', {});
    if (s3.episodes !== 0) {
      throw new Error(`marker did not advance: ${JSON.stringify(s3)}`);
    }
    // 3. snapshot に session:summary episode が残る (debounce flush待ち)
    await h.waitFor(() => {
      const s = h.file('agent-journal.json');
      return s && s.includes('session:summary') ? s : null;
    }, 10_000);
    // 4. 失敗作業: gather を起動 (baritone.mine未stub→失敗)
    await h.mcp('gather', { block: 'minecraft:stone', count: 1 });
    const plan = await h.waitFor(async () => {
      const r = await h.mcp('work_resume_plan', {});
      return r.failed?.length ? r : null;
    }, 15_000);
    const f = plan.failed[0];
    if (f.skill !== 'gather' || !f.error) {
      throw new Error(`failed work wrong: ${JSON.stringify(f)}`);
    }
    if (!Array.isArray(f.doneSteps)) throw new Error('doneSteps missing');
    h.log('session summary + suffix repair plan verified');
  },
};
