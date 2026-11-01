// P26 fixture (D45): barter が金1個を投げて交換品 (パール) を
// インベントリ差分で報告すること。
export default {
  async script(ctx) {
    let tossed = false;
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:the_nether',
      inventory: tossed
        ? { 'minecraft:gold_ingot': 1, 'minecraft:ender_pearl': 1 }
        : { 'minecraft:gold_ingot': 2 },
      inventory_detail: [],
    }));
    ctx.stub('obs.entity', (p) => {
      if (p.name === 'minecraft:piglin' || !p.name) {
        return { entities: [{ id: 7, type: 'minecraft:piglin', name: 'Piglin', x: 3, y: 64, z: 1, dist: 3 }] };
      }
      return { entities: [] };
    });
    ctx.stub('equip', () => ({ ok: true }));
    ctx.stub('look_at', () => ({ ok: true }));
    ctx.stub('toss', () => { tossed = true; return { dropped: true, item: 'minecraft:gold_ingot', count: 1 }; });
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
    // 1回目: toss は承認ゲート対象 → approval_required で止まる
    await h.mcp('barter', { rounds: 1 });
    const r0 = await lastResult('barter');
    if (!r0 || r0.reason !== 'approval_required') {
      throw new Error(`barter should stop at the approval gate first: ${JSON.stringify(r0)}`);
    }
    await h.mcp('approvals', { action: 'approve' });
    await h.mcp('barter', { rounds: 1 });
    const r = await (async () => {
      for (let i = 0; i < 60; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === 'barter');
        if (ends.length >= 2) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    })();
    if (!r || !r.done || r.gave !== 1 || r.got?.['minecraft:ender_pearl'] !== 1) {
      throw new Error(`barter wrong: ${JSON.stringify(r)}`);
    }
  },
};
