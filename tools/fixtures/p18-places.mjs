// P18 fixture (D38): places の add/list/done と、cave_assist が
// notable 発見を自動で places に記録すること。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: {}, inventory_detail: [],
    }));
    ctx.stub('obs.entity', (p) => {
      const player = { id: 99, type: 'minecraft:player', name: 'Daigo', x: 3, y: 64, z: 4 };
      if (p.name === 'Daigo' || p.name === 'minecraft:player' || !p.name) {
        return { entities: [player] };
      }
      return { entities: [] };
    });
    const GEM = { x: 6, y: 64, z: 6 };
    ctx.stub('obs.block', (p) => {
      if (p.block === 'minecraft:diamond_ore') return { found: [GEM] };
      return { found: [] };
    });
    ctx.stub('obs.block_state', () => ({ id: 'minecraft:stone' }));
    ctx.stub('dig', () => ({ task_id: 'd' }));
    ctx.stub('waypoint.set', () => ({ ok: true }));
    await ctx.sleep(90_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const lastResult = async (skill) => {
      for (let i = 0; i < 60; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    // 手動 add
    await h.mcp('places', { action: 'add', kind: 'poi', name: 'test-poi', x: 100, y: 64, z: 100 });
    const added = await lastResult('places');
    if (!added?.place || added.place.name !== 'test-poi') {
      throw new Error(`places add wrong: ${JSON.stringify(added)}`);
    }
    const countEnds = async (skill) => {
      const j = await h.mcp('journal', { action: 'read', limit: 100 });
      return (j.entries ?? []).filter(
        (e) => e.kind === 'work.end' && e.skill === skill).length;
    };
    const waitNew = async (skill, before) => {
      for (let i = 0; i < 60; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length > before) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    // cave_assist がダイヤ発見を自動記録する
    await h.mcp('cave_assist', { player: 'Daigo', seconds: 12, fight: false, torches: false });
    const ca = await lastResult('cave_assist');
    if (!ca) throw new Error('cave_assist did not finish');
    let beforeP = await countEnds('places');
    await h.mcp('places', { action: 'list' });
    const listed = await waitNew('places', beforeP);
    const auto = (listed?.places ?? []).find(
      (p) => p.kind === 'ore' && p.ore === 'minecraft:diamond_ore' && p.auto === true);
    if (!auto) {
      throw new Error(`auto ore place missing: ${JSON.stringify(listed)}`);
    }
    // done にすると open リストから消える
    beforeP = await countEnds('places');
    await h.mcp('places', { action: 'done', kind: 'ore', ore: 'minecraft:diamond_ore', x: 6, y: 64, z: 6 });
    const doneRes = await waitNew('places', beforeP);
    if (!doneRes?.ok) throw new Error(`places done wrong: ${JSON.stringify(doneRes)}`);
    beforeP = await countEnds('places');
    await h.mcp('places', { action: 'list' });
    const listed2 = await waitNew('places', beforeP);
    const stillOpen = (listed2?.places ?? []).some(
      (p) => p.kind === 'ore' && p.ore === 'minecraft:diamond_ore');
    if (stillOpen) throw new Error('ore place still open after done');
    // 後始末: テスト用 poi を消す
    await h.mcp('places', { action: 'remove', id: added.place.id });
  },
};
