// FTB Questsの .snbt 群からクエストグラフ (bridge/data/quest-graph.json) を生成する。
//   node tools/build-quest-graph.mjs [questsDir] [outFile]
// 依存: bridge/dist/snbt.js (先に `cd bridge && npm run build`)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTS_DIR = process.argv[2]
  ?? path.join(ROOT, 'server/config/ftbquests/quests');
const OUT = process.argv[3]
  ?? path.join(ROOT, 'bridge/data/quest-graph.json');

let parseSnbt;
try {
  ({ parseSnbt } = await import(pathToFileURL(
    path.join(ROOT, 'bridge/dist/snbt.js')).href));
} catch (e) {
  console.error('[quest-graph] bridge/dist/snbt.js が見つかりません。' +
    '先に `cd bridge && npm run build` を実行してください');
  process.exit(2);
}

const files = readdirSync(path.join(QUESTS_DIR, 'chapters'))
  .filter((f) => f.endsWith('.snbt'));

// modpack指紋: ファイル名+内容のhash (graphの陳腐化検出用)
const fp = createHash('sha256');
const chapters = [];
const quests = [];

for (const f of files) {
  const src = readFileSync(path.join(QUESTS_DIR, 'chapters', f), 'utf8');
  fp.update(f).update(src);
  const ch = parseSnbt(src);
  const chapterId = String(ch.id ?? '');
  chapters.push({
    id: chapterId,
    title: String(ch.title ?? f.replace('.snbt', '')),
    filename: String(ch.filename ?? f.replace('.snbt', '')),
    group: String(ch.group ?? ''),
    order_index: Number(ch.order_index ?? 0),
  });
  for (const q of ch.quests ?? []) {
    quests.push({
      id: String(q.id),
      title: String(q.title ?? q.id),
      subtitle: q.subtitle != null ? String(q.subtitle) : undefined,
      description: Array.isArray(q.description) ? q.description.map(String) : [],
      chapter: chapterId,
      x: Number(q.x ?? 0),
      y: Number(q.y ?? 0),
      deps: (q.dependencies ?? []).map(String),
      optional: q.optional === 1 || q.optional === true || q.optional === '1b',
      tasks: (q.tasks ?? []).map((t) => ({
        id: String(t.id ?? ''),
        type: String(t.type ?? ''),
        item: t.item != null ? String(t.item) : undefined,
        count: t.count != null ? Number(t.count) : undefined,
      })),
      rewards: (q.rewards ?? []).map((r) => ({
        type: String(r.type ?? ''),
        item: r.item != null ? String(r.item) : undefined,
        count: r.count != null ? Number(r.count) : undefined,
      })),
    });
  }
}

// sanity check: 参照切れ依存・重複id
const ids = new Set(quests.map((q) => q.id));
const dup = quests.length !== ids.size;
const dangling = quests.flatMap((q) => q.deps.filter((d) => !ids.has(d))
  .map((d) => `${q.id}→${d}`));
if (dup) console.warn('[quest-graph] WARN: duplicate quest ids');
if (dangling.length) console.warn('[quest-graph] WARN: dangling deps:', dangling);

const graph = {
  generatedAt: new Date().toISOString(),
  fingerprint: fp.digest('hex').slice(0, 16),
  sourceDir: path.relative(ROOT, QUESTS_DIR),
  chapters,
  quests,
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(graph, null, 2));
console.log(`[quest-graph] ${quests.length} quests / ${chapters.length} chapters` +
  ` → ${path.relative(ROOT, OUT)} (fp=${graph.fingerprint})`);
