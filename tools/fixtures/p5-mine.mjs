// P5 fixture: mine skill。baritone.mine成功→鉱床記憶(facility kind='mine')が
// snapshotに残ること。採掘先座標・降下はstub化して流れだけ確かめる。
export default {
  async script(ctx) {
    ctx.stub('chat.send', () => ({ sent: true }));
    ctx.stub('baritone.mine', (p) => {
      setTimeout(() => ctx.injectEvent('task.done', {
        task_id: 'mine-t1', state: 'succeeded',
        result: { mined: p.count },
      }), 400);
      return { task_id: 'mine-t1' };
    });
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1500);
    // depth指定なしの適当な資源 (テーブルに無い → 降下なし経路)
    const r = await h.mcp('mine_resource', { resource: 'minecraft:stone', count: 1 });
    if (typeof r === 'string' || !r.started) {
      throw new Error(`mine skill not started: ${JSON.stringify(r)}`);
    }
    // skill完了→episode+facility記録まで待つ
    const snapTxt = await h.waitFor(() => {
      const s = h.file('agent-journal.json');
      if (!s) return null;
      return s.includes('skill:mine_resource') && s.includes('minecraft:stone') ? s : null;
    }, 15_000);
    const snap = JSON.parse(snapTxt);
    h.log('facilities:', JSON.stringify(snap.facilities));
    h.log('episodes:', JSON.stringify(snap.episodes?.slice(-3)));
    if (!snap.facilities?.some((f) => f.kind === 'mine' && f.name === 'minecraft:stone')) {
      throw new Error('mine facility not recorded');
    }
    h.log('mine skill + deposit memory verified');
  },
};
