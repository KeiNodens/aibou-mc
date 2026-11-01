import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * パックのブロックカタログ (D23/S1b)。
 * mod の registry.blocks op でクライアントレジストリを dump し、
 * bridge 側に JSON キャッシュする。block_search と schematic_create の
 * id 検証に使う。ゲーム未接続でもファイルキャッシュから検索できる。
 */
export interface CatalogEntry {
  id: string;
  name?: string;
  item?: string;
  properties?: Record<string, string[]>;
}

type CallFn = (method: string, params: unknown) => Promise<any>;

export class BlockCatalog {
  entries: CatalogEntry[] = [];
  private byId = new Map<string, CatalogEntry>();

  constructor(private file: string) {}

  get size(): number {
    return this.entries.length;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  private setAll(arr: CatalogEntry[]): void {
    this.entries = arr;
    this.byId = new Map(arr.map(e => [e.id, e]));
  }

  /** ファイルキャッシュを読む。無ければ false */
  async load(): Promise<boolean> {
    try {
      const arr = JSON.parse(await readFile(this.file, 'utf8'));
      if (Array.isArray(arr)) {
        this.setAll(arr);
        return true;
      }
    } catch { /* キャッシュなし */ }
    return false;
  }

  /** mod から全ページを取得してキャッシュを更新する */
  async refresh(call: CallFn): Promise<number> {
    const all: CatalogEntry[] = [];
    const limit = 2000;
    let offset = 0;
    for (;;) {
      const r = await call('registry.blocks', { offset, limit });
      const blocks: CatalogEntry[] = r?.blocks ?? [];
      all.push(...blocks);
      offset += blocks.length;
      if (!blocks.length || offset >= (r?.total ?? offset)) break;
    }
    this.setAll(all);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(all));
    return all.length;
  }

  /** id / 表示名の部分一致検索 */
  search(query: string, limit = 50): CatalogEntry[] {
    const q = query.toLowerCase();
    const out: CatalogEntry[] = [];
    for (const e of this.entries) {
      if (e.id.toLowerCase().includes(q) ||
        (e.name ?? '').toLowerCase().includes(q)) {
        out.push(e);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** 未知 id への近い候補 (パスの末尾セグメントで検索) */
  suggest(id: string, limit = 5): string[] {
    const seg = id.split(':').pop() ?? id;
    return this.search(seg, limit).map(e => e.id);
  }
}
