import WebSocket from 'ws';
import { State } from './state.js';
import { Autonomy } from './autonomy.js';

// agent-mod (またはmock-mod) のWSサーバーに接続するクライアント。
// req/res相関・evt受信・hello/generation・自動再接続を担う (design §2.3)。
export class ModClient {
  private ws?: WebSocket;
  private reqId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  connected = false;

  constructor(
    private url: string,
    private state: State,
    private log: (...a: unknown[]) => void = console.log,
    private autonomy?: Autonomy,
    /** WS identify で申告する role。observer bot は 'observer' (読取専用) */
    private role: 'controller' | 'observer' = 'controller',
  ) {}

  start() {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    // D59/P2-22: 死活監視 (ping/pong)。黙った経路断 (スリープ等で FIN が
    // 来ない) を検出できず、healthz が mod:true を返し続ける問題への対策
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const hb = setInterval(() => {
      if (!alive) {
        this.log('[modclient] heartbeat lost; terminating');
        ws.terminate();
        return;
      }
      alive = false;
      try { ws.ping(); } catch { /* close 側で処理 */ }
    }, 15_000);
    ws.on('open', () => {
      this.connected = true;
      this.log('[modclient] connected', this.url);
    });
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        this.state.generation = msg.generation as number;
        this.log('[modclient] generation =', msg.generation);
        // WS堅牢化: hello応答としてrole申告する (10s以内必須)
        ws.send(JSON.stringify({ type: 'identify', role: this.role }));
        return;
      }
      if (msg.type === 'evt') {
        this.state.push(String(msg.name), msg.data);
        return;
      }
      if (msg.type === 'res') {
        const p = this.pending.get(msg.id as number);
        if (!p) return;
        this.pending.delete(msg.id as number);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(`${(msg.error as any)?.code}: ${(msg.error as any)?.message}`));
      }
    });
    ws.on('close', () => {
      clearInterval(hb);
      this.connected = false;
      // D59/P2-22: 応答待ちは即座に失敗させる (旧実装は各呼出が個別の
      // 30秒タイマ満了まで残り、mod 落ちの検出が遅れた)
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('NOT_CONNECTED: mod connection closed'));
      }
      this.pending.clear();
      this.log('[modclient] closed; retry in 3s');
      setTimeout(() => this.connect(), 3000);
    });
    ws.on('error', () => {});
  }

  call(method: string, params: unknown = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('NOT_CONNECTED'));
      // 承認ゲート (autonomy.level)。拒否時はapprovalイベントで通知される
      const g = this.autonomy?.check(method, params as Record<string, unknown>);
      if (g && !g.ok) {
        return reject(new Error(
          `APPROVAL_REQUIRED: ${g.req.method} pending as ${g.req.id} — approve with .ok ${g.req.id}`));
      }
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('TIMEOUT'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
}
