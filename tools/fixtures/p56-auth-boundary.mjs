// P56 fixture (D59/P2-24d): 認証境界の固定。
// 旧来は全 fixture が無認証構成前提で、requireAuth が壊れても
// (常時401 / 認証が外れても) 検出できなかった。ここでは:
//   - トークンなし → 401
//   - 誤トークン → 401
//   - 通常トークン → /mcp 利用可。ただし管理系ツール (approve) は 403
//   - 管理トークン → approve を含め利用可
//   - /api/approvals の決裁 POST は管理トークンのみ (通常は 403)
// を固定する。
const USER = 'fixture-user-token';
const ADMIN = 'fixture-admin-token';

export default {
  env: {
    BRIDGE_TOKEN: USER,
    BRIDGE_ADMIN_TOKEN: ADMIN,
    RUNNER: 'off',
  },
  async script(ctx) {
    await ctx.sleep(30_000);
  },
  async assert(h) {
    const base = h.fetch;
    // healthz は無認証で開いている (疎通確認用)
    const hz = await base('/healthz');
    if (hz.status !== 200) throw new Error(`healthz should be open, got ${hz.status}`);

    // 1) トークンなし / 誤トークンは 401
    const noTok = await base('/api/approvals');
    if (noTok.status !== 401) throw new Error(`no-token /api/approvals should be 401, got ${noTok.status}`);
    const badTok = await base('/api/approvals', { headers: { authorization: 'Bearer wrong' } });
    if (badTok.status !== 401) throw new Error(`bad-token /api/approvals should be 401, got ${badTok.status}`);

    // 2) 通常トークンで一覧は読めるが決裁は 403
    const list = await base('/api/approvals', { headers: { authorization: `Bearer ${USER}` } });
    if (list.status !== 200) throw new Error(`user-token list should be 200, got ${list.status}`);
    const decideUser = await base('/api/approvals/a1/approve', {
      method: 'POST', headers: { authorization: `Bearer ${USER}` },
    });
    if (decideUser.status !== 403) throw new Error(`user-token decision should be 403, got ${decideUser.status}`);

    // 3) 管理トークンで決裁できる (pending が無くても 200 で返る)
    const decideAdmin = await base('/api/approvals/a1/approve', {
      method: 'POST', headers: { authorization: `Bearer ${ADMIN}` },
    });
    if (decideAdmin.status !== 200) throw new Error(`admin-token decision should be 200, got ${decideAdmin.status}`);

    // 4) MCP tools/call: 通常トークンで approve は 403、管理トークンでは通る
    const callRaw = async (token, name, args) => {
      const r = await fetch(`http://127.0.0.1:${h.mcpPort}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }),
      });
      return r.status;
    };
    const approveUser = await callRaw(USER, 'approve', {});
    if (approveUser !== 403) throw new Error(`user-token approve tool should be 403, got ${approveUser}`);
    const approveAdmin = await callRaw(ADMIN, 'approve', {});
    if (approveAdmin === 403 || approveAdmin === 401) {
      throw new Error(`admin-token approve tool should pass the gate, got ${approveAdmin}`);
    }
    // 5) 通常ツールは通常トークンで通る (bot_status は読み取り系)
    const statusUser = await callRaw(USER, 'bot_status', {});
    if (statusUser !== 200) throw new Error(`user-token bot_status should be 200, got ${statusUser}`);
  },
};
