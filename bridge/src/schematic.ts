import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as fsPath from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
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

/** "minecraft:oak_stairs[facing=north,half=bottom]" → {id, props} に分離 */
export function parseBlockState(name: string):
  { id: string; props?: Record<string, string> } {
  const i = name.indexOf('[');
  if (i < 0 || !name.endsWith(']')) return { id: name };
  const props: Record<string, string> = {};
  for (const part of name.slice(i + 1, -1).split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return { id: name.slice(0, i),
    props: Object.keys(props).length ? props : undefined };
}

/** id + props → 正規形の blockstate 文字列 (props はキー昇順) */
export function blockStateString(id: string,
  props?: Record<string, string>): string {
  if (!props || !Object.keys(props).length) return id;
  const inner = Object.keys(props).sort()
    .map(k => `${k}=${props[k]}`).join(',');
  return `${id}[${inner}]`;
}

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
    const stateName = palette[val] ?? 'minecraft:air';
    if (stateName !== 'minecraft:air') {
      const x = i % size.x, z = Math.floor(i / size.x) % size.z,
        y = Math.floor(i / (size.x * size.z));
      const { id, props } = parseBlockState(stateName);
      blocks.push({ x, y, z, id, props });
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

// ---------- 生成側 (D23/S1a): プリミティブ蓄積 → Sponge .schem v3 ----------

export interface SchemBlockInput {
  x: number; y: number; z: number;
  block: string; props?: Record<string, string>;
}
export type SchemOp =
  | ({ op: 'block' } & SchemBlockInput)
  | { op: 'box'; from: Vec3; to: Vec3; block: string;
      props?: Record<string, string>; hollow?: boolean }
  | { op: 'line'; from: Vec3; to: Vec3; block: string;
      props?: Record<string, string> }
  // 意味プリミティブ (D34): 工場の意味の塊を決定的に展開する。
  // faces は機械の facing 基準の相対面 (front/back/left/right/top/
  // bottom) で宣言し、manifest では絶対方向に解決して返す。
  // あくまで「宣言」であって、実機の面設定の読み取りではない。
  | { op: 'machine_row'; at: Vec3; machine: string; count: number;
      along?: 'x' | 'z' | '-x' | '-z'; spacing?: number;
      facing?: string; props?: Record<string, string>;
      faces?: { input?: RelFace; output?: RelFace; power?: RelFace } }
  | { op: 'cable_run'; from: Vec3; to: Vec3; cable: string;
      props?: Record<string, string> }
  | { op: 'power_spine'; at: Vec3; along?: 'x' | 'z' | '-x' | '-z';
      length: number; cable: string; props?: Record<string, string>;
      tap_every?: number;
      tap_dir?: 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
      tap_len?: number };

export type RelFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface ManifestMachine {
  x: number; y: number; z: number; id: string;
  facing?: string;
  /** 相対面宣言を絶対方向 (north/south/east/west/up/down) に解決したもの */
  faces?: Record<string, string>;
}

export interface SchemManifest {
  machines: ManifestMachine[];
  /** cable 系 op が置いた本数 (id ごと) */
  cables: Record<string, number>;
  /** machines/*.json に commission 計画がある機械だけ、座標つきで */
  commission: { x: number; y: number; z: number; machine: string; plan: unknown[] }[];
}

const DIR_VEC: Record<string, Vec3> = {
  north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 }, west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 }, down: { x: 0, y: -1, z: 0 },
};
const OPPOSITE: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  up: 'down', down: 'up',
};
const LEFT_OF: Record<string, string> = {
  north: 'west', west: 'south', south: 'east', east: 'north',
};
const RIGHT_OF: Record<string, string> = {
  north: 'east', east: 'south', south: 'west', west: 'north',
};

function resolveFace(facing: string, rel: RelFace): string {
  switch (rel) {
    case 'front': return facing;
    case 'back': return OPPOSITE[facing] ?? facing;
    case 'left': return LEFT_OF[facing] ?? facing;
    case 'right': return RIGHT_OF[facing] ?? facing;
    case 'top': return 'up';
    case 'bottom': return 'down';
  }
}

function alongVec(along?: string): Vec3 {
  switch (along) {
    case 'z': return { x: 0, y: 0, z: 1 };
    case '-x': return { x: -1, y: 0, z: 0 };
    case '-z': return { x: 0, y: 0, z: -1 };
    default: return { x: 1, y: 0, z: 0 };
  }
}

const BLOCK_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const PROP_KEY_RE = /^[a-z0-9_]+$/;
const PROP_VAL_RE = /^[a-z0-9_.-]+$/;
const MAX_AXIS = 256, MAX_BLOCKS = 500_000, MAX_BOX_CELLS = 8_000_000;

