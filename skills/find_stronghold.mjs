// 要塞探し補助 (D47): エンダーアイを1つ投げて、飛んだ方角を
// 観測して報告する。三角測量はできないので、進みながら繰り返す
// 使い方が前提 (LLM が呼び直す)。follow:true でその方向へ
// 少し進む。
export default {
  name: 'find_stronghold',
  description:
    'Throw one Eye of Ender and watch where it flies: reports the ' +
    'compass bearing toward the stronghold (one throw gives a ' +
    'direction, not a distance — repeat while travelling). With ' +
    'follow:true the bot also walks ~30 blocks that way.',
  params: {
    follow: { type: 'boolean', required: false, description: 'walk in the thrown direction (default false)' },
  },
  async run(ctx, { follow = false }) {
    const st = await ctx.state();
    const eyes = (st?.inventory ?? {})['minecraft:ender_eye'] ?? 0;
    if (eyes < 1) return { done: false, reason: 'no_ender_eye' };
    const from = { x: st.pos.x, z: st.pos.z };
    await ctx.call('equip', { item: 'minecraft:ender_eye' }).catch(() => {});
    await ctx.call('use_item', {}).catch(() => null);
    const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
    let last = null;
    for (let i = 0; i < 14; i++) {
      await ctx.sleep(250);
      const eye = ents(await ctx.call('obs.entity',
        { name: 'minecraft:eye_of_ender' }).catch(() => null))[0];
      if (eye) last = { x: eye.x, y: eye.y, z: eye.z };
      else if (last) break;
    }
    if (!last) return { done: false, reason: 'eye_not_seen' };
    const dx = last.x - from.x;
    const dz = last.z - from.z;
    const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    const compass = dirs[Math.round(deg / 45) % 8];
    await ctx.say(`目は${compass}の方に飛んだよ`);
    if (follow) {
      const len = Math.hypot(dx, dz) || 1;
      const g = await ctx.call('baritone.goto', {
        x: Math.floor(from.x + (dx / len) * 30),
        z: Math.floor(from.z + (dz / len) * 30),
      }).catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 60_000).catch(() => null);
    }
    return {
      done: true, threw: true,
      direction_deg: Math.round(deg * 10) / 10, compass,
      toward: { x: last.x, z: last.z },
    };
  },
};
