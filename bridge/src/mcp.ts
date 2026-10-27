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
