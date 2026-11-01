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

    // 滑空の姿勢制御は mod 側 GlideTask (D33)。花火ブーストだけ
    // bridge から定期的に撃つ (加速は制御ほど詰めていないため)
    const gt = await ctx.call('glide.start', {
      x, y: Math.floor(me.y), z, max_seconds,
    }).catch(() => null);
    if (!gt?.task_id) return { done: false, reason: 'op_unavailable' };
    const deadline = Date.now() + (max_seconds + 10) * 1000;
    let ev = null;
    while (Date.now() < deadline) {
      ctx.throwIfCancelled();
      await ctx.sleep(4000);
      const st2 = await ctx.call('task.status', { task_id: gt.task_id })
        .catch(() => null);
      if (!st2 || st2.state === 'succeeded' || st2.state === 'failed'
        || st2.state === 'cancelled') {
        ev = st2;
        break;
      }
      await ctx.call('use_item', {}).catch(() => {}); // 花火ブースト
    }
    const reason = ev?.result?.reason ?? ev?.error_code ?? 'timeout';
    const arrived = reason === 'arrived';
    if (arrived) await ctx.say(`(${x}, ${z}) の上空に着いたよ`);
    return { done: arrived, reason, via: 'glide_task' };
  },
};
