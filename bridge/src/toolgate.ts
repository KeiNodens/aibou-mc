// ツールゲート (D28): MCP ツールの「見せ方」を制御する。
// - mod 連動: 特定 mod が必要なツールは、その mod が居る時だけ出す
//   (meta.mods で判定。未接続時はゲート対象を全部隠す)
// - 既定オフ: 使用頻度の低いツールは普段隠し、設定で戻せる
// - 設定ファイル: data/tool-config.json の enabled / disabled
//   ("group:<名前>" でグループ指定可。disabled が最優先)
// AIBOU_TOOL_PROFILE=full の時は全ツール表示 (検証・fixture 用)。
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export const MOD_GATES: Record<string, string> = {
  projecte_status: 'projecte',
  refinedstorage_status: 'refinedstorage',
  contraption_status: 'create',
  contraption_ride: 'create',
  ride: 'create',
  train_drive: 'create',
  deck_walk: 'create',
  quest: 'ftbquests',
  quest_prepare: 'ftbquests',
  quest_guide: 'ftbquests',
  pattern_encode: 'ae2',
  jei_search: 'jei',
  warp: 'waystones',
};

export const DEFAULT_OFF: string[] = [
  'emi_search', 'emote', 'respawn', 'sign_write', 'item_info',
  'key_list', 'inventory_resync', 'mock_gather', 'reload_skills',
  'debug_entity', 'waypoint_save', 'waypoint_list',
  'waypoint_delete', 'craft_menu',
];

export const GROUPS: Record<string, string[]> = {
  build: [
    'build_schematic', 'build_prepare', 'schematic_create',
    'schematic_plan', 'schematic_inspect', 'block_search',
  ],
  admin: ['reload_skills', 'mock_gather', 'bots'],
  debug: ['debug_entity', 'item_info', 'key_list'],
};

export interface ToolConfig {
  enabled: string[];
  disabled: string[];
}

export function loadToolConfig(
  file: string = path.resolve(process.cwd(), 'data', 'tool-config.json'),
): ToolConfig {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return {
      enabled: Array.isArray(raw.enabled) ? raw.enabled : [],
      disabled: Array.isArray(raw.disabled) ? raw.disabled : [],
    };
  } catch {
    return { enabled: [], disabled: [] };
  }
}

function expand(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    if (n.startsWith('group:')) {
      for (const t of GROUPS[n.slice(6)] ?? []) out.add(t);
    } else out.add(n);
  }
  return out;
}

/** 全ツール名 → 表示するか。mods=null は「mod 未接続」。 */
export function computePresentation(
  allNames: string[],
  mods: Set<string> | null,
  cfg: ToolConfig,
): Map<string, boolean> {
  const all = new Set(allNames);
  const on = new Set(allNames);
  for (const [tool, modid] of Object.entries(MOD_GATES)) {
    if (!all.has(tool)) continue;
    if (mods && mods.has(modid)) on.add(tool);
    else on.delete(tool);
  }
  for (const n of DEFAULT_OFF) on.delete(n);
  for (const n of expand(cfg.enabled)) if (all.has(n)) on.add(n);
  for (const n of expand(cfg.disabled)) on.delete(n);
  return new Map(allNames.map((n) => [n, on.has(n)]));
}
