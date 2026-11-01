// 倉庫整理: チェストへの預け入れ (deposit) / 取り出し (fetch)。
// fetch は S3 (D23) で拡張: 指定チェスト → 近いチェスト → 施設記憶の
// チェスト (近い順) → ME 端末 (座標指定時) の順に探して必要数を集める。
// container.read の container_idx で「プレイヤー側」と「チェスト側」を区別する
// (大きい方の container がプレイヤーインベントリ、という mod 側の規約)。
const KEEP_DEFAULT = [
  'minecraft:torch',
];

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

async function findNearbyChest(ctx, args) {
  const found = await ctx.call('obs.block', {
    block: args.block ?? 'minecraft:chest', radius: args.radius ?? 24,
  }).catch(() => null);
  return found?.found?.[0] ?? null;
}

function splitSides(read) {
  const sizes = read?.container_sizes ?? {};
  const idxs = Object.keys(sizes).map(Number);
  if (!read || read.menu_id === 'player_inventory' || idxs.length < 2) return null;
  const playerIdx = idxs.reduce((a, b) => (sizes[a] >= sizes[b] ? a : b));
  return { playerIdx, menuId: read.menu_id };
}

/** 開いているチェストから item を want 個まで取り出す (小さいスタック優先で過剰を抑える) */
async function fetchFromOpenChest(ctx, sides, read, item, want) {
  const slots = (read.slots ?? [])
    .filter((s) => s.container_idx !== sides.playerIdx && !s.empty && s.id === item)
    .sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
  let got = 0;
  for (const s of slots) {
    if (want && got >= want) break;
    ctx.throwIfCancelled();
    await ctx.call('container.click', {
      slot: s.slot, action: 'quick_move', menu_id: sides.menuId,
    });
    got += s.count ?? 0;
  }
  return got;
}

async function invCount(ctx, item) {
  const st = await ctx.state().catch(() => null);
  return (st?.inventory_detail ?? [])
    .filter((s) => s.id === item)
    .reduce((a, s) => a + (s.count ?? 0), 0);
}

/** ME 端末 (開いた状態で repo が読める画面) から item を want 個まで引き出す */
async function fetchFromME(ctx, pos, item, want) {
  await openAt(ctx, pos);
  try {
    const repo = await ctx.call('container.repo').catch(() => null);
    const entries = repo?.entries ?? repo?.items ?? [];
    const entry = entries.find((e) => e.id === item);
    if (!entry) return 0;
    let got = 0;
    // SHIFT_CLICK は最大1スタックずつ。インベントリ差分で実数を数える
    for (let i = 0; i < 32 && got < want; i++) {
      ctx.throwIfCancelled();
      const before = await invCount(ctx, item);
      await ctx.call('container.repo_action', {
        action: 'SHIFT_CLICK', serial: entry.serial,
      }).catch(() => null);
      await ctx.sleep(300);
      const after = await invCount(ctx, item);
      if (after <= before) break;
      got += after - before;
    }
    return got;
  } finally {
    await ctx.call('container.close').catch(() => {});
  }
}

