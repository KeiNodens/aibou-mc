# aibou-mc

[English](README.md) | 日本語 | [AIエージェント向け](README_FOR_AGENTS.ja.md)

**モッド環境の Minecraft 1.20.1 (Forge)** のためのAIコンパニオン——チャットで
話しかけると返事をし、ついてきて、資源を集め、チャットボットの重ね着では
なく「本物の相棒プレイヤー」として世界で動く、LLM駆動のプレイヤーです。

多くの Minecraft AI プロジェクトと違い、最初からモッド環境が前提です:
アイテム・ブロック・エンティティのアドレスはすべて `modid:name` の
レジストリIDなので、`mekanism:osmium_ore` が `minecraft:rabbit` と
まったく同じに扱えます。

```
Minecraft クライアント (ボット用アカウント)
  └─ agent-mod (Forge) ── Baritone 経路探索, WebSocket サーバ :25587
         │  ws://127.0.0.1:25587
         ▼
  bridge (Node/TS) ── MCP サーバ :25589/mcp, スキルローダ, イベントバッファ,
         │           チャット→LLM ランナー
         ▼
  MCP ホスト (Codex・Muse 接続済み; 他ホストも接続可)
```

ボットは**独立した Minecraft クライアント**（2つ目のアカウント/インスタンス）で、
専用の Forge サーバに普通のプレイヤーとして参加します。主なインターフェースは
ゲーム内チャットです:「砂を5個集めて」と打つと、相棒がチャットで返事をして、
掘りに行って、戻って報告します。

## 特徴

- **チャット駆動の相棒** — ゲーム内チャットで話しかけると、返事をして動く
- **スキル層** — 47個のスキル（`follow_player`、`gather`、`cave_assist`、
  `branch_mine`、`build_schematic`、`process_in_machine`、`process_chain`、
  `craft`、クエスト支援系など）。各スキルは `skills/` のJSファイル1個で、
  ホットリロード可能なまま MCP ツールとして公開される
- **2層API** — LLM向けの高レベルスキルと、低レベルプリミティブ
  （`move`、`dig`、`look_at`、`equip`、`toss`、Baritone の
  `goto`/`mine`/`follow`）という脱出ハッチ
- **代わりにやるのではなく、一緒に遊ぶ** — 同伴/単独のプレゼンスモード:
  プレイヤーの近くでは貴重な発見を声に出して知らせ（ダイヤの鉱脈は一緒に
  掘るために残す）、作業範囲を譲り、幸運のツルハシを持っている方が掘る
  役割分担をする。一人では静かに働いて記録だけ残す
- **モッド対応** — モッドのブロック/エンティティのレジストリID、モッド鉱石の
  ドロップ集計（`mekanism:tin_ore` → `raw_tin` 実証済み）、日本語表示名での
  アイテム検索（`find_item`）、機械GUI定義143件・ステーション定義21件
- **安全モデル** — 自律レベル付きの承認ゲート: 危険な操作（サーバコマンド、
  アイテム投棄、クエスト報酬の受取など）は黙って実行せず、止まって
  チャットで確認する
- **知識を内蔵** — パック自身のデータを引ける: レジストリ、レシピ、jar内蔵
  ガイド（Patchouli/lang 抽出）、出典つきのソース由来ルールファイル
  （`knowledge` ツール）
- **現実的な能力** — ウェイポイント記憶、スクリーンショット、エンティティ
  検索、範囲スキャン、エモート、サーバコマンド（OP権限時）、`task_id`/
  状態/結果/キャンセルイベントを持つタスクライフサイクル
- **スキルのホットリロード** — `skills/` に `.mjs` を置けばツールになる

## リポジトリ構成

