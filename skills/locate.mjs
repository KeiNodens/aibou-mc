// 構造物/バイオーム locate (P5): サーバーの /locate コマンドを実行し、
// 結果をチャットログから読み取る。座標が取れたら任意でそこへ向かう。
// 注意: chat.command は autonomy レベル1では承認対象 (危険操作)。
export default {
  name: 'locate',
  description:
    'Locate a structure or biome with the server /locate command and ' +
    'report the coordinates (optionally travel there). Requires op/' +
    'cheats permission; chat.command may need autonomy approval.',
  params: {
    kind: { type: 'string', required: true, description: '"structure" or "biome"' },
    target: { type: 'string', required: true, description: 'e.g. minecraft:village_plains or minecraft:desert' },
    goto_after: { type: 'boolean', required: false, description: 'travel to the result (default false)' },
  },
  async run(ctx, { kind, target, goto_after = false }) {
    if (kind !== 'structure' && kind !== 'biome') {
      return { done: false, reason: 'bad_kind' };
    }
    const before = ctx.chatLog(5);
    const marker = before.length ? before[before.length - 1].ts : 0;
    try {
      await ctx.call('chat.command', { command: `locate ${kind} ${target}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('APPROVAL_REQUIRED')) {
        await ctx.say('locateには承認がいるみたい。.ok で許可してね');
        return { done: false, reason: 'approval_required' };
      }
      throw e;
    }
    // 結果行: "The nearest ... is at [123, ~, 456] (789 blocks away)"
    let hit = null;
    for (let i = 0; i < 20 && !hit; i++) {
      await ctx.sleep(500);
      ctx.throwIfCancelled();
      for (const c of ctx.chatLog(50)) {
        if (c.ts < marker) continue;
        const m = c.text.match(/\[\s*(-?\d+)\s*,\s*[^,\]]+,\s*(-?\d+)\s*\]/);
        if (m) { hit = { x: Number(m[1]), z: Number(m[2]), line: c.text }; break; }
        if (/could not find|見つから/i.test(c.text)) {
          return { done: false, reason: 'not_found', line: c.text };
        }
      }
    }
    if (!hit) return { done: false, reason: 'no_result_in_chat' };
    const me = await ctx.state();
    const dist = Math.round(Math.hypot(hit.x - me.pos.x, hit.z - me.pos.z));
    await ctx.say(`${target} は (${hit.x}, ${hit.z})、ここから約${dist}ブロックだよ`);
    let travelled = false;
    if (goto_after) {
      const g = await ctx.call('baritone.goto', {
        x: hit.x, y: Math.floor(me.pos.y), z: hit.z,
      });
      const gt = await ctx.waitTask(g.task_id, 600_000);
      travelled = !!gt && gt.state === 'succeeded';
    }
    return { done: true, x: hit.x, z: hit.z, distance: dist, travelled };
  },
};
