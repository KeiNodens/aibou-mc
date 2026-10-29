# aibou-mc

[English](README.md) | 日本語

**modded Minecraft 1.20.1 (Forge)** 向けのAI相棒 — チャットで話しかけ、一緒に
ついてきて、資源を集め、チャットbotのオーバーレイではなく本物の相棒として
世界の中で行動する、LLM駆動のプレイヤーです。

多くのMinecraft AIプロジェクトと違い、本プロジェクトは**最初からmodded
環境を対象**にしています。アイテム・ブロック・エンティティはすべて
`modid:name` のregistry IDで指定するため、`mekanism:osmium_ore` が
`minecraft:rabbit` とまったく同じように扱えます。

```
Minecraftクライアント (botアカウント)
  └─ agent-mod (Forge) ── Baritone経路探索, WebSocketサーバー :25587
         │  ws://127.0.0.1:25587
         ▼
  bridge (Node/TS) ── MCPサーバー :25589/mcp, スキルローダー, イベント
         │           バッファ, chat→LLM runner
         ▼
  MCPホスト (Codexで検証済み。Muse等他ホストも接続可能)
```

botは**独立したMinecraftクライアント**(第2アカウント/インスタンス)で、
専用Forgeサーバーに普通のプレイヤーとして参加します。ゲーム内チャットが
主なインターフェースです。「砂を5個集めて」と打てば、相棒がチャットで
了解し、採掘に行き、終わったらチャットで報告します。

## 機能

- **チャット駆動の相棒** — ゲーム内チャットで話しかけると、返答し行動する
- **技能層 (skills)** — `follow_player`, `gather`, `come_here`, `give`,
  `craft`, `craft_plan`, `process_in_machine`, `waypoint`, `stop_all`。
  各技能は `skills/` 内のホットリロード対応JSファイル1つで、
  MCPツールとして公開される
- **2層API** — LLM向けの高レベル技能と、逃げ道としての低レベル原始操作
  (`move`, `dig`, `look_at`, `equip`, `toss`, Baritone `goto`/`mine`/`follow`)
- **mod対応** — mod追加ブロック/エンティティをregistry IDで指定。mod鉱石の
  ドロップ数カウント (`mekanism:tin_ore` → `raw_tin` 実証済み)、日本語表示名
  でのアイテム検索 (`find_item`)
- **実用機能** — waypoint記憶、スクリーンショット、エンティティ検索、
  エリアスキャン、エモート、サーバーコマンド (要op)、`task_id`・status・
  result・cancelイベントを備えたタスクライフサイクル
- **ホットリロード技能** — `.mjs` ファイルを `skills/` に置くだけでツール化

## リポジトリ構成

| パス | 内容 |
|---|---|
| `agent-mod/` | Forge 1.20.1クライアントmod (Java)。WS API、Baritone連携、タスクシステム |
| `bridge/` | Node/TypeScriptのMCPサーバー + WSクライアント + スキルローダー + チャットrunner |
| `skills/` | 1技能=1JSモジュール: `{name, description, params, run(ctx, args)}` |
| `tools/mock-mod/` | ゲーム側のモックWS実装。Minecraftなしでbridgeをテストできる |
| `machines/` | 機械GUIのslot定義 (`<menu_id>.json`)。`process_in_machine` / `craft_plan` が参照 |
| `docs/` | 設計・仕様・検証ログ・mod互換メモ (日本語) |

## クイックスタート

必要なもの: JDK 17、Node 18+、Forge 1.20.1専用サーバー、bot用の第2
Minecraftインスタンス (Prism Launcher推奨)、botインスタンスに入れた
Baritone (`baritone-api-forge`) とagent-mod。

```bash
# 1. クライアントmodをビルド → botインスタンスの mods/ にjarを配置
cd agent-mod && ./gradlew build
cp build/libs/agentmod-*-all.jar <bot instance>/.minecraft/mods/

# 2. 自分のForge 1.20.1サーバーのフォルダで専用サーバーを起動
#    (server/はこのリポジトリに含まれない。modセットはクライアントと同一 — docs/mod-compat.md 参照)
cd <your-forge-server> && ./run.bat        # Linuxでは run.sh

# 3. bridgeを起動
cd bridge && npm install && npm run build
node dist/index.js            # http://127.0.0.1:25589/mcp で待受

# 4. botクライアントを起動 — サーバーとbridgeへ自動接続する
```

エンドポイント: agent-mod WS `ws://127.0.0.1:25587`、bridge MCP
`http://127.0.0.1:25589/mcp`、ヘルスチェック `GET /healthz`。MCPホスト
(Codexの設定など) はこのMCP URLを指すように設定します。トンネル経由で
公開する場合は `BRIDGE_TOKEN` を設定し、`Authorization: Bearer <token>`
を必須にしてください。

### bridgeの環境変数

| 変数 | デフォルト | 用途 |
|---|---|---|
| `MOD_URL` | `ws://127.0.0.1:25587` | agent-mod WebSocket |
| `MCP_PORT` | `25589` | MCP HTTPポート |
| `BRIDGE_TOKEN` | (未設定=無認証) | 公開エンドポイントのBearerトークン |
| `SKILLS_DIR` | `../skills` | 技能ディレクトリ |
| `RUNNER` | `on` | `off` でchat→LLM runnerを無効化 |
| `RUNNER_COMMAND` | `codex` | チャット単位で起動するLLM CLI |
| `RUNNER_PROMPT_FILE` | (組み込み) | プロンプトテンプレート。`{chatLog}` が履歴に置換される |
| `RUNNER_TIMEOUT_MS` | `600000` | ハングしたLLM実行をkill |
| `BOT_NAME` | `Rin` | botのプレイヤー名 (自分の発言のフィルタ用) |

