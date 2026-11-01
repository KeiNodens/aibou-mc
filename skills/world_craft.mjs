// world_craft (D21): GUI を持たない「ワールド内操作」の加工を実行する。
// 振る舞いは stations/*.json の定義で与え、ステップ原語を解釈して回す。
// 型は「投入 → 変化を観測して待つ → 回収」で、成否はインベントリ差分
// (権威ある状態) で判定する。ステーションの前提インフラ (マナ供給・
// 動力・形成済み構造) はプレイヤーの担当で、崩れている場合は
// タイムアウト + 定義の hint を報告して止まる。
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIONS_DIR = process.env.STATIONS_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stations');

let defsCache = null;
async function loadDefs() {
  if (defsCache) return defsCache;
  const defs = new Map();
  let files = [];
  try { files = (await readdir(STATIONS_DIR)).filter((f) => f.endsWith('.json')); }
  catch { /* 定義なし */ }
  for (const f of files) {
    try {
      const def = JSON.parse(await readFile(path.join(STATIONS_DIR, f), 'utf8'));
      if (def.id) defs.set(def.id, def);
    } catch { /* 壊れた定義は無視 */ }
  }
  defsCache = defs;
  return defs;
}

function invMap(st) {
  const m = new Map();
  for (const s of st?.inventory_detail ?? [])
    if (s.id) m.set(s.id, (m.get(s.id) ?? 0) + (s.count ?? 0));
  return m;
}

async function ensureHeld(ctx, itemId) {
  const st = await ctx.state().catch(() => null);
  const detail = st?.inventory_detail ?? [];
  let slot = detail.find((s) => s.id === itemId && s.slot <= 8 && !s.empty);
  if (!slot) {
    const inv = detail.find((s) => s.id === itemId && s.slot > 8 && !s.empty);
    if (!inv) return false;
    const read = await ctx.call('container.read').catch(() => null);
    if (read?.menu_id !== 'player_inventory') return false;
    const usedHot = new Set(
      detail.filter((s) => s.slot <= 8 && !s.empty).map((s) => s.slot));
    let target = 8;
    for (let i = 0; i <= 8; i++) if (!usedHot.has(i)) { target = i; break; }
    await ctx.call('container.click', {
      slot: inv.slot, action: 'swap', button: target, menu_id: read.menu_id,
    });
    await ctx.sleep(200);
    slot = { slot: target };
  }
  await ctx.call('equip', { slot: slot.slot });
  return true;
}

async function itemEntitiesNear(ctx, pos, radius = 6) {
  const r = await ctx.call('obs.entity', { name: 'minecraft:item', radius })
    .catch(() => null);
  return (r?.entities ?? []).filter((e) =>
    Math.abs(e.x - pos.x) <= radius && Math.abs(e.z - pos.z) <= radius);
}

