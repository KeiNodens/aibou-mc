// 一緒に洞窟探索 (D30): プレイヤーに随行し、松明で照らし、近くの
// 鉱石を手伝って掘り、敵が近づいたら一緒に戦う。移動経路 (crumbs) を
// data/cave-trail.json に残し、lead_back で入口まで案内できるようにする。
// 敵対判定はバニラの既知リストのみ (mod 敵は v1 では自動で殴らない)。
import { writeFile, readFile } from 'node:fs/promises';

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
// 発見を分かち合う鉱石: together では自動で掘らず、知らせて残す。
// solo では通常通り掘るが、発見自体は journal に残す (LLM が後で拾える)。
const NOTABLE = new Map([
  ['minecraft:diamond_ore', 'ダイヤ'],
  ['minecraft:deepslate_diamond_ore', 'ダイヤ'],
  ['minecraft:emerald_ore', 'エメラルド'],
  ['minecraft:deepslate_emerald_ore', 'エメラルド'],
  ['minecraft:ancient_debris', '古代の残骸'],
]);
// 次元別の敵対テーブル (D45): ネザーはウィザースケ/ブレイズ/
// ホグリン/ブルート (ガストは飛行・遠距離で近接対象外、ピグリン
// 系は条件付き中立なので含めない)。エンドはシュルカー中心
// (エンダーマンは視線条件の中立なので含めない)。
const NETHER_HOSTILES = new Set([
  'minecraft:wither_skeleton', 'minecraft:blaze',
  'minecraft:magma_cube', 'minecraft:hoglin', 'minecraft:piglin_brute',
]);
const END_HOSTILES = new Set([
  'minecraft:shulker', 'minecraft:endermite', 'minecraft:silverfish',
]);
const hostilesFor = (dim, profiles) => {
  // dimension-profiles.json の上書きがあればそれを正とする (D48)
  const ov = profiles?.[dim]?.hostiles;
  if (Array.isArray(ov) && ov.length) return new Set(ov);
  return dim === 'minecraft:the_nether' ? NETHER_HOSTILES
    : dim === 'minecraft:the_end' ? END_HOSTILES : HOSTILES;
};
const TRAIL_URL = new URL('../data/cave-trail.json', import.meta.url);
const PARTY_TOOLS_URL = new URL('../data/party-tools.json', import.meta.url);
const PLACES_URL = new URL('../data/places.json', import.meta.url);

async function loadPlaces() {
  try {
    const d = JSON.parse(await readFile(PLACES_URL, 'utf8'));
    return Array.isArray(d?.places) ? d : { places: [] };
  } catch { return { places: [] }; }
}
async function recordPlace(kind, ore, pos) {
  try {
    const data = await loadPlaces();
    const dup = data.places.some((pl2) =>
      pl2.status === 'open' && pl2.kind === kind &&
      (pl2.ore ?? null) === (ore ?? null) &&
      Math.abs(pl2.x - pos.x) <= 6 && Math.abs(pl2.z - pos.z) <= 6);
    if (dup) return;
    data.places.push({
      id: `pl-${Date.now().toString(36)}-${data.places.length + 1}`,
      kind, ...(ore ? { ore } : {}), ...pos,
      at: new Date().toISOString(), status: 'open', auto: true,
    });
    await writeFile(PLACES_URL, JSON.stringify(data, null, 2));
  } catch { /* 記録失敗は致命的でない */ }
}
async function completePlace(ore, pos) {
  try {
    const data = await loadPlaces();
    const cand = data.places
      .filter((pl2) => pl2.status === 'open' && pl2.kind === 'ore' && pl2.ore === ore)
      .sort((a, b) =>
        (Math.abs(a.x - pos.x) + Math.abs(a.z - pos.z)) -
        (Math.abs(b.x - pos.x) + Math.abs(b.z - pos.z)))[0];
    if (cand && Math.abs(cand.x - pos.x) <= 10 && Math.abs(cand.z - pos.z) <= 10) {
      cand.status = 'done';
      cand.done_at = new Date().toISOString();
      await writeFile(PLACES_URL, JSON.stringify(data, null, 2));
    }
  } catch { /* 同上 */ }
}
// 掘るセルの横に溶岩があったら掘らない (D38)
async function nearLava(ctx, s2) {
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = await ctx.call('obs.block_state', { x: s2.x + nx, y: s2.y, z: s2.z + nz }).catch(() => null);
    if (b?.block?.includes('lava')) return true;
  }
  return false;
}

