// P32 fixture (D50): process_batch が2台の enrichment chamber に
// 総量10を 5+5 に分けて投入し、両方から成果を回収すること。
export default {
  async script(ctx) {
    const P1 = { x: 5, y: 64, z: 0, dist: 5 };
    const P2 = { x: 9, y: 64, z: 0, dist: 9 };
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, dimension: 'minecraft:overworld',
      inventory: { 'mekanism:raw_iron': 64 },
      inventory_detail: [],
    }));
    ctx.stub('obs.block', (p) => {
      if (p.block === 'mekanism:enrichment_chamber') return { found: [P1, P2] };
      return { found: [] };
    });
    ctx.stub('use_item', () => ({ ok: true }));
    let gotoSeq = 0;
    ctx.stub('baritone.goto', () => {
      const taskId = `goto-b${++gotoSeq}`;
      setTimeout(() => ctx.injectEvent('task.done',
        { task_id: taskId, state: 'succeeded', result: {} }), 150);
      return { task_id: taskId };
    });
    let outputTaken = false;
    ctx.stub('container.read', () => {
      const slots = [
        { slot: 0, container_idx: 0, empty: true },
        { slot: 1, container_idx: 0, empty: true },
        { slot: 2, container_idx: 0, empty: true },
        outputTaken
          ? { slot: 3, container_idx: 0, empty: true }
          : { slot: 3, container_idx: 0, empty: false, id: 'mekanism:dust_iron', count: 4 },
      ];
      for (let i = 4; i < 40; i++) {
        slots.push(i === 4
          ? { slot: i, container_idx: 1, empty: false, id: 'mekanism:raw_iron', count: 64 }
          : { slot: i, container_idx: 1, empty: true });
      }
      return { menu_id: 'mekanism:enrichment_chamber', slots };
    });
    ctx.stub('container.click', (p) => {
      if (p.slot === 3 && p.action === 'quick_move') outputTaken = true;
      if (p.slot === 2) outputTaken = false; // 次の台の投入で再び成果が出る
      return {};
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
    await h.mcp('process_batch', {
      input: 'mekanism:raw_iron', count: 10, machine: 'mekanism:enrichment_chamber',
    });
    const r = await lastResult('process_batch');
    if (!r || r.machines_used !== 2 || r.inserted !== 10 || r.produced !== 8) {
      throw new Error(`process_batch wrong: ${JSON.stringify(r)}`);
    }
  },
};
