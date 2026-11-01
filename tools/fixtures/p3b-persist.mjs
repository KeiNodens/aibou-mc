// P3追加fixture: Run/Hold の永続化 (atomic snapshot) と stale lease 回収。
// hold が data/run-state.json に書かれること、running=true のまま
// プロセスが死んだ状態で再起動すると staleRecovered + external hold に
// なることを検証する。
export default {
  async script(ctx) {
    ctx.stub('move.stop', () => ({}));
    ctx.stub('baritone.stop', () => ({}));
    ctx.stub('task.cancel_all', () => ({ cancelled: 0 }));
    ctx.stub('chat.send', () => ({ sent: true }));
    await ctx.sleep(60_000);
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
    // 1. 「止まれ」→ owner_stop が run-state.json に永続化される
    await inject({ from: 'Tester', text: '止まれ' });
    await h.waitFor(() => {
      const s = h.file('run-state.json');
      return s && s.includes('owner_stop') ? s : null;
    }, 10_000);
    h.log('run state persisted');

    // 2. run中にプロセスが死んだ状態を再現して再起動
    h.writefile('data/run-state.json', JSON.stringify({
      holds: [{ kind: 'owner_stop', reason: 'explicit stop command', at: Date.now() }],
      lastRunAt: null, lastError: null,
      running: true, runStartedAt: Date.now(), savedAt: Date.now(),
    }));
    await h.restartBridge();

    // 3. stale 回収: staleRecovered が立ち、external hold が追加される
    const st = await h.mcp('bots', { action: 'loop_status' });
    if (!st.staleRecovered) {
      throw new Error(`stale not recovered: ${JSON.stringify(st)}`);
    }
    const kinds = (st.holds ?? []).map((x) => x.kind);
    if (!kinds.includes('external')) throw new Error('external hold missing');
    if (!kinds.includes('owner_stop')) throw new Error('owner_stop not restored');
    h.log('stale lease reclaimed');
  },
};
