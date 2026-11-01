// P30 fixture (D48): dimension_profile の set/get と、
// cave_assist がプロファイルの敵対テーブルで未知次元の敵に
// 反応すること。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'twilightforest:twilight_forest',
      inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.entity', (p) => {
      const player = { id: 99, type: 'minecraft:player', name: 'Daigo', x: 2, y: 64, z: 2 };
      const lich = { id: 77, type: 'twilightforest:lich', name: 'Lich', x: 4, y: 64, z: 2, dist: 3 };
      if (p.name === 'Daigo' || p.name === 'minecraft:player') return { entities: [player] };
      if (!p.name) return { entities: [player, lich] };
      return { entities: [] };
    });
    ctx.stub('obs.block', () => ({ found: [] }));
    ctx.stub('waypoint.set', () => ({ ok: true }));
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const lastResult = async (skill, n = 1) => {
      for (let i = 0; i < 60; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length >= n) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    // プロファイルを下書き保存
    await h.mcp('dimension_profile', {
      action: 'set', dimension: 'twilightforest:twilight_forest',
      hostiles: 'twilightforest:lich', hazards: 'magic,mazes',
      notes: '黄昏の森 (フィクスチャ用)',
    });
    const saved = await lastResult('dimension_profile', 1);
    if (!saved?.done || saved.profile?.hostiles?.[0] !== 'twilightforest:lich') {
      throw new Error(`profile set wrong: ${JSON.stringify(saved)}`);
    }
    // cave_assist がリッチを敵として交戦するか (combat.engage は
    // モック標準ハンドラが受ける)
    await h.mcp('cave_assist', {
      player: 'Daigo', seconds: 10, fight: true, ores: false, torches: false,
    });
    const cave = await lastResult('cave_assist', 1);
    if (!cave || (cave.fights ?? 0) < 1) {
      throw new Error(`cave_assist did not engage profile hostile: ${JSON.stringify(cave)}`);
    }
  },
};