function checkedState(block: string, props?: Record<string, string>): string {
  if (!BLOCK_ID_RE.test(block)) throw new Error(`invalid block id: ${block}`);
  if (props) for (const [k, val] of Object.entries(props)) {
    if (!PROP_KEY_RE.test(k) || !PROP_VAL_RE.test(val))
      throw new Error(`invalid blockstate property: ${k}=${val}`);
  }
  return blockStateString(block, props);
}

const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;

class SchemGrid {
  cells = new Map<string, string>();
  set(x: number, y: number, z: number, state: string): void {
    if (state === 'minecraft:air') this.cells.delete(key3(x, y, z));
    else this.cells.set(key3(x, y, z), state);
  }
  box(a: Vec3, b: Vec3, state: string, hollow?: boolean): void {
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z) };
    const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z) };
    const vol = (hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1);
    if (vol > MAX_BOX_CELLS) throw new Error(`box too large: ${vol} cells`);
    for (let y = lo.y; y <= hi.y; y++)
      for (let z = lo.z; z <= hi.z; z++)
        for (let x = lo.x; x <= hi.x; x++) {
          if (hollow && x > lo.x && x < hi.x && y > lo.y && y < hi.y &&
            z > lo.z && z < hi.z) continue;
          this.set(x, y, z, state);
        }
  }
  line(a: Vec3, b: Vec3, state: string): void {
    // 3D Bresenham (主軸駆動)
    let [x, y, z] = [a.x, a.y, a.z];
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y),
      dz = Math.abs(b.z - a.z);
    const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1,
      sz = a.z < b.z ? 1 : -1;
    this.set(x, y, z, state);
    if (dx >= dy && dx >= dz) {
      let e1 = 2 * dy - dx, e2 = 2 * dz - dx;
      while (x !== b.x) {
        x += sx;
        if (e1 > 0) { y += sy; e1 -= 2 * dx; }
        if (e2 > 0) { z += sz; e2 -= 2 * dx; }
        e1 += 2 * dy; e2 += 2 * dz;
        this.set(x, y, z, state);
      }
    } else if (dy >= dx && dy >= dz) {
      let e1 = 2 * dx - dy, e2 = 2 * dz - dy;
      while (y !== b.y) {
        y += sy;
        if (e1 > 0) { x += sx; e1 -= 2 * dy; }
        if (e2 > 0) { z += sz; e2 -= 2 * dy; }
        e1 += 2 * dx; e2 += 2 * dz;
        this.set(x, y, z, state);
      }
    } else {
      let e1 = 2 * dx - dz, e2 = 2 * dy - dz;
      while (z !== b.z) {
        z += sz;
        if (e1 > 0) { x += sx; e1 -= 2 * dz; }
        if (e2 > 0) { y += sy; e2 -= 2 * dz; }
        e1 += 2 * dx; e2 += 2 * dy;
        this.set(x, y, z, state);
      }
    }
  }
}

// 最小 NBT ライタ (big-endian)。Sponge v3 に必要なタグだけを書く。
type NbtNode =
  | { t: 'short' | 'int'; v: number }
  | { t: 'string'; v: string }
  | { t: 'byteArray'; v: Uint8Array }
  | { t: 'intArray'; v: number[] }
  | { t: 'list'; item: number; v: NbtNode[] }
  | { t: 'compound'; v: [string, NbtNode][] };
const NBT_TAG: Record<NbtNode['t'], number> = {
  short: 2, int: 3, byteArray: 7, string: 8, list: 9, compound: 10,
  intArray: 11,
};

class NbtBuf {
  parts: Buffer[] = [];
  u8(n: number): void { this.parts.push(Buffer.from([n & 0xff])); }
  i16(n: number): void {
    const b = Buffer.alloc(2); b.writeInt16BE(n); this.parts.push(b);
  }
  i32(n: number): void {
    const b = Buffer.alloc(4); b.writeInt32BE(n); this.parts.push(b);
  }
  utf(s: string): void {
    const b = Buffer.from(s, 'utf8');
    this.i16(b.length); this.parts.push(b);
  }
  bytes(b: Uint8Array): void { this.parts.push(Buffer.from(b)); }
  done(): Buffer { return Buffer.concat(this.parts); }
}

function nbtPayload(buf: NbtBuf, node: NbtNode): void {
  switch (node.t) {
    case 'short': buf.i16(node.v); break;
    case 'int': buf.i32(node.v); break;
    case 'string': buf.utf(node.v); break;
    case 'byteArray': buf.i32(node.v.length); buf.bytes(node.v); break;
    case 'intArray':
      buf.i32(node.v.length);
      for (const n of node.v) buf.i32(n);
      break;
    case 'list':
      buf.u8(node.item); buf.i32(node.v.length);
      for (const child of node.v) nbtPayload(buf, child);
      break;
    case 'compound':
      for (const [name, child] of node.v) nbtNamed(buf, name, child);
      buf.u8(0);
      break;
  }
}
function nbtNamed(buf: NbtBuf, name: string, node: NbtNode): void {
  buf.u8(NBT_TAG[node.t]); buf.utf(name); nbtPayload(buf, node);
}

