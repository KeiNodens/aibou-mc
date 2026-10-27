# Minecraft Together 設計書

- バージョン: 0.2 (review-2026-10-27.md 指摘反映)
- 作成日: 2026-10-27
- 対応仕様: docs/spec.md
- 決定記録: docs/decisions.md

## 1. 全体構成

```
ホストLLM (Muse ※接続方式が判明次第) / Codex (MVP検証ホスト)
    │  MCP stdio (主) / Streamable HTTP (副)
    ▼
bridge  [Node.js + TypeScript]
  - MCPサーバー (@modelcontextprotocol/sdk)
  - WebSocketクライアント → agent-mod
  - 技能層 (skills/ のJSモジュール)
  - 状態のテキスト化・失敗検知・タスク管理
  - runner: chatイベント検知 → 外部ホスト起動 (codex exec)
    │  WebSocket / JSON-RPC風 (localhost)
    ▼
agent-mod  [Forge 1.20.1 クライアントmod / Java 17]
  - WebSocketサーバー (JSON-RPC風)
  - Baritone API による移動・採掘・追従
  - バニラクライアント機能のプログラム駆動
    (攻撃・使用・インベントリ・クラフト・チャット)
    │  Minecraftプロトコル (実プレイヤーとして)
    ▼
専用Forgeサーバー  [このPC / Forge 47.4.28 / online-mode=false]
    ▲
あなたのクライアント  [Prism「1.20.1」インスタンス / 262mod]
```

要点は「エージェントの実体を、プロトコル偽装ではなく本物のForgeクライアントに持たせる」こと。mod環境との互換性 (レジストリ・modアイテム・カスタムペイロード) を完全に回避できる唯一の方式であり、Mineflayerフォーク案のL1〜L3相当の作業が消える。

## 2. コンポーネント設計

### 2.1 agent-mod (Forge 1.20.1 クライアントmod)

第2Minecraftクライアントインスタンス内で動作し、外部からの操作要求を受け付けて実行し、観測データとイベントを返す。

**技術基盤**: Java 17 / ForgeGradle 6 / Forge 47.4.28 MDK。依存として `baritone-api-forge-1.10.3.jar` を `libs/` に配置しローカルjar依存で参照する (BaritoneはMaven非公開のため)。WebSocketはJava-WebSocket等の軽量ライブラリを同梱し、localhostの設定ポートのみlistenする。

**提供する機能群**

| 機能群 | 内容 | 実装経路 |
|---|---|---|
| 移動 | goto座標・follow(プレイヤー)・mine(ブロック種別)・explore・停止 | Baritone API (CustomGoalProcess / MineProcess / FollowProcess / ExploreProcess) |
| 戦闘 | entity指定攻撃・索敵範囲の自動反応 | mc.player.attack + 独自ループ |
| ブロック操作 | 指定座標の掘削・設置・情報取得 | 通常の入力と同じ経路: startDestroyBlock / continueDestroyBlock (毎tick) / stopDestroyBlock + ServerboundPlayerActionPacket。設置は useItemOn。成功はサーバー同期後の状態で判定 |
| アイテム操作 | 装備・投棄・コンテナ/インベントリのslotクリック | gameMode.handleInventoryMouseClick |
| クラフト | レシピ帳ベースの自動クラフト | ServerboundPlaceRecipePacket + slotクリック。失敗時は手動grid配置へ退行 |
| インタラクト | ブロック/entityの「使う」・GUIの読み取り/クリック/閉じる | useItemOn / interact / AbstractContainerScreen走査 |
| チャット | 送信・受信イベント | connection.sendChat / ClientChatReceivedEvent |
| 観測 | プレイヤー状態・周囲ブロック走査・entity走査・バイオーム | Minecraft.getInstance() / level API |
| イベント | chat/damage/death/goal結果/inventory差分/player join leave | ForgeイベントをWSイベントへ変換 |

**設計上の性質**

- modは「原始操作と観測」のみを担い、複合動作 (採集して戻る等) の編成はbridgeに寄せる。mod側を薄く保つことで、案1への退路移行時に書き換える範囲を最小化する。
- 長時間動作はタスク化し、cancel要求でBaritoneの現在goalを中断できる。
- 自動再接続: サーバー切断を検知したら設定秒数後に再接続を試行する (configでON/OFF)。

