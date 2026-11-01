// ディメンションプロファイル (D48): 次元ごとの「暮らしの規則」
// (寝られるか・敵対テーブル・危険・メモ) を橋側データとして
// 保持する。バニラ3次元は組み込み、未知の次元はプレイヤーと
// 探索しながら LLM が set で下書きしていく (D43 の原則:
// 未知を先回りで潰さず、一緒に探索する)。
import { writeFile, readFile } from 'node:fs/promises';

const FILE_URL = new URL('../data/dimension-profiles.json', import.meta.url);
const BUILTINS = {
  'minecraft:overworld': {
    label: 'オーバーワールド', sleep: 'works', hazards: [], builtin: true,
  },
  'minecraft:the_nether': {
    label: 'ネザー', sleep: 'explodes',
    hazards: ['lava_sea', 'ghast_fireballs', 'long_falls'], builtin: true,
  },
  'minecraft:the_end': {
    label: 'エンド', sleep: 'explodes', hazards: ['void'], builtin: true,
  },
};

async function load() {
  try {
    const d = JSON.parse(await readFile(FILE_URL, 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch { return {}; }
}

export default {
  name: 'dimension_profile',
  description:
    'Per-dimension living rules (sleep behavior, hostile table ' +
    'override, hazards, notes). Built-ins cover the three vanilla ' +
    'dimensions; unknown dimensions get a profile drafted from ' +
    'exploration with the player and saved here via set. ' +
    'cave_assist uses a profile hostile list when one exists.',
  params: {
    action: { type: 'string', required: true, description: 'get | list | set' },
    dimension: { type: 'string', required: false, description: 'dimension id (get: default = current dimension)' },
    sleep: { type: 'string', required: false, description: 'for set: works | explodes | anchor | none | unknown' },
    hostiles: { type: 'string', required: false, description: 'for set: comma-separated entity ids that cave_assist should treat as hostiles here' },
    hazards: { type: 'string', required: false, description: 'for set: comma-separated hazard tags' },
    notes: { type: 'string', required: false, description: 'for set: free notes learned while exploring' },
    label: { type: 'string', required: false, description: 'for set: display name' },
  },
  async run(ctx, { action, dimension, sleep, hostiles, hazards, notes, label }) {
    const overrides = await load();
    if (action === 'list') {
      return { builtins: Object.keys(BUILTINS), overrides };
    }
    if (action === 'get') {
      const dim = dimension
        ?? (await ctx.state().catch(() => null))?.dimension;
      if (!dim) return { done: false, reason: 'no_dimension' };
      const merged = { ...(BUILTINS[dim] ?? {}), ...(overrides[dim] ?? {}) };
      return {
        done: true, dimension: dim,
        known: dim in BUILTINS || dim in overrides,
        profile: merged,
      };
    }
    if (action === 'set') {
      if (!dimension) return { done: false, reason: 'dimension_required' };
      const cur = overrides[dimension] ?? {};
      const next = { ...cur };
      if (label !== undefined) next.label = label;
      if (sleep !== undefined) next.sleep = sleep;
      if (notes !== undefined) next.notes = notes;
      if (hostiles !== undefined) {
        next.hostiles = hostiles.split(',').map((t) => t.trim()).filter(Boolean);
      }
      if (hazards !== undefined) {
        next.hazards = hazards.split(',').map((t) => t.trim()).filter(Boolean);
      }
      next.updated_at = new Date().toISOString();
      overrides[dimension] = next;
      await writeFile(FILE_URL, JSON.stringify(overrides, null, 2));
      return { done: true, dimension, profile: next };
    }
    return { done: false, reason: `unknown action: ${action}` };
  },
};
