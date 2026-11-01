// ドラゴン戦の相方 (D47): 役割分担が前提の補助スキル。
// bot の仕事: 止まり木に降りたドラゴンへの近接、弓があれば
// クリスタルへの射撃、残り数の実況。空を飛ぶ本体への遠距離は
// プレイヤーに任せる (当たらないので)。
// 開始時に彫刻カボチャがあれば被る (エンダーマンの視線対策)。
export default {
  name: 'dragon_fight',
  description:
    'Assist in the Ender Dragon fight with role-splitting: the ' +
    'bot melees the dragon while it is perched on the exit portal, ' +
    'shoots End Crystals when it has a bow and arrows, and calls ' +
    'out crystal counts. Equips a carved pumpkin first if one is ' +
    'carried (Enderman gaze safety). Ends when the dragon is gone.',
  params: {
    seconds: { type: 'integer', required: false, description: 'max duration (default 600)' },
  },
  async run(ctx, { seconds = 600 }) {
    const st0 = await ctx.state().catch(() => null);
    const inv0 = st0?.inventory ?? {};
    let pumpkin = false;
    if ((inv0['minecraft:carved_pumpkin'] ?? 0) > 0) {
      const eq = await ctx.call('equip', {
        item: 'minecraft:carved_pumpkin', slot_name: 'head',
      }).catch(() => null);
      pumpkin = !!eq;
    }
    const hasBow = (st0?.inventory_detail ?? []).some((d) =>
      d.id === 'minecraft:bow' || d.id === 'minecraft:crossbow');
    const hasArrows = Object.keys(inv0).some((id) => id.includes('arrow'));
    const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
    const byName = async (name) => ents(await ctx.call('obs.entity',
      { name }).catch(() => null));
    const deadline = Date.now() + seconds * 1000;
    let seenDragon = false;
    let engages = 0;
    let shotsFired = 0;
    let crystals0 = null;
    let lastCrystalCount = null;
    let announcedBow = false;
    await ctx.say('ドラゴン戦、相方するよ。止まり木に来たら殴るね');
    while (Date.now() < deadline) {
      ctx.throwIfCancelled();
      const dragon = (await byName('minecraft:ender_dragon'))[0];
      if (!dragon) {
        if (seenDragon) {
          await ctx.say('ドラゴン倒れた！');
          const left = (await byName('minecraft:end_crystal')).length;
          return {
            done: true, dragon_slain: true, engages, shots_fired: shotsFired,
            crystals_destroyed: (crystals0 ?? 0) - left, pumpkin,
          };
        }
        await ctx.sleep(1500);
        continue;
      }
      seenDragon = true;
      const crystals = await byName('minecraft:end_crystal');
      if (crystals0 === null) crystals0 = crystals.length;
      if (lastCrystalCount !== crystals.length) {
        if (lastCrystalCount !== null) {
          await ctx.say(`クリスタル残り${crystals.length}`).catch(() => {});
        } else if (crystals.length > 0 && !hasBow && !announcedBow) {
          announcedBow = true;
          await ctx.say(`クリスタル${crystals.length}個ある。弓で撃ってくれると助かる`).catch(() => {});
        }
        lastCrystalCount = crystals.length;
      }
      const me = (await ctx.state().catch(() => null))?.pos;
      const perched = me
        ? (Math.hypot(dragon.x, dragon.z) < 14 && dragon.y < me.y + 8)
        : false;
      if (perched) {
        const eng = await ctx.call('combat.engage', {
          entity_id: dragon.id, max_seconds: 15, hp_abort: 4,
        }).catch(() => null);
        if (eng?.task_id) {
          engages++;
          await ctx.waitTask(eng.task_id, 20_000).catch(() => null);
        }
        continue;
      }
      if (crystals.length && hasBow && hasArrows) {
        const bowItem = (await ctx.state().catch(() => null))
          ?.inventory_detail?.find((d) =>
            d.id === 'minecraft:bow' || d.id === 'minecraft:crossbow');
        if (bowItem) await ctx.call('equip', { item: bowItem.id }).catch(() => {});
        const c = crystals[0];
        const sh = await ctx.call('combat.shoot', {
          entity_id: c.id, max_shots: 3, max_seconds: 25,
        }).catch(() => null);
        if (sh?.task_id) {
          const ev = await ctx.waitTask(sh.task_id, 30_000).catch(() => null);
          shotsFired += ev?.result?.shots ?? 0;
        }
        continue;
      }
      await ctx.sleep(1500);
    }
    return {
      done: false, reason: 'timeout', dragon_slain: false,
      engages, shots_fired: shotsFired, pumpkin,
    };
  },
};
