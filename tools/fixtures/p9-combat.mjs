// P9 fixture (D31): cave_assist の戦闘が combat.engage 経由になり、
// fight スキルが CombatTask の結果を返すこと。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.entity', (p) => {
      const player = { id: 99, type: 'minecraft:player', name: 'Daigo', x: 2, y: 64, z: 0 };
      const zombie = { id: 55, type: 'minecraft:zombie', x: 4, y: 64, z: 0 };
      if (p.name === 'Daigo') return { entities: [player] };
      if (!p.name) return { entities: [player, zombie] };
      return { entities: [] };
    });
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
    // fight: engage → cleared / kills 1
    await h.mcp('fight', {});
    const f = await lastResult('fight');
    if (!f || f.reason !== 'cleared' || f.kills !== 1) {
      throw new Error(`fight wrong: ${JSON.stringify(f)}`);
    }
    // cave_assist: ゾンビが近いので engage が走る (fights >= 1)
    await h.mcp('cave_assist', { player: 'Daigo', seconds: 5, ores: false, torches: false });
    const ca = await lastResult('cave_assist');
    if (!ca || ca.fights < 1) {
      throw new Error(`cave_assist wrong: ${JSON.stringify(ca)}`);
    }
  },
};
