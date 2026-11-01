// ワープ (Waystones、D25 draft):
// 近くの waystone を開き、宛先一覧 (Screen のボタン) から名前で選んで飛ぶ。
// Waystones の選択 GUI はメニューではなく Screen なので screen ops で扱う。
async function gotoPos(ctx, pos) {
  const g = await ctx.call('baritone.goto', { x: pos.x, y: pos.y, z: pos.z });
  if (g?.task_id) await ctx.waitTask(g.task_id, 60_000);
  await ctx.call('look_at', { x: pos.x, y: pos.y, z: pos.z }).catch(() => {});
}

export default {
  name: 'warp',
  description:
    'Warp with a nearby Waystones waystone: open it and pick the ' +
    'destination by name from the selection screen. Draft: the ' +
    'selection GUI is a plain Screen handled via screen ops.',
  params: {
    name: { type: 'string', required: true, description: 'destination waystone name (partial match)' },
    x: { type: 'integer', required: false, description: 'waystone X (default: nearest within 24)' },
    y: { type: 'integer', required: false },
    z: { type: 'integer', required: false },
  },
  async run(ctx, args) {
    let pos = null;
    if (args.x != null && args.y != null && args.z != null)
      pos = { x: args.x, y: args.y, z: args.z };
    else {
      const found = await ctx.call('obs.block', {
        block: 'waystones:waystone', radius: 24,
      }).catch(() => null);
      pos = found?.found?.[0] ?? null;
    }
    if (!pos) return { done: false, reason: 'waystone_not_found' };
    await gotoPos(ctx, pos);
    await ctx.call('use_item', { x: pos.x, y: pos.y, z: pos.z });
    await ctx.sleep(700);
    const scr = await ctx.call('screen.read').catch(() => null);
    const widgets = scr?.widgets ?? scr?.buttons ?? [];
    const texts = widgets.map((w) => w.text ?? w.label ?? '').filter(Boolean);
    const hit = texts.find((t) => t.toLowerCase().includes(args.name.toLowerCase()));
    if (!hit) {
      await ctx.call('screen.close').catch(() => {});
      return { done: false, reason: 'destination_not_listed', listed: texts };
    }
    await ctx.call('screen.click', { text: hit });
    await ctx.sleep(1000);
    await ctx.say(`${hit} へワープしたよ`);
    return { done: true, destination: hit, from: pos };
  },
};
