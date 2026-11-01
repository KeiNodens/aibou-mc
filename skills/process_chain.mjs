// 加工チェーン (D39): 鉱石→インゴットのような複数機械を跨ぐ
// 加工を、名前付きルートとして束ねる。各工程は process_in_machine
// をそのまま使う (力学はそちら、本スキルは順序と数量の受け渡し)。
// ルートは Mekanism の倍化ライン: mek_2x (濃縮→製錬)、
// mek_3x (浄化→粉砕→濃縮→製錬、浄化には酸素の供給が別途要る)。
import pim from './process_in_machine.mjs';

const METALS = {
  iron: { raw: 'minecraft:raw_iron', ingot: 'minecraft:iron_ingot' },
  gold: { raw: 'minecraft:raw_gold', ingot: 'minecraft:gold_ingot' },
  copper: { raw: 'minecraft:raw_copper', ingot: 'minecraft:copper_ingot' },
  osmium: { raw: 'mekanism:raw_osmium', ingot: 'mekanism:ingot_osmium' },
  tin: { raw: 'mekanism:raw_tin', ingot: 'mekanism:ingot_tin' },
  lead: { raw: 'mekanism:raw_lead', ingot: 'mekanism:ingot_lead' },
  uranium: { raw: 'mekanism:raw_uranium', ingot: 'mekanism:ingot_uranium' },
};
const itemFor = (metal, stage) => {
  const m = METALS[metal];
  if (stage === 'raw') return m.raw;
  if (stage === 'ingot') return m.ingot;
  return `mekanism:${stage}_${metal}`; // shard_/clump_/dirty_dust_/dust_
};

const ROUTES = {
  mek_2x: {
    label: 'Mekanism 2倍化 (濃縮→製錬)',
    steps: [
      { machine: 'mekanism:enrichment_chamber', from: 'raw', to: 'dust', mult: 2 },
      { machine: 'mekanism:energized_smelter', from: 'dust', to: 'ingot', mult: 1 },
    ],
  },
  mek_3x: {
    label: 'Mekanism 3倍化 (浄化→粉砕→濃縮→製錬、浄化は酸素が要る)',
    steps: [
      { machine: 'mekanism:purification_chamber', from: 'raw', to: 'shard', mult: 3 },
      { machine: 'mekanism:crusher', from: 'shard', to: 'clump', mult: 1 },
      { machine: 'mekanism:enrichment_chamber', from: 'clump', to: 'dirty_dust', mult: 1 },
      { machine: 'mekanism:energized_smelter', from: 'dirty_dust', to: 'ingot', mult: 1 },
    ],
  },
};

export default {
  name: 'process_chain',
  description:
    'Run a named multi-machine processing route end to end (ore ' +
    'doubling chains). Each step delegates to process_in_machine; ' +
    'this skill carries item kinds and counts between steps and ' +
    'stops at the first failing step. Routes: mek_2x, mek_3x. ' +
    'Metals: iron, gold, copper, osmium, tin, lead, uranium.',
  params: {
    route: { type: 'string', required: true, description: 'mek_2x | mek_3x' },
    metal: { type: 'string', required: true, description: 'metal key, e.g. iron' },
    count: { type: 'integer', required: false, description: 'raw items to process (default 8)' },
    timeout_s: { type: 'integer', required: false, description: 'per-step wait seconds (default 60)' },
  },
  async run(ctx, { route, metal, count = 8, timeout_s = 60 }) {
    const r = ROUTES[route];
    if (!r) return { done: false, reason: 'unknown_route', routes: Object.keys(ROUTES) };
    if (!METALS[metal]) return { done: false, reason: 'unknown_metal', metals: Object.keys(METALS) };
    let amount = count;
    const stepsDone = [];
    for (let i = 0; i < r.steps.length; i++) {
      const st = r.steps[i];
      ctx.throwIfCancelled();
      const res = await pim.run(ctx, {
        input: itemFor(metal, st.from),
        count: amount,
        machine: st.machine,
        output: itemFor(metal, st.to),
        timeout_s,
      }).catch((e) => ({ done: false, reason: String(e?.message ?? e) }));
      if (!res?.done) {
        await ctx.say(`${r.label}: ${i + 1}工程目 (${st.machine}) で止まった`);
        return {
          done: false, route, metal, failed_step: i,
          machine: st.machine, reason: res?.reason ?? 'step_failed',
          steps_done: stepsDone,
        };
      }
      amount = res.produced ?? Math.round(amount * st.mult);
      stepsDone.push({ machine: st.machine, produced: amount });
    }
    await ctx.say(`${r.label} 終わり。${METALS[metal].ingot} が ${amount} 個できた`);
    return {
      done: true, route, metal, produced: amount,
      ingot: METALS[metal].ingot, steps: stepsDone,
    };
  },
};
