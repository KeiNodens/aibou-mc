/**
 * SNBT (Stringified NBT) の小パーサ。FTB Questsの .snbt 形式に限定:
 * - 区切りは空白/改行/カンマのいずれでも可 (FTBはカンマ無し改行区切り)
 * - キーは裸orクォート。値は string / 数値(型接尾辞 bBsSlLfFdD付き) / true/false
 *   / 配列 [ .. ] / コンパウンド { .. }
 * - `0b`/`1b` はbyte値だがboolean意味でも使われるので、数値0/1として返す
 *   (呼び出し側がtruthy判定する)
 */

export type Snbt = string | number | boolean | Snbt[] | { [key: string]: Snbt };

export function parseSnbt(src: string): Snbt {
  let i = 0;
  const n = src.length;

  function ws() {
    while (i < n && /[\s,]/.test(src[i])) i++;
  }

  function parseValue(): Snbt {
    ws();
    if (i >= n) throw new Error(`SNBT: unexpected EOF at ${i}`);
    const c = src[i];
    if (c === '{') return parseCompound();
    if (c === '[') return parseArray();
    if (c === '"' || c === "'") return parseString();
    return parseBare();
  }

  function parseCompound(): Record<string, Snbt> {
    i++; // {
    const out: Record<string, Snbt> = {};
    for (;;) {
      ws();
      if (i >= n) throw new Error('SNBT: unterminated compound');
      if (src[i] === '}') { i++; return out; }
      // key: クォート or `:`までの裸文字列
      let key: string;
      if (src[i] === '"' || src[i] === "'") {
        key = parseString() as string;
      } else {
        let j = i;
        while (j < n && !/[\s:]/.test(src[j])) j++;
        key = src.slice(i, j);
        i = j;
      }
      ws();
      if (src[i] !== ':') throw new Error(`SNBT: expected ':' after key '${key}' at ${i}`);
      i++;
      out[key] = parseValue();
    }
  }

  function parseArray(): Snbt[] {
    i++; // [
    const out: Snbt[] = [];
    for (;;) {
      ws();
      if (i >= n) throw new Error('SNBT: unterminated array');
      if (src[i] === ']') { i++; return out; }
      out.push(parseValue());
    }
  }

  function parseString(): string {
    const q = src[i++];
    let s = '';
    while (i < n) {
      const c = src[i++];
      if (c === q) return s;
      if (c === '\\' && i < n) {
        const e = src[i++];
        s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
      } else {
        s += c;
      }
    }
    throw new Error('SNBT: unterminated string');
  }

  function parseBare(): Snbt {
    let j = i;
    while (j < n && !/[\s,\]}\)]/.test(src[j])) j++;
    const tok = src.slice(i, j);
    i = j;
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    // 数値 (型接尾辞 bBsSlLfFdD/iI は剥がす)。16進 `0x..` も拾う
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?0x[0-9a-fA-F]+)([bBsSlLfFdDiI])?$/.exec(tok);
    if (m) {
      if (m[1].toLowerCase().startsWith('0x') || m[1].toLowerCase().startsWith('-0x')) {
        return parseInt(m[1], 16);
      }
      return Number(m[1]);
    }
    // 型接尾辞のみの裸文字 (例: id のhex文字列) はstringとして返す
    return tok;
  }

  ws();
  const v = parseValue();
  ws();
  return v;
}
