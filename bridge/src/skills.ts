import { readdirSync, watch } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, ZodRawShape } from 'zod';
import { State } from './state.js';
import { ModClient } from './modclient.js';
import { Journal } from './journal.js';
import { planSchematic } from './schematic.js';

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
  run(ctx: SkillCtx, args: Record<string, unknown>): Promise<unknown>;
}

export interface SkillCtx {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  state(): Promise<unknown>;
  say(text: string): Promise<unknown>;
  /** 直近のゲーム内チャット (locateコマンドの結果読み取り等に使う) */
  chatLog(n?: number): { from: string; text: string; ts: number }[];
  /** schematicファイルの建築計画 (y下から順のブロック列) */
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

  async load() {
    this.registry.clear();
    let files: string[] = [];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.mjs'));
    } catch {
      console.log(`[skills] dir not found: ${this.dir}`);
      return;
    }
    for (const f of files) {
      try {
        const url = pathToFileURL(path.join(this.dir, f)).href + `?t=${Date.now()}`;
        const m = (await import(url)).default as SkillModule;
        if (!m?.name || typeof m.run !== 'function') {
          console.log(`[skills] ${f}: invalid module (need {name, run})`);
          continue;
        }
        this.registry.set(m.name, m);
        console.log(`[skills] loaded ${m.name} (${f})`);
      } catch (e) {
        console.log(`[skills] ${f}: load failed`, e);
      }
    }
  }

  /** ファイル監視でホットリロード */
  watch() {
    try {
      watch(this.dir, () => {
        this.load().catch((e) => console.log('[skills] reload failed', e));
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

  /** スキルのparams定義をzod shapeに変換 */
  static zodShape(m: SkillModule): ZodRawShape {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [k, spec] of Object.entries(m.params ?? {})) {
      let t: z.ZodTypeAny;
      switch (spec.type) {
        case 'number': t = z.number(); break;
        case 'integer': t = z.number().int(); break;
        case 'boolean': t = z.boolean(); break;
        default: t = z.string();
      }
      if (spec.description) t = t.describe(spec.description);
      shape[k] = spec.required ? t : t.optional();
    }
    return shape as ZodRawShape;
  }

  run(name: string, args: Record<string, unknown>) {
    const m = this.registry.get(name);
    if (!m) throw new Error(`unknown skill: ${name}`);
    if (this.current) throw new Error(`BUSY: skill '${this.current.name}' is running`);

    const controller = new AbortController();
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
        this.current = null;
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
