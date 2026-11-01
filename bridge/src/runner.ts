import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { State } from './state.js';
import { Skills } from './skills.js';
import { ModClient } from './modclient.js';
import { Capabilities, match } from './directparse.js';
import { Journal } from './journal.js';
import { RunHold } from './runhold.js';
import { QuestGraph } from './questgraph.js';
import { Autonomy } from './autonomy.js';

export interface RunnerOpts {
  mcpUrl: string;
  cwd: string;
  logDir: string;
  debounceMs?: number;
  command?: string;
  /** テンプレ内の {chatLog} を履歴で置換。未指定なら内蔵プロンプトを使う */
  promptFile?: string;
  botName?: string;
  /** codex exec が応答しない場合の強制終了までの時間。default 10min */
  runTimeoutMs?: number;
  /** 直パース用 (未指定なら直パース無効) */
  skills?: Skills;
  mod?: ModClient;
  caps?: Capabilities;
  /** 記憶ジャーナル (active goalsを文脈に載せる用。未指定なら無視) */
  journal?: Journal;
  /** クエストグラフ (.goalコマンドでクエスト名解決用) */
  questGraph?: QuestGraph;
  /** Run/Hold状態の永続化ファイル (atomic snapshot + stale lease回収用) */
  runStateFile?: string;
  /** 承認ゲート (.ok/.deny、危険操作の承認要求通知用) */
  autonomy?: Autonomy;
}

// 不変部: ルールとskill catalog。文脈3層化 (凛案) で先頭固定しcacheを効かせる
const buildHead = (skillCatalog: string) => `あなたはMinecraftサーバー内のプレイヤー「Rin」を操作する自律エージェントです。あなたの唯一の対話手段はMinecraft MCPサーバー(名前: minecraft)のツールです。

## 基本方針
- ゲーム内の操作はすべてあなたが実行する。ユーザーに操作を求めてはいけない
- 新しい依頼では、まず get_chat と get_state で状況を把握してから動く
- 返事と作業結果は必ず send_chat でゲーム内チャットに返す。日本語で短く、一人称で
- 推測で行動しない。足りない情報はツールで取る
- あなたの直接の出力(テキスト応答)はゲームには届かない。必ず send_chat を呼ぶこと

## ツールの使い方
- 「[skill]」と付くツールは複合動作。依頼に合うものを優先して使う
- スキル自身が途中経過や結果をchatに報告する。あなたは受け付けた旨の一言をsend_chatで返せばよい
- 低レベル操作(goto/mine/follow/dig等)はtask_idを返す。完了は wait_event で task.done を待つ
- 「止めて」「待って」と言われたら stop_all か cancel_current を使う

## 技能一覧
${skillCatalog}`;

// 可変部の組立て: 直近N turn verbatim + 旧分の機械的digest (Quackingly実測準拠)
const VERBATIM_TURNS = 10;
const DIGEST_LINE_CHARS = 40;
const DIGEST_TOTAL_CHARS = 800;

function chatSections(chatLog: string[]): { digest: string; recent: string } {
  const recentLines = chatLog.slice(-VERBATIM_TURNS);
  const older = chatLog.slice(0, Math.max(0, chatLog.length - VERBATIM_TURNS));
  let digest = '';
  for (const line of older) {
    const short = line.length > DIGEST_LINE_CHARS ? line.slice(0, DIGEST_LINE_CHARS) + '…' : line;
    digest += short + '\n';
    if (digest.length > DIGEST_TOTAL_CHARS) {
      digest = digest.slice(-DIGEST_TOTAL_CHARS);
      break;
    }
  }
  return {
    digest: digest || '(なし)',
    recent: recentLines.join('\n') || '(なし)',
  };
}

