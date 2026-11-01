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
  },
  async run(ctx, { max_seconds = 60, leash = 20 }) {
    const st = await ctx.state().catch(() => null);
    const anchor = st?.pos
      ? { x: st.pos.x, y: st.pos.y, z: st.pos.z } : undefined;
    const eng = await ctx.call('combat.engage', {
      types: HOSTILES,
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
      await ctx.say(`片付けたよ。${r.kills ?? 0}体倒した`);
    } else if (r.reason === 'no_target') {
      await ctx.say('近くに敵はいないみたい');
    } else if (r.reason === 'low_hp') {
      await ctx.say('HPが危なくなったから下がった');
    }
    return { done: true, ...r };
  },
};
