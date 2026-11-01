// P3 fixture: Run/Hold実行管理 (assert側から/injectで逐次駆動)。
// - 「止まれ」→ owner_stop hold
// - deathイベント → dead hold。新しい指示が来てもdeadは残りcodex非起動
// - POSTCONDITIONのtask.done失敗 → blocked hold
// - loop_resumeで解除 → 次の指示でcodex起動
export default {
  async script(ctx) {
    ctx.stub('move.stop', () => ({}));
    ctx.stub('baritone.stop', () => ({}));
    ctx.stub('task.cancel_all', () => ({ cancelled: 0 }));
    ctx.stub('chat.send', () => ({ sent: true }));
    await ctx.sleep(60_000); // assert完了まで接続を維持
  },
  async assert(h) {
    const port = process.env.FIXTURE_MCP_PORT ?? 25689;
    const inject = async (body) => {
      const r = await fetch(`http://127.0.0.1:${port}/inject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`inject failed: ${r.status}`);
    };
    const holdsOf = async () =>
      ((await h.mcp('bots', { action: 'loop_status' })).holds ?? []).map((x) => x.kind);

    // 1. 「止まれ」→ owner_stop が立つ
    await inject({ from: 'Tester', text: '止まれ' });
    await h.waitFor(async () => (await holdsOf()).includes('owner_stop'));

    // 2. 死亡イベント → dead が立つ
    await inject({ name: 'death' });
    await h.waitFor(async () => (await holdsOf()).includes('dead'));

    // 3. POSTCONDITION失敗 → blocked が立つ
    await inject({
      name: 'task.done',
      data: { task_id: 'x', state: 'failed', error_code: 'POSTCONDITION' },
    });
    await h.waitFor(async () => (await holdsOf()).includes('blocked'));

    // 4. 新しい指示 → owner_stop/blockedは解除、deadは残る → codex未起動
    await inject({ from: 'Tester', text: '動いて' });
    await h.sleep(2500);
    if (h.rawfile('prompts.md')) {
      throw new Error('codex ran while dead hold was active');
    }
    const k2 = await holdsOf();
    if (k2.includes('owner_stop')) throw new Error('owner_stop not released');
    if (k2.includes('blocked')) throw new Error('blocked not released');
    if (!k2.includes('dead')) throw new Error('dead should survive instruction');

    // 5. dead解除 → 次の指示でcodex起動
    await h.mcp('bots', { action: 'loop_resume', hold: 'dead' });
    await inject({ from: 'Tester', text: 'また動いて' });
    const prompts = await h.waitFor(() => h.rawfile('prompts.md'), 15_000);
    if (!prompts.includes('また動いて')) throw new Error('codex did not run after resume');
    h.log('runhold semantics verified');
  },
};
