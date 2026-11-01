// ピグリン交易 (D45): 金インゴットを投げて物々交換する。
// 金は手持ちに装備してから look_at で狙って toss する (toss は
// 主手のアイテムを落とす)。交換品は周囲を歩いて回収し、
// インベントリ差分で受け渡しを報告する。
export default {
  name: 'barter',
  description:
    'Barter with a nearby piglin: toss gold ingots one at a time, ' +
    'wait for the piglin to inspect and drop its trade, then sweep ' +
    'the drops. Reports what was given and received (inventory ' +
    'diff). Notes: piglins aggro if the bot wears no gold armor ' +
    'and mines gold nearby; bartering itself is safe.',
  params: {
    rounds: { type: 'integer', required: false, description: 'ingots to offer (default 3)' },
  },
  async run(ctx, { rounds = 3 }) {
    const st = await ctx.state();
    const goldHave = (st?.inventory ?? {})['minecraft:gold_ingot'] ?? 0;
    if (goldHave < 1) return { done: false, reason: 'no_gold_ingot' };
    const n = Math.min(rounds, goldHave);
    const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
    const piglin = ents(await ctx.call('obs.entity',
      { name: 'minecraft:piglin' }).catch(() => null))
      .sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99))[0];
    if (!piglin) return { done: false, reason: 'no_piglin_nearby' };
    const wearsGold = (st?.inventory_detail ?? []).some((sl) =>
      sl.slot >= 36 && String(sl.id).includes('golden_'));
    const before = { ...(st.inventory ?? {}) };
    let gave = 0;
    for (let i = 0; i < n; i++) {
      ctx.throwIfCancelled();
      await ctx.call('equip', { item: 'minecraft:gold_ingot' }).catch(() => {});
      await ctx.call('look_at', { x: piglin.x, y: piglin.y + 1, z: piglin.z })
        .catch(() => {});
      let t = null;
      try {
        t = await ctx.call('toss', {});
      } catch (e) {
        // toss は危険操作 (承認ゲート対象): 握り潰さず申告する
        if (String(e?.message ?? e).includes('APPROVAL_REQUIRED')) {
          await ctx.say('金を投げるのは承認が要るみたい。許可もらえたら続けるね');
          return { done: false, reason: 'approval_required', method: 'toss' };
        }
      }
      if (!t?.dropped) break;
      gave++;
      await ctx.sleep(6500); // ピグリンが拾って品定めする時間
      // 交換品の回収: ピグリンの周囲を小さく歩く
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const g = await ctx.call('baritone.goto', {
          x: Math.floor(piglin.x) + ox, y: Math.floor(piglin.y),
          z: Math.floor(piglin.z) + oz,
        }).catch(() => null);
        if (g?.task_id) await ctx.waitTask(g.task_id, 6_000).catch(() => null);
      }
    }
    const after = (await ctx.state().catch(() => null))?.inventory ?? {};
    const got = {};
    for (const [id, c] of Object.entries(after)) {
      const d = (c ?? 0) - (before[id] ?? 0);
      if (d > 0 && id !== 'minecraft:gold_ingot') got[id] = d;
    }
    const gotText = Object.entries(got)
      .map(([id, c]) => `${id.split(':')[1]}×${c}`).join('、');
    await ctx.say(gave
      ? `交易終わり。金${gave}個と交換で ${gotText || 'まだ何も落ちてない'}`
      : 'うまく渡せなかった');
    return { done: gave > 0, gave, got, wears_gold: wearsGold };
  },
};
