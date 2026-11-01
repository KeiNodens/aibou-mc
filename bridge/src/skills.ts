import { readdirSync, watch } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, ZodRawShape } from 'zod';
import { State } from './state.js';
import { ModClient } from './modclient.js';
import { Journal } from './journal.js';
import { planSchematic } from './schematic.js';
import { runCommission } from './commission.js';

/**
 * 技能層 (design §2.1-2): skills/ 配下の .mjs を動的importし、
 * 1技能=1MCPツールとして公開する。実行は1本ずつ、AbortSignalで中断可。
 * 完了・失敗・中断は skill.done イベントとしてイベントバッファに積む。
 */

export interface SkillModule {
  name: string;
  description: string;
  // { argName: {type:'string'|'number'|'integer'|'boolean', required?:bool, description?:string} }
  params?: Record<string, { type: string; required?: boolean; description?: string }>;
  /** 実行ウォッチドッグ (ms)。0 = 無制限 (follow系など恒常実行スキルのみ)。
   *  未指定は Skills 側の既定 (SKILL_TIMEOUT_MS / 20分) */
  timeoutMs?: number;
  run(ctx: SkillCtx, args: Record<string, unknown>): Promise<unknown>;
}

export interface SkillCtx {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  state(): Promise<unknown>;
  say(text: string): Promise<unknown>;
  /** 直近のゲーム内チャット (locateコマンドの結果読み取り等に使う) */
  chatLog(n?: number): { from: string; text: string; ts: number }[];
  /** schematicファイルの建築計画 (y下から順のブロック列) */
  /** 配置済み機械の commission を実行 (定義の plan を使用) */
  commission(x: number, y: number, z: number): Promise<Record<string, unknown>>;
  schematicPlan(file: string, maxLayers?: number): Promise<{
    size: { x: number; y: number; z: number }; total: number;
    blocks: { x: number; y: number; z: number; id: string }[];
  }>;
  sleep(ms: number): Promise<void>;
  // mod側taskの完了(task.done)を待つ。timeoutで null、cancelで例外
  waitTask(taskId: string, timeoutMs?: number): Promise<Record<string, unknown> | null>;
  signal: AbortSignal;
  throwIfCancelled(): void;
  // 作業ジャーナル: 世代非依存のwork id単位で進捗を永続化する。
  // 再開時は「実ゲーム状態を観測→照合」してから続行すること (盲目の再実行禁止)。
  journal: {
    work: string;
    checkpoint(step: string, data?: Record<string, unknown>): void;
    note(text: string, data?: Record<string, unknown>): void;
    // 施設記憶の登録 (kind: mine/farm/chest/machine/base 等)
    noteFacility(f: { kind: string; pos: { x: number; y: number; z: number };
                      dim?: string; name?: string }): void;
    // 施設記憶の検索 (kind指定で絞込。復元ではなく記録参照)
    facilities(kind?: string): Array<{ kind: string; pos: { x: number; y: number; z: number }; name?: string }>;
    // 作業グラフ: nodes=[{id,kind,name,status,deps}] → graph idを返す
    graphStart(nodes: Array<Record<string, unknown>>): string | null;
    graphSet(graphId: string, nodeId: string, status: string): void;
  };
}

export type SkillOutcome = { ok: boolean; cancelled?: boolean; error?: string };
type Running = { name: string; controller: AbortController; done: Promise<SkillOutcome> };

export class Skills {
  private registry = new Map<string, SkillModule>();
  private current: Running | null = null;

  constructor(
    private state: State,
    private mod: ModClient,
    private dir: string,
    private journal?: Journal,
  ) {}

  private loadChain: Promise<void> = Promise.resolve();

  /** D59/P2-19: 新レジストリを完成させてから差し替える (旧実装は冒頭の
   *  registry.clear() から再構築完了まで、ツール一覧が欠けた状態が
   *  外に見えた)。load 同士も直列化し、旧版モジュールの後勝ち復活を防ぐ */
  load(): Promise<void> {
    this.loadChain = this.loadChain.then(() => this.doLoad());
    return this.loadChain;
  }

