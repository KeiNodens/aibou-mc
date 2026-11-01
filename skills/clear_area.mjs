// 整地 (D30/D37): 現在の足元レベルより上にあるブロックを半径内で
// 掘って平らにする。fill=true では窪地を指定レベルまで埋める
// (配置は BuildTask に委譲、材料は所持品から)。
export default {
  name: 'clear_area',
  description:
    'Clear/flatten an area: dig every block above the current ' +
    'feet level within a radius, column by column from the top. ' +
    'With fill=true, depressions below the level are also filled ' +
    'up to the level using filler blocks from the inventory ' +
    '(dirt preferred, then cobblestone).',
  params: {
    radius: { type: 'integer', required: false, description: 'radius in blocks (default 6, max 8)' },
    max_blocks: { type: 'integer', required: false, description: 'safety cap (default 200)' },
    fill: { type: 'boolean', required: false, description: 'also fill depressions up to the level (default false)' },
    filler: { type: 'string', required: false, description: 'filler item id (default: dirt, then cobblestone, from inventory)' },
  },
  async run(ctx, { radius = 6, max_blocks = 200, fill = false, filler }) {
    const R = Math.min(radius, 8);
    const st = await ctx.state();
    const cx = Math.floor(st.pos.x), level = Math.floor(st.pos.y), cz = Math.floor(st.pos.z);
    let cleared = 0;
    let columns = 0;
    outer:
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > R * R) continue;
        ctx.throwIfCancelled();
        const x = cx + dx, z = cz + dz;
        const targets = [];
        for (let y = level + 6; y > level; y--) {
          const bs = await ctx.call('obs.block_state', { x, y, z }).catch(() => null);
          if (bs?.id && bs.id !== 'minecraft:air' && bs.id !== 'minecraft:water') {
            targets.push({ x, y, z, id: bs.id });
          }
        }
        if (!targets.length) continue;
        columns++;
        const g = await ctx.call('baritone.goto', { x, y: level, z }).catch(() => null);
        if (g?.task_id) await ctx.waitTask(g.task_id, 25_000).catch(() => null);
        for (const t of targets) {
          await ctx.call('dig', { x: t.x, y: t.y, z: t.z }).catch(() => {});
          cleared++;
          await ctx.sleep(380);
          if (cleared >= max_blocks) break outer;
        }
      }
    }
    // fill: 目標レベルより低い列を埋める (D37)
    let filled = 0;
    let fillerUsed = null;
    let fillerMissing = 0;
    if (fill) {
      const stF = await ctx.state().catch(() => null);
      const summary = stF?.inventory ?? stF?.inventory_summary ?? {};
      const FILLERS = ['minecraft:dirt', 'minecraft:cobblestone',
        'minecraft:cobbled_deepslate', 'minecraft:stone', 'minecraft:gravel'];
      const fid = filler ?? FILLERS.find((f) => (summary[f] ?? 0) > 0);
      const spots = [];
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          if (dx * dx + dz * dz > R * R) continue;
          ctx.throwIfCancelled();
          const x = cx + dx, z = cz + dz;
          let top = null;
          let wet = false;
          for (let y = level - 1; y >= level - 6; y--) {
            const bs = await ctx.call('obs.block_state', { x, y, z }).catch(() => null);
            const id = bs?.id;
            if (id === 'minecraft:water') { wet = true; break; }
            if (id && id !== 'minecraft:air') { top = y; break; }
            if (y === level - 6) top = level - 7;
          }
          if (wet || top == null || top >= level - 1) continue;
          for (let y = top + 1; y <= level - 1; y++) spots.push({ x, y, z });
        }
      }
      if (spots.length && fid) {
        const avail = summary[fid] ?? 0;
        const use = spots.slice(0, Math.min(avail, max_blocks));
        fillerMissing = spots.length - use.length;
        if (use.length) {
          const t = await ctx.call('build.place', {
            blocks: use.map((s2) => ({ ...s2, id: fid })),
          }).catch(() => null);
          if (t?.task_id) {
            const ev = await ctx.waitTask(t.task_id, use.length * 5_000 + 30_000).catch(() => null);
            filled = ev?.result?.placed ?? 0;
            fillerUsed = fid;
          }
        }
      } else if (spots.length) {
        fillerMissing = spots.length;
      }
    }
    await ctx.say(`整地終わり。${cleared}ブロック掘って平らにした` +
      (fill ? ` / 窪地を${filled}ブロック埋めた` +
        (fillerMissing ? ` (材料不足で${fillerMissing}ブロック残り)` : '') : ''));
    return {
      done: true, cleared, columns, level, capped: cleared >= max_blocks,
      filled, filler_used: fillerUsed, filler_missing: fillerMissing,
    };
  },
};
