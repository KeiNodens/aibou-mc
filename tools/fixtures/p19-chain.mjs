// P19 fixture (D39): process_chain mek_2x (iron 4 → dust 8 →
// ingot 8)。2 台の機械の menu を click で状態遷移させる疑似機械。
export default {
  async script(ctx) {
    const state = {
      machine: null, carried: null,
      inv39: { id: 'minecraft:raw_iron', count: 4 },
      inSlot: null, outSlot: null,
    };
    const TRANSFORM = {
      enrichment: (it) => ({ id: 'mekanism:dust_iron', count: it.count * 2 }),
      smelter: (it) => ({ id: 'minecraft:iron_ingot', count: it.count }),
    };
    const MENU_ID = {
      enrichment: 'mekanism:enrichment_chamber',
      smelter: 'mekanism:energized_smelter',
    };
    const menu = () => ({
      menu_id: MENU_ID[state.machine],
      carried: state.carried,
      slots: [
        { slot: 2, container_idx: 0, empty: !state.inSlot, ...(state.inSlot ?? {}) },
        { slot: 3, container_idx: 0, empty: !state.outSlot, ...(state.outSlot ?? {}) },
        { slot: 39, container_idx: 1, empty: !state.inv39, ...(state.inv39 ?? {}) },
      ],
    });
    ctx.stub('obs.state', () => ({
      name: 'Rin', pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20, inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.block', (p) => {
      if (p.block === 'mekanism:enrichment_chamber') {
        return { found: [{ x: 2, y: 64, z: 0, dist: 1 }] };
      }
      if (p.block === 'mekanism:energized_smelter') {
        return { found: [{ x: 4, y: 64, z: 0, dist: 1 }] };
      }
      return { found: [] };
    });
    ctx.stub('use_item', (p) => {
      state.machine = p.x === 2 ? 'enrichment' : 'smelter';
      return { ok: true };
    });
    ctx.stub('container.read', () => menu());
    ctx.stub('container.click', (p) => {
      if (p.action === 'pickup' && p.slot === 39 && state.inv39 && !state.carried) {
        state.carried = state.inv39; state.inv39 = null;
      } else if (p.action === 'pickup' && p.slot === 2 && state.carried) {
        state.inSlot = state.carried; state.carried = null;
        state.outSlot = TRANSFORM[state.machine](state.inSlot);
        state.inSlot = null;
      } else if (p.action === 'quick_move' && p.slot === 3 && state.outSlot) {
        state.inv39 = state.outSlot; state.outSlot = null;
      }
      return { ok: true };
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
    await h.mcp('process_chain', { route: 'mek_2x', metal: 'iron', count: 4 });
    const r = await lastResult('process_chain');
    if (!r || !r.done || r.produced !== 8 || r.steps?.length !== 2) {
      throw new Error(`chain wrong: ${JSON.stringify(r)}`);
    }
  },
};
