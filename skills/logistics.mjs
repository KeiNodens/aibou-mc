// 倉庫整理: チェストへの預け入れ (deposit) / 取り出し (fetch)。
// fetch は S3 (D23) で拡張: 指定チェスト → 近いチェスト → 施設記憶の
// チェスト (近い順) → ME 端末 (座標指定時) の順に探して必要数を集める。
// container.read の player_container_idx で「プレイヤー側」と「チェスト側」を
// 区別する (mod がプレイヤーInventoryの container を正確に報告する)。
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
  // Review F1: the mod now reports player_container_idx exactly. The old
  // "largest container is the player" rule inverts on double chests
  // (54 storage vs 36 player), swapping fetch and deposit. Fallbacks for
  // older mod builds: the 36-slot container (player main+hotbar), else
  // the last container in menu order.
  let playerIdx;
  if (typeof read.player_container_idx === 'number'
    && idxs.includes(read.player_container_idx)) {
    playerIdx = read.player_container_idx;
  } else {
    playerIdx = idxs.find((i) => sizes[i] === 36) ?? idxs[idxs.length - 1];
  }
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
    // D59/P2-13: quick_move は宛先満杯でも正常応答する。スロットの
    // 減少分だけを実移動として数える (旧実装は旧 count をそのまま加算)
    const after = await ctx.call('container.read').catch(() => null);
    const left = (after?.slots ?? []).find((x) => x.slot === s.slot);
    const leftCount = (left && !left.empty && left.id === item)
      ? (left.count ?? 0) : 0;
    const movedHere = Math.max(0, (s.count ?? 0) - leftCount);
    if (movedHere <= 0) break; // プレイヤー側が満杯なら以降も動かない
    got += movedHere;
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
    mode: { type: 'string', required: false, description: 'auto (default) / together / solo — together: announce before withdrawing from shared storage' },
  },
  async run(ctx, args) {
    // 同伴: 共有ストレージから出す前に一言 (D36)。単独は記録のみ
    let announcedTake = false;
    const announceTake = async (item, count) => {
      if (announcedTake || args.mode === 'solo') return;
      let together = args.mode === 'together';
      if (!together && (args.mode ?? 'auto') === 'auto') {
        const stT = await ctx.state().catch(() => null);
        const ents = (r) => (Array.isArray(r) ? r : (r?.entities ?? r?.found ?? []));
        const all = ents(await ctx.call('obs.entity', { name: 'minecraft:player', radius: 24 }).catch(() => null));
        together = all.some((e) => e.name && e.name !== stT?.name);
      }
      if (together) {
        announcedTake = true;
        await ctx.say(`${item}を${count != null && count !== Infinity ? `${count}個` : ''}ストレージから出すね`).catch(() => {});
      }
    };
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
        await announceTake(args.item, args.count);
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
        await announceTake(args.item, args.count);
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
          // D59/P2-13: 実移動分だけ数える (チェスト満杯時の虚偽報告防止)
          const afterD = await ctx.call('container.read').catch(() => null);
          const leftD = (afterD?.slots ?? []).find((x) => x.slot === s.slot);
          const leftCountD = (leftD && !leftD.empty && leftD.id === s.id)
            ? (leftD.count ?? 0) : 0;
          moved += Math.max(0, (s.count ?? 0) - leftCountD);
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
