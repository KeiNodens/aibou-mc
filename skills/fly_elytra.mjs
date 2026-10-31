// エリトラ飛行 (P5, MVP): 高所から飛び降りて滑空し、花火で加速しながら
// 目標座標の上空まで飛ぶ。着地は自然落下に任せる。
// 安全条件: 落差8以上が無い場所からは離陸しない。花火はホットバー必須。
// 注意: MVP — 障害物回避はしない。開けた場所専用。
export default {
  name: 'fly_elytra',
  description:
    'Glide with an elytra from a high launch point toward target ' +
    'coordinates, boosting with firework rockets. MVP: no obstacle ' +
    'avoidance; needs an 8+ block drop at the launch point, an elytra ' +
    'anywhere in the inventory, and firework rockets in the hotbar.',
  params: {
    x: { type: 'integer', required: true, description: 'target X' },
    z: { type: 'integer', required: true, description: 'target Z' },
    max_seconds: { type: 'integer', required: false, description: 'flight timeout (default 90)' },
  },
  async run(ctx, { x, z, max_seconds = 90 }) {
    const st = await ctx.state();
    const hasElytra = (st.inventory_detail ?? []).some(
      (s) => s.id === 'minecraft:elytra');
    const rocket = (st.inventory_detail ?? []).find(
      (s) => s.id === 'minecraft:firework_rocket' && s.slot <= 8);
    if (!hasElytra) {
      await ctx.say('エリトラを持っていない');
      return { done: false, reason: 'no_elytra' };
    }
    if (!rocket) {
      await ctx.say('花火がホットバーに無い');
      return { done: false, reason: 'no_rockets_in_hotbar' };
    }
    // 落差チェック: 足元から下方向に空きがあるか
    const me = st.pos;
    let drop = 0;
    for (let dy = 1; dy <= 24; dy++) {
      const b = await ctx.call('obs.block_state', {
        x: Math.floor(me.x), y: Math.floor(me.y) - dy, z: Math.floor(me.z),
      }).catch(() => null);
      if (b && b.block !== 'minecraft:air') break;
      drop = dy;
    }
    if (drop < 8) {
      await ctx.say('ここは落差が足りない。もっと高い所から飛ぶね');
      return { done: false, reason: 'insufficient_drop', drop };
    }

    await ctx.call('equip', { item: 'minecraft:elytra', slot_name: 'chest' });
    await ctx.call('equip', { slot: rocket.slot });
    await ctx.say(`エリトラで (${x}, ${z}) へ飛ぶよ`);

    // 目標方向を向いて前進 → 落下中にジャンプキーで展開
    await ctx.call('look_at', { x, y: Math.floor(me.y), z });
    await ctx.call('move.set', { forward: true, sprint: true });
    let deployed = false;
    for (let i = 0; i < 20 && !deployed; i++) {
      await ctx.sleep(200);
      const s = await ctx.state();
      if (!s.on_ground) {
        await ctx.call('key', { mapping: 'jump', press: true }).catch(() => {});
        deployed = true;
      }
    }
    await ctx.call('move.stop').catch(() => {});
    if (!deployed) return { done: false, reason: 'never_airborne' };

    // 滑空ループ: 目標を向き続け、4秒ごとに花火で加速
    const deadline = Date.now() + max_seconds * 1000;
    let lastBoost = 0;
    let landed = false;
    while (Date.now() < deadline) {
      ctx.throwIfCancelled();
      const s = await ctx.state();
      if (s.on_ground) { landed = true; break; }
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const hd = Math.hypot(dx, dz);
      if (hd < 6) break;
      await ctx.call('look_at', { x, y: Math.floor(s.pos.y) - 2, z }).catch(() => {});
      if (Date.now() - lastBoost > 4000) {
        lastBoost = Date.now();
        const r = await ctx.state();
        const rk = (r.inventory_detail ?? []).find(
          (sl) => sl.id === 'minecraft:firework_rocket' && sl.slot <= 8);
        if (!rk) break;
        await ctx.call('equip', { slot: rk.slot });
        await ctx.call('use_item', {}).catch(() => {});
      }
      await ctx.sleep(500);
    }
    const end = await ctx.state();
    const hd = Math.round(Math.hypot(x - end.pos.x, z - end.pos.z));
    await ctx.say(landed || hd < 16
      ? `着いたよ (目標まで約${hd}ブロック)`
      : `飛行を打ち切った (目標まで約${hd}ブロック)`);
    return { done: hd < 16, distance_remaining: hd, landed };
  },
};
