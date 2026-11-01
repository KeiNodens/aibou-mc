// P16 fixture (D38): outing_prep が松明・食料・予備ツルハシの
// 不足を全部拾うこと。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: { 'minecraft:torch': 4, 'minecraft:bread': 1 },
      inventory_detail: [{ slot: 0, id: 'minecraft:stone_pickaxe', count: 1 }],
    }));
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const lastResult = async (skill) => {
      for (let i = 0; i < 40; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    await h.mcp('outing_prep', {});
    const r = await lastResult('outing_prep');
    if (!r || r.ok !== false || r.missing.length !== 3
      || r.have.torches !== 4 || r.have.food !== 1 || r.have.pickaxes !== 1) {
      throw new Error(`outing_prep wrong: ${JSON.stringify(r)}`);
    }
  },
};
