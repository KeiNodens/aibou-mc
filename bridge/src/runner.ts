import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { State } from './state.js';

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
}

// mc-mcpのシステムプロンプト (research/sources/lafkpages-mc-mcp.md) を下地に、
// この構成向けに日本語化したもの。技能ツール優先・状況確認必須・日本語返信を指示する。
const buildPrompt = (chatLog: string) => `あなたはMinecraftサーバー内のプレイヤー「Rin」を操作する自律エージェントです。あなたの唯一の対話手段はMinecraft MCPサーバー(名前: minecraft)のツールです。

## 基本方針
- ゲーム内の操作はすべてあなたが実行する。ユーザーに操作を求めてはいけない
- 新しい依頼では、まず get_chat と get_state で状況を把握してから動く
- 返事と作業結果は必ず send_chat でゲーム内チャットに返す。日本語で短く、一人称で
- 推測で行動しない。足りない情報はツールで取る
- あなたの直接の出力(テキスト応答)はゲームには届かない。必ず send_chat を呼ぶこと

## ツールの使い方
- 「[skill]」と付くツール(gather, follow_player, give, come_here, stop_all)は複合動作。依頼に合うものを優先して使う
- スキル自身が途中経過や結果をchatに報告する。あなたは受け付けた旨の一言をsend_chatで返せばよい
- 低レベル操作(goto/mine/follow/dig等)はtask_idを返す。完了は wait_event で task.done を待つ
- 「止めて」「待って」と言われたら stop_all か cancel_current を使う

## 直近のチャット履歴
${chatLog}

上記の最新の発言に応答してください。作業を求められている場合は、利用可能なツールで実行し、結果を send_chat で報告してください。`;

// chatイベントの到着を監視し、デバウンス後に codex exec を1本ずつ起動する。
// Codexはone-shotなので会話の継続性は履歴の丸ごと引き渡しで補う (design §2.2-7)。
export function startRunner(state: State, opts: RunnerOpts) {
  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  let queued = false;

  // bot自身の発言はchatイベントとして戻ってくるが、それで起動すると無限ループするので除外する
  const botName = opts.botName ?? 'Rin';
  state.onChat((c) => {
    if (c.from === botName) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), opts.debounceMs ?? 1500);
  });

  async function tick() {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        void tick();
      }
    }
  }

  async function run() {
    const chatLog = state.chat(50).map((c) => `[${c.from}] ${c.text}`).join('\n') || '(なし)';
    let prompt: string;
    if (opts.promptFile) {
      const tpl = readFileSync(opts.promptFile, 'utf8');
      prompt = tpl.includes('{chatLog}') ? tpl.replace('{chatLog}', chatLog) : `${tpl}\n\n${chatLog}`;
    } else {
      prompt = buildPrompt(chatLog);
    }
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
}
