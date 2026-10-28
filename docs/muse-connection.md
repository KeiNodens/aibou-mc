# Muse (クラウド常駐エージェント) 接続手順

Codexの代わりにMetaのMuseをbot操作エージェントとして使うための接続メモ。Bearerトークン認証 + cloudflaredトンネルの手順は準備済みだが実接続は未実施 (現ホストはCodex)。ホストLLMの希望リスト (docs/autonomy.md §7-8) はゲーム外のMuseから取り込み済み。

## 前提

- MuseはMetaのクラウド上の隔離VMで動く常駐エージェント。こちらのlocalhostには届かないため、bridgeの`/mcp`を公開HTTPSで出す必要がある
- MCPサーバーの設定画面はなく、チャットで「カスタムコネクタを作って」と依頼するとMuse自身がVM上にMCPクライアントを書いて接続し、再利用可能なskillとして保存する
- メモリはMuse側の製品機能として持つため、Codex one-shot構成の「チャット履歴の丸ごと引き渡し」は不要になる見込み

## bridge側の変更 (実装済み)

`bridge/src/index.ts`にBearer認証を追加した。

- `BRIDGE_TOKEN`環境変数を設定すると、`/mcp`と`/inject`が`Authorization: Bearer <token>`を要求する
- 未設定なら従来どおり無認証で動く (ローカル開発はそのままでよい)
- `/healthz`は認証なしのまま (トンネル疎通確認用)

## 起動手順

1. bridgeをトークン付きで起動する。MuseとCodexが両方チャットに応答する二頭化を防ぐため、Muse運用時は`RUNNER=off`推奨:

```bash
cd bridge
npm run build
BRIDGE_TOKEN=<発行したトークン> RUNNER=off node dist/index.js
```

2. cloudflaredのクイックトンネルで公開する (実行ファイルは`tools/tunnel/cloudflared.exe`にダウンロード済み):

```bash
tools/tunnel/cloudflared.exe tunnel --url http://localhost:25589 --no-autoupdate
```

出力される`https://xxxx-yyyy.trycloudflare.com`が公開URL。クイックトンネルは起動のたびにURLが変わる使い捨てなので、常用するならCloudflareアカウントでnamed tunnelを作る。

3. 疎通確認:

```bash
curl https://<公開URL>/healthz
# => {"ok":true,"mod":true,"generation":...}

curl -X POST https://<公開URL>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
# => トークン無しは401

curl -X POST https://<公開URL>/mcp \
  -H "Authorization: Bearer <トークン>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
# => 200 でMCPのinitialize応答
```

## Museへの依頼文テンプレート

URLとトークンを埋めてMuseとのチャットに貼る:

```text
Minecraftを一緒にプレイするためのMCPサーバーへ接続するカスタムコネクタを作ってください。

- URL: https://<公開URL>/mcp
- 認証: Authorizationヘッダに "Bearer <トークン>"
- transport: streamable HTTP

このサーバーはゲーム内のbotプレイヤー「Rin」を操作するものです。あなた自身のゲーム内の体だと考えてください。接続できたらtools/listでツール一覧を確認し、send_chatで「繋がったよ」とゲーム内チャットに送って疎通確認してください。

使い方: get_chatでチャット履歴、get_stateで位置・体力・持ち物、gatherやfollow_playerなどのskillツールで行動します。返事や報告は必ずsend_chatでゲーム内チャットに返してください。定期的にget_chatまたはwait_eventを呼んで、新しい発言があれば日本語で応答してください。
```

## 既知の制約・TODO

- **イベントのプッシュ経路がない**: Museにはゲーム内チャットが届かない。依頼文末尾で`get_chat`/`wait_event`の定期確認を指示しているが、Museのスケジュール機能に乗るかは実際の応答次第。ダメならローカル側に通知プロセスを残す案を検討
- **Codexとの併用**: runnerを有効にするとCodexとMuseの両方が応答する。切り替えは`RUNNER`環境変数で
- **Tailscale経路の可能性**: MuseのVMがtailnetに参加でき、bridge側マシンもtailnet参加済みなら、公開なしで`http://<bridge-host>.<tailnet>.ts.net:25589/mcp`に届く代替経路になる (要疎通確認)
- **トークンの扱い**: 依頼文に平文で貼るため、遊び終わったら再発行する。リポジトリにはコミットしない
- **ツール数**: 記載当時はM4時点 (原始14+task3+baritone4+skill5+reload) だったが、その後大幅に拡張。現行は mod直通64 + スキル10 = 74ツール。最新一覧の正本は `bridge/src/mcp.ts` とmod側 `AgentWsCapabilities.all()`
- **人格**: Muse側のエージェント名を「ホストLLM」としbot名`Rin`と一致させる前提のため、ロールプレイ指示は不要。Muse自身がゲーム内のRinとして振る舞う形で依頼文を書いている
- **相棒感の追加機能 (実装済み・要クライアント再起動で有効化)**: 発言者を自動で向く `agentmod.autolook`、`emote`/`screenshot`/`waypoint.*` ツール、能動イベント (damage/death/昼夜/天候/近傍プレイヤー/pickup)。jar差し替え済みのためbotクライアントの再起動が必要
- **自発行動の依頼**: Muse側に「定期的にget_chat/wait_eventを確認し、暇なら探索や提案をする」指示を入れると放置中も動く。能動イベントが増えたので、被弾や日没への反応も書ける
