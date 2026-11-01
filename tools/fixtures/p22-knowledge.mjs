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
    // Review F6: mod id must not escape the knowledge dir.
    // D59/P2-24: 旧検査は外側に marker が実在しないため空転していた
    // (F6 の検証コードを消しても ENOENT で合格してしまう)。実 marker を
    // 候補位置に置き、「読めたら失敗」を本当に成立させる
    const { rmSync, rmdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    h.writefile('outside/marker.txt', 'FIXTURE_SECRET');
    h.writefile('../outside/marker.txt', 'FIXTURE_SECRET');
    try {
      const esc = await h.mcp('knowledge', { action: 'get', mod: '../outside', path: 'marker.txt' }).catch((e) => ({ error: String(e) }));
      if (esc && !esc.error && typeof esc.text === 'string') {
        throw new Error(`knowledge get escaped the knowledge dir: ${JSON.stringify(esc).slice(0, 120)}`);
      }
      // 陽性対照: 正常な get が実際に本文を返せること (get 全滅の退行検出)
      const inside = await h.mcp('knowledge', { action: 'get', mod: '.', path: 'index.json' }).catch((e) => ({ error: String(e) }));
      if (!inside || inside.error || typeof inside.text !== 'string'
        || !inside.text.includes('jade')) {
        throw new Error(`knowledge get positive control failed: ${JSON.stringify(inside).slice(0, 160)}`);
      }
    } finally {
      for (const rel of ['outside', '../outside']) {
        try { rmSync(join(h.workdir, rel, 'marker.txt'), { force: true }); } catch {}
        try { rmdirSync(join(h.workdir, rel)); } catch {}
      }
    }
  },
};
