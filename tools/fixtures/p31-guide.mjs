// P31 fixture (D49): quest_guide が frontier を「今できる順」で
// 並べること + ウォッチャーが完了と解放を journal に残すこと。
const GRAPH = {
  generatedAt: '2026-01-01',
  fingerprint: 'test',
  chapters: [{ id: 'CH1', title: 'チュートリアル', filename: 'tutorial' }],
  quests: [
    { id: 'AAAA000000000001', title: '石集め', description: [], chapter: 'CH1',
      x: 0, y: 0, deps: [], optional: false,
      tasks: [{ id: 'T1', type: 'item', item: 'minecraft:cobblestone', count: 8 }],
      rewards: [{ type: 'item', item: 'minecraft:bread', count: 2 }] },
    { id: 'AAAA000000000002', title: '原木集め', description: [], chapter: 'CH1',
      x: 1, y: 0, deps: [], optional: false,
      tasks: [{ id: 'T2', type: 'item', item: 'minecraft:oak_log', count: 4 }],
      rewards: [] },
    { id: 'AAAA000000000003', title: '木材集め', description: [], chapter: 'CH1',
      x: 2, y: 0, deps: ['AAAA000000000001'], optional: false,
      tasks: [], rewards: [] },
  ],
};

export default {
  async script(ctx) {
    let completed = [];
    ctx.stub('quest.list', () => ({
      quests: GRAPH.quests.map((q) => ({
        id: String(BigInt.asIntN(64, BigInt('0x' + q.id))),
        title: q.title,
        completed: completed.includes(q.id),
      })),
    }));
    ctx.stub('obs.state', () => ({
      name: 'Rin', pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:overworld',
      inventory: { 'minecraft:cobblestone': 10 },
      inventory_detail: [],
    }));
    ctx.stub('chat.send', () => ({ sent: true }));
    ctx.stub('screenshot', () => ({ path: 'x.png' }));
    // 開始 8s で石集めを完了させる (ウォッチャー遅延開始+30s poll)
    setTimeout(() => { completed = ['AAAA000000000001']; }, 8_000);
    await ctx.sleep(120_000);
  },
  async assert(h) {
    await h.sleep(1000);
    h.writefile('data/quest-graph.json', JSON.stringify(GRAPH));
    // guide: 石集め (素材あり) が 原木集め (素材なし) より先
    let guide = null;
    for (let i = 0; i < 10 && !guide; i++) {
      const g = await h.mcp('quest_guide', {});
      if (g.recommendations) guide = g;
      else await h.sleep(1000);
    }
    const recs = guide?.recommendations ?? [];
    if (recs.length !== 2 || recs[0].title !== '石集め'
        || recs[0].ready !== true || recs[1].title !== '原木集め'
        || recs[1].missing?.[0]?.item !== 'minecraft:oak_log') {
      throw new Error(`quest_guide wrong: ${JSON.stringify(guide)}`);
    }
    // ウォッチャー: 完了と解放 (木材集め) が journal に載る
    let sawCompleted = false;
    let sawUnlocked = false;
    for (let i = 0; i < 55 && !(sawCompleted && sawUnlocked); i++) {
      const j = await h.mcp('journal', { action: 'read', limit: 100 });
      const kinds = (j.entries ?? []).map((e) => e.kind);
      if (kinds.includes('quest_completed')) sawCompleted = true;
      if (kinds.includes('quest_unlocked')) sawUnlocked = true;
      if (!(sawCompleted && sawUnlocked)) await h.sleep(2000);
    }
    if (!sawCompleted || !sawUnlocked) {
      throw new Error(`watcher notes missing: completed=${sawCompleted} unlocked=${sawUnlocked}`);
    }
  },
};
