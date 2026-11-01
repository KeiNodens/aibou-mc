// schematic実建築 v3 (D32/D39): 計画と回転は bridge、配置ループは
// mod 側 BuildTask。mirror は回転の前に適用。建築後は定義に
// commission plan を持つ機械へ自動で commission を実行する。
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const MACHINES_DIR = new URL('../machines/', import.meta.url);
let commissionBlocksCache = null;
function commissionBlocks() {
  if (commissionBlocksCache) return commissionBlocksCache;
  const set = new Set();
  try {
    for (const f of readdirSync(MACHINES_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const d = JSON.parse(readFileSync(new URL(f, MACHINES_DIR), 'utf8'));
        if (d?.block && Array.isArray(d.commission) && d.commission.length) {
          set.add(d.block);
        }
      } catch { /* skip broken def */ }
    }
  } catch { /* machines dir unreadable: no auto-commission */ }
  commissionBlocksCache = set;
  return set;
}

function mirrorPoint(x, z, size, mirror) {
  if (mirror === 'x') return { x: size.x - 1 - x, z };
  if (mirror === 'z') return { x, z: size.z - 1 - z };
  return { x, z };
}
function mirrorProps(props, mirror) {
  if (!props) return props;
  const out = { ...props };
  if (out.facing) {
    if (mirror === 'x') {
      out.facing = { east: 'west', west: 'east' }[out.facing] ?? out.facing;
    }
    if (mirror === 'z') {
      out.facing = { north: 'south', south: 'north' }[out.facing] ?? out.facing;
    }
  }
  return out;
}