**スレッド境界**: WSの受信コールバックからゲームオブジェクトに直接触れない。要求は `Minecraft#execute` でメインスレッドに引き渡し、クライアントtick内で処理する。観測の採取もメインスレッドで行ってからWSスレッドへ返す。掘削・戦闘のような継続操作はtickごとに1歩進めるタスクとして実装する。

**タスク管理**: modは受理した操作をtask_id付きタスクとして管理する。状態機械は queued → running → (succeeded | failed) および cancelling → cancelled。結果は終了後も一定期間 (目安: 10分または直近128件) 保持し、bridgeから照会できる。クライアント起動・サーバー接続ごとにgeneration idを振り、再接続後に旧generationのタスクへの照会には「結果不明」を明示する。停止要求は受理 (cancelling) と完了 (cancelled) を分けて返す。

### 2.2 bridge (Node.js + TypeScript)

MCPサーバーとして振る舞い、ホストLLM (MCPクライアント) にツールを公開する。agent-modのWSにクライアントとして接続し、応答対応・イベント購読・再接続を担う。

**層構成**

1. **MCP面**: `@modelcontextprotocol/sdk` によるstdioサーバー。副経路としてStreamable HTTPを用意 (将来の非デスクトップクライアント向け)。ツール定義は §3 の構成。
2. **技能層**: `skills/` ディレクトリのJSモジュール。1技能=1ファイルで `export default { name, description, params, run(ctx, args) }` 形式。ctxはmod RPC・観測・チャット送信を束ねたオブジェクト。ファイル監視でホットリロードし、実行中技能はcancel tokenで中断できる。
3. **観測テキスト化**: modの生観測をLLMが扱いやすい要約に整形する (DEPSのdescriptor相当)。インベントリは「item名×個数」のみ、周囲は「ブロック種別×個数」と「entity種別×個数+最近傍」に圧縮し、plan関係の情報を優先する。
4. **失敗検知**: 技能実行にタイムアウトと停滞検知 (一定時間ブロック/entity/位置が変化しない) を持たせ、失敗時は「現在状態の要約 + 直前操作 + エラー/停滞理由」を構造化してLLMに返す。再計画はLLM側の仕事とする (DEPS方式の分担)。
5. **安全フック**: `dangerous` フラグ付き操作 (範囲掘削・TNT/溶岩使用等) は `confirm: true` 引数を要求し、未指定なら確認要求を返す。
6. **起動連携**: 設定でPrism Launcher CLI (`prismlauncher --launch <instance>`) を呼び、botインスタンスの起動→WS接続確立を一連で行える。
7. **チャット起動経路 (runner)**: ゲーム内発話をホストの推論開始に繋ぐ経路。ホスト側のイベント連携、`wait_event` 長ポーリングツール、bridge内runnerによる外部起動の3候補から、実ホストでの検証で選ぶ。MVPはbridge内runnerを本線とし、新規chatイベントの到達で `codex exec` を起動して会話ログと状態要約、指示プロンプトを渡す構成を先に検証する。Codexはone-shot実行のため、対話の継続性はログ全体の引き渡しで補う。Museへの接続は方式が判明次第、runnerの起動先を差し替える形で後続対応とする。

### 2.3 プロトコル (mod ⇄ bridge)

WebSocket上のJSON-RPC風。bridgeがクライアント、modがサーバー。

```jsonc
// 要求
{"type":"req","id":12,"method":"move.goto","params":{"x":100,"y":64,"z":-30}}
// 応答 (成功)
{"type":"res","id":12,"ok":true,"result":{"pathfinding":true}}
// 応答 (失敗)
{"type":"res","id":12,"ok":false,"error":{"code":"UNREACHABLE","message":"no path"}}
// イベント (mod→bridge)
{"type":"evt","name":"chat","data":{"from":"Player","text":"来て"}}
```

