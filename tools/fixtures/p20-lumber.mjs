// P20 fixture (D39): lumber が 4 本の幹を下から全部切ること。
export default {
  async script(ctx) {
    const trunk = new Set(['4,64,0', '4,65,0', '4,66,0', '4,67,0']);
    ctx.stub('obs.state', () => ({
      name: 'Rin', pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.block', (p) => {
      if (p.block !== 'minecraft:oak_log') return { found: [] };
      return {
        found: [...trunk].map((k) => {
          const [x, y, z] = k.split(',').map(Number);
          return { x, y, z, dist: Math.abs(x) };
        }),
      };
    });
    ctx.stub('dig', (p) => {
      trunk.delete(`${p.x},${p.y},${p.z}`);
      return { task_id: 'd' };
    });
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const lastResult = async (skill) => {
      for (let i = 0; i < 60; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    await h.mcp('lumber', {});
    const r = await lastResult('lumber');
    if (!r || !r.done || r.chopped !== 4 || r.trees !== 1) {
      throw new Error(`lumber wrong: ${JSON.stringify(r)}`);
    }
  },
};
