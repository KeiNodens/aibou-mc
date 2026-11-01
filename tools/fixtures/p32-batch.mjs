// P32 fixture (D50): process_batch が2台の enrichment chamber に
// 総量10を 5+5 に分けて投入し、両方から成果を回収すること。
// 成果は enrichment の x2 で 10+10=20 (state モデル化に伴い更新)。
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
    // F2 以降: クリックの実挙動 (右クリック=1個配置、実数計測) を
    // モデル化した state。player=所持数, carried=カーソル, 台ごとに
    // in (投入済) / out (成果)。投入完了で out = in x2 (enrichment)。
    const M = {
      cur: null, player: 64, carried: 0,
      m: { 5: { in: 0, out: 0 }, 9: { in: 0, out: 0 } },
    };
    ctx.stub('use_item', (p) => {
      if (p.x === 5 || p.x === 9) M.cur = p.x;
      return { ok: true };
    });
    let gotoSeq = 0;
    ctx.stub('baritone.goto', () => {
      const taskId = `goto-b${++gotoSeq}`;
      setTimeout(() => ctx.injectEvent('task.done',
        { task_id: taskId, state: 'succeeded', result: {} }), 150);
      return { task_id: taskId };
    });
    ctx.stub('container.read', () => {
      const cur = M.m[M.cur] ?? { in: 0, out: 0 };
      const slots = [
        { slot: 0, container_idx: 0, empty: true },
        { slot: 1, container_idx: 0, empty: true },
        cur.in > 0
          ? { slot: 2, container_idx: 0, empty: false, id: 'mekanism:raw_iron', count: cur.in }
          : { slot: 2, container_idx: 0, empty: true },
        cur.out > 0
          ? { slot: 3, container_idx: 0, empty: false, id: 'mekanism:dust_iron', count: cur.out }
          : { slot: 3, container_idx: 0, empty: true },
      ];
      for (let i = 4; i < 40; i++) {
        slots.push(i === 4 && M.player > 0 && M.carried === 0
          ? { slot: i, container_idx: 1, empty: false, id: 'mekanism:raw_iron', count: M.player }
          : { slot: i, container_idx: 1, empty: true });
      }
      return {
        menu_id: 'mekanism:enrichment_chamber',
        carried: M.carried > 0 ? { id: 'mekanism:raw_iron', count: M.carried } : null,
        slots,
      };
    });
    ctx.stub('container.click', (p) => {
      const cur = M.m[M.cur];
      if (!cur) return {};
      if (p.slot === 4 && p.action === 'pickup') {
        if (M.carried === 0 && M.player > 0) { M.carried = M.player; M.player = 0; }
        else if (M.carried > 0) { M.player = M.carried; M.carried = 0; }
      } else if (p.slot === 2 && p.action === 'pickup' && p.button === 1) {
        if (M.carried > 0) { M.carried--; cur.in++; }
      } else if (p.slot === 2 && p.action === 'pickup') {
        if (M.carried > 0) { cur.in += M.carried; M.carried = 0; }
      } else if (p.slot === 3 && p.action === 'quick_move') {
        cur.out = 0;
      }
      if (M.carried === 0 && cur.in > 0) { cur.out += cur.in * 2; cur.in = 0; }
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
    if (!r || r.machines_used !== 2 || r.inserted !== 10 || r.produced !== 20) {
      throw new Error(`process_batch wrong: ${JSON.stringify(r)}`);
    }
  },
};
