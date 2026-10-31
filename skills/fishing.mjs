// 釣り (P5): 竿を投げて浮き (fishing_bobber) の沈み込みでアタリを検知し、
// 合わせて引き上げる。釣果はインベントリ差分で数える。
const FISH_ITEMS = [
  'minecraft:cod', 'minecraft:salmon', 'minecraft:tropical_fish',
  'minecraft:pufferfish', 'minecraft:enchanted_book', 'minecraft:bow',
  'minecraft:fishing_rod', 'minecraft:name_tag', 'minecraft:nautilus_shell',
  'minecraft:lily_pad', 'minecraft:bowl', 'minecraft:leather',
  'minecraft:leather_boots', 'minecraft:rotten_flesh', 'minecraft:stick',
  'minecraft:string', 'minecraft:glass_bottle', 'minecraft:tripwire_hook',
  'minecraft:ink_sac', 'minecraft:bamboo', 'minecraft:cocoa_beans',
];

function totalFish(state) {
  const sum = state.inventory_summary ?? {};
  let n = 0;
  for (const id of FISH_ITEMS) n += sum[id] ?? 0;
  return n;
}

export default {
  name: 'fishing',
  description:
    'Fish at the current spot: cast the rod, watch the bobber for a bite, ' +
    'reel in, and repeat. The rod must be in the hotbar. Stops after the ' +
    'requested number of catches or casts.',
  params: {
    catches: { type: 'integer', required: false, description: 'stop after this many catches (default 3)' },
    max_casts: { type: 'integer', required: false, description: 'give up after this many casts (default 10)' },
  },
  async run(ctx, { catches = 3, max_casts = 10 }) {
    const st0 = await ctx.state();
    const rod = (st0.inventory_detail ?? []).find(
      (s) => s.id === 'minecraft:fishing_rod' && s.slot <= 8);
    if (!rod) {
      await ctx.say('釣り竿がホットバーに無い');
      return { done: false, reason: 'no_rod_in_hotbar' };
    }
    await ctx.call('equip', { slot: rod.slot });
    let got = 0;
    let casts = 0;
    while (got < catches && casts < max_casts) {
      ctx.throwIfCancelled();
      casts++;
      const before = totalFish(await ctx.state());
      await ctx.call('use_item', {}); // cast
      // 浮きが出るまで待つ
      let bobber = null;
      for (let i = 0; i < 20 && !bobber; i++) {
        await ctx.sleep(250);
        const f = await ctx.call('obs.entity', {
          name: 'minecraft:fishing_bobber', radius: 32,
        }).catch(() => null);
        if (f?.count) bobber = f.entities[0];
      }
      if (!bobber) continue; // 投げ損ね
      // アタリ待ち: 浮きが素早く沈む (y が 0.2 以上下がる) のを検知
      let prevY = bobber.y;
      let bite = false;
      for (let i = 0; i < 160 && !bite; i++) { // 最大40秒
        await ctx.sleep(250);
        ctx.throwIfCancelled();
        const f = await ctx.call('obs.entity', {
          name: 'minecraft:fishing_bobber', radius: 32,
        }).catch(() => null);
        if (!f?.count) { bite = true; break; } // 浮きが消えた = 食った/切れた
        const y = f.entities[0].y;
        if (prevY - y >= 0.2) bite = true;
        prevY = y;
      }
      await ctx.call('use_item', {}); // reel in
      await ctx.sleep(800);
      const after = totalFish(await ctx.state());
      if (after > before) {
        got += after - before;
        ctx.journal?.checkpoint(`catch_${got}`, {});
        await ctx.say(`釣れた! (${got}/${catches})`);
      }
    }
    return { done: got > 0, catches: got, casts };
  },
};
