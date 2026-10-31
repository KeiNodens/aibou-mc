import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ModClient } from './modclient.js';
import { Journal } from './journal.js';
import { State } from './state.js';

/**
 * クエストグラフ (tools/build-quest-graph.mjs が生成したJSON) を読み、
 * 依存解決済みの「今やれるクエスト」(frontier) と目標への道筋を提供する。
 * 完了検出はmod側 quest.list のdiff — 新規完了時にepisode記録+screenshot。
 */

export interface QuestTask { id: string; type: string; item?: string; count?: number }
export interface QuestReward { type: string; item?: string; count?: number }
export interface QuestNode {
  id: string;            // SNBTのhex文字列
  title: string;
  subtitle?: string;
  description: string[];
  chapter: string;
  x: number; y: number;
  deps: string[];
  optional: boolean;
  tasks: QuestTask[];
  rewards: QuestReward[];
}
export interface QuestGraph {
  generatedAt: string;
  fingerprint: string;
  chapters: { id: string; title: string; filename: string }[];
  quests: QuestNode[];
}

// hex文字列↔quest.listのsigned long を正規化して比較する。
// SNBT側は16桁hex、mod側は10進(signed long)で来るため両対応:
// 16桁hexならhex解釈、それ以外は10進解釈してuint64 hexに揃える。
function canonId(id: string): string {
  try {
    const hex = /^[0-9a-fA-F]{16}$/.test(id);
    const v = hex
      ? BigInt.asUintN(64, BigInt(`0x${id}`))
      : BigInt.asUintN(64, BigInt(id));
    return v.toString(16).toUpperCase().padStart(16, '0');
  } catch {
    return id;
  }
}

export class QuestGraph {
  private graph: QuestGraph | null = null;
  private byId = new Map<string, QuestNode>(); // canonId → node
  private knownCompleted = new Set<string>();  // canonId
  private pollTimer: NodeJS.Timeout | null = null;
  // set-aside (P4): 繰り返し失敗したクエストを frontier から外す
  private failures = new Map<string, number>(); // canonId → 失敗回数
  private aside = new Set<string>();            // canonId
  private asideFile: string;

  constructor(private file: string) {
    this.asideFile = path.join(path.dirname(file), 'quest-aside.json');
    this.load();
    this.loadAside();
  }

  /** この回数失敗したら自動で棚上げする */
  static readonly ASIDE_THRESHOLD = 3;

  private loadAside() {
    try {
      if (!existsSync(this.asideFile)) return;
      const d = JSON.parse(readFileSync(this.asideFile, 'utf8')) as {
        failures?: Record<string, number>; aside?: string[];
      };
      this.failures = new Map(Object.entries(d.failures ?? {}));
      this.aside = new Set(d.aside ?? []);
    } catch (e) {
      console.log('[questgraph] aside load failed:', e);
    }
  }

  private saveAside() {
    try {
      const tmp = this.asideFile + '.tmp';
      writeFileSync(tmp, JSON.stringify({
        failures: Object.fromEntries(this.failures),
        aside: [...this.aside],
      }));
      renameSync(tmp, this.asideFile);
    } catch (e) {
      console.log('[questgraph] aside save failed:', e);
    }
  }

  /** クエストの失敗を記録。閾値到達で自動棚上げ */
  noteFailure(idOrTitle: string): { title: string; failures: number; aside: boolean } | null {
    const q = this.find(idOrTitle);
    if (!q) return null;
    const cid = canonId(q.id);
    const n = (this.failures.get(cid) ?? 0) + 1;
    this.failures.set(cid, n);
    const nowAside = n >= QuestGraph.ASIDE_THRESHOLD;
    if (nowAside) this.aside.add(cid);
    this.saveAside();
    return { title: q.title, failures: n, aside: this.aside.has(cid) };
  }

  /** 成功したら失敗カウントをリセット (棚上げは手動解除のみ) */
  noteSuccess(idOrTitle: string) {
    const q = this.find(idOrTitle);
    if (!q) return;
    const cid = canonId(q.id);
    if (this.failures.delete(cid)) this.saveAside();
  }

  /** 手動の棚上げ/解除 */
  setAside(idOrTitle: string, on: boolean): QuestNode | null {
    const q = this.find(idOrTitle);
    if (!q) return null;
    const cid = canonId(q.id);
    if (on) this.aside.add(cid); else this.aside.delete(cid);
    this.saveAside();
    return q;
  }

