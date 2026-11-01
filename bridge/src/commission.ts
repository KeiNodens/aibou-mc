// commission 実行器 (D30 で mcp.ts 内に実装、D39 で共有モジュール化):
// 配置済み機械に対して、機械定義の "commission" 配列 (または
// inline plan) の GUI 手順を実行する。MCP ツールと SkillCtx の
// 両方から使う。失敗した step で止まり、結果を全て返す。
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

type CallFn = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

let machineDefsCache: Array<Record<string, unknown>> | null = null;

export async function loadMachineDefs(): Promise<Array<Record<string, unknown>>> {
  if (machineDefsCache) return machineDefsCache;
  const defs: Array<Record<string, unknown>> = [];
  for (const dir of [path.resolve(process.cwd(), 'machines'),
    path.resolve(process.cwd(), '..', 'machines')]) {
    try {
      const { readdir } = await import('node:fs/promises');
      for (const f of await readdir(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          defs.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
        } catch { /* skip broken def */ }
      }
      if (defs.length) break;
    } catch { /* try next dir */ }
  }
  machineDefsCache = defs;
  return defs;
}

export async function runCommission(
  mod: CallFn,
  args: { x?: number; y?: number; z?: number; plan?: unknown[] },
): Promise<Record<string, unknown>> {
  const { x, y, z, plan } = args;
  let block: string | undefined;
  let def: Record<string, unknown> | undefined;
  if (x !== undefined && y !== undefined && z !== undefined) {
    const bs = (await mod.call('obs.block_state', { x, y, z })) as
      { id?: string; block?: string };
    block = bs?.id ?? bs?.block;
    const defs = await loadMachineDefs();
    def = defs.find((d) => d.block === block);
  }
  const steps = (plan ?? (def?.commission as unknown[] | undefined)) as
    Array<Record<string, unknown>> | undefined;
  if (!steps?.length) {
    return { ok: false, block,
      note: 'no commission plan (definition has none and no inline plan given)' };
  }
  const results: Array<Record<string, unknown>> = [];
  for (const step of steps) {
    const doWhat = String(step.do ?? '');
    try {
      let r: unknown = 'ok';
      if (doWhat === 'open') {
        r = await mod.call('use_item', { x, y, z });
      } else if (doWhat === 'button') {
        r = await mod.call('container.button', { button_id: step.id });
      } else if (doWhat === 'click_slot') {
        r = await mod.call('container.click', {
          slot: step.slot, button: step.button ?? 0,
          action: step.action ?? 'pickup' });
      } else if (doWhat === 'screen_click') {
        const p: Record<string, unknown> = {};
        for (const k of ['index', 'text', 'x', 'y', 'sidebar']) {
          if (step[k] !== undefined) p[k] = step[k];
        }
        r = await mod.call('screen.click', p);
      } else if (doWhat === 'wait') {
        await new Promise((res) => setTimeout(res, Number(step.ms ?? 500)));
      } else if (doWhat === 'close') {
        r = await mod.call('container.close');
      } else {
        throw new Error(`unknown step: ${doWhat}`);
      }
      results.push({ do: doWhat, ok: true, result: r });
    } catch (e) {
      results.push({ do: doWhat, ok: false,
        error: e instanceof Error ? e.message : String(e) });
      return { ok: false, block, steps: results };
    }
  }
  return { ok: true, block, steps: results };
}
