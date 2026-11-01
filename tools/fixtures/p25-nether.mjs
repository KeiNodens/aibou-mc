// P25 fixture (D45): ネザーの cave_assist (ソロ) —
// クォーツと露出面のある残骸は掘り、金鉱石は金装備なしでは
// 掘らないこと。
export default {
  async script(ctx) {
    const dugAt = [];
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:the_nether',
      inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.entity', (p) => {
      const player = { id: 99, type: 'minecraft:player', name: 'Player', x: 2, y: 64, z: 2 };
      if (p.name === 'Player' || p.name === 'minecraft:player' || !p.name) {
        return { entities: [player] };
      }
      return { entities: [] };
    });
    const Q = { x: 6, y: 64, z: 6 };
    const G = { x: 5, y: 64, z: 3 };
    const D = { x: 7, y: 64, z: 7 };
    const dug = new Set(dugAt);
    ctx.stub('obs.block', (p) => {
      const alive = (s) => (dug.has(`${s.x},${s.y},${s.z}`) ? [] : [s]);
      if (p.block === 'minecraft:nether_quartz_ore') return { found: alive(Q) };
      if (p.block === 'minecraft:nether_gold_ore') return { found: alive(G) };
      if (p.block === 'minecraft:ancient_debris') return { found: alive(D) };
      return { found: [] };
    });
    // 残骸の隣 (7,64,8) だけ空気 = 露出あり。それ以外は岩。
    ctx.stub('obs.block_state', (p) => {
      if (p.x === 7 && p.y === 64 && p.z === 8) return { id: 'minecraft:air' };
      return { id: 'minecraft:netherrack' };
    });
    ctx.stub('dig', (p) => {
      dugAt.push(`${p.x},${p.y},${p.z}`);
      dug.add(`${p.x},${p.y},${p.z}`);
      return { task_id: 'd' };
    });
    ctx.stub('waypoint.set', () => ({ ok: true }));
    await ctx.sleep(75_000);
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
    await h.mcp('cave_assist', { player: 'Player', seconds: 14, fight: false, torches: false, mode: 'quiet' });
    const r = await lastResult('cave_assist');
    if (!r || r.ores_mined !== 2) {
      throw new Error(`nether ores wrong (expect quartz+debris=2, gold skipped): ${JSON.stringify(r)}`);
    }
  },
};
