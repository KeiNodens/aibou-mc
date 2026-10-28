import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { State } from './state.js';

/**
 * 作業ジャーナル: 高レベル作業の checkpoint を世代非依存IDで永続化する。
 * 復旧は「操作の再実行」ではなく「現在の実ゲーム状態との照合」前提 —
 * journalは「どこまで進んだか」の事実だけを記録し、skill側が観測→照合→再開する。
 *
 * エントリ形式 (JSONL, data/journal.jsonl):
 *   {ts, kind, work, ...data}
 * kind: work.start / work.end / checkpoint / note / evt(task.done, reflex 等)
 */

export interface JournalEntry {
  ts: number;
  kind: string;
  work?: string;
  [k: string]: unknown;
}

const AUTO_EVENTS = new Set(['task.done', 'skill.done', 'reflex']);

export class Journal {
  private file: string;
  private counterFile: string;
  private counter = 0;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'journal.jsonl');
    this.counterFile = path.join(dir, 'journal-state.json');
    try {
      if (existsSync(this.counterFile))
        this.counter = JSON.parse(readFileSync(this.counterFile, 'utf8')).counter ?? 0;
    } catch { /* 初回起動 */ }
  }

  /** 世代非依存のwork idを採番 (restartで継続) */
  newWorkId(): string {
    const id = `w-${++this.counter}`;
    try { writeFileSync(this.counterFile, JSON.stringify({ counter: this.counter })); }
    catch { /* 書き込み失敗は致命的でない */ }
    return id;
  }

  append(kind: string, data: Record<string, unknown> = {}) {
    const e: JournalEntry = { ts: Date.now(), kind, ...data };
    try { appendFileSync(this.file, JSON.stringify(e) + '\n'); }
    catch (err) { console.log('[journal] append failed', err); }
    return e;
  }

  /** 末尾n件 (work指定時はそのworkのみ) */
  tail(n = 50, work?: string): JournalEntry[] {
    try {
      if (!existsSync(this.file)) return [];
      const lines = readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
      const entries = lines
        .map(l => { try { return JSON.parse(l) as JournalEntry; } catch { return null; } })
        .filter((e): e is JournalEntry => !!e && (!work || e.work === work));
      return entries.slice(-n);
    } catch {
      return [];
    }
  }

  /** work.start済みでwork.endが来ていない作業 = 中断中の作業 */
  openWorks(): JournalEntry[] {
    const all = this.tail(2000);
    const open = new Map<string, JournalEntry>();
    for (const e of all) {
      if (e.kind === 'work.start' && e.work) open.set(e.work, e);
      if (e.kind === 'work.end' && e.work) open.delete(e.work);
    }
    return [...open.values()];
  }

  /** state.push に乗せて自動収集する (task.done/skill.done/reflex) */
  attach(state: State) {
    const orig = state.push.bind(state);
    const self = this;
    state.push = function (name: string, data: unknown) {
      const e = orig(name, data);
      if (AUTO_EVENTS.has(name)) self.append('evt', { name, ...(data as object) });
      return e;
    };
  }
}
