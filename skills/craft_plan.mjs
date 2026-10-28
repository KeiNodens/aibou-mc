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

    // 選択肢スコア: 在庫充足 > 在庫少量 > vanilla > その他mod
    // (板材タグに japanese_apricot_bark 等が混じるのを避ける)
    const optionScore = (o, need) => {
      const have = inv.get(o) ?? 0;
      let s = 0;
      if (have >= need) s += 100;
      else if (have > 0) s += 30;
      if (o.startsWith('minecraft:')) s += 50;
      // バニラ木材系など一般的な選択肢を優遇
      if (/_(planks|log|ingot|dust|gem|nugget|block)$/.test(o)) s += 10;
      return s;
    };

    // 材料ごとの最良選択肢を1つ返す
    const chooseOption = (opts, need) => {
      if (!opts?.length) return null;
      let best = opts[0], bestS = optionScore(opts[0], need);
      for (const o of opts.slice(1)) {
        const s = optionScore(o, need);
        if (s > bestS) { bestS = s; best = o; }
      }
      return best;
    };

    // レシピ候補から「材料が現実的に揃う」crafting系レシピを選ぶ。
    // 材料の選択肢スコア合計 - 不足見積りペナルティ + 同namespace加点で比較し、
    // 同点なら成果物countが大きい方を優先 (bulk recipeで素材が9倍要求される変形を避ける)
    const pickRecipe = (recipes, itemId) => {
      const crafts = recipes.filter((r) => isCraftType(r.type));
      if (!crafts.length) return null;
      const itemNs = itemId.split(':')[0];
      let best = null, bestScore = -Infinity;
      for (const r of crafts) {
        let score = 0, shortage = 0;
        const per = r.result?.count ?? 1;
        for (const ing of r.ingredients ?? []) {
          if (ing.empty) continue;
          const need = ing.count ?? 1;
          const opts = ing.options ?? [];
          let bestO = 0, bestHave = 0;
          for (const o of opts) {
            const s = optionScore(o, need);
            if (s > bestO) { bestO = s; bestHave = inv.get(o) ?? 0; }
          }
          score += bestO;
          shortage += Math.max(0, need - bestHave);
        }
        score += Math.min(per * 5, 40); // 一度に多く作れるレシピを微優遇
        score -= shortage * 8;          // 在庫不足が少ないレシピを優先
        // 成果物と同namespaceのレシピは正規レシピの可能性が高い
        if ((r.id ?? '').split(':')[0] === itemNs) score += 25;
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
      const rec = pickRecipe(recipes, id);
      if (!rec) {
        // crafting系以外のレシピしかない = 機械加工が必要
        machineOnly.add(`${id} (${recipes[0].type})`);
        addMissing(id, need);
        return;
      }
      const per = rec.result?.count ?? 1;
      const runs = Math.ceil(need / per);
      // 深い順でなく先に素材を確保してからこの手順を積む (後置順)
      const uses = [];
      for (const ing of rec.ingredients ?? []) {
        if (ing.empty) continue;
        const opts = ing.options ?? [];
        const chosen = chooseOption(opts, ing.count ?? 1);
        if (!chosen) continue;
        const want = (ing.count ?? 1) * runs;
        uses.push(`${chosen} x${want}`);
        const lack = take(chosen, want);
        if (lack > 0) await expand(chosen, lack, d + 1);
      }
      steps.push({ make: id, count: runs * per, recipe: rec.id, type: rec.type, uses });
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
