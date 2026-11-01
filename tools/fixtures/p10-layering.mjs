// P10 fixture (D32): build_schematic が BuildTask 経由になり、
// process_in_machine の待ちが wait.condition (menu_slots) 経由に
// なること。world_craft の wait_transform ログも確認する。
export default {
  async script(ctx) {
    let reads = 0;
    const menuA = {
      menu_id: 'minecraft:furnace',
      carried: null,
      slots: [
        { slot: 0, container_idx: 0, empty: true },
        { slot: 2, container_idx: 0, empty: true },
        { slot: 39, container_idx: 1, empty: false, id: 'minecraft:iron_ore', count: 8 },
      ],
    };
    const menuB = {
      ...menuA,
      slots: [
        { slot: 0, container_idx: 0, empty: true },
        { slot: 2, container_idx: 0, empty: false, id: 'minecraft:iron_ingot', count: 8 },
        { slot: 39, container_idx: 1, empty: true },
      ],
    };
    const menuC = { ...menuB, slots: menuB.slots.map((s) => ({ ...s, empty: true, id: undefined })) };
    const menuA2 = {
      ...menuA,
      slots: [
        { slot: 0, container_idx: 0, empty: false, id: 'minecraft:iron_ore', count: 8 },
        { slot: 2, container_idx: 0, empty: true },
        { slot: 39, container_idx: 1, empty: true },
      ],
    };
    ctx.stub('container.read', () => {
      reads++;
      if (reads === 1) return menuA;
      if (reads === 2) return menuA2;
      if (reads === 3) return menuB;
      return menuC;
    });
    ctx.stub('container.click', () => ({}));
    ctx.stub('obs.state', () => ({
      name: 'Rin', pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: { 'botania:petal_apothecary': 0 },
      inventory_detail: [],
    }));
    ctx.stub('obs.block', () => ({ found: [{ x: 1, y: 64, z: 0, dist: 1 }] }));
    ctx.stub('obs.entity', () => ({ entities: [] }));
    await ctx.sleep(50_000);
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
    // build: schematic を作って BuildTask 経由で建てる
    const sc = await h.mcp('schematic', {
      action: 'create', name: 'p10hut',
      blocks: [
        { x: 0, y: 0, z: 0, block: 'minecraft:stone' },
        { x: 1, y: 0, z: 0, block: 'minecraft:stone' },
      ],
    });
    const scFile = sc.path ?? sc.file;
    if (!scFile) throw new Error(`schematic create failed: ${JSON.stringify(sc)}`);
    await h.mcp('build_schematic', { file: scFile, x: 0, y: 64, z: 0 });
    const b = await lastResult('build_schematic');
    if (!b || b.placed !== 2 || b.via !== 'build_task') {
      throw new Error(`build wrong: ${JSON.stringify(b)}`);
    }
    // process: wait.condition 経由で成果を回収する
    await h.mcp('process_in_machine', {
      input: 'minecraft:iron_ore', output: 'minecraft:iron_ingot',
    });
    const pr = await lastResult('process_in_machine');
    if (!pr || !pr.done || pr.produced !== 8) {
      throw new Error(`process wrong: ${JSON.stringify(pr)}`);
    }
  },
};
