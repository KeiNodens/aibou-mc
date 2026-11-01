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
  'meta.capabilities', 'meta.mods', 'mod.ping', 'obs.state', 'obs.entity', 'obs.scan',
  'obs.block', 'obs.block_state', 'look_info', 'container.read',
  'container.repo', 'item.info', 'find_item', 'recipe.lookup',
  'waypoint.get', 'waypoint.list', 'quest.list', 'quest.inspect',
  'emi.search',
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

/** params の安定ダイジェスト (キー順を正規化した JSON)。承認のバインド用 */
export function paramsDigest(params: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        o[k] = norm((v as Record<string, unknown>)[k]);
      }
      return o;
    }
    return v;
  };
  return JSON.stringify(norm(params));
}

export class Autonomy {
  private seq = 0;
  private pending = new Map<string, ApprovalReq>();
  /** 承認済みグラント: method → (params ダイジェスト, 期限)。
   *  D59/P2-1: 旧実装は method 単位で任意の引数が通ったため、
   *  承認した特定の呼出 (method + params) にだけバインドする */
  private grants = new Map<string, { digest: string; until: number }>();
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

    // 承認済みグラント (同一 method + 同一 params) は TTL 内で通過
    const g = this.grants.get(method);
    if (g && Date.now() < g.until && g.digest === paramsDigest(params)) {
      return { ok: true };
    }

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

  /** id指定または最新のpendingを承認 → その呼出 (method+params) を5分間通す */
  approve(id?: string): { approved: ApprovalReq | null; pending: number } {
    const r = id
      ? this.pending.get(id) ?? null
      : [...this.pending.values()].sort((a, b) => b.at - a.at)[0] ?? null;
    if (!r) return { approved: null, pending: this.pending.size };
    this.pending.delete(r.id);
    this.grants.set(r.method, {
      digest: paramsDigest(r.params), until: Date.now() + APPROVE_TTL_MS,
    });
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
