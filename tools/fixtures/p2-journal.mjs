// P2 fixture: 構造化記憶の永続化。goal_set→skill実行→bridge強制再起動後に
// agent-journal.json から goals/episodes/facilities が復元されること。
// (強制killなので終了フックは走らない = debounced atomic writeの実効検証)
export default {
  async script(ctx) {
    ctx.stub('obs.entity', (p) => ({
      count: 1,
      entities: [{ name: p.name, entity_id: 7, x: 1, y: 2, z: 3, dist: 3.0 }],
    }));
    ctx.stub('baritone.follow', () => ({ task_id: 'follow-t1' }));
    ctx.stub('baritone.stop', () => ({}));
    ctx.stub('task.cancel', () => ({ state: 'cancelled' }));
    ctx.stub('use_item', () => ({ ok: true }));
    ctx.stub('waypoint.set', () => ({ saved: true }));
    await ctx.sleep(500);
    // 直パースskillでepisode生成 (「ついてきて」→follow_player)
    ctx.injectChat('Tester', 'ついてきて');
    // follow_playerのwaitTaskに応える
    await ctx.sleep(1000);
    ctx.injectEvent('task.done', { task_id: 'follow-t1', state: 'succeeded' });
  },
  async assert(h) {
    // mock側scriptのstub登録(接続後+300ms)を待つ
    await h.sleep(1500);
    // 1. goal登録 + waypoint (施設記憶)
    const g = await h.mcp('goal_set', { text: '石を64個集める', priority: 1 });
    if (!g.ok || !g.goal?.id) throw new Error('goal_set failed');
    const w = await h.mcp('waypoint_save', { name: 'home', x: 10, y: 64, z: 20, r: 16 });
    if (typeof w === 'string') throw new Error(`waypoint_save failed: ${w}`);

    // 2. snapshotが書かれるまで待つ (debounce 1s + 余裕)
    const snapTxt = await h.waitFor(() => {
      const s = h.file('agent-journal.json');
      if (!s) return null;
      return s.includes('石を64個集める') && s.includes('follow_player') ? s : null;
    }, 10_000);
    const snap = JSON.parse(snapTxt);
    if (!snap.goals?.some((x) => x.status === 'active')) {
      throw new Error('active goal not in snapshot');
    }
    if (!snap.facilities?.some((f) => f.name === 'home')) {
      throw new Error('waypoint facility not consolidated');
    }
    if (!snap.episodes?.some((e) => e.action === 'skill:follow_player')) {
      throw new Error('skill episode missing');
    }
    h.log('snapshot verified, restarting bridge');

    // 3. bridge強制再起動 → 記憶が復元されること
    await h.restartBridge();
    const goals = await h.mcp('goal_get', {});
    if (!goals.goals?.some((x) => x.text === '石を64個集める')) {
      throw new Error('goal not restored after restart');
    }
    const snap2 = await h.mcp('journal_snapshot', {});
    if (!snap2.episodes?.some((e) => e.action === 'skill:follow_player')) {
      throw new Error('episodes not restored');
    }
    if (!snap2.facilities?.some((f) => f.name === 'home')) {
      throw new Error('facilities not restored');
    }
    h.log('restart restore verified');
  },
};