```jsonc
// 長時間操作の受理 (task_idを返す)
{"type":"res","id":12,"ok":true,"result":{"task_id":"g3-t41"}}
// 状態照会・結果取得
{"type":"req","id":13,"method":"task.status","params":{"task_id":"g3-t41"}}
{"type":"res","id":13,"ok":true,"result":{"state":"running","generation":3,"progress":0.4}}
{"type":"req","id":14,"method":"task.result","params":{"task_id":"g3-t41"}}
// 停止要求 (受理)。停止完了は evt.task.done(task_id, state=cancelled) で別送
{"type":"req","id":15,"method":"task.cancel","params":{"task_id":"g3-t41"}}
{"type":"res","id":15,"ok":true,"result":{"state":"cancelling"}}
// 完了・失敗・停止完了の通知
{"type":"evt","name":"task.done","data":{"task_id":"g3-t41","state":"succeeded"}}
```

設計原則: method名は `カテゴリ.動詞` で統一する。非同期の長い操作は受理応答にtask_idを含め、完了を `evt.task.done` で別送する。イベントはバッファしてbridge接続時に最新のみ補填する。厳密な再送はしないが、タスクの状態と結果はmod側で一時保持するため、接続断でも `task.status` / `task.result` の照会で復元できる。接続・起動ごとのgeneration idをhello応答と全task応答に含め、旧generationへの照会は `STALE_TASK` (結果不明) を返す。

操作の意味互換のため、methodは画面座標ではなく意味で定義する (例: `container.click{menu_id, slot}`)。各実装は `meta.capabilities` で対応method一覧を返し、未対応の呼出は `UNSUPPORTED` エラーとする。これは案1への退路でも同じ契約を守るための規約である。

### 2.4 スキルライブラリ (Voyager式・拡張枠)

skills/配下のJSモジュールが技能そのもの。MVPは手書き技能のみ。拡張として、LLMが生成したコードをファイル化→実行→自己検証成功で登録、というVoyager式の蓄積を可能にする構造 (description/usage/verifyフックをモジュール形式に持たせる)。スキル選択をembedding検索にするのはさらに後。

## 3. MCPツール一覧

### 3.1 高レベル技能ツール (bridge・技能層)

| ツール | 動作 | 主要引数 |
|---|---|---|
| `follow_player` | 指定プレイヤーに追従 | name, distance |
| `goto` | 座標へ移動 | x, y, z |
| `gather` | ブロック種別を探して採集し戻る | block, count |
| `craft` | アイテムをクラフト | item, count |
| `give_item` | プレイヤーへアイテムを渡す | item, count, to |
| `deposit_items` | 最寄チェストへ格納 | item?, all? |
| `attack_entity` | 指定entityを攻撃 | type or id |
| `guard` | 範囲の敵性mobを排除 | radius |
| `scan_area` | 周囲のブロック/entity要約を取得 | radius |
| `status_report` | 状態を自然文で報告 | - |

### 3.2 低レベル原始ツール (mod直通・逃生路)

`move` `look_at` `jump` `dig` `place` `use_item` `equip` `toss` `click_slot` `gui_read` `gui_click` `gui_close` `attack` `interact` `raw_chat`

実装済みの追加: `emote` (swing/jump/crouch_dance) `screenshot` `find_item` (表示名検索) `waypoint_save` `waypoint_list` `waypoint_delete`。`goto`はwaypoint名でも目的地指定できる。相棒感のための身体表現・視覚共有・名前付き場所を担う。

### 3.3 観測・管理ツール

`get_state` (位置/体力/空腹/次元/バイオーム/時刻) `get_chat` (差分) `wait_event` (長ポーリング、timeout秒でchat/damage/task.done等の差分を返す) `find_blocks` `find_entities` `get_inventory` (要約 or 詳細) `task_status` `task_result` `task_cancel` `bot_status` `cancel_current` `reload_skills`

イベント語彙: `chat` `task.done` `skill.done` `damage` `death` `time` (昼夜遷移) `weather` `player.nearby` (appear/vanish) `pickup` (インベントリ増加)。mod側で能動イベントを検知しevtとして流す。プレイヤー発言時にbotが話者を自動で向く (agentmod.autolook)。

## 4. 観測データ形式

