// P15 fixture (D37): clear_area の fill (窪地を 1 ブロック埋める)
// と light_up (12x12 の屋内に松明 4 本) を検証する。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: { 'minecraft:dirt': 10, 'minecraft:torch': 8 },
      inventory_detail: [],
    }));
    // 地形: y=63 が地面。(2,0) だけ y=63 が欠けた窪地
    ctx.stub('obs.block_state', (p) => {
      if (p.y >= 64) return { block: 'minecraft:air' };
      if (p.y === 63) {
        return { block: (p.x === 2 && p.z === 0) ? 'minecraft:air' : 'minecraft:stone' };
      }
      return { block: 'minecraft:stone' };
    });
    ctx.stub('dig', () => ({ task_id: 'd' }));
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
    await h.mcp('clear_area', { radius: 3, fill: true });
    const ca = await lastResult('clear_area');
    if (!ca || ca.filled !== 1 || ca.filler_used !== 'minecraft:dirt' || ca.cleared !== 0) {
      throw new Error(`clear fill wrong: ${JSON.stringify(ca)}`);
    }
    await h.mcp('light_up', { x: 0, y: 64, z: 0, size_x: 12, size_z: 12 });
    const lu = await lastResult('light_up');
    if (!lu || lu.needed !== 4 || lu.placed !== 4 || lu.done !== true) {
      throw new Error(`light_up wrong: ${JSON.stringify(lu)}`);
    }
  },
};
