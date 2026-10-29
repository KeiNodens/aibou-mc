import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 明示コマンド直パース (Elly式): 「来て」「止まれ」等をLLM非経由で即skill実行する。
 * 未対応コマンドはnullを返してLLMへフォールスルー。
 * `.`始まりは機械指示のプレフィックス規約 (`.goal`等はP4で実装)。
 */

export interface DirectMatch {
  skill: string;
  args: Record<string, unknown>;
  /** capability学習のキー (UNSUPPORTEDでfalseを記憶) */
  capKey: string;
}

// 前置詞・語尾を剥がしてコア命令に寄せる
function normalize(text: string): string {
  return text
    .trim()
    .replace(/[。！!？?、,\s]+$/g, '')
    .replace(/[。！!？?]/g, '')
    .toLowerCase();
}

const RULES: { re: RegExp; make: (from: string) => DirectMatch }[] = [
  {
    re: /^(来て|きて|こっち|こっち来て|おいで|おいでよ|come)$/,
    make: (from) => ({ skill: 'come_here', args: { player: from }, capKey: 'direct:come_here' }),
  },
  {
    re: /^(止まれ|止まって|とまれ|とまって|ストップ|やめて|やめ|stop)$/,
    make: () => ({ skill: 'stop_all', args: {}, capKey: 'direct:stop_all' }),
  },
  {
    re: /^(ついてきて|ついて|追従|follow|follow me)$/,
    make: (from) => ({ skill: 'follow_player', args: { target: from }, capKey: 'direct:follow' }),
  },
  {
    re: /^(待ってて|待機|まってて)$/,
    make: () => ({ skill: 'stop_all', args: {}, capKey: 'direct:stop_all' }),
  },
];

/** chat本文を直パース。機械指示プレフィックス「.」は現段階では未対応 (P4で拡張) */
export function match(text: string, from: string): DirectMatch | null {
  const t = normalize(text);
  if (!t || t.startsWith('.')) return null;
  for (const r of RULES) {
    if (r.re.test(t)) return r.make(from);
  }
  return null;
}

/**
 * capability学習 (Elly式): 直パースで呼んだskillがUNSUPPORTED等で動かない場合、
 * bridge/data/capabilities.json に false を記憶し、以後そのコマンドはLLMへ回す。
 * 未試行=キー無し、動いた=true。
 */
export class Capabilities {
  private file: string;
  private map = new Map<string, boolean>();
  private loaded = false;

  constructor(dir: string) {
    this.file = path.join(dir, 'capabilities.json');
  }

  private ensure() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.file)) {
        const d = JSON.parse(readFileSync(this.file, 'utf8'));
        for (const [k, v] of Object.entries(d)) this.map.set(k, v === true);
      }
    } catch { /* 破損時は空で再出発 */ }
  }

  /** false記憶済みならfalse (LLMへ回す)。未試行/trueは実行可 */
  ok(key: string): boolean {
    this.ensure();
    return this.map.get(key) !== false;
  }

  learn(key: string, works: boolean) {
    this.ensure();
    this.map.set(key, works);
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map), null, 2));
    } catch { /* 永続化失敗は致命的でない */ }
  }
}