| パス | 内容 |
|---|---|
| `agent-mod/` | Forge 1.20.1 クライアントmod (Java)。WS API、Baritone連携、タスクシステム |
| `bridge/` | Node/TypeScript の MCP サーバ + WS クライアント + スキルローダ + チャットランナー |
| `skills/` | スキル1個につきJSモジュール1個: `{name, description, params, run(ctx, args)}` |
| `tools/mock-mod/` | ゲーム側WSのモック実装 — Minecraft なしで bridge をテストできる |
| `tools/fixtures/` | モックmod相手の bridge 通しフィクスチャ |
| `machines/` | 機械GUIのスロット定義 (`*.json`)。`process_in_machine` / `craft_plan` が読む |
| `stations/` | 汎用 `world_craft` 実行器用のステーション定義 |
| `mod-knowledge/` | ソース由来ルールファイル。mod id + バージョン + ソースコミットでキー管理 |
| `docs/` | 設計、仕様、検証記録、mod互換メモ（多くは日本語） |

## クイックスタート

必要なもの: JDK 17、Node 18+、Forge 1.20.1 の専用サーバ、ボット用の
2つ目の Minecraft インスタンス（Prism Launcher 推奨）、ボットの
インスタンスに Baritone（`baritone-api-forge`）+ agent-mod。

```bash
# 1. クライアントmodをビルド → ボットのインスタンスの mods/ へ jar を配置
cd agent-mod && ./gradlew build
cp build/libs/agentmod-*-all.jar <bot instance>/.minecraft/mods/

# 2. 専用サーバを自分の Forge 1.20.1 サーバフォルダで起動
#    (このリポジトリには含まれない; クライアントと同じmod構成 — docs/mod-compat.md 参照)
cd <your-forge-server> && ./run.bat        # Linux は run.sh

# 3. bridge を起動
cd bridge && npm install && npm run build
node dist/index.js            # http://127.0.0.1:25589/mcp で待ち受け

# 4. ボットのクライアントを起動 — サーバと bridge に自動接続する
```

エンドポイント: agent-mod WS `ws://127.0.0.1:25587`、bridge MCP
`http://127.0.0.1:25589/mcp`、ヘルスチェック `GET /healthz`。MCP ホストは
MCP URL を向けてください。トンネル等で外部に出す場合は `BRIDGE_TOKEN` を
設定すると `Authorization: Bearer <token>` が必須になります。

### bridge の環境変数

| 変数 | 既定値 | 用途 |
|---|---|---|
| `MOD_URL` | `ws://127.0.0.1:25587` | agent-mod の WebSocket |
| `MCP_PORT` | `25589` | MCP の HTTP ポート |
| `BRIDGE_TOKEN` | (未設定 = 認証なし) | 公開エンドポイント用の Bearer トークン |
| `SKILLS_DIR` | `../skills` | スキルディレクトリ |
| `RUNNER` | `on` | `off` でチャット→LLM ランナーを無効化 |
| `RUNNER_COMMAND` | `codex` | チャットのまとまりごとに起動する LLM CLI |
| `RUNNER_PROMPT_FILE` | (内蔵) | プロンプト雛形。`{chatLog}` が履歴に置換される |
| `RUNNER_TIMEOUT_MS` | `600000` | ハングした LLM 実行の強制終了 |
| `BOT_NAME` | `Rin` | ボットのプレイヤー名（自分の発言のフィルタ用） |
| `AIBOU_TOOL_PROFILE` | (ゲート有効) | `full` で全ツールを提示（開発/フィクスチャ用） |

`bridge/mcp-call.mjs` はツールを直接呼ぶ小さなCLIです:

```bash
node mcp-call.mjs get_state '{}'
node mcp-call.mjs gather '{"block":"mekanism:tin_ore","count":4}'
node mcp-call.mjs mine '{"block":"minecraft:stone","count":3,"mode":"additional"}'
```

## スキル

スキルは `skills/*.mjs` のデフォルトエクスポートオブジェクトです:

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

