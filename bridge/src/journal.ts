import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { State } from './state.js';

/**
 * 記憶ジャーナル (2層):
 *  - data/journal.jsonl … append-onlyの生イベントログ (work.start/end, checkpoint, evt)
 *  - data/agent-journal.json … 構造化スナップショット (atomic write)
 *
 * 構造化スナップショットの分類:
 *   goals        目標 ({id,text,status,priority,attempts})
 *   workGraphs   作業グラフ ({id,nodes:[{id,kind,name,status,deps}]})
 *   facilities   施設記憶 ({id,kind,pos,dim,name,evidence,lastSeen})
 *   reservations 予約・割当の記録 ({id,what,pos,holder}) — 所有権の再復元には使わない
 *   knowledge    検証済み知識 ({id,fact,source,confidence,ts})
 *   episodes     行動エピソード ({id,ts,pos,action,params,result,ok,goal,work})
 *
 * 復旧原則: journalは「どこまで進んだか」の事実だけを保持。
 * 実行中状態や物理的所有権を再起動後に盲目的に復元しない —
 * 再開は必ず「実ゲーム状態を観測→照合」してから。
 */

export interface JournalEntry {
  ts: number;
  kind: string;
  work?: string;
  [k: string]: unknown;
}

export interface Goal {
  id: string;
  text: string;
  status: 'active' | 'done' | 'failed' | 'aside';
  priority: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkGraphNode {
  id: string;
  kind: string;         // quest / step / skill
  name: string;
  status: 'todo' | 'doing' | 'done' | 'failed' | 'aside';
  deps: string[];
}

export interface WorkGraph {
  id: string;
  created: number;
  nodes: WorkGraphNode[];
}

export interface Facility {
  id: string;
  kind: string;         // mine / farm / chest / machine / base
  pos: { x: number; y: number; z: number };
  dim?: string;
  name?: string;
  evidence: number;     // 観測・利用の蓄積回数 (復元時の信頼度)
  firstSeen: number;
  lastSeen: number;
}

export interface Reservation {
  id: string;
  what: string;         // 対象 (block pos範囲, machine id, item等)
  pos?: { x: number; y: number; z: number };
  holder: string;       // 予約主体 (bot名/work id)
  note?: string;
  ts: number;
}

export interface Knowledge {
  id: string;
  fact: string;
  source: string;       // episode id / skill名 / chat
  confidence: number;   // 0..1、検証回数で上げる
  ts: number;
}

export interface Episode {
  id: string;
  ts: number;
  pos?: { x: number; y: number; z: number };
  action: string;       // skill名 / 直接call
  params?: Record<string, unknown>;
  result: string;       // ok / error要約 (1行)
  ok: boolean;
  goal?: string;
  work?: string;
}

interface Snapshot {
  goals: Goal[];
  workGraphs: WorkGraph[];
  facilities: Facility[];
  reservations: Reservation[];
  knowledge: Knowledge[];
  episodes: Episode[];
  counter: number;
  /** 最後にセッション要約を記録した時刻 (ms epoch)。0=未記録 */
  lastSummaryAt?: number;
}

export interface SessionSummary {
  at: number;
  since: number;
  episodes: number;
  ok: number;
  failed: number;
  byAction: Record<string, number>;
  goalsDone: number;
  goalsActive: number;
  facilitiesTotal: number;
  line: string;
}

const CAPS = {
  goals: 50, workGraphs: 8, facilities: 200,
  reservations: 50, knowledge: 200, episodes: 500,
};

const AUTO_EVENTS = new Set(['task.done', 'skill.done', 'reflex']);

export class Journal {
  private file: string;
  private snapFile: string;
  private snap: Snapshot = {
    goals: [], workGraphs: [], facilities: [],
    reservations: [], knowledge: [], episodes: [], counter: 0,
  };
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'journal.jsonl');
    this.snapFile = path.join(dir, 'agent-journal.json');
    try {
      if (existsSync(this.snapFile)) {
        const s = JSON.parse(readFileSync(this.snapFile, 'utf8')) as Partial<Snapshot>;
        this.snap = {
          goals: s.goals ?? [], workGraphs: s.workGraphs ?? [],
          facilities: s.facilities ?? [], reservations: s.reservations ?? [],
          knowledge: s.knowledge ?? [], episodes: s.episodes ?? [],
          counter: s.counter ?? 0,
        };
        this.seq = this.snap.counter;
      }
    } catch (e) {
      console.log('[journal] snapshot load failed (初回or破損):', e);
    }
  }

  /** 世代非依存のwork idを採番 (restartで継続) */
  newWorkId(): string {
    const id = `w-${++this.seq}`;
    this.snap.counter = this.seq;
    this.markDirty();
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

  /** work.start済みでwork.endが来ていない作業 = 中断中の作業 (照合対象) */
  openWorks(): JournalEntry[] {
    const all = this.tail(2000);
    const open = new Map<string, JournalEntry>();
    for (const e of all) {
      if (e.kind === 'work.start' && e.work) open.set(e.work, e);
      if (e.kind === 'work.end' && e.work) open.delete(e.work);
    }
    return [...open.values()];
  }

  // ---- goals ----

  /** 目標の登録/更新。text一致のactive目標があればそれを返す */
  goalSet(text: string, opts: { priority?: number } = {}): Goal {
    let g = this.snap.goals.find(g => g.text === text && g.status === 'active');
    if (!g) {
      g = {
        id: `g-${++this.seq}`, text, status: 'active',
        priority: opts.priority ?? 0, attempts: 0,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      this.snap.goals.push(g);
      this.snap.counter = this.seq;
      this.snap.goals = this.snap.goals.slice(-CAPS.goals);
    } else {
      g.updatedAt = Date.now();
      if (opts.priority !== undefined) g.priority = opts.priority;
    }
    this.markDirty();
    return g;
  }

  goalGet(includeEnded = false): Goal[] {
    return this.snap.goals.filter(g => includeEnded || g.status === 'active');
  }

  goalEnd(id: string, status: 'done' | 'failed' | 'aside' = 'done'): boolean {
    const g = this.snap.goals.find(g => g.id === id);
    if (!g) return false;
    g.status = status;
    g.updatedAt = Date.now();
    this.markDirty();
    return true;
  }

  goalAttempt(id: string) {
    const g = this.snap.goals.find(g => g.id === id);
    if (g) { g.attempts++; g.updatedAt = Date.now(); this.markDirty(); }
  }

  // ---- workGraphs ----

  graphStart(nodes: WorkGraphNode[]): WorkGraph {
    const g: WorkGraph = { id: `wg-${++this.seq}`, created: Date.now(), nodes };
    this.snap.counter = this.seq;
    this.snap.workGraphs.push(g);
    this.snap.workGraphs = this.snap.workGraphs.slice(-CAPS.workGraphs);
    this.markDirty();
    return g;
  }

  graphSet(graphId: string, nodeId: string, status: WorkGraphNode['status']): boolean {
    const n = this.snap.workGraphs.find(g => g.id === graphId)
      ?.nodes.find(n => n.id === nodeId);
    if (!n) return false;
    n.status = status;
    this.markDirty();
    return true;
  }

  graphGet(graphId: string): WorkGraph | undefined {
    return this.snap.workGraphs.find(g => g.id === graphId);
  }

  // ---- facilities ----

  /**
   * 施設記憶のupsert。同kindでpos距離4以内なら同一施設としてevidenceを加算。
   * 「使った/見た」事実が重なるほど信頼度が上がる (consolidation)。
   */
  noteFacility(f: {
    kind: string; pos: { x: number; y: number; z: number };
    dim?: string; name?: string;
  }): Facility {
    const near = this.snap.facilities.find(x =>
      x.kind === f.kind && x.dim === f.dim &&
      Math.hypot(x.pos.x - f.pos.x, x.pos.y - f.pos.y, x.pos.z - f.pos.z) <= 4);
    if (near) {
      near.evidence++;
      near.lastSeen = Date.now();
      if (f.name) near.name = f.name;
      this.markDirty();
      return near;
    }
    const fac: Facility = {
      id: `f-${++this.seq}`, kind: f.kind, pos: f.pos, dim: f.dim,
      name: f.name, evidence: 1, firstSeen: Date.now(), lastSeen: Date.now(),
    };
    this.snap.counter = this.seq;
    this.snap.facilities.push(fac);
    this.snap.facilities = this.snap.facilities.slice(-CAPS.facilities);
    this.markDirty();
    return fac;
  }

  facilities(kind?: string): Facility[] {
    return this.snap.facilities.filter(f => !kind || f.kind === kind);
  }

  // ---- reservations (記録のみ。復元・強制には使わない) ----

  reserve(r: { what: string; pos?: { x: number; y: number; z: number };
             holder: string; note?: string }): Reservation {
    const res: Reservation = { id: `r-${++this.seq}`, ts: Date.now(), ...r };
    this.snap.counter = this.seq;
    this.snap.reservations.push(res);
    this.snap.reservations = this.snap.reservations.slice(-CAPS.reservations);
    this.markDirty();
    return res;
  }

  // ---- knowledge ----

  learn(fact: string, source: string, confidence = 0.5): Knowledge {
    const same = this.snap.knowledge.find(k => k.fact === fact);
    if (same) {
      same.confidence = Math.min(1, same.confidence + 0.2);
      same.ts = Date.now();
      this.markDirty();
      return same;
    }
    const k: Knowledge = {
      id: `k-${++this.seq}`, fact, source, confidence, ts: Date.now(),
    };
    this.snap.counter = this.seq;
    this.snap.knowledge.push(k);
    this.snap.knowledge = this.snap.knowledge.slice(-CAPS.knowledge);
    this.markDirty();
    return k;
  }

  // ---- episodes ----

  episode(e: {
    action: string; params?: Record<string, unknown>;
    result: string; ok: boolean;
    pos?: { x: number; y: number; z: number }; goal?: string; work?: string;
  }): Episode {
    const ep: Episode = { id: `e-${++this.seq}`, ts: Date.now(), ...e };
    this.snap.counter = this.seq;
    this.snap.episodes.push(ep);
    this.snap.episodes = this.snap.episodes.slice(-CAPS.episodes);
    this.markDirty();
    return ep;
  }

  episodes(n = 50): Episode[] {
    return this.snap.episodes.slice(-n);
  }

  // ---- snapshot管理 ----

  /** 構造化スナップショットの現在値 (read-only用途) */
  snapshot(): Snapshot {
    return {
      goals: this.snap.goals.map(g => ({ ...g })),
      workGraphs: this.snap.workGraphs.map(g => ({ ...g, nodes: g.nodes.map(n => ({ ...n })) })),
      facilities: this.snap.facilities.map(f => ({ ...f, pos: { ...f.pos } })),
      reservations: this.snap.reservations.map(r => ({ ...r })),
      knowledge: this.snap.knowledge.map(k => ({ ...k })),
      episodes: this.snap.episodes.map(e => ({ ...e })),
      counter: this.snap.counter,
      lastSummaryAt: this.snap.lastSummaryAt ?? 0,
    };
  }

  // ---- セッション要約 (P2) ----

  /**
   * 前回要約以降の episodes / goals から機械的なセッション要約を作る。
   * record=true で episode (session:summary) と JSONL に残し、lastSummaryAt を進める。
   * LLM要約ではなく集計ベース — 再開時の「前回なにをしたか」を1行で引ける。
   */
  sessionSummary(record = false): SessionSummary {
    const since = this.snap.lastSummaryAt ?? 0;
    const eps = this.snap.episodes.filter(e => e.ts > since && e.action !== 'session:summary');
    const byAction: Record<string, number> = {};
    let ok = 0;
    for (const e of eps) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
      if (e.ok) ok++;
    }
    const goalsDone = this.snap.goals.filter(
      g => g.status === 'done' && g.updatedAt > since).length;
    const goalsActive = this.snap.goals.filter(g => g.status === 'active').length;
    const top = Object.entries(byAction)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}×${v}`).join(' ');
    const line = eps.length
      ? `前回: 作業${eps.length}件 (成功${ok}/失敗${eps.length - ok}) `
        + `${top} 目標完了${goalsDone} / 進行中${goalsActive}`
      : '前回: 記録なし';
    const sum: SessionSummary = {
      at: Date.now(), since,
      episodes: eps.length, ok, failed: eps.length - ok,
      byAction, goalsDone, goalsActive,
      facilitiesTotal: this.snap.facilities.length, line,
    };
    if (record) {
      this.episode({
        action: 'session:summary',
        result: line, ok: true,
      });
      this.append('session.summary', { ...sum });
      this.snap.lastSummaryAt = sum.at;
      this.markDirty();
    }
    return sum;
  }

  /** セッション終了時: 要約を記録してから snapshot を書き切る */
  endSession(): SessionSummary {
    const sum = this.sessionSummary(true);
    this.flush();
    return sum;
  }

  /**
   * 失敗で終わった作業の一覧 (suffix repair 用)。
   * work.end(ok:false) の作業について、完了済み checkpoint と失敗情報を返す。
   * 再開時は doneSteps を再実行せず、失敗step以降だけを組み直す。
   */
  failedWorks(limit = 3): Array<{
    work: string; skill?: string; error?: string; at: number;
    doneSteps: string[]; lastCheckpoint?: string;
  }> {
    const all = this.tail(2000);
    const byWork = new Map<string, {
      work: string; skill?: string; error?: string; at: number;
      doneSteps: string[]; lastCheckpoint?: string;
    }>();
    for (const e of all) {
      if (!e.work) continue;
      if (e.kind === 'work.start') {
        byWork.set(e.work, {
          work: e.work, skill: e.skill as string | undefined,
          at: e.ts, doneSteps: [],
        });
      } else if (e.kind === 'checkpoint') {
        const w = byWork.get(e.work);
        if (w && typeof e.step === 'string') {
          w.doneSteps.push(e.step);
          w.lastCheckpoint = e.step;
        }
      } else if (e.kind === 'work.end') {
        const w = byWork.get(e.work);
        if (w) {
          if (e.ok === false && !e.cancelled) {
            w.error = typeof e.error === 'string' ? e.error : 'failed';
            w.at = e.ts;
          } else {
            byWork.delete(e.work);
          }
        }
      }
    }
    return [...byWork.values()]
      .filter(w => w.error !== undefined)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  private markDirty() {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 1000);
      this.flushTimer.unref?.();
    }
  }

  /** atomic write (tmp→rename)。終了前に必ず呼ぶ */
  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.dirty) return;
    try {
      const tmp = this.snapFile + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.snap));
      renameSync(tmp, this.snapFile);
      this.dirty = false;
    } catch (e) {
      console.log('[journal] snapshot write failed:', e);
    }
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
