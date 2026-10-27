import WebSocket from 'ws';
import { State } from './state.js';

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
  ) {}

  start() {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
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
      this.connected = false;
      this.log('[modclient] closed; retry in 3s');
      setTimeout(() => this.connect(), 3000);
    });
    ws.on('error', () => {});
  }

  call(method: string, params: unknown = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('NOT_CONNECTED'));
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
