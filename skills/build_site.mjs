// サイト建築 (D50): 複数の schematic を配置関係つきで束ねた
// 「サイト計画」を順に建てる。工場は1枚絵ではなく部品の束、
// という大規模側の単位。各部品は build_schematic に委ねる。
import { readFile } from 'node:fs/promises';
import buildSchematic from './build_schematic.mjs';

export default {
  name: 'build_site',
  description:
    'Build a whole site: a plan (JSON string or a file path) of ' +
    'parts [{file, dx, dy, dz, rotation?, mirror?, max_blocks?}] ' +
    'placed relative to one origin, built in order via ' +
    'build_schematic. Stops at the first failing part and reports ' +
    'per-part results.',
  params: {
    site: { type: 'string', required: true, description: 'site plan JSON or path to a JSON file' },
    x: { type: 'integer', required: true, description: 'origin X' },
    y: { type: 'integer', required: true, description: 'origin Y' },
    z: { type: 'integer', required: true, description: 'origin Z' },
  },
  async run(ctx, { site, x, y, z }) {
    let plan;
    try {
      plan = JSON.parse(site.trim().startsWith('{')
        ? site : await readFile(site, 'utf8'));
    } catch (e) {
      return { done: false, reason: 'site_unreadable', error: String(e?.message ?? e) };
    }
    const parts = Array.isArray(plan?.parts) ? plan.parts : [];
    if (!parts.length) return { done: false, reason: 'empty_site' };
    const results = [];
    let placedTotal = 0;
    for (let i = 0; i < parts.length; i++) {
      ctx.throwIfCancelled();
      const p = parts[i];
      const r = await buildSchematic.run(ctx, {
        file: p.file,
        x: x + (p.dx ?? 0), y: y + (p.dy ?? 0), z: z + (p.dz ?? 0),
        rotation: p.rotation ?? 0,
        mirror: p.mirror,
        max_blocks: p.max_blocks,
      }).catch((e) => ({ done: false, reason: String(e?.message ?? e) }));
      results.push({ file: p.file, ...r });
      placedTotal += r?.placed ?? 0;
      if (r?.done === false && !r?.placed) {
        return {
          done: false, reason: 'part_failed', failed_part: i,
          placed_total: placedTotal, parts: results,
        };
      }
    }
    await ctx.say(`サイト建築終わり。${parts.length}部品、${placedTotal}ブロック置いたよ`);
    return { done: true, parts: results, placed_total: placedTotal };
  },
};