  private async doLoad() {
    let files: string[] = [];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.mjs'));
    } catch {
      console.log(`[skills] dir not found: ${this.dir}`);
      return;
    }
    const next = new Map<string, SkillModule>();
    for (const f of files) {
      try {
        const url = pathToFileURL(path.join(this.dir, f)).href + `?t=${Date.now()}`;
        const m = (await import(url)).default as SkillModule;
        if (!m?.name || typeof m.run !== 'function') {
          console.log(`[skills] ${f}: invalid module (need {name, run})`);
          continue;
        }
        next.set(m.name, m);
        console.log(`[skills] loaded ${m.name} (${f})`);
      } catch (e) {
        console.log(`[skills] ${f}: load failed`, e);
      }
    }
    this.registry = next;
  }

  /** ファイル監視でホットリロード (保存イベントの連打はデバウンス) */
  watch() {
    try {
      let t: NodeJS.Timeout | null = null;
      watch(this.dir, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          this.load().catch((e) => console.log('[skills] reload failed', e));
        }, 300);
      });
      console.log(`[skills] watching ${this.dir}`);
    } catch {
      console.log(`[skills] watch failed (dir missing?): ${this.dir}`);
    }
  }

  list(): SkillModule[] {
    return [...this.registry.values()];
  }

  get(name: string) {
    return this.registry.get(name);
  }

  runningName(): string | null {
    return this.current?.name ?? null;
  }

  /** スキルのparams定義をzod shapeに変換。
   *  D59/P2-17: 数値には既定の範囲を付ける。座標系 (x/y/z) だけ負数を許し、
   *  それ以外 (count/radius/length 等) は 0 以上に制限する — 負の個数が
   *  mod まで届いて偽の成功 ({given:-1} 等) を生む経路を塞ぐ */
  static zodShape(m: SkillModule): ZodRawShape {
    const COORD = new Set(['x', 'y', 'z']);
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [k, spec] of Object.entries(m.params ?? {})) {
      let t: z.ZodTypeAny;
      switch (spec.type) {
        case 'number':
          t = COORD.has(k) ? z.number() : z.number().min(0).max(1_000_000);
          break;
        case 'integer':
          t = COORD.has(k)
            ? z.number().int()
            : z.number().int().min(0).max(1_000_000);
          break;
        case 'boolean': t = z.boolean(); break;
        default: t = z.string();
      }
      if (spec.description) t = t.describe(spec.description);
      shape[k] = spec.required ? t : t.optional();
    }
    return shape as ZodRawShape;
  }

  /** 直通経路 (直パース/runner) 用の引数検証。MCP経路は zod が担う */
  private validateArgs(m: SkillModule, args: Record<string, unknown>) {
    const schema = z.object(Skills.zodShape(m)).passthrough();
    const r = schema.safeParse(args);
    if (!r.success) {
      throw new Error(
        `invalid args for skill '${m.name}': `
        + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
  }

  run(name: string, args: Record<string, unknown>) {
    const m = this.registry.get(name);
    if (!m) throw new Error(`unknown skill: ${name}`);
    this.validateArgs(m, args);
    // Review F5: stop_all must preempt. Routing it through the BUSY gate
    // meant "stop" during a long skill fell through to the LLM path and
    // never reached the mod. Abort the running skill, then run stop_all
    // outside the exclusivity slot so its stop calls land immediately.
    // D59/P1-8: ただし stop_all 自身は実行中ずっと排他枠を占有する。
    // 旧実装は枠外実行で、停止処理の最中に新規スキルが割り込み、
    // 「止めたはず」の後に bot が再び動き出す競合があった。
    if (name === 'stop_all' && this.current) {
      const prev = this.current;
      prev.controller.abort();
      const controller = new AbortController();
      const work = this.journal?.newWorkId();
      this.journal?.append('work.start', { work, skill: name, args, preempted: prev.name });
      const ctx = this.makeCtx(controller, work);
      const done = (async (): Promise<SkillOutcome> => {
        // Let the aborted skill start unwinding, but never block the stop.
        await Promise.race([
          prev.done,
          new Promise((r) => setTimeout(r, 1500)),
        ]);
        try {
          const result = await m.run(ctx, args);
          this.state.push('skill.done', { skill: name, ok: true, result });
          this.journal?.append('work.end', { work, skill: name, ok: true, result });
          return { ok: true };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          this.state.push('skill.done', { skill: name, ok: false, error });
          this.journal?.append('work.end', { work, skill: name, ok: false, error });
          return { ok: false, error };
        } finally {
          if (this.current?.controller === controller) this.current = null;
        }
      })();
      this.current = { name, controller, done };
      return { started: true, skill: name, work, done };
    }
    if (this.current) throw new Error(`BUSY: skill '${this.current.name}' is running`);

    const controller = new AbortController();
    // D59/P2-18: ウォッチドッグ。中断を無視するスキルが排他枠を永久に
    // 塞がないよう、制限時間で abort する (follow系は timeoutMs:0 で免除)
    const timeoutMs = m.timeoutMs
      ?? Number(process.env.SKILL_TIMEOUT_MS ?? 1_200_000);
    const watchdog = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    // 世代非依存のwork id: 再起動を跨いで進捗を追跡できる
    const work = this.journal?.newWorkId();
    this.journal?.append('work.start', { work, skill: name, args });
    const ctx = this.makeCtx(controller, work);
    const done = (async (): Promise<SkillOutcome> => {
      try {
        const result = await m.run(ctx, args);
        this.state.push('skill.done', { skill: name, ok: true, result });
        this.journal?.append('work.end', { work, skill: name, ok: true, result });
        // episode: skill実行の記憶 (1行要約)
        this.journal?.episode({
          action: `skill:${name}`, params: args,
          result: summarize(result), ok: true, work,
        });
        return { ok: true };
      } catch (e) {
        const cancelled = controller.signal.aborted;
        const error = e instanceof Error ? e.message : String(e);
        this.state.push('skill.done', { skill: name, ok: false, cancelled, error });
        this.journal?.append('work.end', {
          work, skill: name, ok: false, cancelled, error,
        });
        this.journal?.episode({
          action: `skill:${name}`, params: args,
          result: cancelled ? 'cancelled' : error, ok: false, work,
        });
        return { ok: false, cancelled, error };
      } finally {
        if (watchdog) clearTimeout(watchdog);
        // D59/P1-8: 自分が現行枠のときだけ解放する (stop_all に枠を
        // 引き継いだ旧スキルの finally が新枠を消さないように)
        if (this.current?.controller === controller) this.current = null;
      }
    })();
    this.current = { name, controller, done };
    // doneは実行結果を返す (直パースのcapability学習等で成否を知る用途)
    return { started: true, skill: name, work, done };
  }

  cancel(): { cancelled: string | null } {
    const cur = this.current;
    if (!cur) return { cancelled: null };
    cur.controller.abort();
    return { cancelled: cur.name };
  }

  private makeCtx(controller: AbortController, work?: string): SkillCtx {
    const { signal } = controller;
    const throwIfCancelled = () => {
      if (signal.aborted) throw new Error('CANCELLED');
    };
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(t);
          reject(new Error('CANCELLED'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });

    const mod = this.mod;
    const state = this.state;
    const journal = this.journal;
    return {
      signal,
      throwIfCancelled,
      sleep,
      // ctx.call監視: ブロック/waypoint操作の成功を施設記憶へconsolidationする
      call: async (method, params) => {
        const r = await mod.call(method, params ?? {});
        try { consolidateCall(journal, method, params); } catch { /* 記憶失敗は無視 */ }
        return r;
      },
      state: () => mod.call('obs.state'),
      say: (text) => mod.call('chat.send', { text }),
      chatLog: (n = 50) => state.chat(n),
      schematicPlan: (file, maxLayers) =>
        planSchematic(file, { max_layers: maxLayers }),
      commission: async (x, y, z) => {
        try {
          return await runCommission(mod, { x, y, z });
        } catch (e) {
          return { ok: false,
            error: e instanceof Error ? e.message : String(e) };
        }
      },
      journal: {
        work: work ?? 'none',
        checkpoint: (step, data) =>
          journal?.append('checkpoint', { work, step, ...(data ?? {}) }),
        note: (text, data) =>
          journal?.append('note', { work, text, ...(data ?? {}) }),
        noteFacility: (f) => { journal?.noteFacility(f); },
        facilities: (kind) => journal?.facilities(kind) ?? [],
        graphStart: (nodes) =>
          journal?.graphStart(nodes as never[])?.id ?? null,
        graphSet: (graphId, nodeId, status) => {
          journal?.graphSet(graphId, nodeId, status as never);
        },
      },
      async waitTask(taskId, timeoutMs = 120_000) {
        const deadline = Date.now() + timeoutMs;
        let since = state.latestSeq();
        while (Date.now() < deadline) {
          throwIfCancelled();
          const evts = await state.waitFor(since, Math.min(5000, deadline - Date.now()), ['task.done']);
          for (const e of evts) {
            since = e.seq;
            const d = e.data as Record<string, unknown>;
            if (d?.task_id === taskId) return d;
          }
        }
        return null;
      },
    };
  }
}

/** episodeのresult用: 値を1行の短い文字列に潰す */
function summarize(v: unknown): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + '...' : s;
  } catch {
    return String(v);
  }
}

/**
 * ctx.call のconsolidation: 座標を伴うブロック操作・waypoint登録を
 * 施設記憶 (facility) として集約する。同kind+座標4m以内はevidenceが増えるだけ。
 */
function consolidateCall(
  journal: Journal | undefined,
  method: string,
  params: Record<string, unknown> | undefined,
) {
  if (!journal || !params) return;
  const pos = (typeof params.x === 'number' && typeof params.y === 'number'
    && typeof params.z === 'number')
    ? { x: params.x, y: params.y, z: params.z } : null;
  if (!pos) return;
  if (method === 'waypoint.set' && typeof params.name === 'string') {
    journal.noteFacility({ kind: 'waypoint', pos, name: params.name });
  } else if (method === 'use_item' || method === 'interact') {
    const kind = typeof params.block === 'string' ? params.block : 'interact';
    journal.noteFacility({ kind, pos });
  }
}
