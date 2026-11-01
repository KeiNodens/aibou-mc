import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { State } from './state.js';
import { ModClient } from './modclient.js';
import { Skills } from './skills.js';
import { createSchematicFile, inspectSchematic, planSchematic } from './schematic.js';
import type { SchemOp } from './schematic.js';
import { Journal } from './journal.js';
import { runCommission } from './commission.js';
import { RunHold, HoldKind } from './runhold.js';
import { QuestGraph } from './questgraph.js';
import { Autonomy } from './autonomy.js';
import { BotManager } from './bots.js';
import { BlockCatalog } from './catalog.js';
import { computePresentation, loadToolConfig } from './toolgate.js';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

// M2.5向けツール群。mod側の実装があるmethodはWS経由で呼び、
// 未実装のものはmock-modがUNSUPPORTEDを返す。
export function createMcpServer(state: State, mod: ModClient, skills: Skills, journal?: Journal, runhold?: RunHold, questGraph?: QuestGraph, autonomy?: Autonomy, bots?: BotManager) {
  const server = new McpServer({ name: 'minecraft', version: '0.0.1' });

  // ツールゲート (D28): 登録ハンドルを集め、mod 連動 + 設定で見せ方を制御
  const REG = new Map<string, { enable(): void; disable(): void }>();
  const reg = ((...args: unknown[]) => {
    const t = (server as any).registerTool(...args);
    REG.set(args[0] as string, t);
    return t;
  }) as unknown as typeof server.registerTool;
  const gateState = new Map<string, boolean>();
  let lastMods: Set<string> | null = null;
  const applyGate = async () => {
    if (process.env.AIBOU_TOOL_PROFILE === 'full') {
      for (const [name, t] of REG) {
        if (gateState.get(name) === false) { t.enable(); gateState.set(name, true); }
      }
      return;
    }
    if (mod.connected) {
      try {
        const r = (await mod.call('meta.mods')) as { mods?: string[] };
        if (Array.isArray(r?.mods)) lastMods = new Set(r.mods);
      } catch { /* 前回値を維持 */ }
    } else {
      lastMods = null;
    }
    const want = computePresentation([...REG.keys()], lastMods, loadToolConfig());
    for (const [name, t] of REG) {
      const w = want.get(name) ?? true;
      if (gateState.get(name) !== w) {
        if (w) t.enable(); else t.disable();
        gateState.set(name, w);
      }
    }
  };


  // ブロックカタログ (D23/S1b)。data/block-catalog.json にキャッシュし、
  // 未取得なら mod 接続時に一度だけ取りに行く。
  const catalog = new BlockCatalog(
    path.resolve(process.cwd(), 'data', 'block-catalog.json'));
  let catalogInit = false;
  let catalogTried = false;
  const ensureCatalog = async (refresh = false): Promise<BlockCatalog> => {
    if (!catalogInit) {
      await catalog.load();
      catalogInit = true;
    }
    if (refresh || (!catalogTried && catalog.size === 0)) {
      catalogTried = true;
      await catalog.refresh((m, pr) => mod.call(m, pr)).catch(() => {});
    }
    return catalog;
  };

  reg(
    'send_chat',
    {
      description: 'Send a chat message to the in-game chat as the bot player.',
      inputSchema: { text: z.string().describe('chat message text') },
    },
    async ({ text: t }) => {
      try {
        return json(await mod.call('chat.send', { text: t }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'run_command',
    {
      description:
        'Run a server-side slash command as the bot player (requires the bot to have op/cheats permission). E.g. give, tp, weather, time.',
      inputSchema: { command: z.string().describe('command without leading slash') },
    },
    async ({ command }) => {
      try {
        return json(await mod.call('chat.command', { command }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'get_chat',
    {
      description: 'Get recent in-game chat lines (newest last).',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => json(state.chat(limit ?? 50)),
  );

  reg(
    'wait_event',
    {
      description:
        'Wait up to timeout_s seconds for new game events (chat, task.done, damage...). Pass since_seq to get events after a known seq.',
      inputSchema: {
        timeout_s: z.number().min(0).max(60).optional(),
        since_seq: z.number().int().min(0).optional(),
        names: z.array(z.string()).optional(),
      },
    },
    async ({ timeout_s, since_seq, names }) => {
      const evts = await state.waitFor(since_seq ?? state.latestSeq(), (timeout_s ?? 30) * 1000, names);
      return json(evts);
    },
  );

  reg(
    'get_state',
    {
      description:
        'Get current player/world state snapshot (position, health, inventory summary+detail, nearby entities).',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('obs.state'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'scan_area',
    {
      description: 'Scan surrounding blocks/entities within radius.',
      inputSchema: { radius: z.number().int().min(1).max(128).optional() },
    },
    async ({ radius }) => {
      try {
        return json(await mod.call('obs.scan', { radius: radius ?? 32 }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'find_block',
    {
      description:
        'Find positions of a specific block type near the bot (nearest first, up to 16). ' +
        'Use to locate crafting tables, chests, machines.',
      inputSchema: {
        block: z.string().describe('registry name like minecraft:crafting_table'),
        radius: z.number().int().min(1).max(64).optional(),
      },
    },
    async ({ block, radius }) => {
      try {
        return json(await mod.call('obs.block', { block, radius: radius ?? 32 }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'use_item',
    {
      description:
        'Right-click use. Without a target: eat/drink/use held item in air. ' +
        'With x,y,z[,face]: use held item on that block (place block, open chest/crafting table, etc).',
      inputSchema: {
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        z: z.number().int().optional(),
        face: z.enum(['up', 'down', 'north', 'south', 'east', 'west']).optional(),
        hand: z.enum(['main', 'off']).optional(),
        hold_ticks: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('hold the use for N ticks then release (bow draw, trident, shield). returns task_id'),
        sneak: z
          .boolean()
          .optional()
          .describe('perform the use while sneaking (wrench/mode-switch tools that need sneak+use)'),
      },
    },
    async (a) => {
      try {
        return json(await mod.call('use_item', a));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_read',
    {
      description:
        'Read the currently open container menu (slots, carried item, menu type). ' +
        'Also works for the player inventory (no screen open).',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('container.read'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_click',
    {
      description:
        'Click a slot in the currently open container (meaning-level, not screen coords). ' +
        'actions: pickup | quick_move (shift-click) | swap (button=hotbar index) | throw | clone | pickup_all | quick_craft',
      inputSchema: {
        slot: z.number().int().min(0),
        button: z.number().int().min(0).max(8).optional(),
        action: z
          .enum(['pickup', 'quick_move', 'swap', 'throw', 'clone', 'pickup_all', 'quick_craft'])
          .optional(),
        menu_id: z
          .string()
          .optional()
          .describe('expected menu_id from container_read; rejected with STALE_STATE if changed'),
      },
    },
    async ({ slot, button, action, menu_id }) => {
      try {
        const p: Record<string, unknown> = {
          slot,
          button: button ?? 0,
          action: action ?? 'pickup',
        };
        if (menu_id !== undefined) p.menu_id = menu_id;
        return json(await mod.call('container.click', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_button',
    {
      description:
        'Press a GUI button in the open menu (enchanting table tier, stonecutter/loom ' +
        'recipe index, beacon confirm, lectern page). button_id is menu-specific.',
      inputSchema: { button_id: z.number().int().min(0) },
    },
    async ({ button_id }) => {
      try {
        return json(await mod.call('container.button', { button_id }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_trade',
    {
      description:
        'Select a villager/wandering-trader trade offer by index, then take the ' +
        'result slot with container_click.',
      inputSchema: { index: z.number().int().min(0) },
    },
    async ({ index }) => {
      try {
        return json(await mod.call('container.trade', { index }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_repo',
    {
      description:
        'Dump the virtual inventory repo of an open AE2-style terminal screen ' +
        '(ME terminal/crafting terminal). Returns stored amounts and craftable ' +
        'flags for every network item — not regular slots.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('container.repo'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_repo_action',
    {
      description:
        'Perform an AE2 InventoryAction on the open terminal: extract a network item ' +
        'by serial (from container_repo; action SHIFT_CLICK=all, SPLIT_OR_PLACE_SINGLE=one), ' +
        'deposit an inventory slot into the network (action SHIFT_CLICK + slot), ' +
        'or request autocraft: action AUTO_CRAFT + serial opens the amount menu, ' +
        'CONFIRM_AUTO_CRAFT + amount opens the plan screen, then ' +
        'GUI_ACTION + name=startJob starts the job (also replan/back/cycleCpu).',
      inputSchema: {
        action: z.enum([
          'SHIFT_CLICK', 'SPLIT_OR_PLACE_SINGLE', 'PICKUP_OR_SET_DOWN',
          'PICKUP_SINGLE', 'MOVE_REGION', 'CRAFT_ITEM', 'CRAFT_STACK', 'CRAFT_ALL',
          'AUTO_CRAFT', 'CONFIRM_AUTO_CRAFT', 'GUI_ACTION',
        ]),
        name: z.string().optional()
          .describe('GUI action name for GUI_ACTION (startJob/replan/back/cycleCpu)'),
        serial: z.number().int().optional()
          .describe('repo entry serial (extract/autocraft from network)'),
        slot: z.number().int().optional()
          .describe('menu slot index (deposit to network)'),
        amount: z.number().int().optional()
          .describe('craft amount for CONFIRM_AUTO_CRAFT'),
        craft_missing: z.boolean().optional()
          .describe('craft missing intermediates for CONFIRM_AUTO_CRAFT'),
        auto_start: z.boolean().optional()
          .describe('skip plan review and start job for CONFIRM_AUTO_CRAFT (default true)'),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('container.repo_action', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'respawn',
    {
      description:
        'Send a respawn request (vanilla respawn button). Use when the bot is dead ' +
        '(health 0) to recover from the death screen.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('respawn', {}));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'inventory_resync',
    {
      description:
        'Force the server to resend the full container contents (vanilla desync-recovery ' +
        'path). Use when client inventory looks stale after /give or server-side item ' +
        'changes. Wait ~1 tick, then re-read state.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('inventory.resync', {}));
      } catch (e) {
        return err(e);
      }
    },
  );

  const h_schematic_inspect: (args: any) => Promise<any> = async ({ path }) => {
      try {
        return json(await inspectSchematic(path));
      } catch (e) {
        return err(e);
      }
    };

  const h_schematic_plan: (args: any) => Promise<any> = async ({ path, max_layers }) => {
      try {
        const r = await planSchematic(path, { max_layers });
        return json({ size: r.size, total: r.total, blocks: r.blocks.slice(0, 2000),
          truncated: r.total > 2000 });
      } catch (e) {
        return err(e);
      }
    };

  const h_schematic_create: (args: any) => Promise<any> = async ({ name, ops, blocks, overwrite }) => {
      try {
        const cat = await ensureCatalog();
        if (cat.size) {
          const ids = new Set<string>();
          for (const op of (ops as any[]) ?? []) {
            if (op?.block) ids.add(op.block);
            if (op?.machine) ids.add(op.machine);
            if (op?.cable) ids.add(op.cable);
          }
          for (const b of blocks ?? []) ids.add(b.block);
          const unknown = [...ids].filter(
            id => id !== 'minecraft:air' && !cat.has(id));
          if (unknown.length)
            throw new Error('unknown block ids: ' + unknown.map(id =>
              `${id} (suggestions: ${cat.suggest(id).join(', ') || 'none'})`
            ).join('; '));
        }
        return json(await createSchematicFile({
          name,
          ops: ops as SchemOp[] | undefined,
          blocks,
          dir: process.env.SCHEMATICS_DIR ??
            path.resolve(process.cwd(), 'data', 'schematics'),
          overwrite,
        }));
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'schematic',
    {
      description:
        'Building blueprint files (.litematic / .schem), parsed directly ' +
        'by the bridge (no Litematica mod needed). action: inspect = size, ' +
        'block count, material totals | plan = ordered block list ' +
        '(bottom-up placement sequence; max_layers previews a subset) | ' +
        'create = build a .schem from primitive ops and/or an explicit ' +
        'block list (D23/S1; written to the schematic library and verified ' +
        'by read-back; works without the game). create ops: ' +
        '{op:"block",x,y,z,block,props?} | {op:"box",from,to,block,props?,hollow?} | ' +
        '{op:"line",from,to,block,props?}; minecraft:air carves a cell. ' +
        'Semantic ops (D34, expanded deterministically, returned as a ' +
        'manifest + <name>.manifest.json sidecar): ' +
        '{op:"machine_row",at,machine,count,along?,spacing?,facing?,faces?' +
        '{input,output,power: front|back|left|right|top|bottom}} | ' +
        '{op:"cable_run",from,to,cable} (rectilinear x,z,y path) | ' +
        '{op:"power_spine",at,along,length,cable,tap_every?,tap_dir?,tap_len?}. ' +
        'faces in the manifest are DECLARED intent resolved to absolute ' +
        'directions, not sensed machine state.',
      inputSchema: {
        action: z.enum(['inspect', 'plan', 'create']),
        path: z.string().optional().describe('absolute path to the schematic file (inspect/plan)'),
        max_layers: z.number().int().optional().describe('limit to first N layers (plan)'),
        name: z.string().optional().describe('file name for create (letters, digits, _ and -)'),
        ops: z.array(z.any()).optional().describe('primitive ops (create; see description)'),
        blocks: z.array(z.object({
          x: z.number().int(), y: z.number().int(), z: z.number().int(),
          block: z.string(),
          props: z.record(z.string(), z.string()).optional(),
        })).optional().describe('explicit placements, applied after ops (create)'),
        overwrite: z.boolean().optional(),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'inspect': return h_schematic_inspect(rest);
        case 'plan': return h_schematic_plan(rest);
        case 'create': return h_schematic_create(rest);
        default: return err(new Error(`unknown schematic action: ${action}`));
      }
    },
  );

  reg(
    'block_search',
    {
      description:
        'Search the pack block catalog (captured from the in-game block ' +
        'registry) by block id or display-name substring. Returns matching ' +
        'blocks with their item id and blockstate property vocabulary — ' +
        'use it to pick real block ids and valid props before ' +
        'schematic_create. The catalog is captured once while the game is ' +
        'connected and cached in the bridge; pass refresh to re-capture.',
      inputSchema: {
        query: z.string().describe('substring of block id or display name'),
        limit: z.number().int().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ query, limit, refresh }) => {
      try {
        const cat = await ensureCatalog(refresh);
        if (!cat.size)
          return err(new Error('block catalog is empty — connect the game ' +
            'mod once so the bridge can capture the registry'));
        return json({ catalog_total: cat.size,
          matches: cat.search(query, limit ?? 50) });
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'probe_energy',
    {
      description:
        'Read the Forge Energy (FE) storage exposed by the block ' +
        'entity at x/y/z, per face (D40 layer 1). Client-side ' +
        'capability read: values may not be synced for every mod, ' +
        'treat them as indicative.',
      inputSchema: {
        x: z.number(), y: z.number(), z: z.number(),
      },
    },
    async ({ x, y, z }) => {
      try {
        return json(await mod.call('probe.energy', { x, y, z }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'registry_items',
    {
      description:
        'Enumerate the client item registry (id + display name) with ' +
        'offset/limit paging (D40 layer 1). The material for the ' +
        'pack item index; pair with block_search for blocks.',
      inputSchema: {
        offset: z.number().int().optional(),
        limit: z.number().int().optional(),
        contains: z.string().optional()
          .describe('filter the returned page by id/name substring'),
      },
    },
    async ({ offset, limit, contains }) => {
      try {
        const r = (await mod.call('registry.items',
          { offset: offset ?? 0, limit: limit ?? 2000 })) as
          { items?: Array<{ id?: string; name?: string }> };
        if (contains && Array.isArray(r.items)) {
          const q = contains.toLowerCase();
          r.items = r.items.filter((e) =>
            (e.id ?? '').toLowerCase().includes(q)
            || (e.name ?? '').toLowerCase().includes(q));
        }
        return json(r);
      } catch (e) {
        return err(e);
      }
    },
  );

  // ---- D40 層2: knowledge (jar 同梱ドキュメントの索引) ----
  let knowledgeIndex: {
    mods?: Array<Record<string, unknown>>;
  } | null = null;
  const knowledgeDir = async (): Promise<string | null> => {
    for (const dir of [path.resolve(process.cwd(), 'knowledge'),
      path.resolve(process.cwd(), '..', 'knowledge')]) {
      try {
        await readFile(path.join(dir, 'index.json'), 'utf8');
        return dir;
      } catch { /* try next */ }
    }
    return null;
  };
  const loadKnowledge = async () => {
    if (knowledgeIndex) return knowledgeIndex;
    const dir = await knowledgeDir();
    if (!dir) return null;
    try {
      knowledgeIndex = JSON.parse(
        await readFile(path.join(dir, 'index.json'), 'utf8'));
    } catch { knowledgeIndex = null; }
    return knowledgeIndex;
  };
  // D40 層3: 解析済みルール (mod-knowledge/rules/, 共有・版固定)
  const rulesDir = async (): Promise<string | null> => {
    for (const dir of [path.resolve(process.cwd(), 'mod-knowledge', 'rules'),
      path.resolve(process.cwd(), '..', 'mod-knowledge', 'rules')]) {
      try {
        const { readdir } = await import('node:fs/promises');
        await readdir(dir);
        return dir;
      } catch { /* try next */ }
    }
    return null;
  };
  const loadRuleFiles = async (): Promise<Array<Record<string, unknown>>> => {
    const dir = await rulesDir();
    if (!dir) return [];
    const { readdir } = await import('node:fs/promises');
    const out: Array<Record<string, unknown>> = [];
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const d = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
        out.push({ file: f, ...d });
      } catch { /* skip broken rule file */ }
    }
    return out;
  };
  reg(
    'knowledge',
    {
      description:
        'Search the extracted mod documentation (D40 layer 2: ' +
        'in-jar lang files and Patchouli guides, extracted by ' +
        'tools/extract_knowledge.py into knowledge/) and the ' +
        'analysed rule store (layer 3: mod-knowledge/rules/, ' +
        'shared across packs, pinned by mod version). ' +
        'action=search finds items/blocks/guides and rules by ' +
        'substring; action=get reads one extracted file (mod + ' +
        'path from the index); action=mods lists indexed mods; ' +
        'action=rules lists analysed rule files.',
      inputSchema: {
        action: z.enum(['search', 'get', 'mods', 'rules']),
        query: z.string().optional(),
        mod: z.string().optional(),
        path: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async ({ action, query, mod: modId, path: rel, limit }) => {
      try {
        if (action === 'rules') {
          const files = await loadRuleFiles();
          return json({ rule_files: files.map((f) => ({
            file: f.file, mod: f.mod, version: f.version,
            source_repo: f.source_repo, source_commit: f.source_commit,
            rules: Array.isArray(f.rules) ? f.rules.length : 0,
          })) });
        }
        const idx = await loadKnowledge();
        if (!idx?.mods && action !== 'search') {
          return err(new Error('knowledge index not found — run ' +
            'tools/extract_knowledge.py against the pack mods dir first'));
        }
        const packMods = idx?.mods ?? [];
        if (action === 'mods') {
          return json({ mods: packMods.map((m) => ({
            id: m.id, name: m.name, version: m.version,
            lang_entries: m.lang_entries, guides: m.guides_count,
          })) });
        }
        if (action === 'search') {
          const q = (query ?? '').toLowerCase();
          if (!q) return err(new Error('query is required for search'));
          const out: Array<Record<string, unknown>> = [];
          // 層3 ルールも検索対象 (topic / value / id の部分一致)
          for (const f of await loadRuleFiles()) {
            const rules = (f.rules ?? []) as Array<Record<string, unknown>>;
            for (const r of rules) {
              const hay = `${r.id ?? ''} ${r.topic ?? ''} ${JSON.stringify(r.value ?? '')}`.toLowerCase();
              if (hay.includes(q)) {
                out.push({ mod: f.mod, version: f.version,
                  kind: 'rule', ...r });
                if (out.length >= (limit ?? 20)) break;
              }
            }
            if (out.length >= (limit ?? 20)) break;
          }
          for (const m of packMods) {
            if (String(m.id).toLowerCase().includes(q)
              || String(m.name ?? '').toLowerCase().includes(q)) {
              out.push({ mod: m.id, kind: 'mod', name: m.name,
                version: m.version });
            }
            const entries = (m.entries ?? []) as Array<Record<string, unknown>>;
            for (const e of entries) {
              const hay = `${e.key} ${e.en ?? ''} ${e.ja ?? ''}`.toLowerCase();
              if (hay.includes(q)) {
                out.push({ mod: m.id, kind: 'lang', ...e });
                if (out.length >= (limit ?? 20)) break;
              }
            }
            if (out.length >= (limit ?? 20)) break;
            const guides = (m.guides ?? []) as Array<Record<string, unknown>>;
            for (const g of guides) {
              if (String(g.title ?? '').toLowerCase().includes(q)) {
                out.push({ mod: m.id, kind: 'guide', ...g });
                if (out.length >= (limit ?? 20)) break;
              }
            }
            if (out.length >= (limit ?? 20)) break;
          }
          return json({ matches: out });
        }
        // get
        const dir = await knowledgeDir();
        if (!dir || !modId || !rel) {
          return err(new Error('mod and path are required for get'));
        }
        // Review F6: modId itself must stay inside the knowledge dir.
        // Checking only target-under-base let mod:"../x" or an absolute
        // mod path move base outside the knowledge dir entirely.
        if (modId.includes('/') || modId.includes('\\') || modId.includes('..')) {
          return err(new Error('invalid mod id'));
        }
        const base = path.resolve(dir, modId);
        if (base !== dir && !base.startsWith(dir + path.sep)) {
          return err(new Error('mod escapes the knowledge dir'));
        }
        const target = path.resolve(base, rel);
        if (!target.startsWith(base + path.sep)) {
          return err(new Error('path escapes the mod knowledge dir'));
        }
        const text = await readFile(target, 'utf8');
        return json({ mod: modId, path: rel, text: text.slice(0, 20000) });
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'projecte_status',
    {
      description:
        'Read the bot player\'s own ProjectE state via the knowledge ' +
        'provider (reflection, soft dependency): EMC balance and learned ' +
        'items. Errors with UNSUPPORTED when ProjectE is absent. The ' +
        'knowledge and EMC belong to the bot player, separate from the ' +
        'human player\'s progression (D22).',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('projecte.status', {}));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'refinedstorage_status',
    {
      description:
        'Probe the open Refined Storage grid/menu for a network item ' +
        'snapshot (generic reflection over the menu object, soft ' +
        'dependency). Open a grid first. Errors with UNSUPPORTED when ' +
        'no stacks are discoverable; the response names the menu class ' +
        'seen, for live tuning (D25).',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('refinedstorage.status', {}));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'contraption_status',
    {
      description:
        'List nearby Create-style contraption entities (probe, D27): ' +
        'class, position, seat count (reflection), whether the bot is ' +
        'a passenger, and speed when readable. Pass local {x,y,z} to ' +
        'also get that contraption-local point in global coordinates ' +
        '(used to track seats/blocks on a moving deck).',
      inputSchema: {
        local: z.object({
          x: z.number(), y: z.number(), z: z.number(),
        }).optional(),
      },
    },
    async ({ local }) => {
      try {
        return json(await mod.call('contraption.status',
          local ? { local } : {}));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'contraption_ride',
    {
      description:
        'Try to sit on a seat of the nearest (or given) contraption ' +
        'entity (D27): seat position is resolved by reflection and ' +
        'clicked via interactAt, with a plain interact fallback. ' +
        'Returns whether the bot ended up riding.',
      inputSchema: {
        entity_id: z.number().int().optional(),
        seat: z.number().int().optional(),
      },
    },
    async ({ entity_id, seat }) => {
      try {
        return json(await mod.call('contraption.ride',
          { entity_id, seat }));
      } catch (e) {
        return err(e);
      }
    },
  );

  const h_work_journal: (args: any) => Promise<any> = async ({ limit, work_id, open_only }) => {
      try {
        if (!journal) return json({ entries: [], note: 'journal disabled' });
        if (open_only) return json({ open: journal.openWorks() });
        return json({ entries: journal.tail(limit ?? 50, work_id) });
      } catch (e) {
        return err(e);
      }
    };

  const h_work_checkpoint: (args: any) => Promise<any> = async ({ work_id, goal, step, note }) => {
      try {
        if (!journal) return json({ ok: false, note: 'journal disabled' });
        let work = work_id;
        if (!work) {
          work = journal.newWorkId();
          journal.append('work.start', { work, skill: 'manual', goal });
        }
        journal.append('checkpoint', { work, step, ...(note ? { note } : {}) });
        return json({ ok: true, work });
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'goal_set',
    {
      description:
        'Register or re-activate a persistent goal (survives restart). ' +
        'Active goals are shown to the runner context and consolidated in the journal.',
      inputSchema: {
        text: z.string().describe('goal text'),
        priority: z.number().int().optional(),
        end_id: z.string().optional()
          .describe('finish an existing goal id instead (status=done|failed|aside)'),
        status: z.enum(['done', 'failed', 'aside']).optional(),
      },
    },
    async ({ text, priority, end_id, status }) => {
      try {
        if (!journal) return json({ ok: false, note: 'journal disabled' });
        if (end_id) {
          const ended = journal.goalGet(true).find((g) => g.id === end_id);
          const okEnd = journal.goalEnd(end_id, status ?? 'done');
          // クエスト目標の失敗は set-aside カウンタへ (閾値で frontier から外れる)
          let questFailure = undefined;
          if (okEnd && status === 'failed' && ended?.text.startsWith('quest:')) {
            // goal text形式: "quest:<id> <title>" — id部分だけで引く
            const ref = ended.text.slice('quest:'.length).trim().split(/\s+/)[0];
            questFailure = questGraph?.noteFailure(ref) ?? undefined;
          }
          return json({ ok: okEnd, ...(questFailure ? { questFailure } : {}) });
        }
        return json({ ok: true, goal: journal.goalSet(text, { priority }) });
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'goal_get',
    {
      description: 'List active goals (all goals with all=true).',
      inputSchema: { all: z.boolean().optional() },
    },
    async ({ all }) => {
      try {
        if (!journal) return json({ goals: [], note: 'journal disabled' });
        return json({ goals: journal.goalGet(all ?? false) });
      } catch (e) {
        return err(e);
      }
    },
  );

  const h_journal_snapshot: (args: any) => Promise<any> = async () => {
      try {
        if (!journal) return json({ note: 'journal disabled' });
        return json(journal.snapshot());
      } catch (e) {
        return err(e);
      }
    };

  const h_quest_list: (args: any) => Promise<any> = async () => {
      try {
        return json(await mod.call('quest.list', {}));
      } catch (e) {
        return err(e);
      }
    };

  const h_quest_inspect: (args: any) => Promise<any> = async ({ name }) => {
      try {
        return json(await mod.call('quest.inspect', { name }));
      } catch (e) {
        return err(e);
      }
    };

  const h_quest_frontier: (args: any) => Promise<any> = async () => {
      try {
        if (!questGraph?.loaded()) {
          return json({ frontier: [], note: 'quest-graph.json not built (tools/build-quest-graph.mjs)' });
        }
        const ql = await mod.call('quest.list').catch(() => ({ quests: [] }));
        const done = questGraph.extractCompleted(ql);
        const frontier = questGraph.frontier(done).map((q) => ({
          id: q.id, title: q.title, chapter: q.chapter,
          tasks: q.tasks.map((t) => `${t.type}:${t.item ?? ''} x${t.count ?? 1}`),
          deps: q.deps,
        }));
        return json({ frontier, completed: done.size });
      } catch (e) {
        return err(e);
      }
    };

  const h_quest_plan: (args: any) => Promise<any> = async ({ goal }) => {
      try {
        if (!questGraph?.loaded()) {
          return json({ note: 'quest-graph.json not built' });
        }
        const plan = questGraph.plan(goal);
        if (!plan) return json({ note: `quest not found: ${goal}` });
        return json({
          plan: plan.map((q) => ({
            id: q.id, title: q.title, deps: q.deps,
            aside: questGraph.isAside(q),
            failures: questGraph.failureCount(q.id),
          })),
        });
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'jei_search',
    {
      description:
        'Set the JEI ingredient-search filter text directly via JEI API ' +
        '(IIngredientFilter.setFilterText). The JEI search box only accepts ' +
        'input through Forge screen events, so this is the reliable path. ' +
        'Empty text clears the filter. Returns filtered item count.',
      inputSchema: {
        text: z.string().optional().describe('search text; empty clears'),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('jei.search', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'emi_search',
    {
      description:
        'Set the EMI ingredient-search filter text (counterpart of ' +
        'jei_search for packs that use EMI instead of JEI). Returns ' +
        'UNSUPPORTED when EMI is not installed.',
      inputSchema: {
        text: z.string().optional().describe('search text; empty clears'),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('emi.search', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  const h_quest_claim: (args: any) => Promise<any> = async (p) => {
      try {
        return json(await mod.call('quest.claim', p));
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'container_close',
    {
      description: 'Close the currently open container menu.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('container.close'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'key_list',
    {
      description:
        'List all registered key mappings incl. modded keybinds ' +
        '(FTB Ultimine, Mekanism mode switch, SlashBlade…). Find the mapping ' +
        'name to pass to `key`.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('key.list'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'key',
    {
      description:
        'Press or release a key mapping (substring match on name/category/' +
        'display key). Hold-downs enable keybind-driven mod features — e.g. ' +
        'key{mapping:"ftbultimine",down:true} then mine/dig for vein-mining, ' +
        'or tap Mekanism mode-switch to cycle tool modes. Injects via the ' +
        'client KeyboardHandler (works for most mods); use real:true for mods ' +
        'with custom GLFW callbacks (e.g. Mekanism) — sends a genuine OS key ' +
        'event and REQUIRES the game window to be focused.',
      inputSchema: {
        mapping: z.string().optional()
          .describe('substring to match a key mapping name'),
        code: z.number().optional()
          .describe('raw GLFW keycode (e.g. 256=Escape) — bypasses mapping lookup'),
        down: z.boolean().optional().describe('default true (press/hold); false releases'),
        press: z.boolean().optional()
          .describe('single tap (press+release, ~1 tick hold)'),
        real: z.boolean().optional()
          .describe('send a REAL OS key event via Robot — reaches custom GLFW ' +
            'callbacks; needs the Minecraft window focused'),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('key', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'scroll',
    {
      description:
        'Inject a mouse-wheel scroll event. Used for radial menus ' +
        '(e.g. hold Mekanism mode key → scroll to pick mode → release) and ' +
        'scrollable mod GUIs. Positive delta scrolls up.',
      inputSchema: {
        delta: z.number().optional()
          .describe('scroll amount, positive=up (default 1)'),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('scroll', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  const h_screen_read: (args: any) => Promise<any> = async () => {
      try {
        return json(await mod.call('screen.read', {}));
      } catch (e) {
        return err(e);
      }
    };

  const h_screen_click: (args: any) => Promise<any> = async (p) => {
      try {
        return json(await mod.call('screen.click', p));
      } catch (e) {
        return err(e);
      }
    };

  const h_screen_close: (args: any) => Promise<any> = async () => {
      try {
        return json(await mod.call('screen.close', {}));
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'screen',
    {
      description:
        'Non-container Screen GUIs (FTB Quests, Curios, mod configs). ' +
        'action: read = list widgets (index/class/text/position) | click = ' +
        'click by widget index, text substring, raw x/y, or FTB sidebar id | ' +
        'close = force-close the open Screen.',
      inputSchema: {
        action: z.enum(['read', 'click', 'close']),
        index: z.number().optional(),
        text: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        sidebar: z.string().optional(),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'read': return h_screen_read(rest);
        case 'click': return h_screen_click(rest);
        case 'close': return h_screen_close(rest);
        default: return err(new Error(`unknown screen action: ${action}`));
      }
    },
  );

  reg(
    'type_text',
    {
      description:
        'Type text into a text input. Targets the anvil rename field ' +
        'when an anvil menu is open, otherwise the first (or focused/' +
        'indexed) EditBox in the open Screen — covers JEI/EMI search ' +
        'boxes and mod filter fields.',
      inputSchema: {
        text: z.string(),
        index: z.number().optional()
          .describe('EditBox index when the screen has several'),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('type', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'sign_write',
    {
      description:
        'Write text onto a sign directly (no screen needed; server checks ' +
        'reach/editable). Pass lines[] or text with \\n; front defaults true.',
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int(),
        lines: z.array(z.string()).max(4).optional(),
        text: z.string().optional(),
        front: z.boolean().optional(),
      },
    },
    async (p) => {
      try {
        return json(await mod.call('sign.write', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'container_open_curios',
    {
      description:
        'Ask the server to open the Curios accessory-slots menu (Curios mod soft-dep). ' +
        'After ~1 tick, use container_read/container_click on it like any menu — ' +
        'equip a jetpack/charm/backpack item by clicking it into a curios slot.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('container.open_curios'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'recipe_lookup',
    {
      description:
        'Resolve crafting/processing recipes that produce an item, from the synced recipe manager. ' +
        'Returns type, ingredients, result (covers modded machine recipe types too).',
      inputSchema: { item: z.string().describe('result item like minecraft:stick or mekanism:ingot_steel') },
    },
    async ({ item }) => {
      try {
        return json(await mod.call('recipe.lookup', { item }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'craft_menu',
    {
      description:
        'Craft an item using the recipe book packet in the currently open crafting menu ' +
        '(player inventory 2x2 or open crafting table 3x3). Returns a task_id. ' +
        'Requires the recipe to be unlocked in the bot recipe book.',
      inputSchema: {
        item: z.string().describe('result item like minecraft:stick'),
        count: z.number().int().min(1).optional(),
      },
    },
    async ({ item, count }) => {
      try {
        return json(await mod.call('craft', { item, count: count ?? 1 }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'mock_gather',
    {
      description:
        'Mock skill: pretend to gather blocks. Returns a task_id; result arrives via task.done event / task_status.',
      inputSchema: {
        block: z.string().describe('registry name like minecraft:oak_log'),
        count: z.number().int().min(1).optional(),
      },
    },
    async ({ block, count }) => {
      try {
        return json(await mod.call('skill.mock_gather', { block, count: count ?? 1 }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'move',
    {
      description:
        'Set movement input states (raw key hold, like a human pressing keys). ' +
        'Pass only the keys to change; call stop_move or move{key:false} to release.',
      inputSchema: {
        forward: z.boolean().optional(),
        back: z.boolean().optional(),
        left: z.boolean().optional(),
        right: z.boolean().optional(),
        jump: z.boolean().optional(),
        sneak: z.boolean().optional(),
        sprint: z.boolean().optional(),
      },
    },
    async (params) => {
      try {
        return json(await mod.call('move.set', params));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'stop_move',
    {
      description: 'Release all movement input states.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('move.stop'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'block_state',
    {
      description:
        'Read block-state properties and synced block-entity NBT at a position ' +
        '(machine progress/energy/fluid diagnostics without Jade).',
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int(),
      },
    },
    async ({ x, y, z }) => {
      try {
        return json(await mod.call('obs.block_state', { x, y, z }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'look_info',
    {
      description:
        'Aim at a target and return what Jade shows for it (name, mod, energy, ' +
        'progress, contents). Give x,y,z or entity_id to look first; omit to read ' +
        'the current view. Returns task_id.',
      inputSchema: {
        x: z.number().optional(),
        y: z.number().optional(),
        z: z.number().optional(),
        entity_id: z.number().int().optional(),
      },
    },
    async (a) => {
      try {
        return json(await mod.call('look_info', a));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'find_entity',
    {
      description:
        'Find entities/players by player name or registry type (minecraft:cow). ' +
        'Returns entity_id, position, distance — the id needed by interact/look_info.',
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        return json(await mod.call('obs.entity', { name }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'interact',
    {
      description:
        'Right-click an entity (feed, tame, milk, shear, leash, name-tag, mount, ' +
        'open villager trading). The merchant menu afterwards is handled via ' +
        'container_* tools.',
      inputSchema: {
        entity_id: z.number().int(),
        hand: z.enum(['main', 'off']).optional(),
      },
    },
    async ({ entity_id, hand }) => {
      try {
        const p: Record<string, unknown> = { entity_id };
        if (hand !== undefined) p.hand = hand;
        return json(await mod.call('interact', p));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'look_at',
    {
      description: 'Turn the bot to face a coordinate or entity.',
      inputSchema: {
        x: z.number().optional(),
        y: z.number().optional(),
        z: z.number().optional(),
        entity_id: z.number().int().optional(),
      },
    },
    async (params) => {
      try {
        return json(await mod.call('look_at', params));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'dig',
    {
      description:
        'Dig a block via the normal client input path (like holding left-click). ' +
        'Returns a task_id; completion arrives via task.done event / task_status.',
      inputSchema: {
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int(),
        face: z.enum(['up', 'down', 'north', 'south', 'east', 'west']).optional(),
        tool_slot: z.number().int().min(0).max(8).optional()
          .describe('force this hotbar slot instead of auto-selecting the best tool ' +
            '(for AoE/mode tools whose value auto-scoring cannot see)'),
      },
    },
    async (params) => {
      try {
        return json(await mod.call('dig', params));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'equip',
    {
      description:
        'Select a hotbar slot (0-8) as the held item, OR equip an item into ' +
        'an armor/offhand slot: {item:"modid:name", slot_name:"head|chest|' +
        'legs|feet|offhand"}. slot_name without item reports what is worn.',
      inputSchema: {
        slot: z.number().int().min(0).max(8).optional(),
        item: z.string().optional().describe('registry id to equip into a wear slot'),
        slot_name: z.enum(['head', 'chest', 'legs', 'feet', 'offhand']).optional(),
      },
    },
    async (a) => {
      try {
        return json(await mod.call('equip', a));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'item_info',
    {
      description:
        'Inspect an inventory item: durability, Forge energy/fluid charge, ' +
        'enchantments, top-level NBT keys — the state that same-id mod items ' +
        'differ by (charge, mode, damage). Slot: 0-8 hotbar, 9-35 inventory ' +
        '(default: held slot).',
      inputSchema: { slot: z.number().int().min(0).max(35).optional() },
    },
    async ({ slot }) => {
      try {
        return json(await mod.call('item.info', slot === undefined ? {} : { slot }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'toss',
    {
      description: 'Drop the held item (full_stack=true drops the whole stack).',
      inputSchema: { full_stack: z.boolean().optional() },
    },
    async ({ full_stack }) => {
      try {
        return json(await mod.call('toss', { full_stack: full_stack ?? false }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'goto',
    {
      description:
        'Walk to a coordinate via Baritone pathfinding. Pass x/z (+optional y), ' +
        'or a saved waypoint name. Returns a task_id; ' +
        'completion arrives via task.done (succeeded/UNREACHABLE).',
      inputSchema: {
        x: z.number().int().optional(),
        y: z.number().int().optional().describe('omit for any-Y travel'),
        z: z.number().int().optional(),
        name: z.string().optional().describe('saved waypoint name'),
      },
    },
    async (params) => {
      try {
        return json(await mod.call('baritone.goto', params));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'emote',
    {
      description:
        'Play a body emote for presence: swing (wave arm), jump, ' +
        'crouch_dance (bow repeatedly ~1.6s).',
      inputSchema: { type: z.enum(['swing', 'jump', 'crouch_dance']) },
    },
    async ({ type }) => {
      try {
        return json(await mod.call('emote', { type }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'screenshot',
    {
      description: "Capture the bot's current first-person view as a PNG image.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = (await mod.call('screenshot')) as { path?: string };
        if (!r?.path) return err(new Error('no path in screenshot result'));
        const buf = await readFile(r.path);
        return {
          content: [{ type: 'image' as const, data: buf.toString('base64'), mimeType: 'image/png' }],
        };
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'find_item',
    {
      description:
        'Search item registry by registry id or localized display name. ' +
        'Works with Japanese names too (e.g. "強化鉄" -> mekanism:enriched_iron).',
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      try {
        return json(await mod.call('find_item', { query }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'waypoint_save',
    {
      description:
        'Save current position (or given coords) under a name like "home". ' +
        'Pass r to make it an area waypoint (safe zone for reflex retreat suppression).',
      inputSchema: {
        name: z.string(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        z: z.number().int().optional(),
        r: z.number().int().optional()
          .describe('area radius in blocks; set for home/safe-area waypoints'),
      },
    },
    async (params) => {
      try {
        const r = await mod.call('waypoint.set', params);
        // 施設記憶: waypoint登録をconsolidationする (座標明示時)
        if (journal && typeof params.x === 'number'
            && typeof params.y === 'number' && typeof params.z === 'number') {
          journal.noteFacility({
            kind: 'waypoint',
            pos: { x: params.x, y: params.y, z: params.z },
            name: params.name,
          });
        }
        return json(r);
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'waypoint_list',
    {
      description: 'List saved waypoint names and coordinates.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('waypoint.list'));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'waypoint_delete',
    {
      description: 'Delete a saved waypoint by name.',
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        return json(await mod.call('waypoint.del', { name }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'mine',
    {
      description:
        'Mine nearby blocks of a type via Baritone. Returns a task_id. ' +
        'mode "additional" (default) mines N more items; "ensure" targets N total ' +
        'in inventory and mines only the shortfall (succeeds immediately if already held).',
      inputSchema: {
        block: z.string().describe('registry name like minecraft:oak_log'),
        count: z.number().int().min(1).optional(),
        mode: z.enum(['additional', 'ensure']).optional(),
      },
    },
    async ({ block, count, mode }) => {
      try {
        return json(
          await mod.call('baritone.mine', { block, count: count ?? 1, mode: mode ?? 'additional' }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'follow',
    {
      description:
        'Follow a target continuously via Baritone until stopped. ' +
        'target is a player name (Kei_Dens) or an entity type (minecraft:rabbit).',
      inputSchema: { target: z.string().describe('player name or entity registry name') },
    },
    async ({ target }) => {
      try {
        return json(await mod.call('baritone.follow', { target }));
      } catch (e) {
        return err(e);
      }
    },
  );

  reg(
    'stop',
    {
      description: 'Stop all Baritone pathfinding/movement and cancel running tasks.',
      inputSchema: {},
    },
    async () => {
      try {
        return json(await mod.call('baritone.stop'));
      } catch (e) {
        return err(e);
      }
    },
  );

  const h_task_status: (args: any) => Promise<any> = async ({ task_id }) => {
      try {
        return json(await mod.call('task.status', { task_id }));
      } catch (e) {
        return err(e);
      }
    };

  const h_task_result: (args: any) => Promise<any> = async ({ task_id }) => {
      try {
        return json(await mod.call('task.result', { task_id }));
      } catch (e) {
        return err(e);
      }
    };

  const h_cancel_current: (args: any) => Promise<any> = async () => {
      const cancelledSkill = skills.cancel().cancelled;
      try {
        const r = (await mod.call('task.cancel_all')) as Record<string, unknown>;
        await mod.call('baritone.stop').catch(() => {});
        return json({ ...r, cancelled_skill: cancelledSkill });
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'task',
    {
      description:
        'Async task control. action: status = execution state of a task ' +
        '(queued/running/succeeded/failed/cancelling/cancelled) | result = ' +
        'final result of a finished task | cancel_all = cancel the running ' +
        'skill and all tasks.',
      inputSchema: {
        action: z.enum(['status', 'result', 'cancel_all']),
        task_id: z.string().optional(),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'status': return h_task_status(rest);
        case 'result': return h_task_result(rest);
        case 'cancel_all': return h_cancel_current(rest);
        default: return err(new Error(`unknown task action: ${action}`));
      }
    },
  );

  // ---- 技能層: skills/*.mjs を1ツールずつ公開 ----
  for (const s of skills.list()) {
    reg(
      s.name,
      {
        description: `[skill] ${s.description}`,
        inputSchema: Skills.zodShape(s),
      },
      async (args) => {
        try {
          return json(skills.run(s.name, args));
        } catch (e) {
          return err(e);
        }
      },
    );
  }

  reg(
    'reload_skills',
    {
      description: 'Rescan the skills directory and reload skill modules.',
      inputSchema: {},
    },
    async () => {
      await skills.load();
      return json({ skills: skills.list().map((s) => s.name) });
    },
  );

  const h_bot_status: (args: any) => Promise<any> = async () => json({ connected: mod.connected, generation: state.generation });

  const h_loop_status: (args: any) => Promise<any> = async () => json(runhold
      ? { ...runhold.status(), connected: mod.connected, generation: state.generation }
      : { note: 'runner disabled', connected: mod.connected, generation: state.generation });

  const h_loop_resume: (args: any) => Promise<any> = async ({ hold }) => {
      try {
        if (!runhold) return json({ ok: false, note: 'runner disabled' });
        if (hold) runhold.release(hold as HoldKind);
        else runhold.releaseAll();
        return json({ ok: true, holds: runhold.status().holds });
      } catch (e) {
        return err(e);
      }
    };

  const h_approve: (args: any) => Promise<any> = async ({ id }) => {
      try {
        if (!autonomy) return json({ ok: false, note: 'autonomy disabled' });
        const r = autonomy.approve(id);
        return json({ ok: !!r.approved, approved: r.approved, pending: r.pending });
      } catch (e) {
        return err(e);
      }
    };

  const h_deny: (args: any) => Promise<any> = async ({ id }) => {
      try {
        if (!autonomy) return json({ ok: false, note: 'autonomy disabled' });
        const r = autonomy.deny(id);
        return json({ ok: !!r.denied, denied: r.denied, pending: r.pending });
      } catch (e) {
        return err(e);
      }
    };

  const h_pending_approvals: (args: any) => Promise<any> = async () => json({
      level: autonomy?.level(),
      pending: autonomy?.list() ?? [],
    });

  reg(
    'approvals',
    {
      description:
        'Autonomy-gate approvals for dangerous actions. action: list = ' +
        'pending requests + current level | approve = approve one (id; ' +
        'omit for the newest; opens the method for 5 minutes) | deny = ' +
        'deny one (id; omit for the newest).',
      inputSchema: {
        action: z.enum(['list', 'approve', 'deny']),
        id: z.string().optional(),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'list': return h_pending_approvals(rest);
        case 'approve': return h_approve(rest);
        case 'deny': return h_deny(rest);
        default: return err(new Error(`unknown approvals action: ${action}`));
      }
    },
  );

  const h_session_summary: (args: any) => Promise<any> = async ({ record }) => {
      try {
        if (!journal) return json({ note: 'journal disabled' });
        return json(journal.sessionSummary(record ?? false));
      } catch (e) {
        return err(e);
      }
    };

  const h_work_resume_plan: (args: any) => Promise<any> = async ({ limit }) => {
      try {
        if (!journal) return json({ failed: [], note: 'journal disabled' });
        return json({ failed: journal.failedWorks(limit ?? 3) });
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'journal',
    {
      description:
        'Persistent work journal and structured memory. action: read = ' +
        'work journal entries (limit, work_id, open_only for unfinished ' +
        'works) | checkpoint = write a checkpoint (work_id to continue, ' +
        'goal+omit work_id to start a new work; step is the label) | ' +
        'snapshot = structured memory (goals, facilities, episodes — ' +
        'recorded facts; verify against live state) | session_summary = ' +
        'mechanical summary since the last one (record=true stores it and ' +
        'advances the marker) | resume_plan = suffix-repair plan for ' +
        'recently failed works (redo only steps after the last checkpoint).',
      inputSchema: {
        action: z.enum(['read', 'checkpoint', 'snapshot', 'session_summary', 'resume_plan']),
        limit: z.number().int().optional(),
        work_id: z.string().optional(),
        open_only: z.boolean().optional(),
        goal: z.string().optional(),
        step: z.string().optional(),
        note: z.string().optional(),
        record: z.boolean().optional(),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'read': return h_work_journal(rest);
        case 'checkpoint': return h_work_checkpoint(rest);
        case 'snapshot': return h_journal_snapshot(rest);
        case 'session_summary': return h_session_summary(rest);
        case 'resume_plan': return h_work_resume_plan(rest);
        default: return err(new Error(`unknown journal action: ${action}`));
      }
    },
  );

  const h_quest_aside: (args: any) => Promise<any> = async ({ action, quest }) => {
      try {
        if (!questGraph?.loaded()) return json({ note: 'quest-graph.json not built' });
        if (action === 'list') {
          return json({
            aside: questGraph.asideList().map((q) => ({
              id: q.id, title: q.title,
              failures: questGraph.failureCount(q.id),
            })),
          });
        }
        if (!quest) return json({ ok: false, note: 'quest is required' });
        if (action === 'fail') {
          return json({ ok: true, result: questGraph.noteFailure(quest) });
        }
        const q = questGraph.setAside(quest, action === 'aside');
        return json({ ok: !!q, quest: q?.title ?? null });
      } catch (e) {
        return err(e);
      }
    };

  reg(
    'quest',
    {
      description:
        'FTB Quests tools (requires the ftbquests mod). action: list = ' +
        'chapters/quests with progress | inspect = one quest by name/id ' +
        '(tasks, rewards, state; name from list) | frontier = actionable ' +
        'quests whose dependencies are done | plan = dependency-resolved ' +
        'path to a goal quest | claim = claim rewards (reward_id from ' +
        'inspect; omit to claim all) | aside = manage set-aside for ' +
        'repeatedly failing quests (mode: list|aside|unaside|fail).',
      inputSchema: {
        action: z.enum(['list', 'inspect', 'frontier', 'plan', 'claim', 'aside']),
        name: z.string().optional().describe('quest title or id (inspect)'),
        goal: z.string().optional().describe('quest title or id (plan)'),
        reward_id: z.number().optional().describe('reward id (claim)'),
        quest: z.string().optional().describe('quest title or id (aside)'),
        mode: z.enum(['list', 'aside', 'unaside', 'fail']).optional()
          .describe('aside sub-action (default list)'),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'list': return h_quest_list(rest);
        case 'inspect': return h_quest_inspect(rest);
        case 'frontier': return h_quest_frontier(rest);
        case 'plan': return h_quest_plan(rest);
        case 'claim': return h_quest_claim(rest);
        case 'aside': return h_quest_aside({ action: (rest as any).mode ?? 'list', quest: (rest as any).quest });
        default: return err(new Error(`unknown quest action: ${action}`));
      }
    },
  );

  const h_bots_status: (args: any) => Promise<any> = async () => json({
      bots: bots?.status() ?? [
        { name: 'primary', connected: mod.connected, generation: state.generation, role: 'primary' },
      ],
    });

  reg(
    'bots',
    {
      description:
        'Bot / execution-loop status. action: status = bridge WS ' +
        'connectivity + generation | multi = primary + observer bots ' +
        '(BOTS_JSON) | loop_status = execution loop state and holds ' +
        '(read-only) | loop_resume = release loop holds (hold = one kind; ' +
        'omit to release all).',
      inputSchema: {
        action: z.enum(['status', 'multi', 'loop_status', 'loop_resume']),
        hold: z.string().optional(),
      },
    },
    async (args: any) => {
      const { action, ...rest } = args ?? {};
      switch (action) {
        case 'status': return h_bot_status(rest);
        case 'multi': return h_bots_status(rest);
        case 'loop_status': return h_loop_status(rest);
        case 'loop_resume': return h_loop_resume(rest);
        default: return err(new Error(`unknown bots action: ${action}`));
      }
    },
  );

  // ---- D30: quest_prepare (クエスト→素材の橋渡し) ----
  reg(
    'quest_prepare',
    {
      description:
        'Aggregate the item tasks of a goal quest path (or the current ' +
        'frontier when goal is omitted) and diff them against the bot ' +
        'inventory. include_me also counts ME network stock when the bot ' +
        'is already near the remembered ME terminal (no travel). Returns ' +
        'per-item need/have/missing and non-item tasks separately.',
      inputSchema: {
        goal: z.string().optional().describe('quest title or id; omit for frontier'),
        include_me: z.boolean().optional(),
      },
    },
    async ({ goal, include_me }) => {
      try {
        if (!questGraph?.loaded()) return json({ note: 'quest-graph.json not built' });
        const ql = await mod.call('quest.list').catch(() => ({ quests: [] }));
        const done = questGraph.extractCompleted(ql);
        let targets: ReturnType<QuestGraph['frontier']> = [];
        if (goal) {
          const plan = questGraph.plan(goal);
          if (!plan) return json({ note: `quest not found: ${goal}` });
          targets = plan.filter((q) => !done.has(q.id));
        } else {
          targets = questGraph.frontier(done);
        }
        const need = new Map<string, number>();
        const other: string[] = [];
        for (const q of targets) {
          for (const t of q.tasks) {
            if (t.type === 'item' && t.item) {
              need.set(t.item, (need.get(t.item) ?? 0) + (t.count ?? 1));
            } else {
              other.push(`${q.title}: ${t.type}${t.item ? ' ' + t.item : ''}`);
            }
          }
        }
        const st = (await mod.call('obs.state').catch(() => null)) as
          Record<string, unknown> | null;
        const inv = new Map<string, number>();
        const rawInv = (st?.inventory ?? st?.inventory_summary) as unknown;
        if (rawInv && typeof rawInv === 'object' && !Array.isArray(rawInv)) {
          for (const [id, n] of Object.entries(rawInv as Record<string, number>)) {
            inv.set(id, Number(n) || 0);
          }
        } else if (Array.isArray(rawInv)) {
          for (const e of rawInv as Array<{ id?: string; count?: number }>) {
            if (e?.id) inv.set(e.id, (inv.get(e.id) ?? 0) + (e.count ?? 0));
          }
        }
        const me = new Map<string, number>();
        let meNote: string | undefined;
        if (include_me) {
          const fac = journal?.snapshot()?.facilities
            ?.find((f) => f.kind === 'me_terminal');
          const pos = (st?.pos ?? {}) as { x?: number; y?: number; z?: number };
          if (!fac) meNote = 'no me_terminal facility remembered';
          else if (pos.x === undefined || pos.z === undefined ||
            Math.hypot(fac.pos.x - pos.x, fac.pos.z - pos.z) > 6) {
            meNote = 'bot is not near the ME terminal (no travel in prepare)';
          } else {
            try {
              await mod.call('use_item', { x: fac.pos.x, y: fac.pos.y, z: fac.pos.z });
              const repo = (await mod.call('container.repo')) as
                { entries?: Array<{ id?: string; amount?: number }> };
              for (const e of repo.entries ?? []) {
                if (e?.id) me.set(e.id, (me.get(e.id) ?? 0) + (e.amount ?? 0));
              }
              await mod.call('container.close').catch(() => {});
            } catch (e) {
              meNote = `ME read failed: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }
        const items = [...need.entries()].map(([id, n]) => {
          const haveInv = inv.get(id) ?? 0;
          const haveMe = me.get(id) ?? 0;
          return { id, need: n, have_inventory: haveInv, have_me: haveMe,
            missing: Math.max(0, n - haveInv - haveMe) };
        });
        return json({
          quests: targets.map((q) => q.title),
          items,
          other_tasks: other,
          ready: items.every((i) => i.missing === 0),
          ...(meNote ? { me_note: meNote } : {}),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  // ---- D49: quest_guide (frontier の推奨順つき提示) ----
  reg(
    'quest_guide',
    {
      description:
        'Recommend what to do next in FTB Quests: the current ' +
        'frontier ranked by readiness — quests whose item tasks the ' +
        'bot inventory already satisfies come first, each with its ' +
        'missing items and rewards. This is the Minemind-style ' +
        '"always know the frontier" view, as a ranked shortlist for ' +
        'the LLM to pick from and explain.',
      inputSchema: {
        limit: z.number().optional().describe('max recommendations (default 8)'),
      },
    },
    async ({ limit }) => {
      try {
        if (!questGraph?.loaded()) return json({ note: 'quest-graph.json not built' });
        const ql = await mod.call('quest.list').catch(() => ({ quests: [] }));
        const done = questGraph.extractCompleted(ql);
        const frontier = questGraph.frontier(done);
        const st = (await mod.call('obs.state').catch(() => null)) as
          Record<string, unknown> | null;
        const inv = new Map<string, number>();
        const rawInv = (st?.inventory ?? st?.inventory_summary) as unknown;
        if (rawInv && typeof rawInv === 'object' && !Array.isArray(rawInv)) {
          for (const [id, n] of Object.entries(rawInv as Record<string, number>)) {
            inv.set(id, Number(n) || 0);
          }
        }
        const recs = frontier.map((q) => {
          const missing: Array<{ item: string; need: number; have: number }> = [];
          let missingTotal = 0;
          for (const t of q.tasks) {
            if (t.type === 'item' && t.item) {
              const need = t.count ?? 1;
              const have = inv.get(t.item) ?? 0;
              if (have < need) {
                missing.push({ item: t.item, need, have });
                missingTotal += need - have;
              }
            }
          }
          const nonItem = q.tasks.filter((t) => t.type !== 'item').length;
          return {
            id: q.id, title: q.title, chapter: q.chapter,
            ready: missing.length === 0 && nonItem === 0,
            items_ready: missing.length === 0,
            missing, missing_total: missingTotal,
            non_item_tasks: nonItem,
            rewards: q.rewards,
          };
        });
        recs.sort((a, b) =>
          Number(b.items_ready) - Number(a.items_ready)
          || a.missing_total - b.missing_total
          || a.title.localeCompare(b.title));
        return json({
          frontier_count: frontier.length,
          completed: done.size,
          recommendations: recs.slice(0, limit ?? 8),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  // ---- D30: commission (配置後の機械設定、実行器は commission.ts) ----
  reg(
    'commission',
    {
      description:
        'Commission a placed machine: run a configuration plan made of ' +
        'GUI steps. The plan comes from the machine definition\'s ' +
        '"commission" array (machines/*.json, matched by the block at ' +
        'x/y/z) or from an inline plan. Steps: {do:"open"} | ' +
        '{do:"button", id} | {do:"click_slot", slot, button?, action?} | ' +
        '{do:"screen_click", text?|index?|x?, y?} | {do:"wait", ms} | ' +
        '{do:"close"}. Stops at the first failed step and reports all ' +
        'step results.',
      inputSchema: {
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
        plan: z.array(z.any()).optional().describe('inline commission steps'),
      },
    },
    async ({ x, y, z, plan }) => {
      try {
        return json(await runCommission(mod, { x, y, z, plan }));
      } catch (e) {
        return err(e);
      }
    },
  );

  void applyGate();
  const gateTimer = setInterval(() => { void applyGate(); }, 15_000);
  (gateTimer as unknown as { unref?: () => void }).unref?.();

  return server;
}
