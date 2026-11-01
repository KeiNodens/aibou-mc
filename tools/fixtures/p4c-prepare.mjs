// P4c fixture (D30): quest_prepare の集計 (plan→item tasks→在庫diff)。
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
    ctx.stub('quest.list', () => ({
      quests: GRAPH.quests.map((q) => ({
        id: String(BigInt.asIntN(64, BigInt('0x' + q.id))),
        title: q.title, completed: false,
      })),
    }));
    ctx.stub('obs.state', () => ({
      name: 'Rin', pos: { x: 0, y: 64, z: 0 },
      inventory: { 'minecraft:cobblestone': 3 }, inventory_detail: [],
    }));
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    h.writefile('data/quest-graph.json', JSON.stringify(GRAPH));
    const r = await h.mcp('quest_prepare', { goal: 'かまど作り' });
    const item = (r.items ?? []).find((i) => i.id === 'minecraft:cobblestone');
    if (!item || item.need !== 8 || item.have_inventory !== 3 || item.missing !== 5 || r.ready !== false) {
      throw new Error(`quest_prepare wrong: ${JSON.stringify(r)}`);
    }
  },
};
