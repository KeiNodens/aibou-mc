// 料理 (Farmer's Delight の cooking pot、D24 draft):
// recipe.lookup で farmersdelight:cooking レシピを引き、材料を鍋の
// スロットへ移し、出来上がりを回収する。slot 構成は汎用ヒューリスティクス
// (コンテナ側の最後のスロット = 出来上がり、それ以外 = 材料) で、
// 実機の CookingPot メニューで確定させる前提の draft 実装。
// 熱源 (鍋の下) と、丼もの等のコンテナ (ボウル) はプレイヤー側の前提。
function splitSides(read) {
  const sizes = read?.container_sizes ?? {};
  const idxs = Object.keys(sizes).map(Number);
  if (!read || read.menu_id === 'player_inventory' || idxs.length < 2) return null;
  const playerIdx = idxs.reduce((a, b) => (sizes[a] >= sizes[b] ? a : b));
  return { playerIdx, menuId: read.menu_id };
}

async function gotoPos(ctx, pos) {
  const g = await ctx.call('baritone.goto', { x: pos.x, y: pos.y, z: pos.z });
  if (g?.task_id) await ctx.waitTask(g.task_id, 60_000);
  await ctx.call('look_at', { x: pos.x, y: pos.y, z: pos.z }).catch(() => {});
}

export default {
  name: 'cook',
  description:
    'Cook a Farmer\'s Delight cooking-pot meal by its result item id: ' +
    'resolve the farmersdelight:cooking recipe, move the ingredients ' +
    'from the bot inventory into the pot, wait, and take the finished ' +
    'meal out. A heat source under the pot (and a bowl in the pot\'s ' +
    'container slot for stews/soups) is the player\'s setup. Draft: ' +
    'the pot slot layout is handled generically and still needs a live ' +
    'confirmation pass.',
  params: {
    target: { type: 'string', required: true, description: 'result item id (e.g. farmersdelight:beef_stew)' },
    crafts: { type: 'integer', required: false, description: 'how many to cook (default 1)' },
    x: { type: 'integer', required: false, description: 'cooking pot X' },
    y: { type: 'integer', required: false },
    z: { type: 'integer', required: false },
  },
  async run(ctx, args) {
    const crafts = Math.max(1, args.crafts ?? 1);
    const r = await ctx.call('recipe.lookup', { item: args.target })
      .catch(() => null);
    const recipes = r?.recipes ?? [];
    const rec = recipes.find((x) => x.type === 'farmersdelight:cooking')
      ?? recipes[0];
    if (!rec) return { done: false, reason: 'recipe_not_found', target: args.target };
    const perCraft = new Map();
    for (const ing of rec.ingredients ?? []) {
      if (ing.empty || !ing.options?.length) continue;
      const id = ing.options[0];
      perCraft.set(id, (perCraft.get(id) ?? 0) + (ing.count ?? 1));
    }
    if (!perCraft.size) return { done: false, reason: 'no_ingredients_in_recipe' };
    const needed = [...perCraft.entries()]
      .map(([item, c]) => ({ item, count: c * crafts }));

    // 材料が手持ちにあるか先に確認
    const st = await ctx.state().catch(() => null);
    const have = new Map();
    for (const s of st?.inventory_detail ?? [])
      if (s.id) have.set(s.id, (have.get(s.id) ?? 0) + (s.count ?? 0));
    const missing = needed.filter((n) => (have.get(n.item) ?? 0) < n.count);
    if (missing.length)
      return { done: false, reason: 'ingredients_missing', missing };

    // 鍋を探す
    let pos = null;
    if (args.x != null && args.y != null && args.z != null)
      pos = { x: args.x, y: args.y, z: args.z };
    else {
      const found = await ctx.call('obs.block', {
        block: 'farmersdelight:cooking_pot', radius: 24,
      }).catch(() => null);
      pos = found?.found?.[0] ?? null;
    }
    if (!pos) return { done: false, reason: 'pot_not_found' };
    await gotoPos(ctx, pos);
    ctx.journal?.noteFacility({ kind: 'station', pos, name: 'farmersdelight:cooking_pot' });

    const openPot = async () => {
      await ctx.call('use_item', { x: pos.x, y: pos.y, z: pos.z });
      await ctx.sleep(500);
      const read = await ctx.call('container.read');
      return { read, sides: splitSides(read) };
    };

    let cooked = 0;
    try {
    // 材料を鍋へ (コンテナ側スロットの末尾は出来上がり用に空ける)
      const { read, sides } = await openPot();
      if (!sides) return { done: false, reason: 'pot_menu_not_open', menu: read?.menu_id };
      const contSlots = (read.slots ?? [])
        .filter((s) => s.container_idx !== sides.playerIdx)
        .map((s) => s.slot)
        .sort((a, b) => a - b);
      const ingredientSlots = contSlots.slice(0, -1);
      if (ingredientSlots.length < needed.length)
        return { done: false, reason: 'pot_layout_unexpected', contSlots };
      let slotCursor = 0;
      for (const need of needed) {
        for (let unit = 0; unit < need.count; unit++) {
          ctx.throwIfCancelled();
          const cur = await ctx.call('container.read');
          const src = (cur.slots ?? []).find((s) =>
            s.container_idx === sides.playerIdx && !s.empty && s.id === need.item);
          if (!src) return { done: false, reason: 'ingredient_vanished', item: need.item };
          const dst = ingredientSlots[slotCursor++];
          if (dst === undefined) return { done: false, reason: 'pot_full' };
          await ctx.call('container.click', {
            slot: src.slot, action: 'pickup', menu_id: sides.menuId,
          });
          await ctx.call('container.click', {
            slot: dst, action: 'pickup', menu_id: sides.menuId,
          });
        }
      }
      await ctx.call('container.close').catch(() => {});

      // 出来上がりを待つ (最長 90 秒、5 秒ごとに開けて確認)
      const wantTotal = crafts * (rec.result?.count ?? 1);
      const deadline = Date.now() + 90_000;
      while (cooked < wantTotal && Date.now() < deadline) {
        ctx.throwIfCancelled();
        await ctx.sleep(5000);
        const { read: poll, sides: ps } = await openPot().catch(() => ({}));
        if (!ps) continue;
        const outs = (poll.slots ?? []).filter((s) =>
          s.container_idx !== ps.playerIdx && !s.empty && s.id === args.target);
        for (const o of outs) {
          await ctx.call('container.click', {
            slot: o.slot, action: 'quick_move', menu_id: ps.menuId,
          });
          cooked += o.count ?? 0;
        }
        await ctx.call('container.close').catch(() => {});
      }
    } finally {
      await ctx.call('container.close').catch(() => {});
    }

    if (cooked > 0) await ctx.say(`${args.target} が ${cooked} 個できたよ`);
    else await ctx.say('料理が完成しなかった。熱源とボウル (コンテナ) を確認してみて');
    return {
      done: cooked > 0, cooked, target: args.target,
      recipe_used: { id: rec.id, type: rec.type },
      hint: cooked > 0 ? undefined
        : '鍋の下の熱源、丼ものならボウルがコンテナスロットにあるかを確認',
    };
  },
};
