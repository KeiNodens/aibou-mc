import { readdirSync, watch } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, ZodRawShape } from 'zod';
import { State } from './state.js';
import { ModClient } from './modclient.js';

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
  sleep(ms: number): Promise<void>;
  // mod側taskの完了(task.done)を待つ。timeoutで null、cancelで例外
  waitTask(taskId: string, timeoutMs?: number): Promise<Record<string, unknown> | null>;
  signal: AbortSignal;
  throwIfCancelled(): void;
}

type Running = { name: string; controller: AbortController; done: Promise<void> };

export class Skills {
  private registry = new Map<string, SkillModule>();
  private current: Running | null = null;

  constructor(
    private state: State,
    private mod: ModClient,
    private dir: string,
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
    const ctx = this.makeCtx(controller);
    const done = (async () => {
      try {
        const result = await m.run(ctx, args);
        this.state.push('skill.done', { skill: name, ok: true, result });
      } catch (e) {
        const cancelled = controller.signal.aborted;
        this.state.push('skill.done', {
          skill: name,
          ok: false,
          cancelled,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        this.current = null;
      }
    })();
    this.current = { name, controller, done };
    return { started: true, skill: name };
  }

  cancel(): { cancelled: string | null } {
    const cur = this.current;
    if (!cur) return { cancelled: null };
    cur.controller.abort();
    return { cancelled: cur.name };
  }

  private makeCtx(controller: AbortController): SkillCtx {
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
    return {
      signal,
      throwIfCancelled,
      sleep,
      call: (method, params) => mod.call(method, params ?? {}),
      state: () => mod.call('obs.state'),
      say: (text) => mod.call('chat.send', { text }),
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
