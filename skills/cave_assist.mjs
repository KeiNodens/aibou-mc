// 一緒に洞窟探索 (D30): プレイヤーに随行し、松明で照らし、近くの
// 鉱石を手伝って掘り、敵が近づいたら一緒に戦う。移動経路 (crumbs) を
// data/cave-trail.json に残し、lead_back で入口まで案内できるようにする。
// 敵対判定はバニラの既知リストのみ (mod 敵は v1 では自動で殴らない)。
import { writeFile } from 'node:fs/promises';

const HOSTILES = new Set([
  'minecraft:zombie', 'minecraft:drowned', 'minecraft:husk',
  'minecraft:skeleton', 'minecraft:stray', 'minecraft:creeper',
  'minecraft:spider', 'minecraft:cave_spider', 'minecraft:witch',
  'minecraft:pillager', 'minecraft:vindicator', 'minecraft:blaze',
  'minecraft:magma_cube', 'minecraft:slime', 'minecraft:phantom',
  'minecraft:silverfish', 'minecraft:endermite',
]);
const ORES = [
  'minecraft:coal_ore', 'minecraft:deepslate_coal_ore',
  'minecraft:iron_ore', 'minecraft:deepslate_iron_ore',
  'minecraft:copper_ore', 'minecraft:deepslate_copper_ore',
  'minecraft:gold_ore', 'minecraft:deepslate_gold_ore',
  'minecraft:redstone_ore', 'minecraft:deepslate_redstone_ore',
  'minecraft:lapis_ore', 'minecraft:deepslate_lapis_ore',
  'minecraft:diamond_ore', 'minecraft:deepslate_diamond_ore',
  'minecraft:emerald_ore', 'minecraft:deepslate_emerald_ore',
  'minecraft:nether_gold_ore', 'minecraft:nether_quartz_ore',
  'minecraft:ancient_debris',
];
const TRAIL_URL = new URL('../data/cave-trail.json', import.meta.url);

const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
const eid = (e) => e.entity_id ?? e.id;
const etype = (e) => e.type ?? e.name;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function gotoNear(ctx, p, timeout = 25_000) {
  const g = await ctx.call('baritone.goto', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }).catch(() => null);
  if (g?.task_id) await ctx.waitTask(g.task_id, timeout).catch(() => null);
}
function hotbarSlot(state, item) {
  return (state?.inventory_detail ?? []).find((s) => s.id === item && s.slot <= 8);
}

