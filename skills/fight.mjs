// 戦う (D31 → D46 拡張): 近くの敵対モブと戦う。力学は mod 側
// (CombatTask = 近接、ShootTask = 遠距離)、方針はここ:
// 対象種別・優先順位・武器の自動選択・食べて再突入・遠距離。
const HOSTILES = [
  'minecraft:zombie', 'minecraft:drowned', 'minecraft:husk',
  'minecraft:skeleton', 'minecraft:stray', 'minecraft:creeper',
  'minecraft:spider', 'minecraft:cave_spider', 'minecraft:witch',
  'minecraft:pillager', 'minecraft:vindicator', 'minecraft:blaze',
  'minecraft:magma_cube', 'minecraft:slime', 'minecraft:phantom',
  'minecraft:silverfish', 'minecraft:endermite',
];
const TIER = { wooden: 0, golden: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 };
const FOOD_RE = /(bread|beef|pork|chicken|mutton|rabbit|potato|carrot|apple|stew|soup|salmon|cod|melon|berries|pie|cookie)/;

function weaponScore(d) {
  const m = String(d.id).replace('minecraft:', '').match(/^(\w+?)_(sword|axe)$/);
  if (!m) return -1;
  let s = (TIER[m[1]] ?? 0) * 10 + (m[2] === 'sword' ? 5 : 3);
  const sh = (d.attrs?.ench ?? []).find((e) => e.id === 'minecraft:sharpness');
  if (sh) s += sh.lvl * 1.5;
  return s;
}