export default {
  name: 'logistics',
  description:
    'Deposit inventory items into a nearby chest (keeping tools/food by ' +
    'default exclusions configurable via keep), or fetch an item out of ' +
    'storage. Fetch searches: the given/nearest chest, then remembered ' +
    'facility chests (nearest first), then an ME terminal when its ' +
    'coordinates are passed (me_x/me_y/me_z).',
  params: {
    action: { type: 'string', required: true, description: '"deposit" or "fetch"' },
    item: { type: 'string', required: false, description: 'item id (fetch only)' },
    count: { type: 'integer', required: false, description: 'how many to fetch (default: all found in the first chest)' },
    block: { type: 'string', required: false, description: 'container block id (default minecraft:chest)' },
    x: { type: 'integer', required: false },
    y: { type: 'integer', required: false },
    z: { type: 'integer', required: false },
    me_x: { type: 'integer', required: false, description: 'ME terminal X (fetch source)' },
    me_y: { type: 'integer', required: false },
    me_z: { type: 'integer', required: false },
    keep: { type: 'string', required: false, description: 'comma-separated item ids never deposited' },
  },
  async run(ctx, args) {
    if (args.action === 'fetch') {
      if (!args.item) return { done: false, reason: 'item_required' };
      const want = args.count ?? Infinity;
      let got = 0;
      const sources = [];

      // 候補チェスト列: 明示座標 → 近傍 → 施設記憶 (近い順)
      const chestPositions = [];
      if (args.x != null && args.y != null && args.z != null)
        chestPositions.push({ x: args.x, y: args.y, z: args.z });
      const near = await findNearbyChest(ctx, args);
      if (near && !chestPositions.some((p) => p.x === near.x && p.y === near.y && p.z === near.z))
        chestPositions.push(near);
      const st = await ctx.state().catch(() => null);
      const me = st?.player ?? st?.pos ?? { x: 0, y: 0, z: 0 };
      const facilities = (ctx.journal?.facilities('chest') ?? [])
        .map((f) => f.pos)
        .filter((p) => !chestPositions.some((q) => q.x === p.x && q.y === p.y && q.z === p.z))
        .sort((a, b) =>
          ((a.x - me.x) ** 2 + (a.z - me.z) ** 2) - ((b.x - me.x) ** 2 + (b.z - me.z) ** 2));
      chestPositions.push(...facilities);

      for (const pos of chestPositions) {
        if (got >= want) break;
        ctx.throwIfCancelled();
        await openAt(ctx, pos);
        try {
          const read = await ctx.call('container.read');
          const sides = splitSides(read);
          if (!sides) continue;
          ctx.journal?.noteFacility({ kind: 'chest', pos, name: args.block ?? 'minecraft:chest' });
          const n = await fetchFromOpenChest(ctx, sides, read, args.item, want - got);
          if (n > 0) sources.push({ type: 'chest', pos, count: n });
          got += n;
        } finally {
          await ctx.call('container.close').catch(() => {});
        }
      }

      if (got < want && args.me_x != null && args.me_y != null && args.me_z != null) {
        const pos = { x: args.me_x, y: args.me_y, z: args.me_z };
        const n = await fetchFromME(ctx, pos, args.item, want - got);
        if (n > 0) sources.push({ type: 'me_terminal', pos, count: n });
        got += n;
      }

      await ctx.say(got
        ? `${args.item} を${got}個取り出したよ`
        : `${args.item} は保管場所に無かった`);
      return { done: got > 0, fetched: got, want: args.count ?? null, sources };
    }

    if (args.action === 'deposit') {
      let pos = null;
      if (args.x != null && args.y != null && args.z != null)
        pos = { x: args.x, y: args.y, z: args.z };
      else pos = await findNearbyChest(ctx, args);
      if (!pos) {
        await ctx.say('近くにチェストが見つからない');
        return { done: false, reason: 'no_container' };
      }
      await openAt(ctx, pos);
      try {
        const read = await ctx.call('container.read');
        const sides = splitSides(read);
        if (!sides) return { done: false, reason: 'container_not_open', menu: read?.menu_id };
        ctx.journal?.noteFacility({ kind: 'chest', pos, name: args.block ?? 'minecraft:chest' });
        const keep = new Set(
          (args.keep ? args.keep.split(',').map((s) => s.trim()) : KEEP_DEFAULT));
        let moved = 0;
        for (const s of read.slots) {
          ctx.throwIfCancelled();
          if (s.container_idx !== sides.playerIdx || s.empty || !s.id) continue;
          if (keep.has(s.id)) continue;
          if (/_sword$|_pickaxe$|_axe$|_shovel$|_hoe$|shield$/.test(s.id)) continue;
          await ctx.call('container.click', {
            slot: s.slot, action: 'quick_move', menu_id: sides.menuId,
          });
          moved += s.count ?? 0;
        }
        await ctx.say(`チェストに預けたよ (${moved}個分)`);
        return { done: true, deposited: moved };
      } finally {
        await ctx.call('container.close').catch(() => {});
      }
    }
    return { done: false, reason: 'bad_action' };
  },
};
