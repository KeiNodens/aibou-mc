// schematic実建築 v2 (D23/S4): .litematic/.schem の計画列に沿って置く。
// 冪等 (正しいブロック+state の位置はスキップ)。v2 の追加:
// - rotation (0/90/180/270): 座標と facing/axis props を回転させる
// - props 検証: id が合っても state が違う場合は mismatched として報告
// - facing 付きブロックは、向きが合うよう bot の立ち位置を合わせてから置く
// - ホットバー自動補充: 在庫 (9-35) から swap でホットバーへ回す
const FACES = [
  { dx: 0, dy: -1, dz: 0, face: 'up' },     // 下のブロックの上面に置く (基本)
  { dx: 1, dy: 0, dz: 0, face: 'west' },
  { dx: -1, dy: 0, dz: 0, face: 'east' },
  { dx: 0, dy: 0, dz: 1, face: 'north' },
  { dx: 0, dy: 0, dz: -1, face: 'south' },
  { dx: 0, dy: 1, dz: 0, face: 'down' },
];
const FACING_ORDER = ['north', 'east', 'south', 'west'];
const FACING_VEC = {
  north: { x: 0, z: -1 }, south: { x: 0, z: 1 },
  east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
};
const AIRS = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

function rotatePoint(x, z, size, rot) {
  switch (rot) {
    case 90: return { x: size.z - 1 - z, z: x };
    case 180: return { x: size.x - 1 - x, z: size.z - 1 - z };
    case 270: return { x: z, z: size.x - 1 - x };
    default: return { x, z };
  }
}

function rotateProps(props, rot) {
  if (!props || !rot) return props;
  const out = { ...props };
  if (out.facing && FACING_ORDER.includes(out.facing)) {
    const steps = rot / 90;
    out.facing = FACING_ORDER[
      (FACING_ORDER.indexOf(out.facing) + steps) % 4];
  }
  if ((rot === 90 || rot === 270) && (out.axis === 'x' || out.axis === 'z'))
    out.axis = out.axis === 'x' ? 'z' : 'x';
  return out;
}

function propsMatch(want, got) {
  if (!want) return true;
  if (!got) return false;
  return Object.entries(want).every(([k, v]) => String(got[k]) === String(v));
}

/** item をホットバーへ用意する。在庫にあれば swap で回す。無ければ null */
async function ensureHotbar(ctx, itemId) {
  const st = await ctx.state().catch(() => null);
  const detail = st?.inventory_detail ?? [];
  const hot = detail.find((s) => s.id === itemId && s.slot <= 8 && !s.empty);
  if (hot) return hot.slot;
  const inv = detail.find((s) => s.id === itemId && s.slot > 8 && !s.empty);
  if (!inv) return null;
  const usedHot = new Set(
    detail.filter((s) => s.slot <= 8 && !s.empty).map((s) => s.slot));
  let target = 8;
  for (let i = 0; i <= 8; i++) if (!usedHot.has(i)) { target = i; break; }
  const read = await ctx.call('container.read').catch(() => null);
  if (read?.menu_id !== 'player_inventory') return null;
  await ctx.call('container.click', {
    slot: inv.slot, action: 'swap', button: target, menu_id: read.menu_id,
  });
  await ctx.sleep(200);
  return target;
}

export default {
  name: 'build_schematic',
  description:
    'Build from a .litematic/.schem file at an origin, bottom layer first. ' +
    'Idempotent: positions already holding the right block (and blockstate, ' +
    'when the plan specifies props) are skipped. Supports rotation ' +
    '(0/90/180/270), verifies placed blockstates and reports mismatches, ' +
    'restocks the hotbar from the inventory, and positions the bot so ' +
    'facing-sensitive blocks (stairs, furnaces...) face the planned way. ' +
    'Places at most max_blocks per run.',
  params: {
    file: { type: 'string', required: true, description: 'schematic file path (on the bridge PC)' },
    x: { type: 'integer', required: true, description: 'origin X (schematic 0,0,0 goes here)' },
    y: { type: 'integer', required: true, description: 'origin Y' },
    z: { type: 'integer', required: true, description: 'origin Z' },
    rotation: { type: 'integer', required: false, description: '0/90/180/270 (clockwise from above, default 0)' },
    max_blocks: { type: 'integer', required: false, description: 'max placements this run (default 64)' },
  },
  async run(ctx, { file, x, y, z, rotation = 0, max_blocks = 64 }) {
    const plan = await ctx.schematicPlan(file);
    if (!plan?.blocks?.length) return { done: false, reason: 'empty_plan' };
    const rot = [0, 90, 180, 270].includes(rotation) ? rotation : 0;
    const blocks = plan.blocks.map((b) => {
      if (!rot) return b;
      const p = rotatePoint(b.x, b.z, plan.size, rot);
      return { ...b, x: p.x, z: p.z, props: rotateProps(b.props, rot) };
    });
    let placed = 0;
    let skipped = 0;
    let missing = 0;
    let failed = 0;
    const mismatched = [];
    for (const b of blocks) {
      if (placed >= max_blocks) break;
      ctx.throwIfCancelled();
      const wx = x + b.x, wy = y + b.y, wz = z + b.z;
      const cur = await ctx.call('obs.block_state', { x: wx, y: wy, z: wz })
        .catch(() => null);
      if (cur?.block === b.id) {
        if (b.props && !propsMatch(b.props, cur.properties)) {
          mismatched.push({ id: b.id, x: wx, y: wy, z: wz, want: b.props, got: cur.properties });
        } else skipped++;
        continue;
      }
      if (cur && !AIRS.has(cur.block)) {
        failed++; // 別のブロックが占有している — 勝手に壊さない
        continue;
      }
      const slot = await ensureHotbar(ctx, b.id);
      if (slot == null) { missing++; continue; }

      // facing 指定があるブロックは、bot が「向きの反対側」に立って
      // 目標を見て置くと向きが合いやすい (バニラの配置規則)
      const fv = b.props?.facing ? FACING_VEC[b.props.facing] : null;
      const stand = fv
        ? { x: wx - fv.x, y: wy, z: wz - fv.z }
        : { x: wx, y: wy, z: wz };
      const g = await ctx.call('baritone.goto', stand).catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 30_000);
      await ctx.call('equip', { slot });
      await ctx.call('look_at', { x: wx, y: wy, z: wz }).catch(() => {});

      let ok = false;
      for (const f of FACES) {
        const sx = wx + f.dx, sy = wy + f.dy, sz = wz + f.dz;
        const sup = await ctx.call('obs.block_state', { x: sx, y: sy, z: sz })
          .catch(() => null);
        if (!sup || AIRS.has(sup.block)) continue;
        const r = await ctx.call('use_item', {
          x: sx, y: sy, z: sz, face: f.face,
        }).catch(() => null);
        if (!r) continue;
        const after = await ctx.call('obs.block_state', { x: wx, y: wy, z: wz })
          .catch(() => null);
        if (after?.block === b.id) {
          ok = true;
          if (b.props && !propsMatch(b.props, after.properties))
            mismatched.push({ id: b.id, x: wx, y: wy, z: wz, want: b.props, got: after.properties });
          break;
        }
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
      (missing ? ` 材料が無いものが${missing}箇所` : '') +
      (mismatched.length ? ` 向き違いが${mismatched.length}箇所` : ''));
    return {
      done: remaining <= 0, placed, skipped, missing, failed,
      mismatched: mismatched.slice(0, 20), mismatched_count: mismatched.length,
      remaining, total: plan.total,
    };
  },
};