export default {
  name: 'cave_assist',
  description:
    'Cave/mine together with the player: follows them, places torches, ' +
    'helps mine nearby ore veins, and fights vanilla hostiles that come ' +
    'close. Records an entry waypoint (cave_entry) and a breadcrumb ' +
    'trail for lead_back. Modded hostiles are not auto-engaged in v1.',
  params: {
    player: { type: 'string', required: false, description: 'player name (default: nearest other player)' },
    minutes: { type: 'integer', required: false, description: 'duration in minutes (default 10, max 30)' },
    seconds: { type: 'integer', required: false, description: 'duration override in seconds (testing)' },
    fight: { type: 'boolean', required: false, description: 'engage hostiles (default true)' },
    ores: { type: 'boolean', required: false, description: 'help mine ores (default true)' },
    torches: { type: 'boolean', required: false, description: 'place torches (default true; needs torches in hotbar)' },
  },
  async run(ctx, { player, minutes = 10, seconds, fight = true, ores = true, torches = true }) {
    const durMs = Math.min(seconds ? seconds * 1000 : minutes * 60_000, 30 * 60_000);
    const deadline = Date.now() + durMs;
    const st0 = await ctx.state().catch(() => null);
    const botName = st0?.name;
    const entry = st0?.pos ? { x: Math.floor(st0.pos.x), y: Math.floor(st0.pos.y), z: Math.floor(st0.pos.z) } : null;
    const crumbs = entry ? [entry] : [];
    if (entry) {
      await ctx.call('waypoint.set', { name: 'cave_entry', ...entry }).catch(() => {});
    }
    const visited = new Set();
    let torchesPlaced = 0;
    let oresMined = 0;
    let fights = 0;
    let lastTorch = null;
    let tick = 0;
    const saveTrail = async () => {
      try {
        await writeFile(TRAIL_URL, JSON.stringify({ at: new Date().toISOString(), entry, crumbs }, null, 2));
      } catch { /* 保存失敗は致命的でない */ }
      ctx.journal?.note('cave_trail', { entry, crumbs: crumbs.length });
    };
    try {
      while (Date.now() < deadline) {
        ctx.throwIfCancelled();
        tick++;
        const st = await ctx.state().catch(() => null);
        const me = st?.pos;
        if (!me) { await ctx.sleep(1200); continue; }
        const last = crumbs[crumbs.length - 1];
        if (!last || dist(me, last) >= 4) {
          crumbs.push({ x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) });
          if (crumbs.length % 25 === 0) await saveTrail();
        }
        // プレイヤー位置
        let pl = null;
        if (player) {
          pl = ents(await ctx.call('obs.entity', { name: player }).catch(() => null))[0] ?? null;
        } else {
          const all = ents(await ctx.call('obs.entity', {}).catch(() => null));
          pl = all.find((e) => etype(e) === 'minecraft:player' && e.name !== botName) ?? null;
        }
        if (!pl) { await ctx.sleep(1200); continue; }
        // 戦闘: プレイヤー7m以内 or 自分5m以内の敵がいたら
        // mod 側 CombatTask (D31) に力学を任せる
        if (fight) {
          const all = ents(await ctx.call('obs.entity', {}).catch(() => null));
          const foe = all.find((e) => HOSTILES.has(etype(e)) &&
            (dist(e, pl) <= 7 || dist(e, me) <= 5));
          if (foe) {
            fights++;
            const eng = await ctx.call('combat.engage', {
              types: [...HOSTILES],
              anchor_entity_id: eid(pl),
              leash: 16,
              max_seconds: 45,
              hp_abort: 4,
            }).catch(() => null);
            if (eng?.task_id) {
              await ctx.waitTask(eng.task_id, 50_000).catch(() => null);
            }
            continue;
          }
        }
        // 追随
        if (dist(me, pl) > 6) {
          await gotoNear(ctx, pl);
          continue;
        }
        // 松明
        if (torches && (!lastTorch || dist(me, lastTorch) >= 7.5)) {
          const slot = hotbarSlot(st, 'minecraft:torch');
          if (slot) {
            await ctx.call('equip', { slot: slot.slot }).catch(() => {});
            const bx = Math.floor(me.x), by = Math.floor(me.y), bz = Math.floor(me.z);
            await ctx.call('use_item', { x: bx, y: by - 1, z: bz, face: 'up' }).catch(() => {});
            const chk = await ctx.call('obs.block_state', { x: bx, y: by, z: bz }).catch(() => null);
            if (chk?.id === 'minecraft:torch' || chk?.id === 'minecraft:wall_torch') {
              torchesPlaced++;
              lastTorch = { ...me };
            }
          }
        }
        // 鉱石手伝い (6 tick に 1 回)
        if (ores && tick % 6 === 0) {
          let target = null;
          for (const ore of ORES) {
            const f = await ctx.call('obs.block', { block: ore, radius: 10 }).catch(() => null);
            for (const s of f?.found ?? []) {
              const key = `${s.x},${s.y},${s.z}`;
              if (!visited.has(key) && dist(me, s) <= 11) {
                if (!target || dist(me, s) < dist(me, target)) target = { ...s, id: ore };
              }
            }
          }
          if (target) {
            await gotoNear(ctx, target);
            for (let n = 0; n < 6; n++) {
              const f = await ctx.call('obs.block', { block: target.id, radius: 3 }).catch(() => null);
              const spot = (f?.found ?? [])[0];
              if (!spot) break;
              visited.add(`${spot.x},${spot.y},${spot.z}`);
              await ctx.call('dig', { x: spot.x, y: spot.y, z: spot.z }).catch(() => {});
              oresMined++;
              await ctx.sleep(500);
            }
            await gotoNear(ctx, pl).catch(() => {});
            continue;
          }
        }
        await ctx.sleep(1200);
      }
    } finally {
      await saveTrail();
    }
    await ctx.say(`洞窟おつかれ。松明${torchesPlaced}本、鉱石${oresMined}個手伝って、戦闘${fights}回。帰り道は覚えてるよ`);
    return { done: true, entry, crumbs: crumbs.length, torches: torchesPlaced, ores_mined: oresMined, fights };
  },
};
