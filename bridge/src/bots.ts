import { ModClient } from './modclient.js';
import { State } from './state.js';

/**
 * 複数bot管理の土台 (P6)。
 *
 * primary bot は従来どおり index.ts が所有する単一の ModClient で、
 * 既存ツール・スキル・runner は全て primary 宛に動く (互換維持)。
 * ここでは BOTS_JSON で登録された追加bot (observer) の接続を束ね、
 * 状態を bots_status で見られるようにするだけに留める。
 * 追加bot宛のコマンドルーティング (ツール/スキルの bot 引数化) は次段。
 *
 * BOTS_JSON 例: [{"name":"Rin2","url":"ws://127.0.0.1:25588"}]
 */
export interface BotDef {
  name: string;
  url: string;
}

export interface BotStatus {
  name: string;
  role: 'primary' | 'observer';
  connected: boolean;
  generation: number;
}

export class BotManager {
  private extras = new Map<string, { def: BotDef; mod: ModClient; state: State }>();

  constructor(
    private primaryName: string,
    private primary: ModClient,
    private primaryState: State,
  ) {}

  /** BOTS_JSON 環境変数から追加botを登録して接続開始 */
  static fromEnv(primaryName: string, primary: ModClient, primaryState: State): BotManager {
    const mgr = new BotManager(primaryName, primary, primaryState);
    const raw = process.env.BOTS_JSON;
    if (raw) {
      try {
        const defs = JSON.parse(raw) as BotDef[];
        for (const d of defs) {
          if (d?.name && d?.url) mgr.addObserver(d);
        }
      } catch (e) {
        console.log('[bots] BOTS_JSON parse failed:', e);
      }
    }
    return mgr;
  }

  addObserver(def: BotDef) {
    if (this.extras.has(def.name) || def.name === this.primaryName) return;
    const state = new State();
    const mod = new ModClient(def.url, state, console.log, undefined, 'observer');
    this.extras.set(def.name, { def, mod, state });
    mod.start();
    console.log(`[bots] observer bot '${def.name}' → ${def.url}`);
  }

  observer(name: string): ModClient | undefined {
    return this.extras.get(name)?.mod;
  }

  status(): BotStatus[] {
    return [
      {
        name: this.primaryName, role: 'primary',
        connected: this.primary.connected,
        generation: this.primaryState.generation,
      },
      ...[...this.extras.values()].map(({ def, mod, state }) => ({
        name: def.name, role: 'observer' as const,
        connected: mod.connected,
        generation: state.generation,
      })),
    ];
  }
}
