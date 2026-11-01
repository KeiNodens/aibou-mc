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
    // 鉱石スタブ: A はプレイヤー (2,64,0) の足元、B は離れた場所。
    // dig された塊は found から消える。
    const dugSpots = new Set();
    const key3 = (x, y, z) => `${x},${y},${z}`;
    const ORE_A = { x: 1, y: 64, z: 1 };
    const ORE_B = { x: 0, y: 64, z: -4 };
    ctx.stub('obs.block', (p) => {
      if (p.block !== 'minecraft:iron_ore') return { found: [] };
      return { found: [ORE_A, ORE_B].filter((s2) => !dugSpots.has(key3(s2.x, s2.y, s2.z))) };
    });
    ctx.stub('dig', (p) => { dugSpots.add(key3(p.x, p.y, p.z)); return { task_id: 'd' }; });
    await ctx.sleep(75_000);
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
    // 鉱脈の譲り合い: プレイヤーの足元の鉱脈 (script 側スタブの ORE_A) は
    // 掘らず、離れた鉱脈だけを 1 個掘るはず (既存の work.end と混同しない
    // よう、開始前の件数を数えて新しい end を待つ)
    const caveEnds = async () => {
      const j = await h.mcp('journal', { action: 'read', limit: 100 });
      return (j.entries ?? []).filter(
        (e) => e.kind === 'work.end' && e.skill === 'cave_assist');
    };
    const before = (await caveEnds()).length;
    await h.mcp('cave_assist', { player: 'Daigo', seconds: 14, fight: false, torches: false });
    let ca2 = null;
    for (let i = 0; i < 40 && !ca2; i++) {
      const ends = await caveEnds();
      if (ends.length > before) ca2 = ends[ends.length - 1].result;
      else await h.sleep(500);
    }
    if (!ca2 || ca2.ores_mined !== 1) {
      throw new Error(`ore courtesy wrong: ${JSON.stringify(ca2)}`);
    }
  },
};
