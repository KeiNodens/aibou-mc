// パーティのツール申告メモ (D35d): プレイヤーの幸運の有無は本人の
// インベントリを読めないため、本人が事前に伝えた内容を bridge 側に
// 覚えておく。ただしこれは「腐る前提のキャッシュ」— 近くにいる時の
// 手持ち観測 (obs.entity の held) が取れたら観測が優先される。
// 記録先: bridge data/party-tools.json { players: { name: {fortune, at} } }
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/party-tools.json', import.meta.url);

async function load() {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return { players: {} };
  }
}

export default {
  name: 'party_tools',
  description:
    'Remember a player-declared tool status (currently: Fortune level ' +
    'of their pickaxe) for dig-role decisions. action=declare stores ' +
    '{player, fortune} (0 means "does not have it"); action=show lists ' +
    'current declarations. Live observation of the held item always ' +
    'overrides a declaration.',
  params: {
    action: { type: 'string', required: true, description: 'declare | show' },
    player: { type: 'string', required: false, description: 'player name (declare)' },
    fortune: { type: 'integer', required: false, description: 'Fortune level 0..3 (declare)' },
  },
  async run(ctx, { action, player, fortune }) {
    const data = await load();
    if (action === 'show') return data;
    if (action === 'declare') {
      if (!player || fortune == null) {
        throw new Error('declare needs player and fortune');
      }
      data.players[player] = {
        fortune: Math.max(0, Math.min(3, fortune | 0)),
        at: new Date().toISOString(),
      };
      await writeFile(FILE, JSON.stringify(data, null, 2));
      return { ok: true, player, fortune: data.players[player].fortune };
    }
    if (action === 'clear') {
      if (!player) throw new Error('clear needs player');
      delete data.players[player];
      await writeFile(FILE, JSON.stringify(data, null, 2));
      return { ok: true, player, cleared: true };
    }
    throw new Error(`unknown action: ${action}`);
  },
};