// プレイヤーの幸運: 手持ち観測 (今の手) と事前申告 (所持) を合算し
// 大きい方を採る。手持ちで確認できた幸運は確定情報で、申告は
// 「鞄/拠点に持っている」の申告として効く (腐る前提のキャッシュ)。
function heldFortune(ent) {
  if (!ent?.held) return null;
  let best = 0;
  for (const e of ent.held.ench ?? []) {
    if (e.id === 'minecraft:fortune') best = Math.max(best, e.lvl ?? 1);
  }
  return best;
}
async function declaredFortune(name) {
  try {
    const d = JSON.parse(await readFile(PARTY_TOOLS_URL, 'utf8'));
    const v = d?.players?.[name]?.fortune;
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}

const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
const eid = (e) => e.entity_id ?? e.id;
const etype = (e) => e.type ?? e.name;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function gotoNear(ctx, p, timeout = 25_000) {
  const g = await ctx.call('baritone.goto', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }).catch(() => null);
  if (g?.task_id) await ctx.waitTask(g.task_id, timeout).catch(() => null);
}
// 幸運つきツルハシを持っているか (掘る役の分担判断に使う)
function fortuneLevel(state) {
  let best = 0;
  for (const s of state?.inventory_detail ?? []) {
    if (!String(s.id).endsWith('pickaxe')) continue;
    for (const e of s.attrs?.ench ?? []) {
      if (e.id === 'minecraft:fortune') best = Math.max(best, e.lvl ?? 1);
    }
  }
  return best;
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
    mode: { type: 'string', required: false, description: 'together (default: announces detours, combat results, and when it cannot follow) or quiet (no mid-run lines)' },
  },
  async run(ctx, { player, minutes = 10, seconds, fight = true, ores = true, torches = true, mode = 'together' }) {
    const together = mode !== 'quiet';
    const durMs = Math.min(seconds ? seconds * 1000 : minutes * 60_000, 30 * 60_000);
    const deadline = Date.now() + durMs;
    const st0 = await ctx.state().catch(() => null);
    const botName = st0?.name;
    const entryDim = st0?.dimension ?? null;
    let dimProfiles = {};
    try {
      dimProfiles = JSON.parse(await readFile(
        new URL('../data/dimension-profiles.json', import.meta.url),
        'utf8'));
    } catch { /* プロファイルなし = 組み込みで動く */ }
    const hostiles = hostilesFor(entryDim, dimProfiles);
    const inNether = entryDim === 'minecraft:the_nether';
    // 金装備 (防具スロットに golden_ 部位があるか): ピグリン対策
    const wearsGold = (st0?.inventory_detail ?? []).some((sl) =>
      sl.slot >= 36 && String(sl.id).includes('golden_'));
    let piglinWarned = false;
    const entry = st0?.pos ? { x: Math.floor(st0.pos.x), y: Math.floor(st0.pos.y), z: Math.floor(st0.pos.z) } : null;
    const crumbs = entry ? [entry] : [];
    if (entry) {
      await ctx.call('waypoint.set', { name: 'cave_entry', ...entry }).catch(() => {});
    }
    if (entry) await recordPlace('cave', null, entry);
    if (together) await ctx.say('ついていくね').catch(() => {});
    const visited = new Set();
    const announcedVeins = new Set();
    const pendingVeins = [];
    let torchesPlaced = 0;
    let oresMined = 0;
    let fights = 0;
    let lastTorch = null;
    let lastFollowDist = null;
    let stuckCount = 0;
    let stuckAnnounced = false;
    let tick = 0;
    const saveTrail = async () => {
      try {
        await writeFile(TRAIL_URL, JSON.stringify({ at: new Date().toISOString(), dim: entryDim, entry, crumbs }, null, 2));
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
          const foe = all.find((e) => hostiles.has(etype(e)) &&
            (dist(e, pl) <= 7 || dist(e, me) <= 5));
          // ピグリン注意 (ネザー・金装備なし): 一度だけ知らせる
          if (inNether && !wearsGold && !piglinWarned) {
            const pig = all.find((e) =>
              (etype(e) === 'minecraft:piglin'
                || etype(e) === 'minecraft:zombified_piglin')
              && dist(e, me) <= 10);
            if (pig) {
              piglinWarned = true;
              await ctx.say('金装備が無いから、ピグリンには気をつけて')
                .catch(() => {});
            }
          }
          if (foe) {
            fights++;
            const eng = await ctx.call('combat.engage', {
              types: [...hostiles],
              anchor_entity_id: eid(pl),
              leash: 16,
              max_seconds: 45,
              hp_abort: 4,
            }).catch(() => null);
            let ev = null;
            if (eng?.task_id) {
              ev = await ctx.waitTask(eng.task_id, 50_000).catch(() => null);
            }
            if (together && ev?.result) {
              if (ev.result.reason === 'low_hp') {
                await ctx.say('HPが危なくて下がった。ごめん').catch(() => {});
              } else if ((ev.result.kills ?? 0) > 0) {
                await ctx.say('片付けたよ。大丈夫？').catch(() => {});
              }
            }
            continue;
          }
        }
        // 追随
        if (dist(me, pl) > 6) {
          const dNow = dist(me, pl);
          if (lastFollowDist != null && Math.abs(dNow - lastFollowDist) < 0.5) {
            stuckCount++;
          } else {
            stuckCount = 0;
          }
          lastFollowDist = dNow;
          if (together && stuckCount >= 4 && !stuckAnnounced) {
            stuckAnnounced = true;
            await ctx.say('そっち、どうも登れないみたい。先行ってて、道ができたら追いつく')
              .catch(() => {});
          }
          await gotoNear(ctx, pl);
          continue;
        }
        lastFollowDist = null;
        stuckCount = 0;
        stuckAnnounced = false;
        // 松明
        if (torches && (!lastTorch || dist(me, lastTorch) >= 7.5)) {
          const slot = hotbarSlot(st, 'minecraft:torch');
          if (slot) {
            await ctx.call('equip', { slot: slot.slot }).catch(() => {});
            const bx = Math.floor(me.x), by = Math.floor(me.y), bz = Math.floor(me.z);
            await ctx.call('use_item', { x: bx, y: by - 1, z: bz, face: 'up' }).catch(() => {});
            const chk = await ctx.call('obs.block_state', { x: bx, y: by, z: bz }).catch(() => null);
            if (chk?.block === 'minecraft:torch' || chk?.block === 'minecraft:wall_torch') {
              torchesPlaced++;
              lastTorch = { ...me };
            }
          }
        }
        // 幸運持ちの時に告知した notable: プレイヤーが近くに来たら
        // 凛が掘る (一緒に掘る形)。足元まで寄られたら譲る
        if (pendingVeins.length && dist(pl, pendingVeins[0]) <= 4) {
          const pv = pendingVeins.shift();
          const fslot = (st?.inventory_detail ?? []).find((s2) =>
            s2.slot <= 8 && String(s2.id).endsWith('pickaxe') &&
            (s2.attrs?.ench ?? []).some((e) => e.id === 'minecraft:fortune'));
          if (fslot) await ctx.call('equip', { slot: fslot.slot }).catch(() => {});
          await gotoNear(ctx, pv);
          for (let n = 0; n < 8; n++) {
            const f = await ctx.call('obs.block', { block: pv.ore, radius: 3 }).catch(() => null);
            const spots = f?.found ?? [];
            if (!spots.length) break;
            const spot = spots.reduce((a, b) =>
              dist(pv, a) <= dist(pv, b) ? a : b);
            const plNow = ents(await ctx.call('obs.entity',
              { name: player ?? pl.name }).catch(() => null))[0] ?? pl;
            if (plNow && dist(plNow, spot) < 1.5) break;
            if (await nearLava(ctx, spot)) {
              visited.add(`${spot.x},${spot.y},${spot.z}`);
              continue;
            }
            visited.add(`${spot.x},${spot.y},${spot.z}`);
            await ctx.call('dig', { x: spot.x, y: spot.y, z: spot.z }).catch(() => {});
            oresMined++;
            await ctx.sleep(500);
          }
          await completePlace(pv.ore, pv);
          if (together) {
            await ctx.say(`${NOTABLE.get(pv.ore)}掘ったよ`).catch(() => {});
          }
          continue;
        }
        // 鉱石手伝い (6 tick に 1 回)
        if (ores && tick % 6 === 0) {
          let target = null;
          for (const ore of ORES) {
            const f = await ctx.call('obs.block', { block: ore, radius: 10 }).catch(() => null);
            if (NOTABLE.has(ore)) {
              for (const s of f?.found ?? []) {
                // together では notable の塊は (告知済みの鉱脈の残り含め)
                // 常に自動採掘の対象から外す
                if (together) visited.add(`${s.x},${s.y},${s.z}`);
                const veinKey = `${ore}:${Math.round(s.x / 4)},${Math.round(s.y / 4)},${Math.round(s.z / 4)}`;
                if (announcedVeins.has(veinKey)) continue;
                announcedVeins.add(veinKey);
                ctx.journal?.note('discovery', {
                  ore, x: s.x, y: s.y, z: s.z, together,
                });
                if (together) {
                  await recordPlace('ore', ore, { x: s.x, y: s.y, z: s.z });
                }
                if (together) {
                  const fl = fortuneLevel(st);
                  const held = heldFortune(pl);
                  const decl = pl.name ? await declaredFortune(pl.name) : null;
                  const theirs = (held == null && decl == null)
                    ? null : Math.max(held ?? 0, decl ?? 0);
                  if (theirs != null && theirs > fl) {
                    await ctx.say(`${NOTABLE.get(ore)}見つけた！${pl.name ?? 'そっち'}は幸運${theirs}あるね。掘って`)
                      .catch(() => {});
                  } else if (fl > 0) {
                    pendingVeins.push({ ore, x: s.x, y: s.y, z: s.z });
                    await ctx.say(`${NOTABLE.get(ore)}見つけた！凛は幸運${fl}あるよ。近くに来たら掘るね`)
                      .catch(() => {});
                  } else {
                    await ctx.say(`${NOTABLE.get(ore)}見つけた！掘らずに残してあるから、こっち来て`)
                      .catch(() => {});
                  }
                }
              }
              if (together) continue;
            }
            // 金装備なしで金鉱石を掘るとピグリンが敵対する
            if (inNether && !wearsGold && ore === 'minecraft:nether_gold_ore') {
              continue;
            }
            for (const s of f?.found ?? []) {
              const key = `${s.x},${s.y},${s.z}`;
              // プレイヤーの作業圏 (3m 以内) は掘らない — 同じ鉱脈の奪い合い回避
              if (!visited.has(key) && dist(me, s) <= 11 && dist(pl, s) >= 3) {
                if (!target || dist(me, s) < dist(me, target)) target = { ...s, id: ore };
              }
            }
          }
          if (target) {
            if (together) {
              const short = target.id.split(':')[1]
                .replace('deepslate_', '').replace('_ore', '');
              await ctx.say(`あ、${short}見つけた。被らない方を掘ってくるね`)
                .catch(() => {});
            }
            await gotoNear(ctx, target);
            for (let n = 0; n < 6; n++) {
              const f = await ctx.call('obs.block', { block: target.id, radius: 3 }).catch(() => null);
              const spots = f?.found ?? [];
              if (!spots.length) break;
              // 選んだ鉱脈に一番近い塊から掘る (found[0] の盲信をやめる)
              const spot = spots.reduce((a, b) =>
                dist(target, a) <= dist(target, b) ? a : b);
              // プレイヤーがこの塊を取りに来たら譲る
              const plNow = ents(await ctx.call('obs.entity',
                { name: player ?? pl.name }).catch(() => null))[0] ?? pl;
              if (plNow && dist(plNow, spot) < 2.5) break;
              // 古代の残骸は露出面があるものだけ (埋没は places 行き)
              if (target.id === 'minecraft:ancient_debris') {
                let exposed = false;
                for (const [nx, ny, nz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
                  const b = await ctx.call('obs.block_state', {
                    x: spot.x + nx, y: spot.y + ny, z: spot.z + nz,
                  }).catch(() => null);
                  if (b?.block === 'minecraft:air' || b?.block === 'minecraft:cave_air') {
                    exposed = true; break;
                  }
                }
                if (!exposed) {
                  visited.add(`${spot.x},${spot.y},${spot.z}`);
                  await recordPlace('ore', 'minecraft:ancient_debris', spot);
                  ctx.journal?.note('debris_buried', { ...spot });
                  break;
                }
              }
              // 横に溶岩がある塊は掘らない
              if (await nearLava(ctx, spot)) {
                visited.add(`${spot.x},${spot.y},${spot.z}`);
                continue;
              }
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
