// RunHold 永続化 + stale lease回収の単体検証 (P3追加)。
// run-fixture の restartBridge は rin 環境で taskkill が Access Denied のため
// 実プロセス再起動の検証ができない。代わりに RunHold クラスを直接使い、
// 「ファイルへ永続化 → running=true のまま死んだ状態 → 再生成で回収」を検証する。
// 実行: node bridge/node_modules/tsx/dist/cli.mjs tools/verify-runhold.mjs
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunHold } from '../bridge/src/runhold.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'runhold-'));
const file = path.join(dir, 'run-state.json');
const noop = async () => {};

// 1. hold が atomic にファイルへ書かれる
const rh1 = new RunHold(noop, () => null, { persistFile: file });
rh1.hold('owner_stop', 'explicit stop command');
const saved = JSON.parse(readFileSync(file, 'utf8'));
if (!saved.holds?.some((h) => h.kind === 'owner_stop')) {
  throw new Error('hold not persisted: ' + JSON.stringify(saved));
}
if (saved.running !== false) throw new Error('running should be false');
console.log('1. persist on hold: OK');

// 2. run中に死んだ状態 (running=true) を作って再生成 → stale 回収
saved.running = true;
saved.runStartedAt = Date.now() - 60_000;
saved.savedAt = Date.now() - 60_000;
writeFileSync(file, JSON.stringify(saved));
const rh2 = new RunHold(noop, () => null, { persistFile: file });
const st = rh2.status();
if (!st.staleRecovered) throw new Error('staleRecovered missing');
const kinds = st.holds.map((h) => h.kind);
if (!kinds.includes('external')) throw new Error('external hold missing');
if (!kinds.includes('owner_stop')) throw new Error('owner_stop not restored');
if (st.running) throw new Error('running should be reclaimed to false');
// 回収後の状態がファイルにも running=false で書かれている
const saved2 = JSON.parse(readFileSync(file, 'utf8'));
if (saved2.running !== false) throw new Error('reclaimed state not persisted');
console.log('2. stale lease reclaim: OK');

// 3. pump の前後で running が立つ/落ちる + lastRunAt が残る
let ran = false;
const rh3 = new RunHold(async () => { ran = true; }, () => null, { persistFile: file });
rh3.releaseAll();
rh3.requestRun();
const r = await rh3.pump();
if (r !== 'ran' || !ran) throw new Error('pump did not run');
const saved3 = JSON.parse(readFileSync(file, 'utf8'));
if (saved3.running !== false || !saved3.lastRunAt) {
  throw new Error('post-run state wrong: ' + JSON.stringify(saved3));
}
console.log('3. pump lifecycle persist: OK');
console.log('verify-runhold: ALL PASS');
