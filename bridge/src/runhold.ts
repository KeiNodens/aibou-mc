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

export type HoldKind = 'dead' | 'external' | 'owner_stop' | 'blocked' | 'failed';

export interface LoopStatus {
  running: boolean;
  queued: boolean;
  holds: { kind: HoldKind; reason: string; at: number }[];
  lastRunAt: number | null;
  lastError: string | null;
  runningSkill: string | null;
}

export class RunHold {
  private holds = new Map<HoldKind, { reason: string; at: number }>();
  private running = false;
  private queued = false;
  private lastRunAt: number | null = null;
  private lastError: string | null = null;

  /** 実体の1回実行。runnerがcodex起動を注入する */
  constructor(private runOnce: () => Promise<void>,
              private runningSkillName: () => string | null = () => null) {}

  hold(kind: HoldKind, reason: string) {
    this.holds.set(kind, { reason, at: Date.now() });
  }

  release(kind: HoldKind) {
    this.holds.delete(kind);
  }

  releaseAll() {
    this.holds.clear();
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
    try {
      await this.runOnce();
      this.lastRunAt = Date.now();
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.hold('failed', this.lastError);
    } finally {
      this.running = false;
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
    };
  }
}
