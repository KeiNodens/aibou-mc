// schematic実建築 (P5): .litematic/.schem の計画列 (y下から順) に沿って
// ブロックを置いていく。既に正しいブロックがある位置はスキップするので、
// 中断してもワールド状態を見て続きから再開できる (冪等)。
// 制約: 置くアイテムがホットバーにあるものだけ対応。1回の実行は max_blocks まで。
const FACES = [
  { dx: 0, dy: -1, dz: 0, face: 'up' },     // 下のブロックの上面に置く (基本)
  { dx: 1, dy: 0, dz: 0, face: 'west' },
  { dx: -1, dy: 0, dz: 0, face: 'east' },
  { dx: 0, dy: 0, dz: 1, face: 'north' },
  { dx: 0, dy: 0, dz: -1, face: 'south' },
  { dx: 0, dy: 1, dz: 0, face: 'down' },
];

export default {
  name: 'build_schematic',
  description:
    'Build from a .litematic/.schem file at an origin, bottom layer first. ' +
    'Idempotent: positions already holding the right block are skipped, so ' +
    're-running resumes. Block items must be in the hotbar. Places at most ' +
    'max_blocks per run.',
  params: {
    file: { type: 'string', required: true, description: 'schematic file path (on the bridge PC)' },
    x: { type: 'integer', required: true, description: 'origin X (schematic 0,0,0 goes here)' },
    y: { type: 'integer', required: true, description: 'origin Y' },
    z: { type: 'integer', required: true, description: 'origin Z' },
    max_blocks: { type: 'integer', required: false, description: 'max placements this run (default 64)' },
  },
  async run(ctx, { file, x, y, z, max_blocks = 64 }) {
    const plan = await ctx.schematicPlan(file);
    if (!plan?.blocks?.length) return { done: false, reason: 'empty_plan' };
    let placed = 0;
    let skipped = 0;
    let missing = 0;
    let failed = 0;
    for (const b of plan.blocks) {
      if (placed >= max_blocks) break;
      ctx.throwIfCancelled();
      const wx = x + b.x, wy = y + b.y, wz = z + b.z;
      const cur = await ctx.call('obs.block_state', { x: wx, y: wy, z: wz })
        .catch(() => null);
      if (cur?.block === b.id) { skipped++; continue; }
      if (cur && cur.block !== 'minecraft:air'
        && cur.block !== 'minecraft:cave_air'
        && cur.block !== 'minecraft:void_air') {
        failed++; // 別のブロックが占有している — 勝手に壊さない
        continue;
      }
      const st = await ctx.state();
      const slot = (st.inventory_detail ?? []).find(
        (s) => s.id === b.id && s.slot <= 8);
      if (!slot) { missing++; continue; }

      const g = await ctx.call('baritone.goto', { x: wx, y: wy, z: wz })
        .catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 30_000);
      await ctx.call('equip', { slot: slot.slot });
      await ctx.call('look_at', { x: wx, y: wy, z: wz }).catch(() => {});

      let ok = false;
      for (const f of FACES) {
        const sx = wx + f.dx, sy = wy + f.dy, sz = wz + f.dz;
        const sup = await ctx.call('obs.block_state', { x: sx, y: sy, z: sz })
          .catch(() => null);
        if (!sup || sup.block === 'minecraft:air') continue;
        const r = await ctx.call('use_item', {
          x: sx, y: sy, z: sz, face: f.face,
        }).catch(() => null);
        if (!r) continue;
        const after = await ctx.call('obs.block_state', { x: wx, y: wy, z: wz })
          .catch(() => null);
        if (after?.block === b.id) { ok = true; break; }
      }
      if (ok) {
        placed++;
        ctx.journal?.checkpoint(`placed_${placed}`, { id: b.id, x: wx, y: wy, z: wz });
      } else {
        failed++;
      }
    }
    const remaining = plan.total - placed - skipped;
    await ctx.say(
      `建築: ${placed}個置いた (既設${skipped} / 残り約${remaining})` +
      (missing ? ` 材料がホットバーに無いものが${missing}箇所` : ''));
    return { done: remaining <= 0, placed, skipped, missing, failed, remaining, total: plan.total };
  },
};
