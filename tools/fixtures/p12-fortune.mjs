// P12 fixture (D35c): 幸運つきツルハシを持つ凛がダイヤを見つけたら、
// 告知して、プレイヤーが近くに来たところで凛が掘る (一緒に掘る形)。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: {},
      inventory_detail: [{
        slot: 0, id: 'minecraft:diamond_pickaxe', count: 1,
        attrs: { enchanted: true, ench: [{ id: 'minecraft:fortune', lvl: 3 }] },
      }],
    }));
    ctx.stub('obs.entity', (p) => {
      const player = { id: 99, type: 'minecraft:player', name: 'Daigo', x: 3, y: 64, z: 4 };
      if (p.name === 'Daigo' || !p.name) return { entities: [player] };
      return { entities: [] };
    });
    const dugSpots = new Set();
    const key3 = (x, y, z) => `${x},${y},${z}`;
    const GEM = { x: 6, y: 64, z: 6 };
    ctx.stub('obs.block', (p) => {
      if (p.block !== 'minecraft:diamond_ore') return { found: [] };
      return { found: dugSpots.has(key3(GEM.x, GEM.y, GEM.z)) ? [] : [GEM] };
    });
    ctx.stub('dig', (p) => { dugSpots.add(key3(p.x, p.y, p.z)); return { task_id: 'd' }; });
    ctx.stub('equip', () => ({ ok: true }));
    ctx.stub('waypoint.set', () => ({ ok: true }));
    await ctx.sleep(60_000);
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
    await h.mcp('cave_assist', { player: 'Daigo', seconds: 15, fight: false, torches: false });
    const ca = await lastResult('cave_assist');
    if (!ca || ca.ores_mined !== 1) {
      throw new Error(`fortune joint dig wrong: ${JSON.stringify(ca)}`);
    }
    const j = await h.mcp('journal', { action: 'read', limit: 100 });
    const disc = (j.entries ?? []).some((e) => {
      const t = JSON.stringify(e);
      return t.includes('discovery') && t.includes('diamond_ore');
    });
    if (!disc) throw new Error('discovery note missing');
  },
};
