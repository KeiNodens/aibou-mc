// ブランチマイニング (D30): 向いている方角へ 1x2 トンネルを真っ直ぐ
// 掘り進む。任意で左右の支坑 (spur) も掘る。溶岩・岩盤で停止。
// 掘った鉱石を数え、torch_every ごとに松明を置く。
async function gotoCell(ctx, x, y, z) {
  const g = await ctx.call('baritone.goto', { x, y, z }).catch(() => null);
  if (g?.task_id) await ctx.waitTask(g.task_id, 20_000).catch(() => null);
}
function hotbarSlot(state, item) {
  return (state?.inventory_detail ?? []).find((s) => s.id === item && s.slot <= 8);
}

export default {
  name: 'branch_mine',
  description:
    'Branch mining: dig a straight 1x2 tunnel in the facing direction, ' +
    'optionally with side spurs every N blocks. Stops at lava or ' +
    'bedrock. Counts ores dug and places torches periodically (needs ' +
    'torches in the hotbar).',
  params: {
    length: { type: 'integer', required: false, description: 'tunnel length in blocks (default 32, max 128)' },
    spur_every: { type: 'integer', required: false, description: 'dig side spurs every N blocks (0 = off, default 0)' },
    spur_length: { type: 'integer', required: false, description: 'spur length (default 3)' },
    torch_every: { type: 'integer', required: false, description: 'torch interval (default 8, 0 = off)' },
    mode: { type: 'string', required: false, description: 'auto (default: together when a player is nearby) / together / solo' },
  },
  async run(ctx, { length = 32, spur_every = 0, spur_length = 3, torch_every = 8, mode = 'auto' }) {
    const st = await ctx.state();
    // 同伴判定: 近くにプレイヤーがいたら一緒に掘る形 (D36)
    const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
    let mate = null;
    if (mode !== 'solo') {
      const all = ents(await ctx.call('obs.entity', { name: 'minecraft:player', radius: 32 }).catch(() => null));
      mate = all.find((e) => e.name && e.name !== st?.name) ?? null;
    }
    const together = mode === 'together' || (mode === 'auto' && !!mate);
    let waits = 0;
    if (together) await ctx.say('一緒に掘るね。置いてかないから、ついてきて').catch(() => {});
    const start = { x: Math.floor(st.pos.x), y: Math.floor(st.pos.y), z: Math.floor(st.pos.z) };
    const yawRad = ((st.pos.yaw ?? 0) * Math.PI) / 180;
    let dx = -Math.sin(yawRad);
    let dz = Math.cos(yawRad);
    if (Math.abs(dx) > Math.abs(dz)) { dx = Math.sign(dx); dz = 0; } else { dz = Math.sign(dz); dx = 0; }
    const ores = {};
    let dug = 0;
    let torches = 0;
    let stopped = null;

    const bsAt = async (x, y, z) =>
      (await ctx.call('obs.block_state', { x, y, z }).catch(() => null))?.block;
    const digCell = async (x, y, z, dirx, dirz) => {
      // 掘る対象を先に確定 (上段→下段)
      const targets = [];
      for (const dy of [1, 0]) {
        const id = await bsAt(x, y + dy, z);
        if (!id || id === 'minecraft:air' || id === 'minecraft:water') continue;
        if (id.includes('lava')) return 'lava';
        if (id === 'minecraft:bedrock') return 'bedrock';
        targets.push({ y: y + dy, id });
      }
      if (!targets.length) return null;
      // 危険の先読み (D38): 進行方向の奥に溶岩 / 掘るセルの横に溶岩
      for (const dy of [0, 1]) {
        const b = await bsAt(x + dirx, y + dy, z + dirz);
        if (b?.includes('lava')) return 'lava_ahead';
      }
      for (const t of targets) {
        for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = await bsAt(x + nx, t.y, z + nz);
          if (n?.includes('lava')) return 'lava_adjacent';
        }
      }
      for (const t of targets) {
        await ctx.call('dig', { x, y: t.y, z }).catch(() => {});
        dug++;
        if (t.id.includes('_ore') || t.id === 'minecraft:ancient_debris') {
          ores[t.id] = (ores[t.id] ?? 0) + 1;
        }
        await ctx.sleep(420);
      }
      return null;
    };
    const digRun = async (sx, sz, dirx, dirz, n) => {
      let cx = sx, cz = sz;
      for (let i = 0; i < n; i++) {
        cx += dirx; cz += dirz;
        const r = await digCell(cx, start.y, cz, dirx, dirz);
        if (r) return { x: cx, z: cz, stop: r };
        // 落下ガード: 進む先の足元が無ければ進まない
        const floor = await bsAt(cx, start.y - 1, cz);
        if (!floor || floor === 'minecraft:air' || floor === 'minecraft:cave_air'
          || floor === 'minecraft:void_air' || floor === 'minecraft:water') {
          return { x: cx - dirx, z: cz - dirz, stop: 'drop' };
        }
        await gotoCell(ctx, cx, start.y, cz);
      }
      return { x: cx, z: cz, stop: null };
    };

    let cx = start.x, cz = start.z;
    for (let step = 1; step <= Math.min(length, 128) && !stopped; step++) {
      ctx.throwIfCancelled();
      const r = await digRun(cx, cz, dx, dz, 1);
      cx = r.x; cz = r.z;
      if (r.stop) { stopped = r.stop; break; }
      if (spur_every > 0 && step % spur_every === 0) {
        for (const side of [-1, 1]) {
          const px = side * dz, pz = side * dx; // 垂直方向
          const sr = await digRun(cx, cz, px, pz, spur_length);
          if (sr.stop) { stopped = sr.stop; break; }
          // 支坑を逆順に戻る (掘ったので通れる)
          for (let b = spur_length; b >= 1; b--) {
            await gotoCell(ctx, cx + px * (b - 1), start.y, cz + pz * (b - 1));
          }
        }
      }
      // 同伴: プレイヤーが離れすぎたら合流を待つ (8 step ごと)
      if (together && mate && step % 8 === 0 && !stopped) {
        for (let w = 0; w < 60; w++) {
          const plNow = ents(await ctx.call('obs.entity', { name: mate.name }).catch(() => null))[0];
          if (!plNow) break;
          const d = Math.hypot(plNow.x - cx, plNow.z - cz);
          if (d <= 24) break;
          if (w === 0) {
            waits++;
            await ctx.say('先行っちゃった。ここで待ってるね').catch(() => {});
          }
          await ctx.sleep(1500);
        }
      }
      if (torch_every > 0 && step % torch_every === 0 && !stopped) {
        const stNow = await ctx.state().catch(() => null);
        const slot = hotbarSlot(stNow, 'minecraft:torch');
        if (slot) {
          await ctx.call('equip', { slot: slot.slot }).catch(() => {});
          await ctx.call('use_item', { x: cx, y: start.y - 1, z: cz, face: 'up' }).catch(() => {});
          torches++;
        }
      }
    }
    const stopLine = {
      lava: '溶岩に当たったから止まったよ',
      lava_ahead: '奥に溶岩があるから止まったよ',
      lava_adjacent: '横に溶岩があるから止まったよ',
      bedrock: '岩盤に当たったから止まったよ',
      drop: '足元が落ちてるから止まったよ',
    }[stopped];
    await ctx.say(stopped
      ? `${stopLine}。${dug}ブロック掘った`
      : `掘り終わった。${dug}ブロック掘ったよ`);
    return { done: !stopped, dug, ores, torches, stopped, waits, together, end: { x: cx, y: start.y, z: cz } };
  },
};