```jsonc
// modのobs.state応答 (bridgeがLLM向けに圧縮して返す)
{
  "pos": {"x":103.5,"y":64.0,"z":-30.2},
  "health": 18.0, "hunger": 17,
  "dimension": "minecraft:overworld", "biome": "minecraft:forest",
  "time": {"day": 3, "ticks": 13450, "is_day": true},
  "inventory_summary": {"minecraft:oak_log": 24, "mekanism:osmium_ingot": 3},
  "inventory_detail": [
    {"slot": 0, "id": "minecraft:diamond_pickaxe", "count": 1,
     "attrs": {"damage": 210, "enchanted": true, "has_nbt": true}}
  ],
  "container": {"menu_id": "player_inventory", "generation": 17},
  "nearby": {
    "blocks": {"minecraft:oak_log": 41, "mekanism:osmium_ore": 2},
    "entities": {"minecraft:zombie": 1, "minecraft:villager": 3},
    "nearest": {"minecraft:zombie": {"dist": 7.2}}
  },
  "events_since_last": ["chat:Player:来て", "damage:3.0"]
}
```

modアイテム・ブロックは全て `modid:name` 形式で返る (FR-10)。

インベントリは要約 (種別→合計個数) と詳細 (slot→{id, count, attrs}) の2形式。attrsは耐久値・エンチャント有無・NBT有無・充電量等、スタック識別に必要な属性。`click_slot` / `toss` / `give_item` 等の対象指定は slot と `container.generation` を必須引数とし、mod側で世代が一致しない操作は `STALE_STATE` で拒否する。高レベル技能がスタックを選ぶ規則は: 装備中・使用中のスタックを渡し対象から除外する。同種別に属性違いが複数あるときは、ユーザー指定がなければ耐久の低い・NBTを持たない側を優先する。捨てる・渡す等の不可逆操作で判断が曖昧な場合は `confirm` を要求する。

## 5. 失敗・スタック処理

```
技能実行 → [modエラー | bridgeタイムアウト | bridge停滞検知]
        → task.state=failed に遷移し、失敗オブジェクトを返却:
          {"task_id":"g3-t41","state":"failed","reason":"STUCK",
           "detail":"no movement for 20s",
           "state_summary":{...現在状態要約...},"last_action":"move.goto"}
        → LLMがdescribeを読んで自己説明・再計画 (DEPS方式)
```

cancelは常時受け付ける。受理応答は state=cancelling、停止完了は evt.task.done(state=cancelled) または task.status で確認する。bridgeは「受理したが未停止」の期間を区別し、停止完了を確認してから新規技能を開始する。タイムアウト発火時も同様に、攻撃ループ・入力保持・インベントリ操作を含めて実行中操作の停止を保証する。

## 6. 環境・運用設計

### 6.1 パック2系統

- **devパック** (検証用・起動が速い): Forge 47.4.28 + agent-mod + baritone-api-forge + JEI + 代表mod少数 (Mekanism, Create程度)。mods 10個前後を目安。
- **prodパック** (本番): Prism「1.20.1」インスタンスの262mod。サーバー用にクライアント専用modを除外するが、mods.tomlの `side` は依存先の要求側を表すもので、mod本体の実行側を保証しない。分類は以下の手順とする。
  1. 候補抽出: 既知クライアント専用mod名リスト・配布ページのEnvironment情報・mods.tomlの依存`side`信号・jar内のクライアント専用エントリポイント有無から、「クライアント専用らしさ」を3段 (ほぼ確定/要確認/サーバー必要) に分類する。
  2. 根拠と不明点を packs/prod/classification.md に記録する。
  3. 固定したjarとconfigで専用サーバーを起動・ログインして確定する。エラーは「依存欠落」(除外ではなく同梱が正解) と「クライアント専用参照」を区別し、起動エラーだけから自動的に除外を広げない。

### 6.2 専用サーバー

Forge 47.4.28のserver installerでこのPCに構築。`server.properties`: `online-mode=false` `enforce-secure-profile=false` `view-distance=8` (RAM節約) `white-list=true`推奨。メモリ割当は6〜8GB。ワールドは新規作成。

### 6.3 botクライアント

Prism Launcherで prodパックを複製した「bot」インスタンスを作成し、agent-mod・baritone-api-forgeを追加、JDK17ランタイムを指定、メモリ割当6〜8GB。アカウントはPrismのオフラインアカウント (ユーザー名 `Rin`、config変更可)。`prismlauncher --launch bot` で起動。ウィンドウは表示され、botの視点を覗く用途にも使える。

### 6.4 ユーザークライアント

既存のPrism「1.20.1」インスタンスをそのまま使用。サーバーへはマルチプレイ追加でlocalhost接続。

