// P27 fixture (D46): fight の拡張 —
// A: low_hp で食べて再突入 (rounds=2)、武器は自動選択
//    (シャープ3ダイヤ剣が選ばれる)。
// B: ranged モードは combat.shoot を使い、近接に入らない。
export default {
  async script(ctx) {
    let engageCalls = 0;
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:overworld',
      inventory: { 'minecraft:bread': 2, 'minecraft:arrow': 12 },
      inventory_detail: [
        { slot: 0, id: 'minecraft:iron_sword', count: 1 },
        { slot: 1, id: 'minecraft:diamond_sword', count: 1, attrs: { ench: [{ id: 'minecraft:sharpness', lvl: 3 }] } },
        { slot: 2, id: 'minecraft:bow', count: 1 },
      ],
    }));
    ctx.stub('obs.entity', () => ({
      entities: [{ id: 55, type: 'minecraft:zombie', name: 'Zombie', x: 12, y: 64, z: 0, dist: 12 }],
    }));
    ctx.stub('equip', () => ({ ok: true }));
    ctx.stub('combat.engage', () => {
      engageCalls++;
      const taskId = `eng-s${engageCalls}`;
      const result = engageCalls === 1
        ? { reason: 'low_hp', kills: 0, hits: 2, duration_ticks: 40 }
        : { reason: 'cleared', kills: 1, hits: 3, duration_ticks: 60 };
      setTimeout(() => ctx.injectEvent('task.done',
        { task_id: taskId, state: 'succeeded', result }), 300);
      return { task_id: taskId };
    });
    ctx.stub('use_item', () => {
      const taskId = 'use-s1';
      setTimeout(() => ctx.injectEvent('task.done',
        { task_id: taskId, state: 'succeeded', result: {} }), 200);
      return { task_id: taskId };
    });
    await ctx.sleep(90_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const ends = async () => {
      const j = await h.mcp('journal', { action: 'read', limit: 100 });
      return (j.entries ?? []).filter(
        (e) => e.kind === 'work.end' && e.skill === 'fight');
    };
    const waitEnds = async (n) => {
      for (let i = 0; i < 60; i++) {
        const es = await ends();
        if (es.length >= n) return es[es.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    // A: 食べて再突入
    await h.mcp('fight', { rounds: 2, collect: false });
    const a = await waitEnds(1);
    if (!a || a.reason !== 'cleared' || a.ate !== 1 || a.engagements !== 2
        || a.weapon !== 'minecraft:diamond_sword') {
      throw new Error(`fight melee loop wrong: ${JSON.stringify(a)}`);
    }
    // B: 遠距離
    await h.mcp('fight', { ranged: true, targets: 'minecraft:zombie', collect: false });
    const b = await waitEnds(2);
    if (!b || b.ranged !== true || b.engagements !== 0
        || (b.volleys ?? 0) < 1 || (b.shots_fired ?? 0) < 5) {
      throw new Error(`fight ranged wrong: ${JSON.stringify(b)}`);
    }
  },
};