export default {
  name: 'fight',
  description:
    'Fight nearby mobs. Melee uses the mod combat task (chase, ' +
    'cooldown swings, shield blocks between swings when shield:true ' +
    'and a shield is in the offhand, creeper hit-and-back-off, ' +
    'optional target priority). The best weapon in the inventory ' +
    '(material tier + Sharpness) is equipped first. With ' +
    'ranged:true and a bow/crossbow + arrows it shoots instead, ' +
    'falling back to melee if a target closes in. On low HP it ' +
    'breaks off; with rounds>1 it eats and re-engages.',
  params: {
    max_seconds: { type: 'integer', required: false, description: 'max duration per engagement (default 60)' },
    leash: { type: 'integer', required: false, description: 'leash radius from start (default 20)' },
    targets: { type: 'string', required: false, description: 'comma-separated entity ids to engage (default: vanilla hostiles). Use for hunting, e.g. "minecraft:cow,minecraft:sheep"' },
    priority: { type: 'string', required: false, description: 'comma-separated entity ids in priority order for melee targeting (e.g. creepers first)' },
    shield: { type: 'boolean', required: false, description: 'use the offhand shield between swings (default true)' },
    ranged: { type: 'boolean', required: false, description: 'shoot with bow/crossbow instead of melee when possible (default false)' },
    shots: { type: 'integer', required: false, description: 'shots per target in ranged mode (default 5)' },
    rounds: { type: 'integer', required: false, description: 'engagements; on low_hp, eat and re-engage while rounds remain (default 1)' },
    collect: { type: 'boolean', required: false, description: 'after kills, sweep the area to pick up drops (default true)' },
  },
  async run(ctx, {
    max_seconds = 60, leash = 20, targets, priority, shield = true,
    ranged = false, shots = 5, rounds = 1, collect = true,
  }) {
    const st = await ctx.state().catch(() => null);
    const beforeInv = { ...(st?.inventory ?? st?.inventory_summary ?? {}) };
    const typeList = (targets ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const hunting = typeList.length > 0;
    const typeSet = hunting ? typeList : HOSTILES;
    const anchor = st?.pos ? { x: st.pos.x, y: st.pos.y, z: st.pos.z } : undefined;
    const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
    const etype = (e) => e.type ?? e.id_name ?? '';

    // ---- 遠距離モード ----
    const detail = st?.inventory_detail ?? [];
    const hasBow = detail.some((d) =>
      d.id === 'minecraft:bow' || d.id === 'minecraft:crossbow');
    const hasArrows = Object.keys(beforeInv).some((id) => id.includes('arrow'));
    if (ranged && hasBow && hasArrows) {
      let volleys = 0;
      let shotsFired = 0;
      let switched = false;
      for (let v = 0; v < 4; v++) {
        const me = (await ctx.state().catch(() => null))?.pos;
        const foes = ents(await ctx.call('obs.entity', {}).catch(() => null))
          .filter((e) => typeSet.includes(etype(e)))
          .map((e) => ({
            ...e,
            d: me ? Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z) : (e.dist ?? 99),
          }))
          .sort((a, b) => a.d - b.d);
        if (!foes.length) break;
        if (foes[0].d < 6) { switched = true; break; }
        const t = foes[0];
        const bowItem = detail.find((d) =>
          d.id === 'minecraft:bow' || d.id === 'minecraft:crossbow');
        await ctx.call('equip', { item: bowItem.id }).catch(() => {});
        const sh = await ctx.call('combat.shoot', {
          entity_id: t.id, max_shots: shots, max_seconds: 30,
        }).catch(() => null);
        if (!sh?.task_id) break;
        volleys++;
        const doneEv = await ctx.waitTask(sh.task_id, 35_000).catch(() => null);
        shotsFired += doneEv?.result?.shots ?? 0;
        if (doneEv?.result?.reason === 'out_of_arrows') break;
      }
      if (!switched) {
        await ctx.say(`遠距離で ${shotsFired} 発撃ったよ`);
        return {
          done: true, ranged: true, volleys, shots_fired: shotsFired,
          engagements: 0, weapon: null, ate: 0, picked_up: {},
        };
      }
      // 近づかれたので近接へ切替 (このまま下の近接フローへ)
    }

    // ---- 近接: 武器の自動選択 ----
    let weapon = null;
    let bestScore = -1;
    for (const d of detail) {
      const s = weaponScore(d);
      if (s > bestScore) { bestScore = s; weapon = d.id; }
    }
    if (weapon) await ctx.call('equip', { item: weapon }).catch(() => {});

    const prioList = (priority ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    let ate = 0;
    let engagements = 0;
    let r = {};
    for (let round = 0; round < Math.max(1, rounds); round++) {
      const eng = await ctx.call('combat.engage', {
        types: typeSet,
        ...(anchor ? { anchor } : {}),
        leash, max_seconds, hp_abort: 4,
        ...(prioList.length ? { priority: prioList } : {}),
        use_shield: shield,
      }).catch(() => null);
      if (!eng?.task_id) return { done: false, reason: 'engage_failed' };
      engagements++;
      const done = await ctx.waitTask(eng.task_id, (max_seconds + 10) * 1000)
        .catch(() => null);
      r = done?.result ?? {};
      if (r.reason !== 'low_hp' || round + 1 >= Math.max(1, rounds)) break;
      // 食べて再突入
      const stN = await ctx.state().catch(() => null);
      const inv = stN?.inventory ?? stN?.inventory_summary ?? {};
      const food = Object.keys(inv).find((id) =>
        FOOD_RE.test(id) && !id.includes('rotten'));
      if (!food) break;
      await ctx.call('equip', { item: food }).catch(() => {});
      const use = await ctx.call('use_item', { hold_ticks: 40 }).catch(() => null);
      if (use?.task_id) await ctx.waitTask(use.task_id, 5_000).catch(() => null);
      ate++;
      if (weapon) await ctx.call('equip', { item: weapon }).catch(() => {});
    }
    if (r.reason === 'cleared') {
      await ctx.say(hunting
        ? `倒したよ。${r.kills ?? 0}体`
        : `片付けたよ。${r.kills ?? 0}体倒した`);
    } else if (r.reason === 'no_target') {
      await ctx.say(hunting ? '近くに対象はいないみたい' : '近くに敵はいないみたい');
    } else if (r.reason === 'low_hp') {
      await ctx.say('HPが危なくなったから下がった');
    }
    // ドロップ掃引
    let pickedUp = {};
    if (collect && (r.kills ?? 0) > 0) {
      const stE = await ctx.state().catch(() => null);
      const c = stE?.pos ?? anchor;
      if (c) {
        for (const [ox, oz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const g = await ctx.call('baritone.goto', {
            x: Math.floor(c.x) + ox, y: Math.floor(c.y), z: Math.floor(c.z) + oz,
          }).catch(() => null);
          if (g?.task_id) await ctx.waitTask(g.task_id, 6_000).catch(() => null);
        }
      }
      const stA = await ctx.state().catch(() => null);
      const afterInv = stA?.inventory ?? stA?.inventory_summary ?? {};
      for (const [id, n] of Object.entries(afterInv)) {
        const d = (n ?? 0) - (beforeInv[id] ?? 0);
        if (d > 0) pickedUp[id] = d;
      }
    }
    return { done: true, ...r, weapon, ate, engagements, picked_up: pickedUp };
  },
};
