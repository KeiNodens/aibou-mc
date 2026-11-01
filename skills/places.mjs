// 場所の記憶 (D38): 今は掘れない鉱石や、戻りたい洞窟・目印を
// bridge 側 data/places.json に永続記録する (正本は bridge 側、
// D31 の「ファイル/索引は bridge」原則)。cave_assist が notable
// 発見と洞窟入口を自動で記録し、掘り終えたら done にする。
// 手動の追加・確認はこのスキルから。
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/places.json', import.meta.url);

async function load() {
  try {
    const d = JSON.parse(await readFile(FILE, 'utf8'));
    return Array.isArray(d?.places) ? d : { places: [] };
  } catch {
    return { places: [] };
  }
}
async function save(data) {
  await writeFile(FILE, JSON.stringify(data, null, 2));
}
const near = (a, b, r) =>
  Math.abs(a.x - b.x) <= r && Math.abs(a.y - b.y) <= r && Math.abs(a.z - b.z) <= r;

export default {
  name: 'places',
  description:
    'Persistent place memory (bridge-side): unmined ore veins, ' +
    'cave entrances, and points of interest, so the bot can return ' +
    'later. action=add records a place (defaults to the bot\'s ' +
    'current position), list shows open places (all=true includes ' +
    'done), done marks the nearest matching open place finished, ' +
    'remove deletes by id.',
  params: {
    action: { type: 'string', required: true, description: 'add | list | done | remove' },
    kind: { type: 'string', required: false, description: 'ore | cave | poi (add/done)' },
    ore: { type: 'string', required: false, description: 'ore item/block id (add/done)' },
    name: { type: 'string', required: false, description: 'label (add)' },
    note: { type: 'string', required: false, description: 'free note (add)' },
    x: { type: 'integer', required: false },
    y: { type: 'integer', required: false },
    z: { type: 'integer', required: false },
    id: { type: 'string', required: false, description: 'place id (remove)' },
    all: { type: 'boolean', required: false, description: 'list: include done places' },
  },
  async run(ctx, args) {
    const data = await load();
    if (args.action === 'list') {
      const places = data.places.filter((p) => args.all || p.status === 'open');
      return { places };
    }
    if (args.action === 'add') {
      let pos = { x: args.x, y: args.y, z: args.z };
      if (pos.x == null || pos.y == null || pos.z == null) {
        const st = await ctx.state();
        pos = {
          x: Math.floor(st.pos.x), y: Math.floor(st.pos.y), z: Math.floor(st.pos.z),
        };
      }
      const kind = args.kind ?? 'poi';
      const dup = data.places.some((p) =>
        p.status === 'open' && p.kind === kind &&
        (p.ore ?? null) === (args.ore ?? null) && near(p, pos, 6));
      if (dup) return { ok: true, deduped: true };
      const place = {
        id: `pl-${Date.now().toString(36)}-${data.places.length + 1}`,
        kind, ...(args.ore ? { ore: args.ore } : {}),
        ...(args.name ? { name: args.name } : {}),
        ...pos, ...(args.note ? { note: args.note } : {}),
        at: new Date().toISOString(), status: 'open',
      };
      data.places.push(place);
      await save(data);
      return { ok: true, place };
    }
    if (args.action === 'done') {
      const st = await ctx.state().catch(() => null);
      const c = { x: args.x ?? Math.floor(st?.pos?.x ?? 0), y: args.y ?? Math.floor(st?.pos?.y ?? 0), z: args.z ?? Math.floor(st?.pos?.z ?? 0) };
      const cand = data.places
        .filter((p) => p.status === 'open'
          && (!args.kind || p.kind === args.kind)
          && (!args.ore || p.ore === args.ore))
        .sort((a, b) =>
          (Math.abs(a.x - c.x) + Math.abs(a.z - c.z)) -
          (Math.abs(b.x - c.x) + Math.abs(b.z - c.z)))[0];
      if (!cand) return { ok: false, reason: 'no_matching_open_place' };
      cand.status = 'done';
      cand.done_at = new Date().toISOString();
      await save(data);
      return { ok: true, place: cand };
    }
    if (args.action === 'remove') {
      const before = data.places.length;
      data.places = data.places.filter((p) => p.id !== args.id);
      await save(data);
      return { ok: true, removed: before - data.places.length };
    }
    throw new Error(`unknown action: ${args.action}`);
  },
};
