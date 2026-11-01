// P5追加fixture: 新規skill 7本のロードと基本動作 (mock環境で安全に
// 終わる経路のみ): farm / locate / pet_care / logistics / fishing /
// build_schematic / fly_elytra。
export default {
  async script(ctx) {
    ctx.stub('obs.block', (p) => ({ block: p.block, radius: p.radius ?? 32, found: [], count: 0 }));
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1000);
    // 1. 全skillがロードされている
    const rel = await h.mcp('reload_skills', {});
    const names = rel.skills ?? [];
    for (const n of ['farm', 'locate', 'pet_care', 'logistics', 'fishing',
      'build_schematic', 'fly_elytra', 'mine_resource']) {
      if (!names.includes(n)) throw new Error(`skill not loaded: ${n}`);
    }
    h.log('skills loaded: ' + names.join(','));

    // skill完了を work_journal の work.end で待つ
    const waitSkill = async (name) => h.waitFor(async () => {
      const j = await h.mcp('journal', { action: 'read', limit: 100 });
      const es = (j.entries ?? []).filter(
        (e) => e.kind === 'work.end' && e.skill === name);
      return es.length ? es[es.length - 1] : null;
    }, 20_000);

    // 2. farm: 作物なし → harvested 0 で正常終了
    await h.mcp('farm', { crop: 'minecraft:wheat' });
    const farmEnd = await waitSkill('farm');
    if (!farmEnd.ok || farmEnd.result?.harvested !== 0) {
      throw new Error(`farm wrong: ${JSON.stringify(farmEnd)}`);
    }
    // 3. pet_care: 対象なし → fed 0
    await h.mcp('pet_care', {});
    const petEnd = await waitSkill('pet_care');
    if (!petEnd.ok || petEnd.result?.fed !== 0) {
      throw new Error(`pet_care wrong: ${JSON.stringify(petEnd)}`);
    }
    // 4. fishing: 竿なし → no_rod_in_hotbar
    await h.mcp('fishing', {});
    const fishEnd = await waitSkill('fishing');
    if (!fishEnd.ok || fishEnd.result?.reason !== 'no_rod_in_hotbar') {
      throw new Error(`fishing wrong: ${JSON.stringify(fishEnd)}`);
    }
    // 5. logistics: チェストなし → no_container
    await h.mcp('logistics', { action: 'deposit' });
    const logEnd = await waitSkill('logistics');
    if (!logEnd.ok || logEnd.result?.reason !== 'no_container') {
      throw new Error(`logistics wrong: ${JSON.stringify(logEnd)}`);
    }
    // 6. locate: kind不正 → bad_kind
    await h.mcp('locate', { kind: 'city', target: 'x' });
    const locEnd = await waitSkill('locate');
    if (!locEnd.ok || locEnd.result?.reason !== 'bad_kind') {
      throw new Error(`locate wrong: ${JSON.stringify(locEnd)}`);
    }
    // 7. fly_elytra: エリトラなし → no_elytra
    await h.mcp('fly_elytra', { x: 0, z: 0 });
    const flyEnd = await waitSkill('fly_elytra');
    if (!flyEnd.ok || flyEnd.result?.reason !== 'no_elytra') {
      throw new Error(`fly_elytra wrong: ${JSON.stringify(flyEnd)}`);
    }
    h.log('new skills smoke verified');
  },
};
