export type Evt = { seq: number; name: string; data: unknown; ts: number };

type Waiter = {
  names: Set<string> | null;
  since: number;
  resolve: (evts: Evt[]) => void;
  timer: NodeJS.Timeout;
};

// イベントバッファ・チャットログ・待機者管理。
// 観測状態は持たず都度modへ問い合わせる (design D16)。
export class State {
  generation = 0;
  private seq = 0;
  private events: Evt[] = [];
  private chatLog: { from: string; text: string; ts: number }[] = [];
  private waiters: Waiter[] = [];
  private chatListeners: ((c: { from: string; text: string }) => void)[] = [];

  onChat(fn: (c: { from: string; text: string }) => void) {
    this.chatListeners.push(fn);
  }

  push(name: string, data: unknown): Evt {
    const e: Evt = { seq: ++this.seq, name, data, ts: Date.now() };
    this.events.push(e);
    if (this.events.length > 1000) this.events.shift();
    if (name === 'chat') {
      const d = data as { from: string; text: string };
      this.chatLog.push({ from: d.from, text: d.text, ts: e.ts });
      if (this.chatLog.length > 200) this.chatLog.shift();
      for (const fn of this.chatListeners) fn(d);
    }
    this.wake(e);
    return e;
  }

  private wake(latest: Evt) {
    const ready = this.waiters.filter((w) => !w.names || w.names.has(latest.name));
    if (!ready.length) return;
    for (const w of ready) {
      clearTimeout(w.timer);
      w.resolve(this.events.filter((e) => e.seq > w.since && (!w.names || w.names.has(e.name))));
    }
    this.waiters = this.waiters.filter((w) => !ready.includes(w));
  }

  chat(n = 50) {
    return this.chatLog.slice(-n);
  }

  latestSeq() {
    return this.seq;
  }

  eventsSince(seq: number, names?: string[]): Evt[] {
    const set = names?.length ? new Set(names) : null;
    return this.events.filter((e) => e.seq > seq && (!set || set.has(e.name)));
  }

  waitFor(since: number, timeoutMs: number, names?: string[]): Promise<Evt[]> {
    const hit = this.eventsSince(since, names);
    if (hit.length) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        resolve([]);
      }, timeoutMs);
      this.waiters.push({ names: names?.length ? new Set(names) : null, since, resolve, timer });
    });
  }
}
