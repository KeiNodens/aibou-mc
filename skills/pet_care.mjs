// ペットの世話 (P5): 近くのペット (オオカミ/ネコ/ウマ等) に好物を与えて回復させる。
// 餌はホットバーにあるものだけ使う。対象は entity type で探す。
const PETS = {
  'minecraft:wolf': ['minecraft:rotten_flesh', 'minecraft:beef', 'minecraft:cooked_beef',
    'minecraft:porkchop', 'minecraft:cooked_porkchop', 'minecraft:chicken',
    'minecraft:cooked_chicken', 'minecraft:mutton', 'minecraft:rabbit'],
  'minecraft:cat': ['minecraft:cod', 'minecraft:salmon', 'minecraft:cooked_cod',
    'minecraft:cooked_salmon'],
  'minecraft:horse': ['minecraft:apple', 'minecraft:golden_carrot', 'minecraft:hay_block',
    'minecraft:sugar', 'minecraft:wheat'],
  'minecraft:donkey': ['minecraft:apple', 'minecraft:golden_carrot', 'minecraft:wheat'],
  'minecraft:mule': ['minecraft:apple', 'minecraft:golden_carrot', 'minecraft:wheat'],
  'minecraft:parrot': ['minecraft:wheat_seeds', 'minecraft:pumpkin_seeds',
    'minecraft:melon_seeds', 'minecraft:beetroot_seeds'],
  'minecraft:axolotl': ['minecraft:tropical_fish_bucket'],
};

export default {
  name: 'pet_care',
  description:
    'Feed nearby pets (wolves, cats, horses, donkeys, mules, parrots, ' +
    'axolotls) with their preferred food from the hotbar to heal them.',
  params: {
    radius: { type: 'integer', required: false, description: 'search radius (default 16)' },
    type: { type: 'string', required: false, description: 'limit to one entity type id' },
  },
  async run(ctx, { radius = 16, type }) {
    const types = type ? [type] : Object.keys(PETS);
    let fed = 0;
    const details = [];
    for (const t of types) {
      ctx.throwIfCancelled();
      const foods = PETS[t];
      if (!foods) continue;
      const found = await ctx.call('obs.entity', { name: t, radius }).catch(() => null);
      if (!found?.count) continue;
      for (const e of found.entities) {
        ctx.throwIfCancelled();
        const st = await ctx.state();
        const slot = (st.inventory_detail ?? []).find(
          (s) => foods.includes(s.id) && s.slot <= 8);
        if (!slot) { details.push(`${t}: no food in hotbar`); break; }
        // 近づいてから与える
        const g = await ctx.call('baritone.goto', {
          x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z),
        }).catch(() => null);
        if (g?.task_id) await ctx.waitTask(g.task_id, 30_000);
        await ctx.call('equip', { slot: slot.slot });
        await ctx.call('look_at', { entity_id: e.entity_id }).catch(() => {});
        const r = await ctx.call('interact', { entity_id: e.entity_id }).catch(() => null);
        if (r) { fed++; details.push(`${t} @(${Math.floor(e.x)},${Math.floor(e.z)}): fed ${slot.id}`); }
        await ctx.sleep(300);
      }
    }
    if (fed) await ctx.say(`${fed}匹にごはんをあげたよ`);
    return { done: true, fed, details };
  },
};
