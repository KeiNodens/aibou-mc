// 倉庫整理 (P5): 近くのチェストを開けて預け入れ (deposit) / 取り出し (fetch)。
// container.read の container_idx で「プレイヤー側」と「チェスト側」を区別する
// (大きい方の container がプレイヤーインベントリ、という mod 側の規約に従う)。
const KEEP_DEFAULT = [
  'minecraft:torch',
];

async function openChest(ctx, args) {
  let pos = null;
  if (args.x != null && args.y != null && args.z != null) {
    pos = { x: args.x, y: args.y, z: args.z };
  } else {
    const found = await ctx.call('obs.block', {
      block: args.block ?? 'minecraft:chest', radius: args.radius ?? 24,
    });
    pos = found?.found?.[0] ?? null;
  }
  if (!pos) return null;
  const g = await ctx.call('baritone.goto', { x: pos.x, y: pos.y, z: pos.z });
  if (g?.task_id) await ctx.waitTask(g.task_id, 60_000);
  await ctx.call('look_at', { x: pos.x, y: pos.y, z: pos.z }).catch(() => {});
  await ctx.call('use_item', { x: pos.x, y: pos.y, z: pos.z });
  await ctx.sleep(500);
  return pos;
}

function splitSides(read) {
  const sizes = read?.container_sizes ?? {};
  const idxs = Object.keys(sizes).map(Number);
  if (!read || read.menu_id === 'player_inventory' || idxs.length < 2) return null;
  const playerIdx = idxs.reduce((a, b) => (sizes[a] >= sizes[b] ? a : b));
  return { playerIdx, menuId: read.menu_id };
}

export default {
  name: 'logistics',
  description:
    'Deposit inventory items into a nearby chest (keeping tools/food by ' +
    'default exclusions configurable via keep), or fetch an item out of ' +
    'it. Works with any block that opens a container menu.',
  params: {
    action: { type: 'string', required: true, description: '"deposit" or "fetch"' },
    item: { type: 'string', required: false, description: 'item id (fetch only)' },
    count: { type: 'integer', required: false, description: 'how many to fetch (default: all found)' },
    block: { type: 'string', required: false, description: 'container block id (default minecraft:chest)' },
    x: { type: 'integer', required: false },
    y: { type: 'integer', required: false },
    z: { type: 'integer', required: false },
    keep: { type: 'string', required: false, description: 'comma-separated item ids never deposited' },
  },
  async run(ctx, args) {
    const pos = await openChest(ctx, args);
    if (!pos) {
      await ctx.say('近くにチェストが見つからない');
      return { done: false, reason: 'no_container' };
    }
    try {
      const read = await ctx.call('container.read');
      const sides = splitSides(read);
      if (!sides) return { done: false, reason: 'container_not_open', menu: read?.menu_id };
      ctx.journal?.noteFacility({ kind: 'chest', pos, name: args.block ?? 'minecraft:chest' });

      if (args.action === 'deposit') {
        const keep = new Set(
          (args.keep ? args.keep.split(',').map((s) => s.trim()) : KEEP_DEFAULT));
        let moved = 0;
        for (const s of read.slots) {
          ctx.throwIfCancelled();
          if (s.container_idx !== sides.playerIdx || s.empty || !s.id) continue;
          if (keep.has(s.id)) continue;
          // 武器/ツール/食料は手元に残す (id の語尾・分類での雑な判定)
          if (/_sword$|_pickaxe$|_axe$|_shovel$|_hoe$|shield$/.test(s.id)) continue;
          await ctx.call('container.click', {
            slot: s.slot, action: 'quick_move', menu_id: sides.menuId,
          });
          moved += s.count ?? 0;
        }
        await ctx.say(`チェストに預けたよ (${moved}個分)`);
        return { done: true, deposited: moved };
      }

      if (args.action === 'fetch') {
        if (!args.item) return { done: false, reason: 'item_required' };
        let got = 0;
        for (const s of read.slots) {
          ctx.throwIfCancelled();
          if (args.count && got >= args.count) break;
          if (s.container_idx === sides.playerIdx || s.empty || s.id !== args.item) continue;
          await ctx.call('container.click', {
            slot: s.slot, action: 'quick_move', menu_id: sides.menuId,
          });
          got += s.count ?? 0;
        }
        await ctx.say(got ? `${args.item} を${got}個取り出したよ` : 'チェストに無かった');
        return { done: true, fetched: got };
      }
      return { done: false, reason: 'bad_action' };
    } finally {
      await ctx.call('container.close').catch(() => {});
    }
  },
};