function encodeVarint(out: number[], val: number): void {
  let n = val >>> 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
}

/** 占有セルのグリッド (原点へ平行移動済み) → gzip 済み Sponge v3 NBT */
function buildSchemBuffer(cells: Map<string, string>, size: Vec3): Buffer {
  const palette = new Map<string, number>([['minecraft:air', 0]]);
  const data: number[] = [];
  for (let y = 0; y < size.y; y++)
    for (let z = 0; z < size.z; z++)
      for (let x = 0; x < size.x; x++) {
        const state = cells.get(key3(x, y, z)) ?? 'minecraft:air';
        let idx = palette.get(state);
        if (idx === undefined) {
          idx = palette.size; palette.set(state, idx);
        }
        encodeVarint(data, idx);
      }
  const palNode: NbtNode = {
    t: 'compound',
    v: [...palette.entries()].map(([name, idx]): [string, NbtNode] =>
      [name, { t: 'int', v: idx }]),
  };
  const root: NbtNode = {
    t: 'compound',
    v: [['Schematic', {
      t: 'compound',
      v: [
        ['Version', { t: 'int', v: 3 }],
        ['DataVersion', { t: 'int', v: 3465 }],  // Minecraft 1.20.1
        ['Width', { t: 'short', v: size.x }],
        ['Height', { t: 'short', v: size.y }],
        ['Length', { t: 'short', v: size.z }],
        ['Offset', { t: 'intArray', v: [0, 0, 0] }],
        ['Blocks', {
          t: 'compound',
          v: [
            ['PaletteMax', { t: 'int', v: palette.size }],
            ['Palette', palNode],
            ['Data', { t: 'byteArray', v: Uint8Array.from(data) }],
            ['BlockEntities', { t: 'list', item: 10, v: [] }],
          ],
        }],
        ['Entities', { t: 'list', item: 10, v: [] }],
      ],
    }]],
  };
  const buf = new NbtBuf();
  nbtNamed(buf, '', root);
  return gzipSync(buf.done());
}

/**
 * プリミティブ列と生ブロック列から .schem を生成する。
 * 書き出し後に inspectSchematic で読み戻して自己検証する。
 */
