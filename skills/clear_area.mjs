// 整地 (D30): 現在の足元レベルより上にあるブロックを半径内で掘って
// 平らにする。列ごとに上から掘る。fill (埋め立て) は v1 未対応。
export default {
  name: 'clear_area',
  description:
    'Clear/flatten an area: dig every block above the current ' +
    'feet level within a radius, column by column from the top. ' +
    'Filling low spots is not supported yet.',
  params: {
    radius: { type: 'integer', required: false, description: 'radius in blocks (default 6, max 8)' },
    max_blocks: { type: 'integer', required: false, description: 'safety cap (default 200)' },
  },
  async run(ctx, { radius = 6, max_blocks = 200 }) {
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
    await ctx.say(`整地終わり。${cleared}ブロック掘って平らにした`);
    return { done: true, cleared, columns, level, capped: cleared >= max_blocks };
  },
};
