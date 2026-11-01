// P17 fixture (D38): branch_mine が進行方向の奥の溶岩を先読みして
// 手前で止まること (lava_ahead)。z=3 のセルを掘る前に止まるので
// dug は z=1,2 の 4 ブロック。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.entity', () => ({ entities: [] }));
    ctx.stub('obs.block_state', (p) => {
      if (p.x === 0 && p.y === 64 && p.z === 4) return { id: 'minecraft:lava' };
      return { id: 'minecraft:stone' };
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
    await h.mcp('branch_mine', { length: 10, torch_every: 0 });
    const r = await lastResult('branch_mine');
    if (!r || r.stopped !== 'lava_ahead' || r.dug !== 4) {
      throw new Error(`lava_ahead wrong: ${JSON.stringify(r)}`);
    }
  },
};
