// P4追加fixture: クエスト set-aside (繰り返し失敗の棚上げ)。
// 失敗3回で frontier から外れること、手動 unaside で戻ること、
// goal_set(failed) フックが失敗カウントに連動することを検証する。
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
  ],
};

export default {
  async script(ctx) {
    ctx.stub('quest.list', () => ({
      quests: GRAPH.quests.map((q) => ({
        id: String(BigInt.asIntN(64, BigInt('0x' + q.id))),
        title: q.title, completed: false,
      })),
    }));
    ctx.stub('chat.send', () => ({ sent: true }));
    ctx.stub('screenshot', () => ({ path: 'x.png' }));
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1500);
    h.writefile('data/quest-graph.json', JSON.stringify(GRAPH));

    const frontierTitles = async () =>
      ((await h.mcp('quest', { action: 'frontier' })).frontier ?? []).map((q) => q.title);

    // 1. 最初は石集めが frontier
    if (!(await frontierTitles()).includes('石集め')) {
      throw new Error('initial frontier wrong');
    }
    // 2. 失敗3回 → 自動で棚上げされ frontier から消える
    let last = null;
    for (let i = 0; i < 3; i++) {
      last = await h.mcp('quest', { action: 'aside', mode: 'fail', quest: '石集め' });
    }
    if (!last.result?.aside) {
      throw new Error(`not aside after 3 failures: ${JSON.stringify(last)}`);
    }
    if ((await frontierTitles()).includes('石集め')) {
      throw new Error('aside quest still in frontier');
    }
    // 3. list に失敗回数つきで載る
    const list = await h.mcp('quest', { action: 'aside', mode: 'list' });
    const entry = (list.aside ?? []).find((q) => q.title === '石集め');
    if (!entry || entry.failures !== 3) {
      throw new Error(`aside list wrong: ${JSON.stringify(list)}`);
    }
    // 4. goal_set(failed) フック: quest目標の失敗がカウントに加わる
    const g = await h.mcp('goal_set', { text: 'quest:AAAA000000000001 石集め' });
    const end = await h.mcp('goal_set', {
      text: 'x', end_id: g.goal.id, status: 'failed',
    });
    if (!end.questFailure || end.questFailure.failures !== 4) {
      throw new Error(`goal hook wrong: ${JSON.stringify(end)}`);
    }
    // 5. unaside で frontier に戻る
    await h.mcp('quest', { action: 'aside', mode: 'unaside', quest: '石集め' });
    if (!(await frontierTitles()).includes('石集め')) {
      throw new Error('unaside did not restore frontier');
    }
    h.log('quest set-aside verified');
  },
};
