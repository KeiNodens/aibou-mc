// アイテムをクラフトする。まず現在のmenuで試し、NEED_TABLEが返れば
// 近くの作業台を探して開いてから再試行する。
export default {
  name: 'craft',
  description:
    'Craft an item (e.g. minecraft:stick, mekanism:steel_casing). Uses the recipe book; ' +
    'opens a nearby crafting table automatically for 3x3 recipes.',
  params: {
    item: { type: 'string', required: true, description: 'result item registry name' },
    count: { type: 'integer', required: false, description: 'how many to craft (default 1)' },
  },
  async run(ctx, { item, count = 1 }) {
    const short = item.includes(':') ? item.split(':')[1] : item;

    const doCraft = async () => {
      const r = await ctx.call('craft', { item, count });
      return ctx.waitTask(r.task_id, 120_000);
    };

    await ctx.say(`${short} を${count}個作るね`);
    let d = await doCraft();
    let openedTable = false;

    if (d && d.error_code === 'NEED_TABLE') {
      // 2x2では作れない — 作業台を探して開いて再試行
      const found = await ctx.call('obs.block', { block: 'minecraft:crafting_table', radius: 48 });
      if (!found.found?.length) {
        await ctx.say('作業台が近くに見つからない');
        return { done: false, reason: 'no_crafting_table' };
      }
      const t = found.found[0];
      // 距離4以内ならreachできるのでgoto不要 (GoalBlockはソリッドブロック座標に失敗しやすい)
      if ((t.dist ?? 99) > 3.5) {
        const g = await ctx.call('baritone.goto', { x: t.x, y: t.y, z: t.z });
        const gt = await ctx.waitTask(g.task_id, 60_000);
        if (!gt || gt.state !== 'succeeded') {
          await ctx.say('作業台まで行けなかった');
          return { done: false, reason: 'cannot_reach_table' };
        }
      }
      // 作業台の上面を右クリックしてGUIを開く
      await ctx.call('use_item', { x: t.x, y: t.y, z: t.z, face: 'up' });
      await ctx.sleep(400);
      const menu = await ctx.call('container.read');
      if (menu.menu_id !== 'minecraft:crafting') {
        await ctx.say('作業台を開けなかった');
        return { done: false, reason: 'table_not_open', menu: menu.menu_id };
      }
      openedTable = true;
      d = await doCraft();
      await ctx.call('container.close').catch(() => {});
    }

    if (!d) {
      await ctx.say('クラフトが時間切れ…');
      return { done: false, reason: 'timeout' };
    }
    if (d.state === 'succeeded') {
      const c = d.result?.crafted ?? count;
      await ctx.say(`${short} を${c}個作ったよ`);
      return { done: true, crafted: c };
    }
    const msg =
      d.error_code === 'NO_RECIPE' ? `${short} の作り方が分からない`
      : d.error_code === 'RECIPE_REJECTED' ? `${short} の材料が足りないみたい`
      : `${short} を作れなかった`;
    await ctx.say(msg);
    return { done: false, error: d.error_code };
  },
};
