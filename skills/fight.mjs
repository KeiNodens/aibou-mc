// 戦う (D31): 近くの敵対モブを mod 側 CombatTask で片付ける。
// 力学 (接近・照準・クールダウン攻撃) は mod、対象種別の方針はここ。
const HOSTILES = [
  'minecraft:zombie', 'minecraft:drowned', 'minecraft:husk',
  'minecraft:skeleton', 'minecraft:stray', 'minecraft:creeper',
  'minecraft:spider', 'minecraft:cave_spider', 'minecraft:witch',
  'minecraft:pillager', 'minecraft:vindicator', 'minecraft:blaze',
  'minecraft:magma_cube', 'minecraft:slime', 'minecraft:phantom',
  'minecraft:silverfish', 'minecraft:endermite',
];

export default {
  name: 'fight',
  description:
    'Fight nearby hostile mobs using the mod-side combat task: it ' +
    'chases, aims, and swings on the real attack cooldown. The bot ' +
    'stays within the leash radius of where it started and breaks off ' +
    'at low HP. Target policy (vanilla hostiles) is set here, the ' +
    'mechanics live in the mod.',
  params: {
    max_seconds: { type: 'integer', required: false, description: 'max duration (default 60)' },
    leash: { type: 'integer', required: false, description: 'leash radius from start (default 20)' },
    targets: { type: 'string', required: false, description: 'comma-separated entity ids to engage (default: vanilla hostiles). Use for hunting, e.g. "minecraft:cow,minecraft:sheep"' },
    collect: { type: 'boolean', required: false, description: 'after kills, sweep the area to pick up drops (default true)' },
  },
  async run(ctx, { max_seconds = 60, leash = 20, targets, collect = true }) {
    const st = await ctx.state().catch(() => null);
    const beforeInv = { ...(st?.inventory ?? st?.inventory_summary ?? {}) };
    const typeList = (targets ?? '')
      .split(',').map((t) => t.trim()).filter(Boolean);
    const hunting = typeList.length > 0;
    const anchor = st?.pos
      ? { x: st.pos.x, y: st.pos.y, z: st.pos.z } : undefined;
    const eng = await ctx.call('combat.engage', {
      types: hunting ? typeList : HOSTILES,
      ...(anchor ? { anchor } : {}),
      leash,
      max_seconds,
      hp_abort: 4,
    }).catch(() => null);
    if (!eng?.task_id) return { done: false, reason: 'engage_failed' };
    const done = await ctx.waitTask(eng.task_id, (max_seconds + 10) * 1000)
      .catch(() => null);
    const r = done?.result ?? {};
    if (r.reason === 'cleared') {
      await ctx.say(hunting
        ? `倒したよ。${r.kills ?? 0}体`
        : `片付けたよ。${r.kills ?? 0}体倒した`);
    } else if (r.reason === 'no_target') {
      await ctx.say(hunting ? '近くに対象はいないみたい' : '近くに敵はいないみたい');
    } else if (r.reason === 'low_hp') {
      await ctx.say('HPが危なくなったから下がった');
    }
    // ドロップ掃引: 倒した場所の周りを小さく歩いて拾う (狩り・戦闘共通)
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
    return { done: true, ...r, picked_up: pickedUp };
  },
};
