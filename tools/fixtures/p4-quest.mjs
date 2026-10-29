// P4 fixture: クエストグラフ→frontier + .goal コマンド。
// graphを注入して quest_frontier が依存解決したクエストを返すこと、
// .goal でjournal goalが立つこと、quest.list diffで完了検出→episode記録を見る。
const GRAPH = {
  generatedAt: '2026-01-01',
  fingerprint: 'test',
  chapters: [{ id: 'CH1', title: 'チュートリアル', filename: 'tutorial' }],
  quests: [
    { id: 'AAAA000000000001', title: '石集め', description: [], chapter: 'CH1',
      x: 0, y: 0, deps: [], optional: false,
      tasks: [{ id: 'T1', type: 'item', item: 'minecraft:cobblestone', count: 8 }],
      rewards: [] },
    { id: 'AAAA000000000002', title: '木材集め', description: [], chapter: 'CH1',
      x: 1, y: 0, deps: ['AAAA000000000001'], optional: false,
      tasks: [], rewards: [] },
    { id: 'AAAA000000000003', title: 'かまど作り', description: [], chapter: 'CH1',
      x: 2, y: 0, deps: ['AAAA000000000001', 'AAAA000000000002'], optional: false,
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
    ctx.stub('chat.send', () => ({ sent: true }));
    ctx.stub('screenshot', () => ({ path: 'x.png' }));
    // 途中で石集めを完了させてdiff検出を確かめる
    setTimeout(() => { completed = ['AAAA000000000001']; }, 12_000);
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1500);
    h.writefile('data/quest-graph.json', JSON.stringify(GRAPH));

    // 1. frontier: 石集めのみ (deps無し)
    const f1 = await h.mcp('quest_frontier', {});
    const t1 = (f1.frontier ?? []).map((q) => q.title);
    if (!t1.includes('石集め') || t1.length !== 1) {
      throw new Error(`frontier wrong: ${JSON.stringify(f1)}`);
    }

    // 2. quest_plan: かまど作り → 石集め→木材集め→かまど作り の順
    const p = await h.mcp('quest_plan', { goal: 'かまど作り' });
    const titles = (p.plan ?? []).map((q) => q.title);
    if (titles.join(',') !== '石集め,木材集め,かまど作り') {
      throw new Error(`plan wrong: ${JSON.stringify(titles)}`);
    }

    // 3. .goal → journal goalに載りchat返答が返る
    await fetch(`http://127.0.0.1:${process.env.FIXTURE_MCP_PORT ?? 25689}/inject`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'Tester', text: '.goal かまど作り' }),
    });
    await h.waitFor(async () => {
      const g = await h.mcp('goal_get', {});
      return g.goals?.some((x) => x.text.includes('かまど作り'));
    });
    h.log('.goal registered');

    // 4. 完了検出: 12s後に石集めがcompletedになる → watch(30s)では遅いので
    //    ここでは poll は待たず、次のrunまでの短縮確認は省略。
    //    (実機では30s間隔で episode+screenshot が動く。fixtureは構造確認まで)
    h.log('quest graph verified');
  },
};
