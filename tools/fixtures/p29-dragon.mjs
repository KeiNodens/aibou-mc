// P29 fixture (D47): dragon_fight の分担フロー —
// 止まり木で近接→飛行中はクリスタルを射撃→戻って近接→撃破。
export default {
  async script(ctx) {
    // phase: 0 止まり木/結晶2 → engage で 1 (飛行/結晶2)
    //        → shoot で結晶 -1 → 結晶0 かつ shoot 済みで 2 (止まり木)
    //        → engage で 3 (ドラゴン消滅)
    let phase = 0;
    let crystals = 2;
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 3, y: 64, z: 3, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:the_end',
      inventory: { 'minecraft:carved_pumpkin': 1, 'minecraft:arrow': 10 },
      inventory_detail: [{ slot: 0, id: 'minecraft:bow', count: 1 }],
    }));
    ctx.stub('equip', () => ({ ok: true }));
    ctx.stub('obs.entity', (p) => {
      if (p.name === 'minecraft:ender_dragon') {
        if (phase === 3) return { entities: [] };
        const perched = phase !== 1;
        return { entities: [{ id: 900, type: 'minecraft:ender_dragon', name: 'Dragon', x: 2, y: perched ? 68 : 95, z: 2, dist: 4 }] };
      }
      if (p.name === 'minecraft:end_crystal') {
        return {
          entities: Array.from({ length: crystals }, (_, i) => ({
            id: 901 + i, type: 'minecraft:end_crystal', name: 'Crystal', x: 10 * (i + 1), y: 90, z: 0, dist: 20,
          })),
        };
      }
      return { entities: [] };
    });
    ctx.stub('combat.engage', () => {
      const taskId = `eng-d${phase}`;
      if (phase === 0) phase = 1;
      else if (phase === 2) phase = 3;
      setTimeout(() => ctx.injectEvent('task.done',
        { task_id: taskId, state: 'succeeded', result: { reason: 'timeout', kills: 0, hits: 2 } }), 300);
      return { task_id: taskId };
    });
    ctx.stub('combat.shoot', () => {
      const taskId = 'shoot-d1';
      crystals = Math.max(0, crystals - 1);
      if (crystals === 0 && phase === 1) phase = 2;
      setTimeout(() => ctx.injectEvent('task.done',
        { task_id: taskId, state: 'succeeded', result: { reason: 'done', shots: 3 } }), 300);
      return { task_id: taskId };
    });
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
    await h.mcp('dragon_fight', { seconds: 60 });
    const r = await lastResult('dragon_fight');
    if (!r || r.dragon_slain !== true || r.engages !== 2
        || r.crystals_destroyed !== 2 || r.pumpkin !== true
        || (r.shots_fired ?? 0) < 3) {
      throw new Error(`dragon_fight wrong: ${JSON.stringify(r)}`);
    }
  },
};
