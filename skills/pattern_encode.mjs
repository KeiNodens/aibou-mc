// AE2 パターン作成 (D30 ドラフト): Pattern Encoding Terminal を開いて
// レイアウトを実測し、encode ボタンらしきものがあれば押すところまで。
// スロット配置はバージョン・設定で変わるため、v1 は「調査+試行」で、
// 何が見えて何をしたかを正直に返す。材料の流し込みは未対応。
export default {
  name: 'pattern_encode',
  description:
    'DRAFT: probe an AE2 Pattern Encoding Terminal at x/y/z — opens ' +
    'it, reports the real slot layout, and presses an encode-like ' +
    'button when one is exposed. Item placement into pattern slots is ' +
    'not automated yet (layout differs per version/config).',
  params: {
    x: { type: 'integer', required: true, description: 'terminal x' },
    y: { type: 'integer', required: true, description: 'terminal y' },
    z: { type: 'integer', required: true, description: 'terminal z' },
  },
  async run(ctx, { x, y, z }) {
    const g = await ctx.call('baritone.goto', { x, y, z }).catch(() => null);
    if (g?.task_id) await ctx.waitTask(g.task_id, 60_000).catch(() => null);
    await ctx.call('use_item', { x, y, z }).catch(() => {});
    await ctx.sleep(900);
    const read = await ctx.call('container.read').catch(() => null);
    const probe = {
      menu_id: read?.menu_id ?? null,
      slots: (read?.slots ?? []).map((s) => ({ slot: s.slot, id: s.id ?? null, count: s.count ?? null })),
      buttons: read?.buttons ?? null,
      keys: read ? Object.keys(read) : [],
    };
    let encodeAttempt = null;
    const btns = Array.isArray(read?.buttons) ? read.buttons : [];
    const enc = btns.find((b) => String(b.id ?? b.name ?? '').toLowerCase().includes('encode') ||
      String(b.id ?? b.name ?? '').toLowerCase().includes('confirm'));
    if (enc) {
      await ctx.call('container.button', { button_id: enc.id ?? enc.name }).catch(() => {});
      encodeAttempt = { pressed: enc.id ?? enc.name };
      await ctx.sleep(600);
    }
    await ctx.call('container.close').catch(() => {});
    return { done: true, draft: true, probe, encode_attempt: encodeAttempt };
  },
};
