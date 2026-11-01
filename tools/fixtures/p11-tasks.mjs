// P11 fixture (D33): deck_walk / train_drive / fishing / fly_elytra が
// mod 側タスク経由で完了すること。
export default {
  async script(ctx) {
    let stateCalls = 0;
    ctx.stub('obs.state', () => {
      stateCalls++;
      const cod = stateCalls >= 3 ? 2 : 0;
      return {
        name: 'Rin',
        pos: { x: 0, y: 80, z: 0, yaw: 0, pitch: 0 },
        on_ground: stateCalls < 2,
        health: 20, hunger: 20,
        inventory: cod ? { 'minecraft:cod': cod } : {},
        inventory_summary: cod ? { 'minecraft:cod': cod } : {},
        inventory_detail: [
          { slot: 0, id: 'minecraft:fishing_rod', count: 1 },
          { slot: 1, id: 'minecraft:firework_rocket', count: 3 },
          { slot: 12, id: 'minecraft:elytra', count: 1 },
        ],
      };
    });
    ctx.stub('obs.block_state', () => ({ block: 'minecraft:air' }));
    for (const m of ['equip', 'use_item', 'look_at', 'move.set', 'move.stop', 'key']) {
      ctx.stub(m, () => ({}));
    }
    ctx.stub('contraption.status', () => ({
      riding: true,
      found: [{ bot_is_passenger: true, speed: 0.5, delta_speed: 0.5 }],
    }));
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const lastResult = async (skill) => {
      for (let i = 0; i < 40; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      throw new Error(`no work.end for ${skill}`);
    };
    const dw = await lastResult('deck_walk').catch(() => null);
    await h.mcp('deck_walk', { local_x: 2, local_y: 1, local_z: 0 });
    const dwr = await lastResult('deck_walk');
    if (!dwr?.done || !dwr.arrived) {
      throw new Error(`deck_walk wrong: ${JSON.stringify(dwr)} (prev ${JSON.stringify(dw)})`);
    }
    await h.mcp('train_drive', { seconds: 2 });
    const td = await lastResult('train_drive');
    if (!td?.done || td.via !== 'drive_task' || !td.moved) {
      throw new Error(`train_drive wrong: ${JSON.stringify(td)}`);
    }
    await h.mcp('fishing', { catches: 2, max_casts: 3 });
    const fs = await lastResult('fishing');
    if (!fs || fs.via !== 'fishing_task' || fs.casts !== 3) {
      throw new Error(`fishing wrong: ${JSON.stringify(fs)}`);
    }
    await h.mcp('fly_elytra', { x: 10, z: 10, max_seconds: 10 });
    const fl = await lastResult('fly_elytra');
    if (!fl?.done || fl.via !== 'glide_task') {
      throw new Error(`fly_elytra wrong: ${JSON.stringify(fl)}`);
    }
  },
};
