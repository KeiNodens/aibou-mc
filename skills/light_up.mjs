// 建築後の明かり (D37): 建て終わった屋内に、幾何学的な間隔ルールで
// 松明を置く。設計に明かりを混ぜず、後付けのパスとして分離する。
// 光量は読めないため spacing (既定5) 以内に1本の格子で湧き潰しを狙う。
// 配置は BuildTask (build.place)、松明は所持品から消費される。
export default {
  name: 'light_up',
  description:
    'Place torches inside a finished structure on a spacing grid ' +
    '(post-build lighting pass, kept separate from the design). ' +
    'y is the floor level (same convention as the build origin): ' +
    'torches are placed standing on the floor at y+1. Reports how ' +
    'many were needed vs placed when torches run short.',
  params: {
    x: { type: 'integer', required: true, description: 'footprint origin X' },
    y: { type: 'integer', required: true, description: 'floor level Y (torches go at y+1)' },
    z: { type: 'integer', required: true, description: 'footprint origin Z' },
    size_x: { type: 'integer', required: true, description: 'footprint size X' },
    size_z: { type: 'integer', required: true, description: 'footprint size Z' },
    spacing: { type: 'integer', required: false, description: 'grid spacing (default 5)' },
  },
  async run(ctx, { x, y, z, size_x, size_z, spacing = 5 }) {
    const sp = Math.max(3, Math.min(spacing, 8));
    const off = Math.floor(sp / 2);
    const spots = [];
    for (let lx = 1; lx < size_x - 1; lx++) {
      for (let lz = 1; lz < size_z - 1; lz++) {
        if (lx % sp === off && lz % sp === off) {
          spots.push({ x: x + lx, y: y + 1, z: z + lz, id: 'minecraft:torch' });
        }
      }
    }
    if (!spots.length) return { done: true, needed: 0, placed: 0 };
    const st = await ctx.state().catch(() => null);
    const summary = st?.inventory ?? st?.inventory_summary ?? {};
    const have = summary['minecraft:torch'] ?? 0;
    const use = spots.slice(0, have);
    let placed = 0;
    if (use.length) {
      const t = await ctx.call('build.place', { blocks: use }).catch(() => null);
      if (t?.task_id) {
        const ev = await ctx.waitTask(t.task_id, use.length * 5_000 + 30_000)
          .catch(() => null);
        placed = ev?.result?.placed ?? 0;
      }
    }
    const shortage = spots.length - placed;
    await ctx.say(shortage > 0
      ? `明かり、${placed}本置いた。松明不足で${shortage}箇所残ってる`
      : `明かり置いたよ。${placed}本`);
    return {
      done: shortage <= 0, needed: spots.length, placed,
      shortage, spacing: sp,
    };
  },
};