`ctx`: `call`（mod RPC）、`state`、`say`（チャット）、`waitTask`、`sleep`、
`signal`（キャンセル）、`journal`（永続作業記録）、`schematicPlan`、
`commission`（配置後の機械設定）。ファイルは監視されてホットリロード
されます。`reload_skills` で強制再読込も可能。

### `mine` の意味論 — 重要

`baritone.mine` / `mine` ツールは `mode` を取ります:

- `"additional"`（既定） — N個**追加で**集める
- `"ensure"` — インベントリ合計 N個を目標にする。不足分だけ掘り、
  既に足りていれば即成功する

`gather` スキルは `ensure` を使います。「砂を5個持ってきて」の自然な
読み方で、既に6個持っていれば掘らずにその旨を伝えます。

## 苦労して学んだ相棒の前提条件

- **ボットにツルハシを持たせること。** Baritone は素手では埋まった鉱石/
  石に経路を引けません（採掘コストが探索上限を超えてブラックリストの
  ループになります）。鉄のツルハシがあれば即座に動きます。
- **`obs.entity` はボット自身を含みません** — `give`/`come_here` には
  *実在の2人目のプレイヤー*が必要です。自分は対象にできません。
- **`run_command` はボットに OP が必要**で、承認ゲートの対象です。
  強力です: OP の LLM は `/give` もできれば `/stop` もできます。
  プライベートサーバでのみ使ってください。

## 安全性

- 既定では全て `127.0.0.1` にバインドされます — トンネルで出す場合のみ
  外部に出ます（その場合は `BRIDGE_TOKEN` を設定）。
- 危険な操作は自律システムでゲートされます: 黙って実行せず、チャットで
  承認（`.ok` / `.deny`）を待って止まります。承認はその操作種別を
  数分間だけ開きます。
- `run_command` はボットの権限レベルでサーバコマンドを実行します。
  管理していないサーバではボットに OP を付けないでください。
- `skills/debug_entity.mjs` は開発/デバッグ用スキルです。自前の
  デプロイを公開する場合は削除してください。

## 状態とロードマップ

マイルストーン M0–M5 は **262 mod のパック**で実機検証済み。その上の
相棒層（自律、記憶、クエスト、探索、戦闘、建築、知識）は実装済みで、
モックmod相手のフィクスチャで検証しています
（実機記録: `docs/verification-m2.5.md`、互換メモ: `docs/mod-compat.md`、
mod別対応: `docs/mod-support.md`）。

**現在動くもの**

| 領域 | 内容 |
|---|---|
| 基盤 | Forge クライアントmod + WebSocket API; プリミティブ（`move` / `dig` / `look_at` / `equip` / `toss`）; Baritone 経路探索（`goto` / `mine` / `follow`）; キャンセル/イベント付きタスクライフサイクル |
| 相棒スキル | チャット駆動ランナー; ホットリロード可能な47スキル — 相棒系（`follow_player`、`cave_assist`、`give`）、作業系（`gather`、`branch_mine`、`lumber`、`farm`、`ranch`）、工業系（`process_in_machine`、`process_chain`、`process_batch`、`stock_keeper`）、建築系（`build_schematic`、`build_site`、`light_up`）、探索系（`find_stronghold`、`dragon_fight`、`dimension_profile`） |
| クラフトと機械GUI | 意味レベルのコンテナ操作（`container.read` / `click` / `button` / `trade`）; 機械GUI定義143件（`machines/*.json`）; 機械加工ステップを含む `craft_plan`; AE2 の ME ネットワーク操作（読取/取出し/自動クラフト）; `jei_search` |
| 世界との関わり | エンティティ操作（餌やり/手懐け/毛刈り/リード/騎乗/交易）; チャージ＆リリースやスニーク変種を含む `use_item`; Curios アクセサリ装備; 通常の掘削経路での範囲採掘（実証済み）; 掘削時の自動ツール選択 |
| 入力と画面 | キー/スクロール注入と実OS入力経路（Mekanism のラジアルメニューを長押し+スクロールで操作、実証済み）; `screen` ドメインツール経由の画面操作; 汎用テキスト入力（`type_text`）; `sign_write` |
| 認識と記憶 | Jade 連携の `look_info`; アイテム/NBT 状態検査; 永続的な作業ジャーナルとチェックポイント; 名前付きウェイポイント（正本はmod側、JourneyMap へミラー）; 反射層（ダメージ/接近の割り込み＋撤退）; 設計図の取り込み（`.litematic` / `.schem`）; FTB Quests（グラフ、`quest_guide` によるフロンティア順位付け、完了ウォッチャー） |
| 自律と安全 | 承認ゲート付き自律レベル0–2; 陳腐化回収つき run/hold リース; プレゼンス連動のランナー延期（近くにいるプレイヤーが発言していない間の冷間自律開始をしない） |
| 知識 | パックのレジストリ/レシピをデータとして保持; `knowledge` ツールの背後にある jar内蔵ガイド抽出; 出典つきソース由来ルールストア（`mod-knowledge/`） |
| 復旧 | デス画面からの `respawn`; 死亡地点の記録と `recover`; インベントリ不整合の復旧（`inventory_resync`） |

