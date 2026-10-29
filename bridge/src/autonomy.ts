/**
 * 自律レベルと承認ゲート (ControlNet MineAgent式approve/deny)。
 *
 * autonomy.level:
 *   0 = 指示のみ (読み取り以外の全てのmod操作が承認対象)
 *   1 = 提案     (危険操作のみ承認対象 — 既定)
 *   2 = 自律     (ゲートなし)
 *
 * profile: survival (既定) / operator (level既定値を2に引き上げ)
 *
 * ゲートは ModClient.call の内側に置き、MCPツール・skill ctx.call の
 * 全経路を単一点で通す。承認は `.ok <id>` / `.ok` / approveツールで行い、
 * 承認後はそのmethodが一定時間通過する (同一呼出の再実行は呼出側責任)。
 */

import { State } from './state.js';

export type Level = 0 | 1 | 2;

/** 危険操作: レベル1で承認を要求するmethod (不可逆・権限・資産喪失系) */
const DANGEROUS = new Set([
  'chat.command',        // /give /kill /op 等のサーバーコマンド
  'toss',                // アイテム破棄
  'sign.write',          // 看板への恒久的書込み
  'container.repo_action', // AE2 autocraft等の資源消費アクション
  'quest.claim',         // 報酬claim (不可逆に近い)
]);

/** 読み取り専用: レベル0でも承認不要 (observerと同等) */
const READONLY = new Set([
  'meta.capabilities', 'mod.ping', 'obs.state', 'obs.entity', 'obs.scan',
  'obs.block', 'obs.block_state', 'look_info', 'container.read',
  'container.repo', 'item.info', 'find_item', 'recipe.lookup',
  'waypoint.get', 'waypoint.list', 'quest.list', 'quest.inspect',
  'screen.read', 'task.status', 'task.result', 'task.list', 'chat.send',
]);

export interface ApprovalReq {
  id: string;
  method: string;
  params: Record<string, unknown>;
  at: number;
}

const APPROVE_TTL_MS = 5 * 60_000;
const APPROVE_GRACE_MS = 60_000;

export class Autonomy {
  private seq = 0;
  private pending = new Map<string, ApprovalReq>();
  private approvedUntil = new Map<string, number>();
  private profile: string;

  constructor(private state?: State) {
    this.profile = (process.env.AGENT_PROFILE ?? 'survival').toLowerCase();
  }

  level(): Level {
    const raw = process.env.AUTONOMY_LEVEL;
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (n === 0 || n === 1 || n === 2) return n;
    }
    return this.profile === 'operator' ? 2 : 1;
  }

  /**
   * 呼出可否判定。ok=false のとき approval requestを発行する
   * (pendingに残し、approval eventをstateへ流す)
   */
  check(method: string, params: Record<string, unknown> = {}):
      { ok: true } | { ok: false; req: ApprovalReq } {
    const lv = this.level();
    if (lv === 2 || READONLY.has(method)) return { ok: true };
    if (lv === 1 && !DANGEROUS.has(method)) return { ok: true };

    // 承認済みmethodはgrace period内で通過
    const until = this.approvedUntil.get(method);
    if (until && Date.now() < until) return { ok: true };

    const req: ApprovalReq = {
      id: `a${++this.seq}`, method, params, at: Date.now(),
    };
    this.pending.set(req.id, req);
    this.state?.push('approval', {
      id: req.id, method, params,
      hint: `.ok ${req.id} で承認 / .deny ${req.id} で拒否`,
    });
    return { ok: false, req };
  }

  /** id指定または最新のpendingを承認 → そのmethodを5分間通す */
  approve(id?: string): { approved: ApprovalReq | null; pending: number } {
    const r = id
      ? this.pending.get(id) ?? null
      : [...this.pending.values()].sort((a, b) => b.at - a.at)[0] ?? null;
    if (!r) return { approved: null, pending: this.pending.size };
    this.pending.delete(r.id);
    this.approvedUntil.set(r.method, Date.now() + APPROVE_TTL_MS);
    return { approved: r, pending: this.pending.size };
  }

  deny(id?: string): { denied: ApprovalReq | null; pending: number } {
    const r = id
      ? this.pending.get(id) ?? null
      : [...this.pending.values()].sort((a, b) => b.at - a.at)[0] ?? null;
    if (!r) return { denied: null, pending: this.pending.size };
    this.pending.delete(r.id);
    return { denied: r, pending: this.pending.size };
  }

  list(): ApprovalReq[] {
    return [...this.pending.values()];
  }
}
