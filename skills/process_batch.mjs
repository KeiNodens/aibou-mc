// 並列加工 (D50): 同じ機械が複数台ある時、総量を台数で割って
// 順に投入する。process_in_machine は「一番近い1台」を開くので、
// 台のそばへ移動してから呼ぶことで対象を実質指定する
// (専用経路を作らない = 冗長で複合可能な側の設計、D43 原則)。
import processInMachine from './process_in_machine.mjs';

export default {
  name: 'process_batch',
  description:
    'Process a total amount across ALL machines of one block type ' +
    'found nearby: splits the count across machines and runs the ' +
    'existing single-machine processing at each (by standing next ' +
    'to it). Slower per item than a dedicated parallel rig, but ' +
    'works with any layout and any machine definition.',
  params: {
    input: { type: 'string', required: true, description: 'item id to feed' },
    count: { type: 'integer', required: true, description: 'total amount to process' },
    machine: { type: 'string', required: true, description: 'machine block id' },
    input2: { type: 'string', required: false, description: 'secondary material' },
    fuel: { type: 'string', required: false, description: 'fuel item' },
    output: { type: 'string', required: false, description: 'expected output item id (hint)' },
    timeout_s: { type: 'integer', required: false, description: 'per-machine wait (default 30)' },
    radius: { type: 'integer', required: false, description: 'search radius (default 48)' },
  },
  async run(ctx, { input, count, machine, input2, fuel, output, timeout_s = 30, radius = 48 }) {
    const found = await ctx.call('obs.block', { block: machine, radius })
      .catch(() => null);
    const spots = [...(found?.found ?? [])]
      .sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
    if (!spots.length) return { done: false, reason: 'machine_not_found' };
    let remaining = count;
    let produced = 0;
    let inserted = 0;
    const perMachine = [];
    for (let i = 0; i < spots.length && remaining > 0; i++) {
      ctx.throwIfCancelled();
      const share = Math.ceil(remaining / (spots.length - i));
      const t = spots[i];
      const g = await ctx.call('baritone.goto', { x: t.x, y: t.y, z: t.z })
        .catch(() => null);
      if (g?.task_id) await ctx.waitTask(g.task_id, 60_000).catch(() => null);
      const r = await processInMachine.run(ctx, {
        input, count: share, machine, input2, fuel, output, timeout_s,
      }).catch((e) => ({ done: false, reason: String(e?.message ?? e) }));
      perMachine.push({ at: { x: t.x, y: t.y, z: t.z }, share, ...r });
      produced += r?.produced ?? 0;
      inserted += r?.inserted ?? 0;
      remaining -= r?.inserted ?? share;
      if (!r?.done && !r?.produced) break;
    }
    await ctx.say(`並列加工終わり。${spots.length}台体制で ${produced} 個できた`);
    return {
      done: produced > 0, produced, inserted,
      machines_found: spots.length, machines_used: perMachine.length,
      per_machine: perMachine,
    };
  },
};
