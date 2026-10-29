// P6 fixture: 承認ゲート。level1でrun_command(chat.command)は拒否され、
// pending_approvalsに積まれ、.ok で承認後は同methodが通る。
export default {
  async script(ctx) {
    ctx.stub('chat.command', () => ({ executed: true }));
    ctx.stub('chat.send', () => ({ sent: true }));
    await ctx.sleep(60_000);
  },
  async assert(h) {
    await h.sleep(1500);
    const port = process.env.FIXTURE_MCP_PORT ?? 25689;
    const injectChat = (text) => fetch(`http://127.0.0.1:${port}/inject`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'Tester', text }),
    });

    // 1. 危険操作はgateされる (run_command → chat.command)
    const r1 = await h.mcp('run_command', { command: 'give Rin stone 1' });
    if (typeof r1 !== 'string' || !r1.includes('APPROVAL_REQUIRED')) {
      throw new Error(`dangerous call not gated: ${JSON.stringify(r1)}`);
    }
    // 2. pending_approvalsに載る
    const p = await h.mcp('pending_approvals', {});
    if (!p.pending?.length || p.pending[0].method !== 'chat.command') {
      throw new Error(`approval not pending: ${JSON.stringify(p)}`);
    }
    // 3. chatの .ok で承認 → 同methodが通る
    await injectChat(`.ok ${p.pending[0].id}`);
    await h.sleep(800);
    const r2 = await h.mcp('run_command', { command: 'give Rin stone 1' });
    if (typeof r2 === 'string' && r2.includes('APPROVAL_REQUIRED')) {
      throw new Error(`still gated after approve: ${r2}`);
    }
    if (!r2 || r2.executed !== true) {
      throw new Error(`call failed after approve: ${JSON.stringify(r2)}`);
    }
    h.log('autonomy gate + .ok flow verified');
  },
};
