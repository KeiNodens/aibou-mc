// P28 fixture (D47): find_stronghold がアイを投げて方角
// (北東=45°) を報告すること。
export default {
  async script(ctx) {
    let thrown = false;
    let eyeQueries = 0;
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 100, y: 64, z: 100, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:overworld',
      inventory: { 'minecraft:ender_eye': 3 },
      inventory_detail: [],
    }));
    ctx.stub('equip', () => ({ ok: true }));
    ctx.stub('use_item', () => { thrown = true; return { ok: true }; });
    ctx.stub('obs.entity', (p) => {
      // 投げた後しばらく北東に飛び、その後 消える
      if (p.name === 'minecraft:eye_of_ender' && thrown) {
        eyeQueries++;
        if (eyeQueries <= 3) {
          return { entities: [{ id: 42, type: 'minecraft:eye_of_ender', name: 'Eye', x: 108, y: 70, z: 92, dist: 10 }] };
        }
      }
      return { entities: [] };
    });
    await ctx.sleep(30_000);
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
    await h.mcp('find_stronghold', {});
    const r = await lastResult('find_stronghold');
    if (!r || !r.threw || Math.abs((r.direction_deg ?? -1) - 45) > 3
        || r.compass !== '北東') {
      throw new Error(`find_stronghold wrong: ${JSON.stringify(r)}`);
    }
  },
};
