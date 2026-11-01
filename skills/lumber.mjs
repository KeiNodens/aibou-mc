// 伐採 (D39): 最寄りの木を幹ごと切る。幹のセルを下から順に掘り、
// 周囲を再スキャンして 1 本分 (幹の塊) が無くなるまで続ける。
// 葉は自然消滅に任せる。巨木 (2x2 ジャングル等) は塊判定に含む。
// 任意で同じ種類の苗木を植え直す (苗木と土が必要)。
const TREES = [
  ['minecraft:oak_log', 'minecraft:oak_sapling'],
  ['minecraft:spruce_log', 'minecraft:spruce_sapling'],
  ['minecraft:birch_log', 'minecraft:birch_sapling'],
  ['minecraft:jungle_log', 'minecraft:jungle_sapling'],
  ['minecraft:acacia_log', 'minecraft:acacia_sapling'],
  ['minecraft:dark_oak_log', 'minecraft:dark_oak_sapling'],
  ['minecraft:mangrove_log', 'minecraft:mangrove_propagule'],
  ['minecraft:cherry_log', 'minecraft:cherry_sapling'],
];

export default {
  name: 'lumber',
  description:
    'Chop down the nearest tree(s): find logs within a radius, ' +
    'walk to the trunk, and dig the trunk column bottom-up, ' +
    're-scanning until the trunk cluster is gone. Leaves are left ' +
    'to decay. Optionally replants a sapling of the same species.',
  params: {
    radius: { type: 'integer', required: false, description: 'search radius (default 24)' },
    max_logs: { type: 'integer', required: false, description: 'safety cap on logs (default 48)' },
    trees: { type: 'integer', required: false, description: 'how many trees (default 1)' },
    replant: { type: 'boolean', required: false, description: 'replant a sapling (default false)' },
  },
  async run(ctx, { radius = 24, max_logs = 48, trees = 1, replant = false }) {
    let chopped = 0;
    let treesDone = 0;
    for (let t = 0; t < trees; t++) {
      ctx.throwIfCancelled();
      // 最寄りの幹を探す
      let seed = null;
      let seedSapling = null;
      for (const [log, sapling] of TREES) {
        const r = await ctx.call('obs.block', { block: log, radius }).catch(() => null);
        for (const f of r?.found ?? []) {
          if (!seed || (f.dist ?? 99) < (seed.dist ?? 99)) {
            seed = { ...f, id: log };
            seedSapling = sapling;
          }
        }
      }
      if (!seed) break;
      const g = await ctx.call('baritone.goto', {
        x: seed.x + 1, y: seed.y, z: seed.z,
      }).catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 30_000).catch(() => null);
      // 幹の塊 (水平 ±1) を下から掘る。再スキャンで続きを取る
      let guard = 0;
      let baseCell = null;
      while (guard++ < 24 && chopped < max_logs) {
        ctx.throwIfCancelled();
        const cells = [];
        for (const [log] of TREES) {
          const r = await ctx.call('obs.block', { block: log, radius: 3 }).catch(() => null);
          for (const f of r?.found ?? []) {
            if (Math.abs(f.x - seed.x) <= 1 && Math.abs(f.z - seed.z) <= 1) {
              cells.push(f);
            }
          }
        }
        if (!cells.length) break;
        cells.sort((a, b) => a.y - b.y);
        const c = cells[0];
        baseCell = baseCell ?? c;
        await ctx.call('dig', { x: c.x, y: c.y, z: c.z }).catch(() => {});
        await ctx.sleep(380);
        // D59/P2-14: 掘れたかをセル再観測で確認してから数える
        // (旧実装は dig の成否を見ずに数え、全失敗でも報告が水増しされた)
        const chk = await ctx.call('obs.block_state', { x: c.x, y: c.y, z: c.z })
          .catch(() => null);
        if (!chk?.block || chk.block === 'minecraft:air') chopped++;
      }
      treesDone++;
      if (replant && baseCell && seedSapling) {
        const st = await ctx.state().catch(() => null);
        const have = (st?.inventory ?? {})[seedSapling] ?? 0;
        if (have > 0) {
          await ctx.call('equip', { item: seedSapling }).catch(() => {});
          await ctx.call('use_item', {
            x: baseCell.x, y: baseCell.y - 1, z: baseCell.z, face: 'up',
          }).catch(() => {});
        }
      }
    }
    await ctx.say(chopped
      ? `伐採終わり。原木を ${chopped} 本分切った (${treesDone} 本)`
      : '近くに切れる木が無いみたい');
    return { done: chopped > 0, chopped, trees: treesDone };
  },
};
