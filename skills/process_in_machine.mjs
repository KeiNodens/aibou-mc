// 機械に材料を入れて加工結果を取り出す汎用技能 (design §6.5 Phase 2)。
// machines/<menu_id>.json の定義があればそれでslotを解決し、無ければ
// container内のslot群(container_idx)とslot_class名から推定する。
import { readFileSync, existsSync } from 'node:fs';

const MACHINES_DIR = new URL('../machines/', import.meta.url);

function loadDef(menuId) {
  const file = new URL(`${menuId.replace(':', '_')}.json`, MACHINES_DIR);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// menu_idのスロット列から、機械側slotを {input,output,fuel} に推定する。
// def優先、無ければコンテナ分離+クラス名ヒューリスティック。
function resolveRoles(menu, def) {
  if (def) {
    return {
      input: def.input ?? [],
      output: def.output ?? [],
      fuel: def.fuel ?? [],
      source: 'definition',
    };
  }
  // 最終slotが属するcontainerをplayer invとみなし、それ以外を機械側とする
  const playerIdx = menu.slots[menu.slots.length - 1].container_idx;
  const machineSlots = menu.slots.filter((s) => s.container_idx !== playerIdx);
  const input = [], output = [], fuel = [];
  // 'virtual' は機械のエネルギー/アップグレード用仮想slot — 投入対象から外す
  const real = machineSlots.filter(
    (s) => !(s.slot_class ?? '').toLowerCase().includes('virtual'));
  for (const s of real) {
    const c = (s.slot_class ?? '').toLowerCase();
    if (c.includes('output') || c.includes('result')) output.push(s.slot);
    else if (c.includes('fuel') || c.includes('energy')) fuel.push(s.slot);
    else input.push(s.slot);
  }
  // クラス名から役割が取れない場合: input=先頭の実slot、output=残り全て
  // (output側は「投入したアイテム以外が現れたら回収」で運用する)
  if (!output.length && input.length > 1) {
    output.push(...input.slice(1));
    input.length = 1;
  }
  return { input, output, fuel, source: 'heuristic' };
}

export default {
  name: 'process_in_machine',
  description:
    'Put an item into a machine and take the processed result. Uses machine ' +
    'definitions (machines/*.json) when known, otherwise infers input/output ' +
    'slots from the open menu. Opens the nearest machine block if not already open.',
  params: {
    input: { type: 'string', required: true, description: 'item id to feed, e.g. mekanism:raw_tin' },
    count: { type: 'integer', required: false, description: 'how many to insert (default all)' },
    machine: { type: 'string', required: false, description: 'block id to find and open' },
    input2: { type: 'string', required: false, description: 'secondary material (2nd input slot)' },
    fuel: { type: 'string', required: false, description: 'fuel item for fuel slot' },
    output: { type: 'string', required: false, description: 'wait until this item appears in output' },
    timeout_s: { type: 'integer', required: false, description: 'seconds to wait for result (default 30)' },
  },
  async run(ctx, { input, count, machine, input2, fuel, output, timeout_s = 30 }) {
    const short = (id) => (id.includes(':') ? id.split(':')[1] : id);

    // 1. machineが指定されていれば開く (既に開いているmenuがあればそのまま使う)
    if (machine) {
      const found = await ctx.call('obs.block', { block: machine, radius: 48 });
      if (!found.found?.length) {
        await ctx.say(`${short(machine)} が近くに見つからない`);
        return { done: false, reason: 'machine_not_found' };
      }
      const t = found.found[0];
      if ((t.dist ?? 99) > 3.5) {
        const g = await ctx.call('baritone.goto', { x: t.x, y: t.y, z: t.z });
        const gt = await ctx.waitTask(g.task_id, 60_000);
        if (!gt || gt.state !== 'succeeded') {
          await ctx.say(`${short(machine)} まで行けなかった`);
          return { done: false, reason: 'cannot_reach' };
        }
      }
      await ctx.call('use_item', { x: t.x, y: t.y, z: t.z, face: 'up' });
      await ctx.sleep(400);
    }

    // 2. menuを読んで役割を解決
    let menu = await ctx.call('container.read');
    const def = loadDef(menu.menu_id);
    if (def?.menu_id && def.menu_id !== menu.menu_id) {
      return { done: false, reason: 'def_menu_mismatch' };
    }
    const roles = resolveRoles(menu, def);
    if (!roles.input.length) {
      await ctx.say('この機械の投入slotが分からない');
      return { done: false, reason: 'no_input_slots', menu: menu.menu_id };
    }

    // player側slot群 = 最終slotが属するcontainer (menu定義上ほぼ末尾がplayer inv)
    const playerSlots = () => {
      const last = menu.slots[menu.slots.length - 1];
      return menu.slots.filter((s) => s.container_idx === last.container_idx);
    };
    const findPlayerSlot = (item) =>
      playerSlots().find((s) => !s.empty && s.id === item && s.count > 0);

    // 3. 材料を機械のinput slotへ入れる (pickup→place)。
    //    count未指定なら1スタック分。carriedが残れば元slotへ戻す。
    const items = [
      { item: input, dst: roles.input[0] },
      input2 != null ? { item: input2, dst: roles.input[1] ?? roles.input[0] } : null,
      fuel != null && roles.fuel.length ? { item: fuel, dst: roles.fuel[0] } : null,
    ].filter(Boolean);
    let inserted = 0;
    for (const { item, dst } of items) {
      if (dst === undefined) continue;
      let moved = 0;
      const cap = count ?? 64;
      while (moved < cap) {
        const src = findPlayerSlot(item);
        if (!src) break;
        const want = Math.min(cap - moved, src.count);
        await ctx.call('container.click', {
          slot: src.slot, action: 'pickup', menu_id: menu.menu_id,
        });
        await ctx.call('container.click', {
          slot: dst, action: 'pickup', menu_id: menu.menu_id,
        });
        const read = await ctx.call('container.read');
        if (read.carried) {
          await ctx.call('container.click', {
            slot: src.slot, action: 'pickup', menu_id: menu.menu_id,
          });
        }
        menu = read;
        moved += want;
        inserted += want;
      }
    }
    if (inserted === 0) {
      await ctx.say(`${short(input)} を持ってない`);
      return { done: false, reason: 'material_missing' };
    }
    await ctx.say(`${short(input)} を${short(machine ?? menu.menu_id)}に入れたよ`);

    // 4. output slotに成果が出るまでpollして回収
    const deadline = Date.now() + timeout_s * 1000;
    let produced = 0;
    const seen = {};
    while (Date.now() < deadline) {
      await ctx.sleep(1000);
      const m = await ctx.call('container.read');
      const outs = roles.output.length ? roles.output : roles.input;
      let done = false;
      for (const s of m.slots) {
        if (!outs.includes(s.slot) || s.empty) continue;
        // mod統合で出力が別modのIDになることがあるので、output指定は
        // 回収の可否ではなく報告用ヒントとして扱う
        if (output && s.id !== output) {
          seen['__mismatch'] = s.id;
        }
        await ctx.call('container.click', {
          slot: s.slot, action: 'quick_move', menu_id: menu.menu_id,
        });
        produced += s.count;
        seen[s.id] = (seen[s.id] ?? 0) + s.count;
        done = true;
      }
      if (done) break;
    }

    if (produced === 0) {
      await ctx.say('加工結果がまだ出てこない');
      return { done: false, reason: 'timeout', inserted };
    }
    const ids = Object.keys(seen).filter((k) => !k.startsWith('__'));
    const first = ids[0];
    await ctx.say(`${short(first)} を${produced}個作ったよ (${roles.source === 'definition' ? '定義' : '推定'}slot)`);
    const got = Object.fromEntries(ids.map((k) => [k, seen[k]]));
    if (seen.__mismatch) got.output_mismatch = seen.__mismatch;
    return { done: true, produced, items: got, via: roles.source };
  },
};