// schematic実建築 v3 (D32): 計画と回転は bridge、配置ループは
// mod 側 BuildTask が消化する (D23/S4 の v2 から移行)。
// - rotation (0/90/180/270): 座標と facing/axis props を回転 (bridge)
// - 配置・在庫内移動・facing の立ち位置・設置後検証は BuildTask
// - 冪等 (設置済みは skip)、占有セルは壊さない (どちらもタスク側)
const FACING_ORDER = ['north', 'east', 'south', 'west'];
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
    mirror: { type: 'string', required: false, description: 'mirror axis before rotation: x | z (default none)' },
    commission: { type: 'boolean', required: false, description: 'after building, run commission plans for placed machines whose definitions have one (default true)' },
    max_blocks: { type: 'integer', required: false, description: 'max placements this run (default 64)' },
    mode: { type: 'string', required: false, description: 'auto (default) / together / solo — together: per-batch progress + material shortage lines' },
  },
  async run(ctx, { file, x, y, z, rotation = 0, max_blocks = 64, mode = 'auto', mirror, commission = true }) {
    // 同伴判定 (D36): 近くにプレイヤーがいたら進捗を逐次知らせる
    let together = mode === 'together';
    if (mode === 'auto') {
      const stB = await ctx.state().catch(() => null);
      const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
      const all = ents(await ctx.call('obs.entity', { name: 'minecraft:player', radius: 32 }).catch(() => null));
      together = all.some((e) => e.name && e.name !== stB?.name);
    }
    const announcedMissing = new Set();
    const plan = await ctx.schematicPlan(file);
    if (!plan?.blocks?.length) return { done: false, reason: 'empty_plan' };
    const rot = [0, 90, 180, 270].includes(rotation) ? rotation : 0;
    const blocks = plan.blocks.map((b) => {
      let out = b;
      if (mirror === 'x' || mirror === 'z') {
        const mp = mirrorPoint(b.x, b.z, plan.size, mirror);
        out = { ...out, x: mp.x, z: mp.z, props: mirrorProps(b.props, mirror) };
      }
      if (!rot) return out;
      const p = rotatePoint(out.x, out.z, plan.size, rot);
      return { ...out, x: p.x, z: p.z, props: rotateProps(out.props, rot) };
    });
    // Review F3: apply max_blocks AFTER removing blocks that are
    // already placed. Slicing the raw plan first made every re-run
    // re-send the same first chunk, so plans larger than max_blocks
    // never progressed. Already-placed uses BuildTask's own rule:
    // same id and props subset match.
    let placed = 0;
    let skipped = 0;
    const placements = [];
    for (const b of blocks) {
      if (AIRS.has(b.id)) continue;
      if (placements.length >= max_blocks) break;
      const wx = x + b.x, wy = y + b.y, wz = z + b.z;
      const cur = await ctx.call('obs.block_state', { x: wx, y: wy, z: wz }).catch(() => null);
      if (cur?.block === b.id) {
        const propsOk = !b.props || Object.entries(b.props)
          .every(([k, v]) => String(cur.properties?.[k]) === String(v));
        if (propsOk) { skipped++; continue; }
      }
      placements.push({
        x: wx, y: wy, z: wz, id: b.id,
        ...(b.props ? { props: b.props } : {}),
      });
    }
    let failed = 0;
    let mismatchedCount = 0;
    const mismatchedAt = [];
    const missingItems = new Set();
    const BATCH = 96;
    for (let i = 0; i < placements.length; i += BATCH) {
      ctx.throwIfCancelled();
      const batch = placements.slice(i, i + BATCH);
      const t = await ctx.call('build.place', { blocks: batch })
        .catch(() => null);
      if (!t?.task_id) {
        return { done: false, reason: 'build_op_unavailable', placed, skipped };
      }
      const doneEv = await ctx.waitTask(
        t.task_id, batch.length * 20_000 + 120_000).catch(() => null);
      const r = doneEv?.result ?? {};
      placed += r.placed ?? 0;
      skipped += r.skipped ?? 0;
      failed += r.failed ?? 0;
      mismatchedCount += r.mismatched ?? 0;
      for (const m of r.mismatched_at ?? []) mismatchedAt.push(m);
      for (const mi of r.missing_items ?? []) missingItems.add(mi);
      ctx.journal?.checkpoint(`build_batch_${i / BATCH}`, { placed, skipped });
      if (together) {
        for (const mi of r.missing_items ?? []) {
          if (!announcedMissing.has(mi)) {
            announcedMissing.add(mi);
            await ctx.say(`材料が無い: ${mi}`).catch(() => {});
          }
        }
        if (i + BATCH < placements.length) {
          await ctx.say(`建築 ${placed + skipped}/${placements.length}`).catch(() => {});
        }
      }
      if (doneEv?.state !== 'succeeded') break;
    }
    // 建築後 commission (D39): 定義に plan を持つ機械が置かれて
    // いたら、その場で初期設定まで済ませる
    const commissioned = [];
    if (commission && (placed + skipped) > 0 && ctx.commission) {
      const targets = commissionBlocks();
      if (targets.size) {
        const seenPos = new Set();
        for (const pl of placements) {
          if (!targets.has(pl.id)) continue;
          const key = `${pl.x},${pl.y},${pl.z}`;
          if (seenPos.has(key)) continue;
          seenPos.add(key);
          if (commissioned.length >= 16) break;
          const r = await ctx.commission(pl.x, pl.y, pl.z).catch(() => null);
          commissioned.push({ x: pl.x, y: pl.y, z: pl.z, block: pl.id, ok: !!r?.ok });
        }
        if (commissioned.length && commissioned.every((c) => c.ok)) {
          await ctx.say('置いた機械の設定も済ませたよ').catch(() => {});
        }
      }
    }
    const remaining = plan.total - placed - skipped;
    await ctx.say(
      `建築: ${placed}個置いた (既設${skipped} / 残り約${remaining})` +
      (missingItems.size ? ` 材料が無いもの: ${[...missingItems].join(', ')}` : '') +
      (mismatchedCount ? ` 向き違いが${mismatchedCount}箇所` : ''));
    return {
      done: remaining <= 0, placed, skipped, failed,
      missing: missingItems.size, missing_items: [...missingItems],
      mismatched: mismatchedAt.slice(0, 20), mismatched_count: mismatchedCount,
      remaining, total: plan.total, via: 'build_task',
      commissioned,
    };
  },
};
