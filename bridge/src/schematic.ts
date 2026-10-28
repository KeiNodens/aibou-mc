import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';

/**
 * 建築設計図 (.litematic / .schem) の読み取り。
 * Litematica mod不要 — NBTを直接パースしてブロック配置を得る。
 */

type Vec3 = { x: number; y: number; z: number };

export interface SchematicBlock {
  x: number; y: number; z: number;  // schematic内ローカル座標
  id: string;                       // modid:name (air除く)
  props?: Record<string, string>;   // facing等のblockstate
}

export interface SchematicInfo {
  format: 'litematic' | 'schem';
  regions: number;
  size: Vec3;
  origin?: Vec3;
  palette_size: number;
  solid_blocks: number;      // air以外のブロック数
  materials: { id: string; count: number }[];  // 降順
}

// NBTタグ値の簡易アクセス
const v = (t: any): any => (t && typeof t === 'object' && 'value' in t ? t.value : t);
const num = (t: any): number => Number(v(t) ?? 0);

async function loadNbt(path: string): Promise<any> {
  let buf = await readFile(path);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  const { parsed } = await nbt.parse(buf);
  return v(parsed);
}

// .schem: Sponge Schematic (v2/v3)。palette index列はvarint。
function readSchem(root: any): { size: Vec3; blocks: SchematicBlock[] } {
  const s = root.Schematic ? v(root.Schematic) : root;
  // v3は Blocks{Palette,Data}、v2は直下 Palette+BlockData
  const blk = s.Blocks ? v(s.Blocks) : s;
  const palTag = blk.Palette ? v(blk.Palette) : v(s.Palette);
  const dataTag = blk.Data ? v(blk.Data) : v(s.BlockData);
  const size: Vec3 = {
    x: num(s.Width ?? v(blk).Width),
    y: num(s.Height ?? v(blk).Height),
    z: num(s.Length ?? v(blk).Length),
  };
  const palette: string[] = [];
  for (const [name, idx] of Object.entries(palTag)) palette[num(idx)] = name;
  const data: Uint8Array = dataTag instanceof Buffer ? dataTag : v(dataTag);
  // varintデコード
  const blocks: SchematicBlock[] = [];
  let i = 0, pos = 0;
  while (i < size.x * size.y * size.z && pos < data.length) {
    let val = 0, shift = 0;
    while (true) {
      const b = data[pos++];
      val |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    const id = palette[val] ?? 'minecraft:air';
    if (id !== 'minecraft:air') {
      const x = i % size.x, z = Math.floor(i / size.x) % size.z,
        y = Math.floor(i / (size.x * size.z));
      blocks.push({ x, y, z, id });
    }
    i++;
  }
  return { size, blocks };
}

// .litematic: Regions{...} 毎に bit-packing された BlockStates (long配列)。
function readLitematic(root: any): { size: Vec3; blocks: SchematicBlock[] } {
  const regions = v(root.Regions) ?? {};
  let size: Vec3 = { x: 0, y: 0, z: 0 };
  const blocks: SchematicBlock[] = [];
  for (const r of Object.values<any>(regions)) {
    const rg = v(r);
    const sz = v(rg.Size);
    const sx = Math.abs(num(v(sz.x))), sy = Math.abs(num(v(sz.y))), sz2 = Math.abs(num(v(sz.z)));
    size = { x: Math.max(size.x, sx), y: Math.max(size.y, sy), z: Math.max(size.z, sz2) };
    const pal: { id: string; props?: Record<string, string> }[] =
      (v(rg.BlockStatePalette) ?? []).map((p: any) => {
        const pp = v(p);
        const props: Record<string, string> = {};
        if (pp.Properties) for (const [k, t] of Object.entries(v(pp.Properties))) props[k] = String(v(t));
        return { id: String(v(pp.Name)), props: Object.keys(props).length ? props : undefined };
      });
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, pal.length))));
    const longs = (v(rg.BlockStates) ?? []) as (bigint | number)[];
    const mask = (1n << BigInt(bits)) - 1n;
    const total = sx * sy * sz2;
    for (let i = 0; i < total; i++) {
      const bitOff = BigInt(i * bits);
      const li = Number(bitOff >> 6n);
      const off = Number(bitOff & 63n);
      let val = ((BigInt(longs[li] ?? 0) >> BigInt(off)) & mask);
      // 64bit境界を跨ぐ場合
      if (off + bits > 64)
        val |= (BigInt(longs[li + 1] ?? 0) << BigInt(64 - off)) & mask;
      const entry = pal[Number(val)];
      if (entry && entry.id !== 'minecraft:air') {
        const x = i % sx, z = Math.floor(i / sx) % sz2, y = Math.floor(i / (sx * sz2));
        blocks.push({ x, y, z, id: entry.id, props: entry.props });
      }
    }
  }
  return { size, blocks };
}

function pickReader(path: string, root: any) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.schem')) return readSchem(root);
  if (root.Regions) return readLitematic(root);
  if (root.Palette || (root.Schematic && v(root.Schematic).Palette)) return readSchem(root);
  throw new Error('unrecognized schematic format (want .litematic or .schem)');
}

export async function inspectSchematic(path: string): Promise<SchematicInfo> {
  const root = await loadNbt(path);
  const { size, blocks } = pickReader(path, root);
  const mat = new Map<string, number>();
  for (const b of blocks) mat.set(b.id, (mat.get(b.id) ?? 0) + 1);
  return {
    format: path.toLowerCase().endsWith('.schem') ? 'schem' : 'litematic',
    regions: 1,
    size,
    palette_size: mat.size,
    solid_blocks: blocks.length,
    materials: [...mat.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** 建築順序 (y下から、同層内は螺旋不要なのでz-major) のブロック列を返す */
export async function planSchematic(path: string, opts?: {
  max_layers?: number;
}): Promise<{ size: Vec3; total: number; blocks: SchematicBlock[] }> {
  const root = await loadNbt(path);
  const { size, blocks } = pickReader(path, root);
  blocks.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const max = opts?.max_layers;
  const filtered = max != null ? blocks.filter(b => b.y < max) : blocks;
  return { size, total: filtered.length, blocks: filtered };
}
