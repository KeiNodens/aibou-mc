// 目標アイテムの素材ツリーを再帰展開し、不足分と必要なクラフト手順を計算する。
// recipe.lookup の上に乗るプランナ (autonomy.md 8.1 素材ツリー計算)。
export default {
  name: 'craft_plan',
  description:
    'Expand an item into a material tree and compute missing ingredients and crafting ' +
    'steps. Uses the live recipe book + current inventory.',
  params: {
    item: { type: 'string', required: true, description: 'result item registry name' },
    count: { type: 'integer', required: false, description: 'target amount (default 1)' },
    depth: { type: 'integer', required: false, description: 'max recipe depth (default 4)' },
  },
  async run(ctx, { item, count = 1, depth = 4 }) {
    const state = await ctx.call('obs.state');
    const inv = new Map();
    for (const s of state.inventory_detail ?? []) {
      inv.set(s.id, (inv.get(s.id) ?? 0) + (s.count ?? 1));
    }

    const missing = new Map();   // 素材id -> 不足個数
    const steps = [];            // 作る順の手順リスト
    const machineOnly = new Set(); // 作業台以外の加工が必要なアイテム
    const uncraftable = new Set();
    const memo = new Map();      // item -> 展開結果cache
    const isCraftType = (t) =>
      t === 'minecraft:crafting_shaped' || t === 'minecraft:crafting_shapeless'
      || t === 'minecraft:crafting';

    // 在庫からneed個消費し、残りを返す
    const take = (id, need) => {
      const have = inv.get(id) ?? 0;
      const used = Math.min(have, need);
      if (used > 0) inv.set(id, have - used);
      return need - used;
    };

    // レシピ候補から「材料が一番揃う」crafting系レシピを選ぶ
    const pickRecipe = (recipes) => {
      const crafts = recipes.filter((r) => isCraftType(r.type));
      if (!crafts.length) return null;
      let best = null, bestScore = -1;
      for (const r of crafts) {
        let score = 0;
        for (const ing of r.ingredients ?? []) {
          if (ing.empty) continue;
          const opts = ing.options ?? [];
          if (opts.some((o) => (inv.get(o) ?? 0) >= (ing.count ?? 1))) score += 2;
          else if (opts.some((o) => (inv.get(o) ?? 0) > 0)) score += 1;
        }
        if (score > bestScore) { bestScore = score; best = r; }
      }
      return best;
    };

    const addMissing = (id, n) => {
      if (n <= 0) return;
      missing.set(id, (missing.get(id) ?? 0) + n);
    };

    // itemをneed個作るのに必要なものを展開
    const expand = async (id, need, d) => {
      if (d > depth) { addMissing(id, need); return; }
      const key = `${id}`;
      let info = memo.get(key);
      if (!info) {
        const r = await ctx.call('recipe.lookup', { item: id });
        info = r;
        memo.set(key, r);
      }
      const recipes = info.recipes ?? [];
      if (!recipes.length) { uncraftable.add(id); addMissing(id, need); return; }
      const rec = pickRecipe(recipes);
      if (!rec) {
        // crafting系以外のレシピしかない = 機械加工が必要
        machineOnly.add(`${id} (${recipes[0].type})`);
        addMissing(id, need);
        return;
      }
      const per = rec.result?.count ?? 1;
      const runs = Math.ceil(need / per);
      // 深い順でなく先に素材を確保してからこの手順を積む (後置順)
      for (const ing of rec.ingredients ?? []) {
        if (ing.empty) continue;
        const opts = ing.options ?? [];
        // 在庫にある選択肢を優先、なければ先頭
        const chosen = opts.find((o) => (inv.get(o) ?? 0) > 0) ?? opts[0];
        if (!chosen) continue;
        const want = (ing.count ?? 1) * runs;
        const lack = take(chosen, want);
        if (lack > 0) await expand(chosen, lack, d + 1);
      }
      steps.push({ make: id, count: runs * per, recipe: rec.id, type: rec.type });
    };

    const lack0 = take(item, count);
    if (lack0 === 0) {
      return { done: true, already_have: true, item, count };
    }
    await expand(item, lack0, 0);

    const short = item.split(':')[1];
    if (missing.size === 0 && uncraftable.size === 0) {
      await ctx.say(`${short} は今ある素材だけで作れるよ`);
    } else {
      const tops = [...missing.entries()].slice(0, 3)
        .map(([id, n]) => `${id.split(':')[1]}${n}個`).join(', ');
      await ctx.say(`${short} には ${tops}${missing.size > 3 ? ' 他' : ''} が足りない`);
    }
    return {
      done: true,
      item, count,
      craftable_now: missing.size === 0 && uncraftable.size === 0 && machineOnly.size === 0,
      missing: Object.fromEntries(missing),
      uncraftable: [...uncraftable],
      needs_machine: [...machineOnly],
      steps, // 素材→仕上げ の実行順 (後置順なので既に素材が先)
    };
  },
};
