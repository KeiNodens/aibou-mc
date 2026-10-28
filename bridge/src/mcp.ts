import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { State } from './state.js';
import { ModClient } from './modclient.js';
import { Skills } from './skills.js';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const err = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

// M2.5向けツール群。mod側の実装があるmethodはWS経由で呼び、
// 未実装のものはmock-modがUNSUPPORTEDを返す。
export function createMcpServer(state: State, mod: ModClient, skills: Skills) {
  const server = new McpServer({ name: 'minecraft', version: '0.0.1' });

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'get_chat',
    {
      description: 'Get recent in-game chat lines (newest last).',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => json(state.chat(limit ?? 50)),
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'container_repo_action',
    {
      description:
        'Perform an AE2 InventoryAction on the open terminal: extract a network item ' +
        'by serial (from container_repo; action SHIFT_CLICK=all, SPLIT_OR_PLACE_SINGLE=one) ' +
        'or deposit an inventory slot into the network (action SHIFT_CLICK + slot).',
      inputSchema: {
        action: z.enum([
          'SHIFT_CLICK', 'SPLIT_OR_PLACE_SINGLE', 'PICKUP_OR_SET_DOWN',
          'PICKUP_SINGLE', 'MOVE_REGION', 'CRAFT_ITEM', 'CRAFT_STACK', 'CRAFT_ALL',
        ]),
        serial: z.number().int().optional()
          .describe('repo entry serial (extract from network)'),
        slot: z.number().int().optional()
          .describe('menu slot index (deposit to network)'),
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'equip',
    {
      description: 'Select a hotbar slot (0-8) as the held item.',
      inputSchema: { slot: z.number().int().min(0).max(8) },
    },
    async ({ slot }) => {
      try {
        return json(await mod.call('equip', { slot }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'waypoint_save',
    {
      description: 'Save current position (or given coords) under a name like "home".',
      inputSchema: {
        name: z.string(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        z: z.number().int().optional(),
      },
    },
    async (params) => {
      try {
        return json(await mod.call('waypoint.set', params));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'task_status',
    {
      description: 'Query execution state of a task (queued/running/succeeded/failed/cancelling/cancelled).',
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      try {
        return json(await mod.call('task.status', { task_id }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'task_result',
    {
      description: 'Get final result of a finished task.',
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      try {
        return json(await mod.call('task.result', { task_id }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'cancel_current',
    {
      description:
        'Cancel the running skill and all tasks. Completion is reported via ' +
        'task.done(state=cancelled) / skill.done(cancelled).',
      inputSchema: {},
    },
    async () => {
      const cancelledSkill = skills.cancel().cancelled;
      try {
        const r = (await mod.call('task.cancel_all')) as Record<string, unknown>;
        await mod.call('baritone.stop').catch(() => {});
        return json({ ...r, cancelled_skill: cancelledSkill });
      } catch (e) {
        return err(e);
      }
    },
  );

  // ---- 技能層: skills/*.mjs を1ツールずつ公開 ----
  for (const s of skills.list()) {
    server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'bot_status',
    {
      description: 'Bridge/bot status: WS connectivity to the agent, generation id.',
      inputSchema: {},
    },
    async () => json({ connected: mod.connected, generation: state.generation }),
  );

  return server;
}
