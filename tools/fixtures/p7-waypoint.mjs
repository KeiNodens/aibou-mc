// D20 fixture: waypoint 統合。skill (アダプタ) と MCP ツールが mod 側の
// 同一ストアを見ることを確認する。移行ロジックは tools/verify-waypoint.mjs。
export default {
  async script(ctx) {
    ctx.stub('baritone.goto', () => ({ task_id: 'wp-goto-1' }));
    // waitTask は task.done イベント待ちなので、goto を受けたら成功イベントを流す
    (async () => {
      const req = await ctx.waitReq('baritone.goto', 120_000);
      if (req) {
        await ctx.sleep(200);
        ctx.injectEvent('task.done', {
          task_id: 'wp-goto-1', state: 'succeeded', result: {},
        });
      }
    })();
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1000);
    let seen = 0;
    const runSkill = async (params) => {
      await h.mcp('waypoint', params);
      const end = await h.waitFor(async () => {
        const j = await h.mcp('work_journal', { limit: 100 });
        const es = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === 'waypoint');
        return es.length > seen ? es[es.length - 1] : null;
      }, 20_000);
      seen++;
      return end;
    };

    // 1. skill remember → MCP waypoint_list に見える (mock現在位置 103,64,-31)
    const r1 = await runSkill({ action: 'remember', name: 'skill_home' });
    if (!r1.ok || !r1.result?.done) {
      throw new Error('remember failed: ' + JSON.stringify(r1));
    }
    let list = await h.mcp('waypoint_list', {});
    if (list.waypoints?.skill_home?.x !== 103
      || list.waypoints?.skill_home?.z !== -31) {
      throw new Error('skill_home not in mod store: ' + JSON.stringify(list));
    }
    h.log('skill remember visible via MCP: OK');

    // 2. MCP waypoint_save (領域) → skill list / goto が解決する
    await h.mcp('waypoint_save', { name: 'mcp_base', x: 10, y: 70, z: 20, r: 15 });
    const r2 = await runSkill({ action: 'list' });
    if (!r2.result?.waypoints?.mcp_base
      || r2.result.waypoints.mcp_base.r !== 15) {
      throw new Error('mcp_base not visible to skill: ' + JSON.stringify(r2.result));
    }
    const r3 = await runSkill({ action: 'goto', name: 'mcp_base' });
    if (!r3.result?.done) {
      throw new Error('goto mcp_base failed: ' + JSON.stringify(r3));
    }
    h.log('MCP save visible to skill + goto: OK');

    // 3. skill remember with radius → 領域として mod 側に残る
    const r4 = await runSkill({ action: 'remember', name: 'skill_area', radius: 8 });
    if (!r4.result?.done) throw new Error('area remember failed');
    list = await h.mcp('waypoint_list', {});
    if (list.waypoints?.skill_area?.r !== 8) {
      throw new Error('skill_area radius missing: ' + JSON.stringify(list));
    }
    h.log('skill radius parity: OK');

    // 4. remove の相互可視 + not_found
    const r5 = await runSkill({ action: 'remove', name: 'skill_home' });
    if (!r5.result?.done) throw new Error('remove failed');
    list = await h.mcp('waypoint_list', {});
    if (list.waypoints?.skill_home) throw new Error('skill_home still present');
    const r6 = await runSkill({ action: 'remove', name: 'skill_home' });
    if (r6.result?.done !== false || r6.result?.error !== 'not_found') {
      throw new Error('remove not_found wrong: ' + JSON.stringify(r6.result));
    }
    h.log('waypoint integration verified');
  },
};
