/**
 * 実行管理 (Run/Hold + pump)。LLM発動系統を1箇所に集約する。
 *
 * - Run: codex exec 1本 = 1回の推論→実行サイクル
 * - Hold: 実行を止める理由。複数同時に立てられる (解除は理由ごと)
 *   dead      死亡中 (死亡イベントで自動、respawned/手動で解除)
 *   external  外部要因 (skill実行中等、実行系が他者に取られた)
 *   owner_stop オーナーの「止まれ」系指示 (次の指示が来るまで持続)
 *   blocked   進行不能 (postcondition失敗・経路失敗の連続等)
 *   failed    codex/ツールエラーで前回runが失敗 (再指示で解除)
 * - pump(): 唯一の進行点。holdがあれば止め、queuedがあればrunOnceを1本走らせる。
 *   steering挿入点は「tool完了後/次run前」、follow-upは「完了直前」のみ。
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export type HoldKind = 'dead' | 'external' | 'owner_stop' | 'blocked' | 'failed';

export interface LoopStatus {
  running: boolean;
  queued: boolean;
  holds: { kind: HoldKind; reason: string; at: number }[];
  lastRunAt: number | null;
  lastError: string | null;
  runningSkill: string | null;
  /** 再起動で回収した stale run (前回プロセスがrun中に死んでいた) */
  staleRecovered: { at: number; savedAt: number } | null;
}

interface PersistedRunState {
  holds: { kind: HoldKind; reason: string; at: number }[];
  lastRunAt: number | null;
  lastError: string | null;
  running: boolean;
  runStartedAt: number | null;
  savedAt: number;
}

export class RunHold {
  private holds = new Map<HoldKind, { reason: string; at: number }>();
  private running = false;
  private queued = false;
  private lastRunAt: number | null = null;
  private lastError: string | null = null;
  private runStartedAt: number | null = null;
  private staleRecovered: { at: number; savedAt: number } | null = null;
  private persistFile?: string;

  /** 実体の1回実行。runnerがcodex起動を注入する */
  constructor(private runOnce: () => Promise<void>,
              private runningSkillName: () => string | null = () => null,
              opts: { persistFile?: string } = {}) {
    this.persistFile = opts.persistFile;
    this.restore();
    // D59/P1-7: queued の再駆動を保証するウォッチドッグ。
    // 旧設計は「次の人間チャットが来たときの pump 呼出」にだけ再駆動を
    // 依存しており、skill 終了や hold 解除のタイミングでは queued な
    // 要求が無言で滞留した。pump 自体が全条件を guard するので、
    // 1秒間隔で条件が揃ったかだけを見る。
    const wd = setInterval(() => {
      if (this.queued && !this.running) void this.pump();
    }, 1000);
    wd.unref?.();
  }

  /**
   * 永続化状態の復元 (P3: atomic snapshot + stale lease回収)。
   * holds は復元するが、実行中だった run は復元しない — 前回プロセスが
   * run の途中で死んだ証拠なので lease を回収し、external hold で止める。
   */
  private restore() {
    if (!this.persistFile) return;
    try {
      if (!existsSync(this.persistFile)) return;
      const s = JSON.parse(readFileSync(this.persistFile, 'utf8')) as PersistedRunState;
      for (const h of s.holds ?? []) this.holds.set(h.kind, { reason: h.reason, at: h.at });
      this.lastRunAt = s.lastRunAt ?? null;
      this.lastError = s.lastError ?? null;
      if (s.running) {
        this.staleRecovered = { at: Date.now(), savedAt: s.savedAt };
        this.lastError = 'stale run reclaimed after restart';
        this.holds.set('external', {
          reason: 'stale run reclaimed: 前回プロセスがrun中に終了したため回収',
          at: Date.now(),
        });
        this.persist();
      }
    } catch (e) {
      console.log('[runhold] restore failed:', e);
    }
  }

  /** atomic write (tmp→rename)。状態が変わるたびに呼ぶ */
  private persist() {
    if (!this.persistFile) return;
    try {
      const data: PersistedRunState = {
        holds: [...this.holds.entries()].map(([kind, v]) => ({ kind, ...v })),
        lastRunAt: this.lastRunAt,
        lastError: this.lastError,
        running: this.running,
        runStartedAt: this.runStartedAt,
        savedAt: Date.now(),
      };
      const tmp = this.persistFile + '.tmp';
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.persistFile);
    } catch (e) {
      console.log('[runhold] persist failed:', e);
    }
  }

  hold(kind: HoldKind, reason: string) {
    this.holds.set(kind, { reason, at: Date.now() });
    this.persist();
  }

  release(kind: HoldKind) {
    this.holds.delete(kind);
    this.persist();
  }

  releaseAll() {
    this.holds.clear();
    this.persist();
  }

  isHeld(): boolean {
    return this.holds.size > 0;
  }

  /** 「実行したい」積算フラグ。pumpが実際に走らせるか判断する */
  requestRun() {
    this.queued = true;
  }

  /**
   * 唯一の進行点。hold中/実行中/要求無しなら何もしない。
   * runOnce完了後、queuedが残っていれば続けてもう1本 (follow-up挿入点)。
   */
  async pump(): Promise<'ran' | 'held' | 'busy' | 'idle'> {
    if (this.isHeld()) return 'held';
    // skill実行中はLLMと競合させない (external hold相当だが自動)
    const skill = this.runningSkillName();
    if (skill) return 'held';
    if (this.running) { this.queued = true; return 'busy'; }
    if (!this.queued) return 'idle';
    this.queued = false;
    this.running = true;
    this.runStartedAt = Date.now();
    this.persist();
    try {
      await this.runOnce();
      this.lastRunAt = Date.now();
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.hold('failed', this.lastError);
    } finally {
      this.running = false;
      this.runStartedAt = null;
      this.persist();
    }
    return 'ran';
  }

  status(): LoopStatus {
    return {
      running: this.running,
      queued: this.queued,
      holds: [...this.holds.entries()].map(([kind, v]) => ({
        kind, reason: v.reason, at: v.at,
      })),
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      runningSkill: this.runningSkillName(),
      staleRecovered: this.staleRecovered,
    };
  }
}