### 6.5 FR-05の段階対応 (レシピ範囲)

FR-05は全RecipeTypeを範囲に含むが、対応は段階的に進める。

| Phase | 範囲 | 操作経路 |
|---|---|---|
| Phase 1 (MVP) | 標準作業台レシピ (バニラ・mod追加) | レシピ帳packet + slotクリック |
| Phase 2 | 単一機械: Mekanism (冶金/富化等)、Thermal系機械 | コンテナslot操作 + 設備ごとの成功判定 |
| Phase 3 | 複合加工: Create機械加工、IEマルチブロック、TConstruct溶鉱炉 | 同上 + 構造認識 |
| Phase 4 | 大規模連携: AE2自動クラフト等 | 個別設計 (優先度低) |

設備ごとの操作と成功判定は、対象modを列挙した上で個別に設計する。上表の対象modは262modの代表例からの暫定列挙であり、優先順位は実プレイで調整する。

#### 実装方針: 技能と機械・レシピ知識の分離

mod数に対して技能数が線形に増えないよう、手順・機械定義・レシピを分離する。

- **技能は動詞のみ** — `gather` `smelt_in` `process_in_machine` `craft` のような汎用技能に留め、「強化鉄を作る」のような個別技能は作らない。LLMはレシピを解決した上で汎用技能を呼ぶ。
- **機械定義はJSONデータ** — 機械ごとの差分 (GUIのslot配置・input/output/進行判定位置) を `machines/<modid>_<machine>.json` 形式の定義ファイルとして持ち、`process_in_machine` 技能が読んで実行する。新機械への対応はコードではなく定義ファイルの追加。
- **レシピはクライアントのレシピマネージャから引く** — サーバー同期されたレシピマネージャには独自RecipeType (機械加工) のレシピも含まれる。agent-modに `recipe.lookup {item}` を実装し、成果物名から {レシピタイプ, 材料, 投入slot構成} を返す。レシピを技能やプロンプトにハードコードしない。
- **名称解決は `find_item {query}`** — クライアントは翻訳済み表示名を持つため、「強化鉄」のような日本語名からも `mekanism:enriched_iron` を引ける。無名modのアイテムも同じ経路で解決する。
- **未定義機械のフォールバック** — 定義JSONがない機械は `gui_read` でslot配置を観察し `container.click` を試行する汎用経路で処理する。成功した配置は定義ファイルとして保存し、次回以降は高速経路を使う (技能の自己蓄積)。

## 7. フォールバック設計 (案1: サーバー側フェイクプレイヤー)

判定ゲートG1/G2 (§8) で本線を捨てる場合の設計。

案1は「確立済みの退路」ではなく「第一候補の仮説」として扱う。通信形式を共通化しても、操作の意味とmod互換性まで同等になるとは限らないため、移行に入る前に最小実証を行う。

- **要PoC**: 移行着手前に次の3点を実証する。(a) FakeServerPlayerの生成とWS接続 (b) PathNavigationベースの移動・採掘・足場制御 (c) コンテナのslot操作。3点が成立しなければ案2 (Mineflayerフォーク) も再評価する。
- **変わる部分**: 制御実体のみ。サーバーmodがFakeServerPlayer (CarpetのEntityPlayerMPFake相当) を生成し、同一のWS/JSONプロトコルを提供する。
- **変わらない部分**: bridge・技能層・MCPツール面・プロンプト。ただし本線APIには画面走査・GUIクリック・クライアントレシピ帳が含まれ、サーバー側には同じ画面がない。共通APIは `container.click{menu_id, slot}` のような意味操作で定義し、実装別に `meta.capabilities` の対応一覧と `UNSUPPORTED` エラーを返す契約にする (§2.3)。
- **失うもの**: Baritone。PathNavigationはプレイヤー用に組み込まれた経路探索ではなく、歩行・採掘・足場の制御は自前実装になる。ピラミッド登り・架橋・精度の高い経路は弱くなる。
- **得るもの**: 第2クライアントの常駐が不要になりRAMと安定性を取り戻せる。

## 8. マイルストーンと判定ゲート