  isAside(q: QuestNode): boolean {
    return this.aside.has(canonId(q.id));
  }

  asideList(): QuestNode[] {
    return this.all().filter(q => this.isAside(q));
  }

  failureCount(idOrTitle: string): number {
    const q = this.find(idOrTitle);
    return q ? (this.failures.get(canonId(q.id)) ?? 0) : 0;
  }

  load() {
    this.graph = null;
    this.byId.clear();
    try {
      if (!existsSync(this.file)) return;
      const g = JSON.parse(readFileSync(this.file, 'utf8')) as QuestGraph;
      this.graph = g;
      for (const q of g.quests) this.byId.set(canonId(q.id), q);
      console.log(`[questgraph] loaded ${g.quests.length} quests (fp=${g.fingerprint})`);
    } catch (e) {
      console.log('[questgraph] load failed:', e);
    }
  }

  loaded(): boolean {
    // 起動時に無くても後から build-quest-graph.mjs が生成したら使う
    if (this.graph == null) this.load();
    return this.graph != null;
  }

  all(): QuestNode[] {
    return this.graph?.quests ?? [];
  }

  /** title/id/正規化idでクエストを引く */
  find(name: string): QuestNode | null {
    if (!this.graph) return null;
    const byTitle = this.graph.quests.find((q) => q.title === name || q.id === name);
    if (byTitle) return byTitle;
    return this.byId.get(canonId(name)) ?? null;
  }

  /**
   * frontier: 依存が全て完了済みかつ自身未完了のクエスト群。
   * completedIds = mod側 quest.list の完了id群 (canon済み)。
   * graphの外にある依存 (未定義id) は完了扱いしない (danglingは通さない)。
   */
  frontier(completedIds: Set<string>): QuestNode[] {
    if (!this.graph) return [];
    return this.graph.quests.filter((q) => {
      const cid = canonId(q.id);
      if (completedIds.has(cid)) return false;
      if (this.aside.has(cid)) return false; // 棚上げ中は候補に出さない
      return q.deps.every((d) => completedIds.has(canonId(d)));
    });
  }

  /** goalIdまでの依存解決順パス (topo order)。goal自身を含む */
  plan(goalName: string): QuestNode[] | null {
    const goal = this.find(goalName);
    if (!goal) return null;
    const out: QuestNode[] = [];
    const seen = new Set<string>();
    const visit = (q: QuestNode) => {
      const cid = canonId(q.id);
      if (seen.has(cid)) return;
      seen.add(cid);
      for (const d of q.deps) {
        const dn = this.byId.get(canonId(d));
        if (dn) visit(dn);
      }
      out.push(q);
    };
    visit(goal);
    return out;
  }

  /**
   * quest.listの結果から完了id群を引き出す。
   * mock/実機の形: {quests:[{id,completed}], chapters:[...]} 等を広く受ける。
   */
  extractCompleted(questList: unknown): Set<string> {
    const out = new Set<string>();
    const list = (questList as Record<string, unknown>)?.quests;
    if (Array.isArray(list)) {
      for (const q of list) {
        const o = q as Record<string, unknown>;
        if (o.completed === true || o.completed === 1) {
          out.add(canonId(String(o.id)));
        }
      }
    }
    return out;
  }

  /**
   * 30s間隔でquest.listをポーリングし、新規完了クエストを検出:
   * episode記録 + screenshot (撮れれば)。goal未登録でも軽量に動く。
   */
  startWatch(state: State, mod: ModClient, journal?: Journal) {
    if (this.pollTimer || !this.loaded()) return;
    this.pollTimer = setInterval(async () => {
      try {
        const res = await mod.call('quest.list');
        const now = this.extractCompleted(res);
        const fresh = [...now].filter((id) => !this.knownCompleted.has(id));
        for (const cid of fresh) {
          const q = this.byId.get(cid);
          const title = q?.title ?? cid;
          this.noteSuccess(cid);
          journal?.episode({
            action: 'quest:complete',
            result: `completed: ${title}`, ok: true,
          });
          console.log(`[questgraph] quest completed: ${title}`);
          // 完了スクショット (撮れる環境のみ。失敗は無視)
          mod.call('screenshot').catch(() => {});
        }
        this.knownCompleted = now;
      } catch {
        // quest.list非対応 (modpackにFTB無し等) — 次回再試行
      }
    }, 30_000);
    this.pollTimer.unref?.();
    console.log('[questgraph] watch started (30s poll)');
  }
}