// chatイベントの到着を監視し、デバウンス後に codex exec を1本ずつ起動する。
// Codexはone-shotなので会話の継続性は履歴の丸ごと引き渡しで補う (design §2.2-7)。
// 「来て」「止まれ」等の明示コマンドは直パースでLLM非経由の即実行に振り分ける。
export function startRunner(state: State, opts: RunnerOpts): RunHold {
  let timer: NodeJS.Timeout | null = null;
  let worldCache = { at: 0, text: '(世界情報なし)' };

  // 同伴ゲート用の状態 (D36): 人間の最終発言・前回ラン終了・
  // 最終の見送り記録
  let lastHumanChatAt = 0;
  let lastRunEndedAt = 0;
  let lastDeferredAt = 0;

  // 実行管理: codex runの発火は全てpump()を通す (1本のみ並行)
  const rh = new RunHold(() => runGated(), () => opts.skills?.runningName() ?? null,
    { persistFile: opts.runStateFile });

  // 死亡→dead hold、respawnedで解除 (反射イベント経路)
  state.onEvent((e) => {
    if (e.name === 'death') {
      rh.hold('dead', 'bot died');
      // 死亡地点を記録 (D30 recover 用)。イベントに座標が無い場合は記録のみ
      const d = (e.data ?? {}) as Record<string, unknown>;
      const pos = (d.pos ?? (typeof d.x === 'number'
        ? { x: d.x, y: d.y, z: d.z } : undefined)) as
        { x: number; y: number; z: number } | undefined;
      opts.journal?.append('deathpoint', {
        at: new Date().toISOString(),
        ...(pos ? { pos } : {}),
        ...(d.cause ? { cause: d.cause } : {}),
      });
    }
    if (e.name === 'reflex') {
      const t = (e.data as Record<string, unknown>)?.type;
      if (t === 'respawned') rh.release('dead');
    }
    // blocked: task.doneの連続失敗はpump側へ進行不能として伝える材料
    if (e.name === 'task.done') {
      const d = e.data as Record<string, unknown>;
      if (d?.state === 'failed' && d?.error_code === 'POSTCONDITION') {
        rh.hold('blocked', 'postcondition failed; replan needed');
      }
    }
    // 承認要求: 危険操作がgateに掛かった → chatで通知
    if (e.name === 'approval') {
      const d = e.data as Record<string, unknown>;
      void opts.mod?.call('chat.send', {
        text: `${d.method} は承認が必要だよ。OKなら .ok ${d.id}、やめなら .deny ${d.id}`,
      }).catch(() => {});
    }
  });

  // bot自身の発言はchatイベントとして戻ってくるが、それで起動すると無限ループするので除外する
  const botName = opts.botName ?? 'Rin';

  // 機械指示プレフィックス「.」: LLMを通さない確定的コマンド。消費したらtrue
  const handleDot = (c: { from: string; text: string }): boolean => {
    const t = c.text.trim();
    if (!t.startsWith('.')) return false;
    const sp = t.indexOf(' ');
    const cmd = (sp < 0 ? t.slice(1) : t.slice(1, sp)).toLowerCase();
    const arg = sp < 0 ? '' : t.slice(sp + 1).trim();
    const say = (text: string) =>
      void opts.mod?.call('chat.send', { text }).catch(() => {});
    switch (cmd) {
      case 'goal':
        if (!arg) {
          const active = opts.journal?.goalGet() ?? [];
          say(active.length
            ? '目標: ' + active.map((g) => g.text).join(' / ')
            : '目標はまだない (.goal <内容> で設定)');
        } else {
          const q = opts.questGraph?.find(arg);
          const text = q ? `quest:${q.id} ${q.title}` : arg;
          opts.journal?.goalSet(text);
          say(`目標にしたよ: ${text}`);
        }
        return true;
      case 'goals':
        {
          const active = opts.journal?.goalGet() ?? [];
          say(active.length
            ? '目標: ' + active.map((g) => `${g.id}=${g.text}`).join(' / ')
            : '目標なし');
        }
        return true;
      case 'ok':
      case 'approve':
        {
          const r = opts.autonomy?.approve(arg || undefined);
          say(r?.approved
            ? `${r.approved.method} を承認したよ (5分有効)`
            : '承認待ちはないよ');
        }
        return true;
      case 'deny':
        {
          const r = opts.autonomy?.deny(arg || undefined);
          say(r?.denied
            ? `${r.denied.method} をやめさせたよ`
            : '承認待ちはないよ');
        }
        return true;
      default:
        say(`不明なコマンド: .${cmd}`);
        return true;
    }
  };

  state.onChat((c) => {
    if (c.from === botName) return;
    lastHumanChatAt = Date.now();
    if (handleDot(c)) return;
    // 直パース: 明示コマンドはskill直接実行 (UNSUPPORTED等で動かなければ学習して以後LLMへ)
    const dm = opts.skills ? match(c.text, c.from) : null;
    if (dm && (opts.caps?.ok(dm.capKey) ?? true)) {
      try {
        const r = opts.skills!.run(dm.skill, dm.args);
        r.done?.then((out) => {
          if (!out) return;
          if (!out.ok && /UNSUPPORTED|unknown skill/i.test(out.error ?? '')) {
            opts.caps?.learn(dm.capKey, false);
          } else {
            opts.caps?.learn(dm.capKey, true);
          }
        });
        // 「止まれ」系はowner_stopを立てる (次の指示までLLMを動かさない)
        if (dm.skill === 'stop_all') rh.hold('owner_stop', 'explicit stop command');
        return;
      } catch {
        // BUSY等で直接起動できない場合はLLM経路へフォールスルー
      }
    }
    // 新しい指示 = 人間の介入。stop/failed/blockedを解除してrunを要求
    rh.release('owner_stop');
    rh.release('failed');
    rh.release('blocked');
    rh.requestRun();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rh.pump(), opts.debounceMs ?? 1500);
  });

  // 半不変部: 世界文脈1行。obs.stateを~5秒キャッシュ
  async function worldCtx(): Promise<string> {
    if (!opts.mod) return worldCache.text;
    if (Date.now() - worldCache.at < 5000) return worldCache.text;
    try {
      const s = (await opts.mod.call('obs.state')) as Record<string, any>;
      const p = s.pos ?? {};
      const t = s.time ?? {};
      worldCache = {
        at: Date.now(),
        text: `pos(${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}) ${s.dimension ?? '?'} ${t.is_day ? '昼' : '夜'} hp${s.health} 腹${s.hunger}`,
      };
      // active goalsを世界文脈に並記 (半不変部)
      const goals = opts.journal?.goalGet() ?? [];
      if (goals.length) {
        worldCache.text += ' goals[' +
          goals.map(g => `${g.id}:${g.text}`).join('; ') + ']';
      }
    } catch {
      worldCache = { at: Date.now(), text: '(世界情報なし)' };
    }
    return worldCache.text;
  }

  // 同伴マナー (D36 改訂): 「新規の自律開始」だけを見送る。
  // 見送るのは全部そろった時だけ: プレイヤーが 64 以内にいる /
  // 実行中のスキルが無い / 前回ラン終了から 10 分以上 (連鎖が冷えて
  // いる) / 人間の発言から 30 分以上。長いタスクの継続ランは連鎖が
  // 温かいので止まらない。見送りの journal 記録は 5 分に 1 回まで。
  async function runGated() {
    if (opts.mod
      && !opts.skills?.runningName()
      && Date.now() - lastRunEndedAt > 10 * 60_000
      && Date.now() - lastHumanChatAt > 30 * 60_000) {
      try {
        const r = (await opts.mod.call('obs.entity', {
          name: 'minecraft:player', radius: 64,
        })) as { entities?: Array<{ name?: string }> };
        const others = (r?.entities ?? []).filter((e) => e.name !== botName);
        if (others.length) {
          if (Date.now() - lastDeferredAt > 5 * 60_000) {
            lastDeferredAt = Date.now();
            opts.journal?.append('runner_deferred', {
              at: new Date().toISOString(),
              near: others.map((e) => e.name ?? '?'),
            });
          }
          return;
        }
      } catch { /* 観測できなければ通常通り開始する */ }
    }
    try {
      await run();
    } finally {
      lastRunEndedAt = Date.now();
    }
  }

  async function run() {
    const chatLog = state
      .chat(50)
      .map((c) => `[${c.from}] ${c.text}`);
    const { digest, recent } = chatSections(chatLog);
    const catalog = (opts.skills?.list() ?? [])
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
    const world = await worldCtx();
    const boundedLog = `## これまでの会話 (古い分・ダイジェスト)\n${digest}\n\n## 直近の会話\n${recent}`;
    // suffix repair: 前回失敗した作業は、完了済みstepを再実行せず失敗step以降だけ組み直す
    const failed = opts.journal?.failedWorks(2) ?? [];
    const resumeNote = failed.length
      ? '\n\n## 前回失敗した作業 (再開時は完了済みstepを繰り返さず、失敗した所から先だけ進めること)\n'
        + failed.map(f =>
          `- ${f.work} skill=${f.skill ?? '?'} error=${f.error ?? '?'}`
          + (f.doneSteps.length ? ` 完了済みstep: ${f.doneSteps.join(' → ')}` : '')).join('\n')
      : '';

    let prompt: string;
    if (opts.promptFile) {
      const tpl = readFileSync(opts.promptFile, 'utf8');
      prompt = tpl.includes('{chatLog}')
        ? tpl.replace('{chatLog}', boundedLog).replace('{worldCtx}', world)
        : `${tpl}\n\n${boundedLog}`;
      prompt += resumeNote;
    } else {
      prompt = `${buildHead(catalog)}\n\n## 世界の状況\n${world}\n\n${boundedLog}${resumeNote}\n\n上記の最新の発言に応答してください。作業を求められている場合は、利用可能なツールで実行し、結果を send_chat で報告してください。`;
    }
    console.log(`[runner] prompt ${prompt.length} chars`);
    mkdirSync(opts.logDir, { recursive: true });
    const outFile = path.join(opts.logDir, `codex-last-${Date.now()}.md`);
    const args = [
      'exec',
      '--ignore-user-config',
      '--ephemeral',
      '--skip-git-repo-check',
      // MCPツール呼出を自動承認させる（-s read-only との併用は不可）
      '--approve-for-me',
      '-C',
      opts.cwd,
      '-c',
      `mcp_servers.minecraft.url="${opts.mcpUrl}"`,
      '-o',
      outFile,
      '-',
    ];
    console.log('[runner] codex exec 起動');
    await new Promise<void>((resolve) => {
      const p = spawn(opts.command ?? 'codex', args, { shell: true });
      let out = '';
      const killer = setTimeout(() => {
        console.log('[runner] codex timeout; killing');
        p.kill('SIGKILL');
      }, opts.runTimeoutMs ?? 600_000);
      p.stdout?.on('data', (d) => {
        out += d;
      });
      p.stderr?.on('data', (d) => process.stderr.write(d));
      p.stdin?.write(prompt);
      p.stdin?.end();
      p.on('close', (code) => {
        clearTimeout(killer);
        console.log(`[runner] codex 終了 code=${code} (last message: ${outFile})`);
        const tail = out.trim().slice(-600);
        if (tail) console.log('[runner] stdout tail:', tail);
        resolve();
      });
      p.on('error', (e) => {
        clearTimeout(killer);
        console.log('[runner] spawn error:', e.message);
        resolve();
      });
    });
  }

  return rh;
}
