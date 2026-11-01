// P22 fixture (D41): probe_energy / registry_items の疎通と、
// knowledge ツール (層2 索引) の mods/search。
// 前提: tools/extract_knowledge.py で knowledge/ が生成済み
// (libs の jade jar から抽出)。
export default {
  async script(ctx) {
    ctx.stub('probe.energy', () => ({
      supported: true, stored: 5000, capacity: 10000,
      faces: { up: { stored: 5000, capacity: 10000 } },
    }));
    ctx.stub('registry.items', () => ({
      total: 2, offset: 0, returned: 2,
      items: [
        { id: 'minecraft:iron_ingot', name: 'Iron Ingot' },
        { id: 'mekanism:ingot_osmium', name: 'Osmium Ingot' },
      ],
    }));
    await ctx.sleep(30_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const pe = await h.mcp('probe_energy', { x: 1, y: 64, z: 1 });
    if (!pe || pe.supported !== true || pe.stored !== 5000) {
      throw new Error(`probe_energy wrong: ${JSON.stringify(pe)}`);
    }
    const ri = await h.mcp('registry_items', { contains: 'osmium' });
    if (!ri || ri.items?.length !== 1 || ri.items[0].id !== 'mekanism:ingot_osmium') {
      throw new Error(`registry_items wrong: ${JSON.stringify(ri)}`);
    }
    const mods = await h.mcp('knowledge', { action: 'mods' });
    if (!mods?.mods?.some((m) => m.id === 'jade')) {
      throw new Error(`knowledge mods missing jade: ${JSON.stringify(mods)}`);
    }
    const found = await h.mcp('knowledge', { action: 'search', query: 'jade' });
    if (!found?.matches?.length) {
      throw new Error(`knowledge search empty: ${JSON.stringify(found)}`);
    }
  },
};