**未完のもの**

| 項目 | 備考 |
|---|---|
| 長時間ソークテスト | 未実施 |
| AE2 自動クラフトの実ジョブ完了 | パケット経路は実装済み。パターン供給ネットワークでの通しジョブは未検証 |
| 層3ルールの網羅 | ソース分析は mod ごとに進行（ProjectE → AE2 → 黄昏の森 → Mekanism → RFTools）。終盤の mod 対応はこのルールの上に作る |
| コミッションプラン | 枠組みと建築後の自動実行は実装済み。同梱プランは実機GUIデータ待ち |

## 任意の連携

これらの mod はソフト依存です — なくても aibou-mc は動きますが、あると
賢くなります。

- **Jade** — ボットのクライアントに入っていると、`look_info` が素の
  レジストリIDではなく Jade の豊富なツールチップ（機械のエネルギー、
  流体、進行度）を返します。相棒が文字通りあなたと同じものを見ます。
  （コンパイル専用依存: `jade-11.13.3.jar` を `agent-mod/libs/` へ）
- **AE2 / Applied Energistics 系ターミナル** — ME 系ターミナルの画面を
  開くと `container_repo` がネットワーク全体の在庫（シリアル/id/数量/
  取出可否/クラフト可否）をダンプします。`container_repo_action` は
  AE2 ネイティブの `MEInteractionPacket` でシリアル指定の取出しを行い、
  通常の `container_click` の quick_move でプレイヤーインベントリから
  ネットワークへ預け入れできます — 通電したテストグリッドで通し検証
  済み。自動クラフト要求も同じ操作系: `AUTO_CRAFT`（数量画面）→
  `CONFIRM_AUTO_CRAFT`（計画画面）→ `GUI_ACTION` `startJob`。
- **JourneyMap** — ボットのクライアントに入っていると、`waypoint`
  スキルで保存したウェイポイントが JourneyMap の `agentmod` グループへ
  ミラーされ、ボットの地図にビーコンとして表示されます
  （journeymap-api v2、リフレクションによるソフト依存）。
- **FTB Quests** — クライアント+サーバに入っていると、`quest` ドメイン
  ツールがチャプター、タスク、報酬、開始/完了状態を読みます。SNBT の
  クエストブックは bridge 側で依存グラフに解析され、着手可能な
  クエストのフロンティアが常にプランナーに分かります。
- **Curios** — `container_open_curios` がサーバに Curios アクセサリ
  メニューを開かせ、`container_read` が各スロットに `curios_id`
  （back / jetpack / charm / ring…）のラベルを付けるので、
  `container_click` でバックパックやガジェットを他のメニューと
  同じように装備できます。（リフレクションによるソフト依存）

## ライセンス

MIT — [LICENSE](LICENSE) を参照。
