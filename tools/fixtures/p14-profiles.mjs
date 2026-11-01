// P14 fixture (D36): 同伴プロファイル —
// (1) branch_mine: プレイヤーが遠いと合流を待ち (waits>=1)、
//     近づいたら掘り終える。
// (2) expedition_prep: 近くのプレイヤーの防具もチェックする
//     (player セクション)。プレイヤーがいなければ付かない。
export default {
  async script(ctx) {
    ctx.stub('obs.state', () => ({
      name: 'Rin',
      pos: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
      health: 20, hunger: 20,
      inventory: { 'ad_astra:oxygen_tank': 1, 'minecraft:torch': 16 },
      inventory_detail: [
        { slot: 36, id: 'ad_astra:space_suit_helmet', count: 1 },
        { slot: 37, id: 'ad_astra:space_suit_chestplate', count: 1 },
        { slot: 38, id: 'ad_astra:space_suit_leggings', count: 1 },
        { slot: 39, id: 'ad_astra:space_suit_boots', count: 1 },
      ],
    }));
    // プレイヤー: 最初は遠く (branch の合流待ち用)、obs.entity の
    // 呼び出し回数が進むと近づく。expedition の2回目は不在にしたい
    // ので、名前検索の総回数で段階を切り替える。
    let listCalls = 0;
    let nameCalls = 0;
    const mateFar = { id: 99, type: 'minecraft:player', name: 'Player', x: 0, y: 64, z: -30 };
    const mateNear = {
      id: 99, type: 'minecraft:player', name: 'Player', x: 0, y: 64, z: 4,
      armor: [
        { slot: 'head', id: 'ad_astra:space_suit_helmet', ench: [] },
        { slot: 'chest', id: 'ad_astra:space_suit_chestplate', ench: [] },
        { slot: 'legs', id: 'ad_astra:space_suit_leggings', ench: [] },
        { slot: 'feet', id: 'ad_astra:space_suit_boots', ench: [] },
      ],
    };
    ctx.stub('obs.entity', (p) => {
      if (p.name === 'minecraft:player') {
        // 一覧検索: 1回目 branch の同伴判定 (遠い)、2回目
        // expedition 1回目 (近い・防具つき)、3回目以降は不在
        listCalls++;
        if (listCalls === 1) return { entities: [mateFar] };
        if (listCalls === 2) return { entities: [mateNear] };
        return { entities: [] };
      }
      if (p.name === 'Player') {
        // 合流待ちのポーリング: 数回は遠いまま、その後近づく
        nameCalls++;
        return { entities: [nameCalls <= 5 ? mateFar : mateNear] };
      }
      return { entities: [] };
    });
    ctx.stub('obs.block_state', () => ({ block: 'minecraft:stone' }));
    ctx.stub('dig', () => ({ task_id: 'd' }));
    ctx.stub('waypoint.set', () => ({ ok: true }));
    await ctx.sleep(120_000);
  },
  async assert(h) {
    await h.sleep(1000);
    const lastResult = async (skill) => {
      for (let i = 0; i < 90; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };
    const countEnds = async (skill) => {
      const j = await h.mcp('journal', { action: 'read', limit: 100 });
      return (j.entries ?? []).filter(
        (e) => e.kind === 'work.end' && e.skill === skill).length;
    };
    const waitNew = async (skill, before) => {
      for (let i = 0; i < 90; i++) {
        const j = await h.mcp('journal', { action: 'read', limit: 100 });
        const ends = (j.entries ?? []).filter(
          (e) => e.kind === 'work.end' && e.skill === skill);
        if (ends.length > before) return ends[ends.length - 1].result;
        await h.sleep(500);
      }
      return null;
    };

    // (1) branch_mine 同伴: 合流を待ってから掘り終える
    await h.mcp('branch_mine', { length: 16, torch_every: 0 });
    const bm = await lastResult('branch_mine');
    if (!bm || bm.together !== true || (bm.waits ?? 0) < 1 || bm.dug <= 0) {
      throw new Error(`branch together wrong: ${JSON.stringify(bm)}`);
    }

    // (2) expedition_prep: 1回目はプレイヤーの装備つき
    //     (obs.entity 一覧の1回目が expedition 側に来るよう、
    //      branch 側は名前検索を消費し切っている前提)
    let before = await countEnds('expedition_prep');
    await h.mcp('expedition_prep', {});
    const ex1 = await waitNew('expedition_prep', before);
    if (!ex1 || !ex1.player || ex1.player.suit_pieces !== 4) {
      throw new Error(`expedition player check wrong: ${JSON.stringify(ex1)}`);
    }
    // 2回目: プレイヤー不在 → player セクションなし
    before = await countEnds('expedition_prep');
    await h.mcp('expedition_prep', {});
    const ex2 = await waitNew('expedition_prep', before);
    if (!ex2 || ex2.player !== null) {
      throw new Error(`expedition solo wrong: ${JSON.stringify(ex2)}`);
    }
  },
};