| 工程 | 内容 | ゲート |
|---|---|---|
| M0 | 環境構築: devパック・専用サーバー・bot用Prismインスタンス・offlineアカウント | - |
| M1 | agent-modスケルトン: WS起動・spawn・chat echo・obs.state | - |
| M2 | 原始操作: move/look_at/dig/inventory/chatがbridge CLI経由で動く (task_id・状態照会・停止完了の契約込み)。devパック専用サーバーのサバイバルで「硬いブロックの採掘→戻る」と途中キャンセルを確認 | - |
| M2.5 | 縦切り検証: モック技能で ゲーム内chat→MVPホスト (Codex) 起動→ツール呼出→send_chat返信 を実ホストで確認。M4を待たずに実施 | - |
| M3 | Baritone統合: goto/mine/follow | **G1**: devパック+代表modでBaritoneが起動・経路探索できること。駄目なら原因調査、見込みなしなら退路へ |
| M4 | bridge+技能層+MCPツール、相棒MVP (チャット駆動の追従/採集/受け渡し) | - |
| M5 | prodパック統合検証: botが262mod環境で起動・ログイン・相棒動作 | **G2**: 実用に耐える安定性がないなら退路へ |
| M6 | 安定化・ドキュメント整備・OSS公開準備 | - |

## 9. リスクと対応

| リスク | 影響 | 対応 |
|---|---|---|
| Baritone Forge版が262modと衝突 | 本線不成立 | devパックで早期検証 (G1) → 退路へ |
| botクライアントが重い・不安定 | 実用性低下 | 割当RAM調整・mod削減検討 → 悪ければ退路 |
| mod GUI (機械・AE2等) の操作が未対応 | 一部作業ができない | 段階対応。主要modから個別にgui操作を足す |
| クラフトがrecipe packetで失敗 | クラフト不能 | 手動grid clickのフォールバック実装 |
| 262modのサーバー側分類ミス | サーバー起動失敗 | mods.tomlのsideは候補信号とし、根拠記録+固定jarでの起動確認で確定。起動エラーだけから自動的に除外を広げない (§6.1) |
| Codex one-shot実行で対話継続性が弱い | 会話の文脈喪失 | 会話ログ+状態要約を丸ごと引き渡し。長文化したら要約層を導入する。Muse接続時は方式に合わせて見直す |
| WSコールバックからの直接操作 | クライアントクラッシュ・競合 | メインスレッド引き渡しを実装規約とし、レビュー対象にする (§2.1) |
| 古い観測に基づく誤操作 | 意図しないアイテム喪失 | slot+generation必須の契約とSTALE_STATE拒否 (§4) |
| オフラインモードの利用制限 | 他サーバーでは不可 | 本システムは私設サーバー専用と明記 |

## 10. ディレクトリ構成

```
minecrafttogether/
├─ agent-mod/        # Forge 1.20.1 mod (Java 17 / ForgeGradle)
├─ bridge/           # MCPサーバー (Node/TypeScript)
├─ skills/           # 技能ライブラリ (JSモジュール + index.json)
├─ packs/
│  ├─ dev/           # devパック定義 (mod一覧・config)
│  └─ prod/          # prod仕分け結果 (server-mods.txt / client-only.txt)
├─ server/           # 専用サーバー構築・起動スクリプト (実体はgitignore)
├─ tools/            # mod分類・パック同期・起動補助スクリプト
├─ docs/
│  ├─ spec.md  design.md  decisions.md
├─ research/         # 調査資料 (既存)
├─ README.md         # 英語 (OSS向け)
└─ README.ja.md      # 日本語
```

## 11. 拡張設計: 自律モード (後続)

相棒MVPの上に乗せる。

- **自動カリキュラム**: bridgeに「目標生成」タスクを追加。現在のインベントリ・技術ツリー・周囲資源から次の到達目標をLLMが提案し、技能列に分解 (Voyager)。
- **スキル蓄積**: 成功したコードをskills/にコミット。検証はLLM自己検証+実行成功の2条件 (Voyagerのcommit条件)。
- **失敗の自己説明**: describeをもとにexplainerとしてLLMが誤りを特定し再計画 (DEPS)。
- **並行モジュール**: 危険感知 (被弾・落下・敵接近) はLLMを介さずbridge側で即応答する分岐を設け、PIANOの「遅い思考を止めない」構造を真似る。

これらはMVPのモジュール構造 (技能層の外側にループを足す) で実現できるため、現段階の実装を阻害しない。
