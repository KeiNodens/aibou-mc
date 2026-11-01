// 遠征準備チェック (D30): 宇宙服などの装備・酸素タンク・食料・松明が
// 揃っているかをインベントリ実測で確認する (Ad Astra 想定だが汎用)。
export default {
  name: 'expedition_prep',
  description:
    'Pre-expedition checklist measured from the real inventory: suit ' +
    'pieces equipped (armor slots, by id prefix), oxygen tank present, ' +
    'food and torches stocked, plus caller-specified required items.',
  params: {
    suit_prefix: { type: 'string', required: false, description: 'armor id prefix (default ad_astra:)' },
    extra: { type: 'string', required: false, description: 'comma-separated extra required item ids' },
    mode: { type: 'string', required: false, description: 'auto (default) / together / solo — together: also check a nearby player armor (visible range)' },
  },
  async run(ctx, { suit_prefix = 'ad_astra:', extra, mode = 'auto' }) {
    const st = await ctx.state();
    const detail = st?.inventory_detail ?? [];
    const summary = st?.inventory ?? {};
    const armor = detail.filter((s) => s.slot >= 36 && s.slot <= 39);
    const suitPieces = armor.filter((s) => (s.id ?? '').startsWith(suit_prefix)).length;
    const hasTank = Object.keys(summary).some((id) => id.includes('oxygen_tank'));
    const torches = summary['minecraft:torch'] ?? 0;
    const missing = [];
    if (suitPieces < 4) missing.push(`suit pieces ${suitPieces}/4 equipped`);
    if (!hasTank) missing.push('oxygen tank not in inventory');
    if ((st?.hunger ?? 20) < 10) missing.push('hunger is low');
    if (torches < 8) missing.push(`torches ${torches} (<8)`);
    for (const id of (extra ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!summary[id]) missing.push(`missing item: ${id}`);
    }
    // 同伴: 近くのプレイヤーの装備 (見える範囲 = 防具) もチェック (D36)
    let playerSection = null;
    if (mode !== 'solo') {
      const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
      const all = ents(await ctx.call('obs.entity', { name: 'minecraft:player', radius: 32 }).catch(() => null));
      const mate = all.find((e) => e.name && e.name !== st?.name);
      if (mate && Array.isArray(mate.armor)) {
        const pSuit = mate.armor.filter((a) => (a.id ?? '').startsWith(suit_prefix)).length;
        playerSection = {
          name: mate.name, suit_pieces: pSuit,
          armor: mate.armor.map((a) => a.id),
        };
        await ctx.say(`${mate.name}の装備も見たよ: スーツ${pSuit}/4${pSuit < 4 ? ' (足りない分ある)' : ''}`).catch(() => {});
      }
    }
    const ok = missing.length === 0;
    await ctx.say(ok ? '遠征の準備は揃ってるよ' : `遠征準備、足りないもの: ${missing.join(' / ')}`);
    return { done: true, ok, suit_pieces: suitPieces, has_tank: hasTank, torches, hunger: st?.hunger, missing, player: playerSection };
  },
};
