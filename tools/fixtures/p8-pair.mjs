// P8 fixture (D30): branch_mine / cave_assist / ranch の基本動作。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 180, pitch: 0 },
      health: 20, hunger: 20,
      inventory: { 'minecraft:wheat': 10, 'minecraft:bucket': 1 },
      inventory_detail: [
        { slot: 0, id: 'minecraft:wheat', count: 10 },
        { slot: 1, id: 'minecraft:bucket', count: 1 },
      ],
    }));
    ctx.stub('obs.block_state', (p) => ({
      id: (p.x === 0 && p.y === 64 && p.z === -3)
        ? 'minecraft:iron_ore' : 'minecraft:stone',
    }));
    ctx.stub('obs.entity', (p) => {
      if (p.name === 'Player') {
        return { entities: [{ id: 99, type: 'minecraft:player', name: 'Player', x: 2, y: 64, z: 0 }] };
      }
      if (p.name === 'minecraft:cow') {
        return { entities: [
          { id: 1, type: 'minecraft:cow', x: 1, y: 64, z: 1 },
          { id: 2, type: 'minecraft:cow', x: 3, y: 64, z: 1 },
        ] };
      }
      if (p.name === 'minecraft:player') {
        return { entities: [{ id: 99, type: 'minecraft:player', name: 'Player', x: 2, y: 64, z: 0 }] };
      }
      return { entities: [] };
    });
    ctx.stub('interact', () => ({ result: 'success' }));
    ctx.stub('waypoint.set', () => ({ ok: true }));
    await ctx.sleep(50_000);
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
      throw new Error(`no work.end for ${skill}`);
    };
    // branch_mine: 北へ 5、石 2 段 x 5 = 10、鉄 1
    await h.mcp('branch_mine', { length: 5, torch_every: 0 });
    const bm = await lastResult('branch_mine');
    if (!bm || bm.dug !== 10 || bm.ores?.['minecraft:iron_ore'] !== 1) {
      throw new Error(`branch_mine wrong: ${JSON.stringify(bm)}`);
    }
    // cave_assist: 4 秒だけ随行して trail を残す
    await h.mcp('cave_assist', { player: 'Player', seconds: 4, ores: false });
    const ca = await lastResult('cave_assist');
    if (!ca || !ca.entry || ca.crumbs < 1) {
      throw new Error(`cave_assist wrong: ${JSON.stringify(ca)}`);
    }
    // ranch: 牛 2 頭 + 小麦 → 繁殖 1
    await h.mcp('ranch', {});
    const ra = await lastResult('ranch');
    if (!ra || !ra.bred?.['牛']) {
      throw new Error(`ranch wrong: ${JSON.stringify(ra)}`);
    }
  },
};