export async function createSchematicFile(opts: {
  name: string; ops?: SchemOp[]; blocks?: SchemBlockInput[];
  dir: string; overwrite?: boolean;
}): Promise<{
  path: string; size: Vec3; solid_blocks: number;
  materials: { id: string; count: number }[];
  manifest: SchemManifest; manifest_path: string;
}> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(opts.name))
    throw new Error(`invalid schematic name: ${opts.name}`);
  const grid = new SchemGrid();
  const rawMachines: { pos: Vec3; id: string; facing?: string;
    faces?: { input?: RelFace; output?: RelFace; power?: RelFace } }[] = [];
  const cableCounts: Record<string, number> = {};
  const addCable = (x: number, y: number, z: number, op: { cable: string; props?: Record<string, string> }) => {
    grid.set(x, y, z, checkedState(op.cable, op.props));
    cableCounts[op.cable] = (cableCounts[op.cable] ?? 0) + 1;
  };
  for (const op of opts.ops ?? []) {
    if (op.op === 'block')
      grid.set(op.x, op.y, op.z, checkedState(op.block, op.props));
    else if (op.op === 'box')
      grid.box(op.from, op.to, checkedState(op.block, op.props), op.hollow);
    else if (op.op === 'line')
      grid.line(op.from, op.to, checkedState(op.block, op.props));
    else if (op.op === 'machine_row') {
      const v = alongVec(op.along);
      const spacing = Math.max(1, op.spacing ?? 1);
      const count = Math.max(1, Math.min(op.count, 256));
      const props = { ...(op.props ?? {}),
        ...(op.facing ? { facing: op.facing } : {}) };
      for (let i = 0; i < count; i++) {
        const pos = { x: op.at.x + v.x * i * spacing,
          y: op.at.y, z: op.at.z + v.z * i * spacing };
        grid.set(pos.x, pos.y, pos.z, checkedState(op.machine, props));
        rawMachines.push({ pos, id: op.machine,
          facing: op.facing, faces: op.faces });
      }
    } else if (op.op === 'cable_run') {
      // 直角経路: x → z → y の順に1軸ずつ進む
      const cur = { ...op.from };
      addCable(cur.x, cur.y, cur.z, op);
      for (const axis of ['x', 'z', 'y'] as const) {
        while (cur[axis] !== op.to[axis]) {
          cur[axis] += Math.sign(op.to[axis] - cur[axis]);
          addCable(cur.x, cur.y, cur.z, op);
        }
      }
    } else if (op.op === 'power_spine') {
      const v = alongVec(op.along);
      const length = Math.max(1, Math.min(op.length, 512));
      const tapVec = op.tap_dir ? DIR_VEC[op.tap_dir] : null;
      const tapLen = Math.max(1, op.tap_len ?? 1);
      for (let i = 0; i < length; i++) {
        const pos = { x: op.at.x + v.x * i, y: op.at.y,
          z: op.at.z + v.z * i };
        addCable(pos.x, pos.y, pos.z, op);
        if (tapVec && op.tap_every && i % op.tap_every === 0) {
          for (let j = 1; j <= tapLen; j++) {
            addCable(pos.x + tapVec.x * j, pos.y + tapVec.y * j,
              pos.z + tapVec.z * j, op);
          }
        }
      }
    }
    else throw new Error(`unknown schematic op: ${(op as any).op}`);
  }
  for (const b of opts.blocks ?? [])
    grid.set(b.x, b.y, b.z, checkedState(b.block, b.props));
  if (!grid.cells.size) throw new Error('schematic would be empty');
  if (grid.cells.size > MAX_BLOCKS)
    throw new Error(`too many blocks: ${grid.cells.size} (cap ${MAX_BLOCKS})`);
  let min = { x: Infinity, y: Infinity, z: Infinity };
  let max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const k of grid.cells.keys()) {
    const [x, y, z] = k.split(',').map(Number);
    min = { x: Math.min(min.x, x), y: Math.min(min.y, y),
      z: Math.min(min.z, z) };
    max = { x: Math.max(max.x, x), y: Math.max(max.y, y),
      z: Math.max(max.z, z) };
  }
  const size = { x: max.x - min.x + 1, y: max.y - min.y + 1,
    z: max.z - min.z + 1 };
  if (size.x > MAX_AXIS || size.y > MAX_AXIS || size.z > MAX_AXIS)
    throw new Error(`schematic too large: ${size.x}x${size.y}x${size.z} ` +
      `(cap ${MAX_AXIS} per axis)`);
  const shifted = new Map<string, string>();
  for (const [k, state] of grid.cells) {
    const [x, y, z] = k.split(',').map(Number);
    shifted.set(key3(x - min.x, y - min.y, z - min.z), state);
  }
  await mkdir(opts.dir, { recursive: true });
  const file = fsPath.join(opts.dir, `${opts.name}.schem`);
  if (!opts.overwrite && existsSync(file))
    throw new Error(`schematic already exists: ${opts.name} ` +
      '(pass overwrite to replace)');
  await writeFile(file, buildSchemBuffer(shifted, size));
  const info = await inspectSchematic(file);
  if (info.solid_blocks !== grid.cells.size) {
    await unlink(file).catch(() => {});
    throw new Error('round-trip verification failed: block count mismatch');
  }
  // manifest: 座標は .schem と同じく切り出し後のローカル座標に揃える
  const machines: ManifestMachine[] = rawMachines.map((m) => {
    const facing = m.facing ?? 'north';
    const faces: Record<string, string> = {};
    if (m.faces) {
      for (const [k, rel] of Object.entries(m.faces)) {
        if (rel) faces[k] = resolveFace(facing, rel);
      }
    }
    return {
      x: m.pos.x - min.x, y: m.pos.y - min.y, z: m.pos.z - min.z,
      id: m.id,
      ...(m.facing ? { facing: m.facing } : {}),
      ...(Object.keys(faces).length ? { faces } : {}),
    };
  });
  const commission: SchemManifest['commission'] = [];
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    const dirs = [fsPath.resolve(process.cwd(), 'machines'),
      fsPath.resolve(process.cwd(), '..', 'machines')];
    for (const m of machines) {
      for (const d of dirs) {
        const f = fsPath.join(d, `${m.id.replace(':', '_')}.json`);
        if (!existsSync(f)) continue;
        const def = JSON.parse(readFileSync(f, 'utf8'));
        if (Array.isArray(def.commission) && def.commission.length) {
          commission.push({ x: m.x, y: m.y, z: m.z,
            machine: m.id, plan: def.commission });
        }
        break;
      }
    }
  } catch { /* defs は任意: 無ければ commission は空 */ }
  const manifest: SchemManifest = { machines,
    cables: cableCounts, commission };
  const manifestPath = fsPath.join(opts.dir, `${opts.name}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { path: file, size: info.size, solid_blocks: info.solid_blocks,
    materials: info.materials, manifest, manifest_path: manifestPath };
}