`bridge/mcp-call.mjs` はツールを直接呼ぶ小さなCLIです:

```bash
node mcp-call.mjs get_state '{}'
node mcp-call.mjs gather '{"block":"mekanism:tin_ore","count":4}'
node mcp-call.mjs mine '{"block":"minecraft:stone","count":3,"mode":"additional"}'
```

## 技能 (skills)

技能は `skills/*.mjs` のdefault-exportされたオブジェクトです:

```js
export default {
  name: 'gather',
  description: 'Gather blocks via Baritone mine until the count is collected.',
  params: { block: { type: 'string', required: true },
            count: { type: 'integer' } },
  async run(ctx, { block, count = 1 }) {
    await ctx.say(`${block} を${count}個集めてくるね`);
    const r = await ctx.call('baritone.mine', { block, count, mode: 'ensure' });
    const d = await ctx.waitTask(r.task_id, 300_000);
    // ...チャットで報告し、結果オブジェクトを返す
  },
};
```

`ctx`: `call` (mod RPC)、`state`、`say` (chat)、`waitTask`、`sleep`、
`signal` (キャンセル)。ファイルは監視・ホットリロードされ、
`reload_skills` で強制リロードもできます。

### `mine` のセマンティクス — 重要

`baritone.mine` / `mine` ツールは `mode` を取ります:

- `"additional"` (デフォルト) — **あとN個**追加で集める
- `"ensure"` — インベントリの**合計をN個**にする。不足分だけ掘り、
  すでに所持していれば即座に成功

`gather` 技能は `ensure` を使います。「砂を5個取ってきて」の自然な解釈で、
すでに6個持っていれば掘らずにそう報告します。

## 実運用で分かった前提条件

- **botにツルハシを持たせること。** Baritoneは素手では囲まれた鉱石や石へ
  経路探索できません (採掘コストが探索上限を超えてブラックリスト無限ループ)。
  鉄ツルハシがあれば即座に動きます。
- **`obs.entity` はbot自身を含まない** — `give`/`come_here` には*本物の第2
  プレイヤー*が必要で、自分自身は対象にできません。
- **`run_command` はbotのopが必要。** LLMにopを与えると `/give` も `/stop`
  も打てます。自分の管理するプライベートサーバーでのみ使ってください。

## 安全に関する注意

- すべて `127.0.0.1` にバインドされます。トンネルしない限り外部には
  公開されません (公開する場合は `BRIDGE_TOKEN` を設定)。
- `run_command` はbotの権限レベルでサーバーコマンドを実行します。
  管理外のサーバーではbotをopにしないでください。
- `skills/debug_entity.mjs` は開発・デバッグ用技能です。不要なら自分の
  デプロイでは削除してください。

## 現状とロードマップ

マイルストーン M0〜M5 は **262 mod パック**で実機検証済み（検証ログ:
`docs/verification-m2.5.md`、mod 互換性: `docs/mod-compat.md`、
mod ごとの対応詳細: `docs/mod-support.md`）。

**現在できること**

| 領域 | できること |
|---|---|
| 基盤 | Forge クライアント mod + WebSocket API; プリミティブ（`move` / `dig` / `look_at` / `equip` / `toss`）; Baritone による移動（`goto` / `mine` / `follow`）; キャンセル・イベント付きタスク管理 |
| コンパニオンスキル | チャット駆動ランナー; ホットリロード可能なスキル群（`follow_player`、`gather`、`come_here`、`give`、`craft`、`waypoint`、`stop_all`、…） |
| クラフト・マシン GUI | 意味レベルのコンテナ操作（`container.read` / `click` / `button` / `trade`）; マシン GUI 定義 112 件（`machines/*.json`）; 機械加工ステップを含む `craft_plan`; AE2 の ME ネットワーク操作（読み取り・取り出し・自動クラフト）; `jei_search` |
| ワールド操作 | エンティティ操作（餌やり / 手懐け / 毛刈り / リード / 乗馬 / 取引）; 溜め解放・スニーク対応の `use_item`; Curios アクセサリ装備; 通常の掘削経路での範囲掘削（検証済み）; 掘削時の自動ツール選択 |
| 入力・画面操作 | キー / スクロール注入 + 実 OS 入力経路（Mekanism のラジアルメニューを長押し+スクロールで操作、検証済み）; 画面操作（`screen_read` / `click` / `close`）; 汎用テキスト入力（`type_text`）; `sign_write` |
| 認識・記憶 | Jade 連携の `look_info`; アイテム / NBT 状態の検査（`item_info`、`get_state`）; 永続ワークジャーナルとチェックポイント; 名前付きウェイポイント（JourneyMap へも反映）; 反射レイヤ（被ダメージ・接近割り込み + 撤退）; 設計図の取り込み（`.litematic` / `.schem`）; FTB Quests 操作（一覧 / 詳細 / 報酬受け取り） |
| 復旧 | 死亡画面からの `respawn`; インベントリ不整合の復旧（`inventory_resync`） |

**未完・これから**

| 項目 | 備考 |
|---|---|
| `give` / `come_here` の正常系テスト | 実プレイヤーの2人目が必要 |
| Muse ホスト接続 | 手順は `docs/muse-connection.md` に記載済み; 接続自体はまだ |
| 長時間の連続稼働テスト | 未実施 |

## ライセンス

MIT — [LICENSE](LICENSE) を参照。
