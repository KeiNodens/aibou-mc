// P13b fixture (D35d): 手持ちは幸運なしでも、事前申告 (所持 3) が
// あれば合算で大晃の方が高いと判断し、凛 (幸運1) は掘らない。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: {},
      inventory_detail: [{
        slot: 0, id: 'minecraft:iron_pickaxe', count: 1,
        attrs: { enchanted: true, ench: [{ id: 'minecraft:fortune', lvl: 1 }] },
      }],
    }));
    ctx.stub('obs.entity', (p) => {
      const player = {
        id: 99, type: 'minecraft:player', name: 'Daigo', x: 3, y: 64, z: 4,
        held: { id: 'minecraft:stone_pickaxe', ench: [] },
      };
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
    // 事前申告: 大晃は幸運3を「持っている」 (スキルは非同期なので
    // journal の work.end で完了を確認してから次へ進む)
    await h.mcp('party_tools', { action: 'declare', player: 'Daigo', fortune: 3 });
    const decRes = await lastResult('party_tools');
    if (!decRes || decRes.fortune !== 3) {
      throw new Error(`declare wrong: ${JSON.stringify(decRes)}`);
    }
    await h.mcp('cave_assist', { player: 'Daigo', seconds: 15, fight: false, torches: false });
    const ca = await lastResult('cave_assist');
    if (!ca || ca.ores_mined !== 0) {
      throw new Error(`declared-fortune wrong: ${JSON.stringify(ca)}`);
    }
    await h.mcp('party_tools', { action: 'clear', player: 'Daigo' });
  },
};