export default {
  name: 'world_craft',
  description:
    'Run a world-interaction crafting station (no GUI): mana infusion, ' +
    'crystal growth, petal apothecary, enchanting apparatus, casting, ' +
    'Create stations... The choreography comes from stations/*.json ' +
    'definitions. Station infrastructure (mana supply, power, formed ' +
    'structures) is the player\'s job; on timeout the likely missing ' +
    'prerequisite is reported. List stations by calling with no station.',
  params: {
    station: { type: 'string', required: false, description: 'station definition id (omit to list)' },
    crafts: { type: 'integer', required: false, description: 'how many crafts to run (default 1)' },
    input: { type: 'string', required: false, description: 'override the input item (single-input stations)' },
    x: { type: 'integer', required: false, description: 'station X (default: scan for the station block)' },
    y: { type: 'integer', required: false },
    z: { type: 'integer', required: false },
  },
  async run(ctx, args) {
    const defs = await loadDefs();
    if (!args.station) {
      return { done: true, stations: [...defs.values()].map((d) => ({
        id: d.id, recipeTypes: d.recipeTypes ?? [], block: d.station?.block,
        draft: !!d.draft,
      })) };
    }
    const def = defs.get(args.station);
    if (!def) return { done: false, reason: 'unknown_station', station: args.station };

    const crafts = Math.max(1, args.crafts ?? 1);
    let inputs = (def.inputs ?? []).map((i) => ({
      item: i.item, count: (i.per ?? 1) * crafts,
    }));
    if (args.input && inputs.length === 1)
      inputs = [{ item: args.input, count: inputs[0].count }];
    if (args.input && inputs.length === 0)
      inputs = [{ item: args.input, count: crafts }];
    if (!inputs.length) return { done: false, reason: 'no_inputs_defined' };

    // ステーション発見
    let pos = null;
    if (args.x != null && args.y != null && args.z != null)
      pos = { x: args.x, y: args.y, z: args.z };
    else {
      const found = await ctx.call('obs.block', {
        block: def.station.block, radius: def.station.radius ?? 32,
      }).catch(() => null);
      pos = found?.found?.[0] ?? null;
    }
    if (!pos) {
      await ctx.say(`${def.station.block} が見つからない`);
      return { done: false, reason: 'station_not_found', block: def.station.block };
    }

    const invBefore = invMap(await ctx.state().catch(() => null));
    const log = [];
    let transformSeen = null;

    for (const step of def.steps ?? []) {
      ctx.throwIfCancelled();
      switch (step.do) {
        case 'goto_station': {
          const g = await ctx.call('baritone.goto', pos).catch(() => null);
          if (g?.task_id) await ctx.waitTask(g.task_id, 60_000);
          ctx.journal?.noteFacility({
            kind: 'station', pos, name: def.id,
          });
          log.push('goto_station');
          break;
        }
        case 'toss_inputs': {
          for (const inp of inputs) {
            if (!(await ensureHeld(ctx, inp.item)))
              return { done: false, reason: 'input_missing', item: inp.item, log };
            for (let i = 0; i < inp.count; i++) {
              ctx.throwIfCancelled();
              await ctx.call('toss', {});
              await ctx.sleep(200);
            }
          }
          log.push('toss_inputs');
          break;
        }
        case 'place_on': {
          for (const inp of inputs) {
            if (!(await ensureHeld(ctx, inp.item)))
              return { done: false, reason: 'input_missing', item: inp.item, log };
            const target = step.target === 'station' || !step.target
              ? pos : pos;
            await ctx.call('use_item', { x: target.x, y: target.y, z: target.z });
            await ctx.sleep(300);
          }
          log.push('place_on');
          break;
        }
        case 'right_click_station': {
          if (step.with) {
            if (!(await ensureHeld(ctx, step.with)))
              return { done: false, reason: 'tool_missing', item: step.with, log };
          }
          const target = step.target_block
            ? (await ctx.call('obs.block', {
              block: step.target_block, radius: 8,
            }).catch(() => null))?.found?.[0] ?? pos
            : pos;
          await ctx.call('use_item', { x: target.x, y: target.y, z: target.z });
          await ctx.sleep(300);
          log.push('right_click_station');
          break;
        }
        case 'wait_transform': {
          const timeoutMs = (step.timeout_s ?? def.timeout_s ?? 60) * 1000;
          const baseline = (await itemEntitiesNear(ctx, pos)).length;
          const start = Date.now();
          transformSeen = false;
          while (Date.now() - start < timeoutMs) {
            ctx.throwIfCancelled();
            await ctx.sleep(2500);
            const now = (await itemEntitiesNear(ctx, pos)).length;
            if (now !== baseline) { transformSeen = true; break; }
          }
          log.push(`wait_transform:${transformSeen ? 'changed' : 'timeout'}`);
          break;
        }
        case 'wait_block_state': {
          const timeoutMs = (step.timeout_s ?? 60) * 1000;
          const start = Date.now();
          let ok = false;
          while (Date.now() - start < timeoutMs) {
            ctx.throwIfCancelled();
            const cur = await ctx.call('obs.block_state', pos).catch(() => null);
            if (step.block && cur?.block === step.block) { ok = true; break; }
            if (step.match && cur?.properties &&
              Object.entries(step.match)
                .every(([k, v]) => String(cur.properties[k]) === String(v))) {
              ok = true; break;
            }
            await ctx.sleep(2000);
          }
          log.push(`wait_block_state:${ok ? 'ok' : 'timeout'}`);
          break;
        }
        case 'collect': {
          if (def.collect_block) {
            const found = await ctx.call('obs.block', {
              block: def.collect_block, radius: 8,
            }).catch(() => null);
            const cp = found?.found?.[0];
            if (cp) {
              const g = await ctx.call('baritone.goto', cp).catch(() => null);
              if (g?.task_id) await ctx.waitTask(g.task_id, 30_000);
              await ctx.call('use_item', { x: cp.x, y: cp.y, z: cp.z })
                .catch(() => {});
              await ctx.sleep(400);
            }
          }
          const g = await ctx.call('baritone.goto', pos).catch(() => null);
          if (g?.task_id) await ctx.waitTask(g.task_id, 30_000);
          await ctx.sleep(1200); // 近くのドロップを歩いて拾う
          log.push('collect');
          break;
        }
        default:
          log.push(`unknown_step:${step.do}`);
      }
    }

    // 事後条件: インベントリ差分 (権威ある状態) で判定
    const invAfter = invMap(await ctx.state().catch(() => null));
    const consumed = {};
    const produced = {};
    for (const inp of inputs) {
      const d = (invBefore.get(inp.item) ?? 0) - (invAfter.get(inp.item) ?? 0);
      // 投入分は手持ちから減っているのが正常 (ドロップ→消費 or 変換)
      if (d !== 0) consumed[inp.item] = d;
    }
    for (const [id, n] of invAfter) {
      const d = n - (invBefore.get(id) ?? 0);
      if (d > 0 && !inputs.some((i) => i.item === id)) produced[id] = d;
    }
    const anyProduced = Object.keys(produced).length > 0;
    const done = anyProduced || (def.allow_no_output === true && transformSeen);
    if (done) {
      await ctx.say(`できたよ: ${Object.entries(produced)
        .map(([id, n]) => `${id} x${n}`).join(', ') || '(変換を確認)'}`);
    } else {
      await ctx.say(
        `うまくいかなかった。${def.hint ?? 'ステーションの前提条件を確認してみて'}`);
    }
    return {
      done: !!done, station: def.id, consumed, produced,
      transform_seen: transformSeen, log,
      hint: done ? undefined : (def.hint ?? null),
    };
  },
};
