// 携行チェック (D38): 洞窟や遠出の前に、松明・食料・予備ツルハシが
// 足りているかを所持品実測で確認する汎用版 (expedition_prep の
// 宇宙装備特化に対する日常版)。
const FOOD_KEYS = [
  'bread', 'cooked', 'apple', 'carrot', 'potato', 'beef', 'porkchop',
  'chicken', 'mutton', 'cod', 'salmon', 'berries', 'melon_slice',
  'pumpkin_pie', 'beetroot', 'dried_kelp', 'cookie',
];

export default {
  name: 'outing_prep',
  description:
    'Pre-outing carry check from the real inventory: torches, food ' +
    'items, and spare pickaxes against configurable minimums. ' +
    'Reports what is short. General-purpose sibling of ' +
    'expedition_prep (which is space-suit specific).',
  params: {
    torches_min: { type: 'integer', required: false, description: 'minimum torches (default 16)' },
    food_min: { type: 'integer', required: false, description: 'minimum food items (default 3)' },
    pickaxes_min: { type: 'integer', required: false, description: 'minimum pickaxes incl. the one in hand (default 2)' },
  },
  async run(ctx, { torches_min = 16, food_min = 3, pickaxes_min = 2 }) {
    const st = await ctx.state();
    const summary = st?.inventory ?? st?.inventory_summary ?? {};
    const detail = st?.inventory_detail ?? [];
    const torches = summary['minecraft:torch'] ?? 0;
    let food = 0;
    for (const [id, n] of Object.entries(summary)) {
      if (FOOD_KEYS.some((k) => id.includes(k))) food += n ?? 0;
    }
    const pickaxes = detail
      .filter((s) => String(s.id).endsWith('pickaxe'))
      .reduce((a, s) => a + (s.count ?? 1), 0);
    const missing = [];
    if (torches < torches_min) missing.push(`松明 ${torches}/${torches_min}`);
    if (food < food_min) missing.push(`食料 ${food}/${food_min}`);
    if (pickaxes < pickaxes_min) missing.push(`ツルハシ ${pickaxes}/${pickaxes_min} (予備が要る)`);
    const ok = missing.length === 0;
    await ctx.say(ok
      ? '持ち物は足りてるよ'
      : `出発前に足りないもの: ${missing.join(' / ')}`);
    return {
      done: true, ok,
      have: { torches, food, pickaxes },
      want: { torches: torches_min, food: food_min, pickaxes: pickaxes_min },
      missing,
    };
  },
};
