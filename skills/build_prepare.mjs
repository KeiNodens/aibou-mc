// 建築準備 (D23/S2): schematic の材料集計を起点に、手持ち → 施設記憶の
// チェスト → ME 端末の順で不足分を集め、残りを「作れるもの」と
// 「本当に足りないもの」に分けて報告する。gather=false で集めずに診断だけ。
async function gotoPos(ctx, pos) {
  const g = await ctx.call('baritone.goto', { x: pos.x, y: pos.y, z: pos.z });
  if (g?.task_id) await ctx.waitTask(g.task_id, 60_000);
  await ctx.call('look_at', { x: pos.x, y: pos.y, z: pos.z }).catch(() => {});
}

async function openAt(ctx, pos) {
  await gotoPos(ctx, pos);
  await ctx.call('use_item', { x: pos.x, y: pos.y, z: pos.z });
  await ctx.sleep(500);
}

function splitSides(read) {
  const sizes = read?.container_sizes ?? {};
  const idxs = Object.keys(sizes).map(Number);
  if (!read || read.menu_id === 'player_inventory' || idxs.length < 2) return null;
  const playerIdx = idxs.reduce((a, b) => (sizes[a] >= sizes[b] ? a : b));
  return { playerIdx, menuId: read.menu_id };
}

function invCounts(st) {
  const m = new Map();
  for (const s of st?.inventory_detail ?? [])
    if (s.id) m.set(s.id, (m.get(s.id) ?? 0) + (s.count ?? 0));
  return m;
}

export default {
  name: 'build_prepare',
  description:
    'Prepare materials for building a schematic: tally the plan, subtract ' +
    'the bot inventory, fetch the shortfall from remembered chests and an ' +
    'ME terminal (in that order), then classify what is still missing into ' +
    'craftable (a recipe exists) vs truly missing. gather=false only ' +
    'diagnoses without moving items.',
  params: {
    file: { type: 'string', required: true, description: 'schematic file path (on the bridge PC)' },
    gather: { type: 'boolean', required: false, description: 'actually fetch items (default true)' },
    me_x: { type: 'integer', required: false, description: 'ME terminal X' },
    me_y: { type: 'integer', required: false },
    me_z: { type: 'integer', required: false },
  },
  async run(ctx, args) {
    const plan = await ctx.schematicPlan(args.file);
    if (!plan?.blocks?.length) return { done: false, reason: 'empty_plan' };
    const need = new Map();
    for (const b of plan.blocks) need.set(b.id, (need.get(b.id) ?? 0) + 1);

    const st = await ctx.state().catch(() => null);
    const have = invCounts(st);
    const fromInventory = {};
    const remaining = new Map();
    for (const [id, n] of need) {
      const h = Math.min(have.get(id) ?? 0, n);
      if (h > 0) fromInventory[id] = h;
      if (n - h > 0) remaining.set(id, n - h);
    }

    const fetched = {};
    const take = (id, n) => {
      fetched[id] = (fetched[id] ?? 0) + n;
      const left = (remaining.get(id) ?? 0) - n;
      if (left <= 0) remaining.delete(id);
      else remaining.set(id, left);
    };

    if (args.gather !== false && remaining.size) {
      // チェスト候補: 近傍スキャン + 施設記憶 (近い順)
      const me = st?.player ?? st?.pos ?? { x: 0, y: 0, z: 0 };
      const positions = [];
      const scan = await ctx.call('obs.block', {
        block: 'minecraft:chest', radius: 24,
      }).catch(() => null);
      for (const p of scan?.found ?? []) positions.push(p);
      const fac = (ctx.journal?.facilities('chest') ?? [])
        .map((f) => f.pos)
        .sort((a, b) =>
          ((a.x - me.x) ** 2 + (a.z - me.z) ** 2) - ((b.x - me.x) ** 2 + (b.z - me.z) ** 2));
      for (const p of fac)
        if (!positions.some((q) => q.x === p.x && q.y === p.y && q.z === p.z))
          positions.push(p);

      for (const pos of positions) {
        if (!remaining.size) break;
        ctx.throwIfCancelled();
        await openAt(ctx, pos);
        try {
          const read = await ctx.call('container.read');
          const sides = splitSides(read);
          if (!sides) continue;
          ctx.journal?.noteFacility({ kind: 'chest', pos, name: 'minecraft:chest' });
          const slots = (read.slots ?? [])
            .filter((s) => s.container_idx !== sides.playerIdx && !s.empty &&
              s.id && remaining.has(s.id))
            .sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
          for (const s of slots) {
            if (!remaining.has(s.id)) continue;
            ctx.throwIfCancelled();
            await ctx.call('container.click', {
              slot: s.slot, action: 'quick_move', menu_id: sides.menuId,
            });
            take(s.id, s.count ?? 0);
          }
        } finally {
          await ctx.call('container.close').catch(() => {});
        }
      }
    }

    if (args.gather !== false && remaining.size) {
      // ME 端末: 明示座標 or 施設記憶
      let mePos = null;
      if (args.me_x != null && args.me_y != null && args.me_z != null)
        mePos = { x: args.me_x, y: args.me_y, z: args.me_z };
      else mePos = (ctx.journal?.facilities('me_terminal') ?? [])[0]?.pos ?? null;
      if (mePos) {
        await openAt(ctx, mePos);
        try {
          const repo = await ctx.call('container.repo').catch(() => null);
          const entries = repo?.entries ?? repo?.items ?? [];
          for (const id of [...remaining.keys()]) {
            const entry = entries.find((e) => e.id === id);
            if (!entry) continue;
            ctx.journal?.noteFacility({ kind: 'me_terminal', pos: mePos, name: 'ae2' });
            let got = 0;
            for (let i = 0; i < 32 && got < remaining.get(id); i++) {
              ctx.throwIfCancelled();
              const before = invCounts(await ctx.state().catch(() => null)).get(id) ?? 0;
              await ctx.call('container.repo_action', {
                action: 'SHIFT_CLICK', serial: entry.serial,
              }).catch(() => null);
              await ctx.sleep(300);
              const after = invCounts(await ctx.state().catch(() => null)).get(id) ?? 0;
              if (after <= before) break;
              got += after - before;
            }
            if (got > 0) take(id, got);
          }
        } finally {
          await ctx.call('container.close').catch(() => {});
        }
      }
    }

    // 残りを「作れる」と「本当に不足」に分類
    const craftable = [];
    const missing = [];
    for (const [id, n] of remaining) {
      const r = await ctx.call('recipe.lookup', { item: id }).catch(() => null);
      const recipes = r?.recipes ?? r?.results ?? (Array.isArray(r) ? r : []);
      if (recipes.length) craftable.push({ item: id, count: n, via: recipes[0]?.type ?? 'recipe' });
      else missing.push({ item: id, count: n });
    }

    const totalKinds = need.size;
    await ctx.say(
      `建築準備: 材料${totalKinds}種 / 手持ちで${Object.keys(fromInventory).length}種、` +
      `保管から${Object.keys(fetched).length}種を集めた` +
      (craftable.length ? ` / 作れば揃うのが${craftable.length}種` : '') +
      (missing.length ? ` / 本当に足りないのが${missing.length}種ある` : ' / 全部揃ったよ'));
    return {
      done: remaining.size === 0,
      needed: Object.fromEntries(need),
      from_inventory: fromInventory,
      fetched,
      craftable,
      missing,
    };
  },
};
