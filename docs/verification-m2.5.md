# M2.5 縦切り検証記録 (2026-10-27)

設計書 §7 の M2.5「チャット起動経路の縦切り検証」の実施記録。

## 構成

- `tools/mock-mod/mock-mod.mjs` … ゲーム側の偽物（WSサーバー ws://127.0.0.1:25587）
- `bridge/` … MCPサーバー(HTTP http://127.0.0.1:25589/mcp) + WSクライアント + イベントバッファ + runner
- runner: chatイベント検知 → デバウンス → `codex exec` 起動（`-c mcp_servers.minecraft.url=...` でMCP登録を注入）

## 検証結果

ゲーム内chat → Codex推論 → MCPツール呼出 → ゲーム内返信 の一連が実機で確認できた。

```
/inject {"from":"Player","text":"こんにちは、元気？"}
  → [runner] codex exec 起動
  → mcp: minecraft/get_chat (completed)
  → mcp: minecraft/get_state (completed)
  → mcp: minecraft/send_chat (completed)
  → codex 終了 code=0

get_chat:
  [Player] こんにちは、元気？
  [Rin]   こんにちは、Player！私は元気だよ。Playerは元気？
```

## 検証中に見つかった問題と修正

1. **HTTP 500（初期化失敗）**: ステートレス `StreamableHTTPServerTransport` は1リクエストで閉じる仕様のため使い回し不可。リクエストごとに transport+server を生成するSDK推奨パターンに修正（index.ts）。
2. **CodexのMCPツール承認**: `--ignore-user-config` 時は approval policy が `never` になりMCP呼出が自動拒否。`--approve-for-me` を使う（`-s` とは併用不可）。
3. **bot自身の発言でループ**: `send_chat` の発言がchatイベントとして自分に返り、runnerが再起動する無限ループ。`from === botName` を除外して修正（state.ts の onChat が発言者を渡すように変更）。
4. **日本語の文字化け**: curl の `-d` 引数経由でcp932化したテストハーネス側の問題。`--data-binary @file`（UTF-8ファイル）で回避。bridge/mod間のJSON(UTF-8)経路自体は正常。

## 残件

- mock-mod側は `chat.send`・`player.state` 等の固定応答のみ。実mod未接続。
- `wait_event`・task系ツールは実装済みだがCodex経由の長時間動作検証は未実施。
- 次工程: M0 環境構築（dev軽量パック・専用Forge鯖・bot Prismインスタンス）。

---

# M0〜M2 追記 (2026-10-27 夜)

## M0 環境

- devパック: `packs/dev/mods/` (JEI 15.74.0.225 / Create 6.0.8 / Mekanism 10.4.16.80 / baritone-api-forge 1.10.3)
- 専用サーバー: `server/` Forge 47.4.28・online-mode=false・`Done` 確認・新規ワールド生成済
- bot Prismインスタンス `bot`: JDK17・6GB・オフラインアカウント `Rin` (profile.id は環境固有のため省略) に `UseAccountForInstance` でピン留め。実起動でタイトル画面到達確認
- 1回目の起動で ForgeWrapper の DOWNLOAD_MOJMAPS が一過性ネットワークtimeout → 再起動で解消。同時刻にGPUドライバハングが発生したが再起動で回復（mod構成起因ではない）

## M1 agent-modスケルトン (実機)

- `agent-mod/` Forge 1.20.1 mod。Java-WebSocketをjarJarで同梱 (`jarJar.enable()` 必須)。成果物 `build/libs/agentmod-0.1.0-all.jar` → bot mods へ
- WSサーバー起動 (ws://127.0.0.1:25587) → hello {generation乱数, capabilities}
- タイトル画面検知で localhost:25565 へ自動接続 → `Rin joined the game`
- bridge から `get_state` → 実データ (pos/health/biome/近隣entity集計/inventory要約+詳細+generation)
- `send_chat` → ゲーム内 `<Rin>` 発言成立、chat evtエコーも確認（from=Rinで自発言識別可）

## M2 原始操作 (実機)

| method | 結果 |
|---|---|
| look_at{x,y,z} | yaw/pitch実変更 OK |
| move.set/move.stop | sprint前進13ブロック実移動 OK |
| dig{x,y,z} | task_id即時返却→task.done(succeeded)。砂ブロック実破壊・`minecraft:sand:1`を拾得。結果に破壊block名を記録 |
| task.cancel/cancel_all | running中にcancel→state:cancelling→task.done(cancelled)→status=cancelled OK |
| task.status/result | generation・state・result/errorを返却。STALE_TASK=未知idエラー |
| dig距離外 | OUT_OF_RANGE ("target is 6.1m away") の構造化エラー |
| equip/toss | ホットバー選択・手持ちアイテム投棄 OK |

- `LocalPlayer.drop()` はboolean返し（ItemEntityではない）・`ServerData` 第3引数はboolean — 1.20.1 API差分で初期実装を修正済
- 既知: chat evt の `text` は `<Rin> ...` 装飾込み。obs.state の `nearby.blocks` は未実装（M3〜のスキャン系で対応）

## 未検証・今後

- 「硬いブロック」は砂層の深い砂漠では届かず砂のみ。石層掘削は降下が必要でM3 (Baritone) 後に再確認
- `wait_event` のCodex経由長時間検証、use_item/コンテナslot操作 (M4以降)
- 次工程: M3 Baritone統合 (goto/mine/follow) と G1 ゲート

---

# M3 Baritone統合 実機検証 (2026-10-28)

devパック (JEI + Create + Mekanism + Baritone API 1.10.3) 同梱のRinクライアントで実施。

## 検証結果

| 操作 | 結果 |
|------|------|
| `goto {x:10,z:-15}` | succeeded — Baritone経路探索で歩行到達 (10.1,62,-14.1) |
| `mine {block:minecraft:sand,count:2}` | succeeded — 14ブロック移動して採掘、inventoryに sand×2 |
| `stop`（長距離goto中） | stopped=true, tasks_cancelled=1 → task state=cancelled |
| `follow {player:Kei_Dens}`（未ログイン時） | failed / NOT_FOUND — 構造化エラーで即終了 |
| `task.done` イベント | wait_eventで配信確認 (seq=10, succeeded, result付き) |

## G1ゲート判定: 合格

Baritoneがdevパック環境で起動し、経路探索・採掘・フォローの全APIが動作した。
fallback（サーバー側fake player案）への移行は不要。

## 実装上の修正

- `build.gradle`: flatDir { dir 'libs' } + `compileOnly fg.deobf("blank:baritone-api-forge:1.10.3")` でlibs/baritone-api-forge-1.10.3.jarをコンパイル参照（実行時はmodsフォルダの同jarが提供）
- `GotoTask.baritone()` をpublic化（game/taskパッケージ間参照のため）

## 未検証

- follow の positive ケース（要 Kei_Dens のワールド参加）

## M3 追加検証 (同日・peaceful化後)

- サーバー difficulty=peaceful に変更（normal時はRinがゾンビに反復殺害され検証不可 — ログに `Rin was slain by Zombie` ×5）
- `follow {target:minecraft:item}` → running、FollowProcess起動確認
- `follow {target:minecraft:rabbit}` → Rinが(45,20)→(59.3,17.7)までウサギを追跡、dist 2.7維持。**followのpositiveケース実証**
- `follow` ツールの引数を `player` → `target` に拡張（`minecraft:xxx`形式でエンティティ種類指定可能に）
- 自動接続を1回限り→タイトル/切断画面で10秒毎リトライに改善（サーバー再起動への追従が可能に）
- followのプレイヤー対象ケース（Kei_Dens）は未検証だが、同一predicate機構のためエンティティ実証をもってG1合格維持

---

# M4 技能層+相棒MVP 実機検証 (2026-10-28)

## 構成

- `skills/*.mjs` — 1技能=1ファイル `{name, description, params, run(ctx,args)}`。bridgeが起動時+ファイル監視でロード、1ツール=1技能としてMCP登録
- ctx: `call`(mod RPC) / `state` / `say`(chat送信) / `waitTask`(task.done待機) / `sleep` / `signal`(AbortSignal)
- `cancel_current` は 実行中スキルのabort + baritone.stop + task.cancel_all の3段
- mod追加: `obs.entity {name}` — プレイヤー名または`minecraft:種類`で座標・距離を返す（give/come_hereの対象解決用）
- 自動接続を10秒リトライ化（サーバー再起動追従）

## 検証結果（実ゲーム + 実Codex）

| 入力chat | 結果 |
|---|---|
| `砂を5個集めて` | Codex応答「私が砂を5個集めるね。」→ gather スキル発動「sand を5個集めてくるね」→ Baritone採掘 →「sand を5個集めたよ」（注入→完了報告まで約28秒） |
| `Playerについてきて` | Codex応答 → follow_player スキル → 対象不在を検出「Player が見つからない」（NOT_FOUNDをchatで自然に報告） |

- スキル内でctx.sayによる途中経過・結果報告が動作（LLM側は受付の一言だけ返す分業が成立）
- bot自発言によるrunner再ループ無し（codex-last出力1本のみ）
- 登録ツール26本: 原始14 + task3 + baritone4 + スキル5 + reload_skills

## 未検証・既知制約

- `give`/`come_here` のpositiveケースは要 Kei_Dens 参加（giveはホットバー内アイテム限定のMVP制約付き）
- スキル完了イベント `skill.done` はwait_eventで取得可能だが、現スキルは内部でsay完結のためLLMからは未使用

---

# M5 prod 262modパック統合 (2026-10-28)

`instances/1.20.1` の262mod本番パックを鯖・botに展開した際の障害対応記録。パックは複数の破損・不整合を抱えており、単一プレイヤー（統合鯖・Essential LAN）では表面化しないものが専用鯖化で露呈した。

## 鯖側の修正（起動〜ワールドロード）

| 障害 | 原因 | 対応 |
|---|---|---|
| 依存不足 | `blockdonalds`→`bobo_lib`、`create_enchantment_industry`→`create_dragons_plus`、`respiteful`→`farmersrespite` がパックに欠落 | 各jarを追加（respitefulは本番で無効化されているが依存上必須） |
| `sob` CONSTRUCT失敗 | sobはFarmer's Delight 1.2.x向けで、同梱のFD 1.3.4の `RoastChickenBlock` 削除と非互換 | 両側から除外 |
| `jeresources`/`jerintegration` COMMON_SETUP失敗 | JER系がworldgen走査時に `bamboomod:autumn_forest` の未登録キー参照で落ちる（クライアント向けJEI連携で鯖には不要） | 両側から除外 |
| 鯖データロード失敗 | `sugar_delight` jar内の `sgushenka.json` が出力ID `sugar_delight:sugar_delight:chocomilk`（二重コロン）でResourceLocation例外 | jar内レシピを `sugar_delight:chocomilk` に修正（上流バグのパッチ） |

## クライアント側の修正

| 障害 | 原因 | 対応 |
|---|---|---|
| `chunkpregen` CONSTRUCT失敗 | JourneyMap 6.xと非互換（`Displayable` クラス不存在） | 両側から除外（管理用プリジェネレータでプレイ不要） |
| `nolijium` CONSTRUCT失敗 | 同上で同時に検出。クライアントQoL modでbotには不要 | botから除外 |
| `e_l:*`/`e_1:*` チャンネル不一致 | `emi_loot`（fzzyhmstrs系はmodid短縮チャンネル名を使う）がサーバー側パケットを持つのに鯖未導入 | 鯖に `emi_loot`+`fzzy_config` 追加 |
| `Invalid player data` (join失敗) | `ArsCurios` が `EquipmentSlot` enumにmixinで定数追加（filterFlag=6）→ TConstruct `AttributeModule` の固定長 `UUID[6]` をオーバーし `step_up` エンコード失敗。作者issue既知・未修正 | `ArsCurios`+依存先 `SlashNouveau` を両側から除外 |

## 現在の稼働状況 (01:38時点)

- 鯖: `Done`、peaceful、mod約241本で稼働
- bot: 約260本で起動、**Rinがフルパック鯖にログイン成功**
- agent-mod WS + bridge接続済、`get_state` でmod入り実データ取得成功（`ars_nouveau:worn_notebook`/`tconstruct:materials_and_you`/`shincolle_kai`/`patchouli`本を含むインベントリ、近隣ウサギ等）
- レジストリID経路がmod入り環境で機能確認（バニラと同一APIでmodアイテムを名前解決）

## 残件・既知gap

- `step_up` エンコード失敗はTConstruct側の根本バグ（任意slot index未対応）。ArsCuriosを戻すと再発するため、TConstruct修正かArsCurios更新待ち
- `urushi` のディスペンサー登録はfastutil競合で稀にCOMMON_SETUP失敗（リトライで回避可能なレース）
- `ticex` のSlashBlade向けmixin注入失敗、`ntgl` ファイル欠落、`athena`/`ae2additions`のモデルローダー欠落等の非致命的警告が残存
- `emote`/`screenshot`/`find_item`/`waypoint` 系の新規APIとautoLook追跡は実装済みだがフルパック実機検証はこれから
- 本番インスタンス側も同mod構成なら同理由で接続不可 — `arscurios`/`slashnouveau`/`nolijium`/`chunkpregen` を本番からも外す必要あり

## M5追記: mine個数セマンティクスの修正 (01:55)

### 発見した問題

フルパック環境で `gather sand 3` を実行したところ、砂漠で在庫に砂6個所持にもかかわらず `UNREACHABLE: baritone finished but only gathered 0/3` で失敗。Baritoneログは `Have 6 valid items`。

**原因**: Baritone `mineByName(quantity, ...)` の quantity は「掘るブロック数」ではなく「対象ドロップの**総所持目標数**」で、既存インベントリ分も達成分にカウントする。一方 MineTask は増分(want)を要求していたため、Baritoneが即完了（0個採掘）→ MineTaskが「不足」と誤判定していた。devパック時は在庫0だったため表面化しなかった。

### 修正: 2モード化

- `baritone.mine` に `mode` パラメータ追加 (`MineTask` + MCP `mine` ツール):
  - `additional` (default): 新たにN個掘る。個数監視と停止はmod側で行うため、Baritone呼び出しは**数量なし** `mineByName(block...)` に変更（掘り続けさせ、目標達成でcancel）
  - `ensure`: 合計N個を目標。不足分(target = want - 初期所持)だけ掘り、既に足りていれば `already_satisfied:true` で即成功
- `gather` スキルは `ensure` セマンティクスで呼ぶ（コンパニオンとして「手元にN個あればいい」が自然）

### 実機検証 (フルパック・badlands・砂8個所持時点)

| 呼び出し | 結果 |
|---|---|
| `mine sand 3 mode:ensure` | 即成功 `already_satisfied:true, held:6, gathered:0` |
| `mine sand 2 mode:additional` | 実掘 `gathered:2, held:8` |
| `gather sand 3` | chat「sand はもう8個持ってるよ」(掘らず) |
| `gather sand 10` | chat「sand を2個掘って、合計10個になったよ」(不足2のみ掘削) |

→ ユーザー提案どおり「追加N個」「合計N個」の2セマンティクスを分離し、どちらも実機確認。

### 既知の制約

- `countItems` はブロックIDをアイテムIDとしてそのまま照合するため、ドロップが別IDになるブロック（`diamond_ore`→`diamond`、草ブロック→土等）では個数が正しく数えられない。Baritone側も `asItem()` 同等の扱いなので同じ制約を持つ。鉱石系の正確な採集判定はloot table解決が必要で今後の課題

## M5追記: 全API実機検証 (フルパック, 02:10)

新規API・原始操作を262mod環境で網羅検証。結果は全て実データで確認。

| API | 結果 |
|---|---|
| `bot_status` | `{"connected":true,"generation":...}` |
| `waypoint_save/list/delete` | home(55,60,26)保存・一覧・削除・NOT_FOUNDエラーパス全てOK |
| `find_item` | レジストリ横断検索・日本語表示名返却 (osmium 20件等) |
| `emote` | swing/jump/crouch_dance 全種成功。crouch_danceはtask化されtask.done発行 |
| `screenshot` | MCP image content (PNG base64) 返却 |
| `follow minecraft:rabbit` | 動的追従 (dist 2.7維持)。`stop`/`stop_all`/`cancel_current` で全キャンセル経路OK |
| `look_at` | 座標指定・`entity_id`指定の両方で旋回確認 |
| `scan_area` | **`obs.scan` を新規実装**。r=24で27ブロック種 (terracotta系badlands地形) + entity集計+nearest |
| `obs.entity` | ウサギ2匹を `entity_id`+座標+dist で返却。**応答にentity_idを追加** (look_at用) |
| `move`/`stop_move` | sprint移動・停止OK |
| `equip`/`toss`/`dig` | ホットバー選択・1個投棄・指定座標破壊 (sandstone) 全てOK |
| `wait_event` | `skill.done`/`task.done` イベントをseq付きで取得 |
| `reload_skills` | ディスク再読込で新スキルが即ツール化されることを確認 |
| `give`/`come_here` (自己対象) | `obs.entity` は `level.getEntities(p, box)` のため**自分自身を除外** → 「Rin が見つからない」。対人経路のエラー処理は健全。positive検証は第2プレイヤー要 |

### 検証中に見つけたgapと対応

- `obs.scan` がmod側未実装だった (bridgeの`scan_area`だけ先行して存在) → GameOpsに実装。主スレッド全走査のため radius は64上限に制限
- `obs.entity` が実行時`entity_id`を返さず `look_at entity_id` が到達不能だった → 応答に追加

### G2 暫定評価

「実用に耐える安定性」について、同日中にクライアントを複数回再起動・再接続しても全APIが一貫して動作し、Baritone経路探索・採掘・追従・タスクライフサイクルが262mod環境で破綻していない。**G2は当面合格とみなす**。留保事項: 長時間 (数時間規模) の連続稼働は未測定、urushiの鯖起動レースは稀に再発し得る (リトライで回復)、give/come_hereの対人positiveパスは未検証。

## M5追記: mine深堀り調査とmod鉱石対応 (02:50)

`mine` の実地検証で発見した3つの本質的問題と対応。

### 1. `mineByName` は名前空間を解決できない (mod対応の致命的gap)

`mine mekanism:tin_ore` → `BAD_REQUEST: Invalid block name tin_ore`。Baritoneの名前解決はバニラ短名前提で、`modid:name` を受け付けない。
**対応**: `IMineProcess.mine(Block...)` を使い、`BuiltInRegistries.BLOCK` で `modid:name` を直接解決してBlockオブジェクトを渡す方式に変更。→ **任意のmodブロックがID指定で採掘可能になった**

### 2. 素手では深部/硬ブロックにpathしない (ツール必須)

素手の状態で `mine stone`/`mine gold_ore` → Baritoneが `Unable to find any path → blacklist` を無限巡回 (y35-47を10分超往復)。岩盤/terracottaに埋もれたブロックへの掘削経路が素手コストでは探索上限を超える。砂(即破壊)だけが成功していた理由。
**対応**: `chat.command {command}` APIを新設 (`sendChat`は `/` をコマンドと解釈しないため `sendCommand` が必要)。`ops.json` にRinを追加し `run_command` で鉄ツルハシを付与して検証 → **stone/gold系が即座に成功**。運用上「相棒にはツールを持たせる」が前提条件と判明 (将来的には自動クラフト・工具棚スキルで解消する領域)。

### 3. 暴走タスクの安全弁

path不達の巡回はBaritone側が終了しないため、タスクが無限runningになり得た。
**対応**: `MineTask` に停滞検出 (6000 tick=5分 採取数増加なしで `TIMEOUT` fail + Baritone停止)。実機で発火確認 (`no progress for 300s, gathered 0/1`)。

### 4. ドロップID差異 (追加対応・実証済)

`countItems` を「ブロックID集合」から「採集対象アイテムID集合」に拡張:
- バニラ代表表 (`stone→cobblestone`, `*_ore→raw_*/diamond等`, `grass_block→dirt` 等30件)
- mod鉱石ヒューリスティック: `X_ore` → `raw_X`/`X`/`X_shard`/`X_gem`/`X_crystal`/`X_fragment`/`X_dust` で存在するIDを採用

### 実機結果 (フルパック・鉄ツルハシ所持)

| 呼び出し | 結果 |
|---|---|
| `mine stone 3` | 成功 `held:3` (cobblestone3個をalias計上) |
| `mine mekanism:tin_ore 2` | **成功 `held:2`** — mod鉱石ID解決+`raw_tin`計上 |
| `gather tin_ore 2` (在庫2時) | 「もう2個持ってるよ」— alias+ensure経路 |
| `gather tin_ore 4` | 「2個掘って、合計4個になったよ」— 不足分のみ採掘 |

### その他の発見

- `obs.entity` は `getEntities(p, box)` で自分自身を除外 (仕様通り)。`give`/`come_here` のpositive対人経路は第2プレイヤー要
- 実績達成 (Stone Age) がchatイベントとしてrunnerに流れ、Codexが「「石器時代」を達成したよ」と自然に自己報告 — 非発言イベントのコンパニオン化が機能
- `send_chat` で `/give` を送るとコマンド実行されず平文chatになる → `chat.command` (sendCommand) で解決済

### 運用メモ

- `ops.json` にRin (level 4) を追加済 — `run_command` 経由でgive/tp等が使える。**LLM駆動botのopは強力なので、公開鯖では推奨しない** (OSS化時にREADME注意書き要)
- 相棒の採集技能はツール (鉄ツルハシ以上) の所持が事実上の前提。現状は手動付与、M6以降で自動化検討

---

# M6: OSS公開準備・安定化 (03:20)

## 実施内容

- **git init + 初期コミット** (55ファイル)。`.gitignore` で server/(3.9GB)・packs/・research/・node_modules・build/dist・logs・生成jarjarメタ・cloudflared.exe(53MB) を除外
- **LICENSE** (MIT), **README.md** (英語: アーキテクチャ・quickstart・mine 2モード・ツール前提・安全注意・env変数表), **AGENTS.md** (ビルド/実行/規約), **docs/mod-compat.md** (262mod互換性の知見を独立文書化 — 除外mod一覧・両側必要mod・パックデータバグ・単一プレイで隠れる理由)
- **runner.ts 安定化**: 未使用だった `promptFile` を実装 (`{chatLog}` 置換)、Codexハング時の `runTimeoutMs` (default 10min) 追加。index.ts に `RUNNER_PROMPT_FILE`/`RUNNER_TIMEOUT_MS`/`RUNNER_COMMAND`/`BOT_NAME` env配線
- bridge/package.json に description/license 追加、agentsトムルにjarJar warning解消

## OSSとして未整備の残件

- crafting/container/GUI 操作は未実装 (design §5 の段階対応は設計済み)
- give/come_here の対人positive検証 (要第2プレイヤー)
- Muse接続 (docs/muse-connection.md にメモあり)
- CI無し (build手順はAGENTS.md記載)
- 長時間soak未測定

---

# M6.5: use_item・コンテナ・クラフト実装と検証 (08:30)

## 新規API (Phase 1: 標準クラフト)

- `obs.block` (bridge: `find_block`) — 指定ブロックの座標検索、距離順最大16件
- `use_item` — 空中use (食べる・投げる等) / x,y,z+face指定でブロック右クリック (設置・GUI開く)
- `container.read` / `container.click` / `container.close` — 意味レベルslot操作。clickの `menu_id` 不一致で `STALE_STATE`
- `recipe.lookup` (bridge: `recipe_lookup`) — 同期済みレシピマネージャから成果物→{type,材料(tag展開),個数}。機械系RecipeTypeも列挙される
- `craft` (bridge: `craft_menu`) — `ServerboundPlaceRecipePacket` でグリッド配置→結果スロット取り出しをtask繰り返し。2x2=インベントリmenu、3x3=CraftingMenu要
- `skills/craft.mjs` — craft試行→`NEED_TABLE`なら`obs.block`で作業台探索→reach内ならgoto省略→`use_item`で開く→再試行→`container.close`

## 実機検証結果 (フルパック)

| 機能 | 結果 |
|---|---|
| 作業台を `use_item` で設置 | success、find_blockで確認 |
| 作業台・チェストを `use_item` で開く | `minecraft:crafting` (46slots) / `generic_9x3` (63slots) menu確認 |
| `container_click` swap (inv↔hotbar) / quick_move (player→chest) | 両方成功、dioriteがchest slot0へ |
| `container_click` 誤った `menu_id` | `STALE_STATE` で拒否 |
| `craft_menu` 3x3 (furnace) | cobblestone 12個→4個消費、furnace獲得 |
| `craft` skill 2x2 (stick x8) | planks 16→12、sticks獲得 |
| `craft` skill 3x3 (chest) | NEED_TABLE→作業台発見→開く→craft→close 全自動 |
| `craft_menu` bedrock / 3x3をinvで / 材料不足 | `NO_RECIPE` / `NEED_TABLE` / `RECIPE_REJECTED` |
| `use_item` 食事 (steak) | consume→腹0→20回復。**solapplepie が onFoodEaten で FoodListNotFoundException → kick** (mod側bug、後述) |
| `recipe_lookup` stick | 全RecipeType列挙 (sawmill/cutting/emptying/crafting/mod製代替recipe含む)、材料tag展開済み |

## 検証で発見・修正した不具合

1. `InventoryMenu.getType()` が `UnsupportedOperationException` → try/catch で `player_inventory` fallback
2. **FastSuite** がPlaceRecipe処理を非同期化 → `PLACE_WAIT` 4→20tick (4tickだと常にgrid未充填判定)
3. 同名成果物の代替recipe (mod追加) が多い → `satisfiable()`: 全材料がインベントリにあるrecipeを優先選択
4. `task.done` イベントは `error:{code,message}` ネスト形、skill側はflat `error_code` を参照 → emitDoneにflat field併記 (互換で両方)
5. `obs.block` がソート未実装 → 距離順ソート+16件cap
6. **`equip` が `ServerboundSetCarriedItemPacket` を送っていなかった** → 鯖が古いslotのitemで操作するdesync (use_item/tossの実効対象がずれる、原因不明のアイテム消失に見える) → packet送信で修正
7. `GoalBlock` 指定がソリッドな作業台座標では失敗しやすい → craft skillはreach (dist≤3.5) 内ならgoto省略
8. mods/ に旧 `agentmod-0.1.0.jar` と新 `agentmod.jar` が同居し旧コードがロードされていた → 旧ファイル削除

## 既知の制約・mod互換

- **solapplepie**: Rinが食事を完了するたび `FoodListNotFoundException` でkickされる (offline/bot playerにfood capabilityが付かないmod側問題)。食事自体は成功する。恒久対策はsolapplepie除外または修正版待ち
- `use_item` の設置: クリック面がreplaceable/airだと鯖が拒否・位置がずれることがある (回復不能ではないが座標確認推奨)
- peacefulではhungerが減らず食事できない (ゲーム仕様)
- Phase 2以降 (機械GUI/自動化) はmachine定義JSON+汎用slot操作で対応予定 — design §5 参照

## 追記: Phase 2 機械GUI (`process_in_machine` + machine定義JSON)

`machines/<menu_id>.json` でinput/output/fuelスロットを宣言し、skillが読み込む。定義が無いmenuはヒューリスティック推定 (container_idxで機械/プレイヤー領域を分離、slot_class名にvirtual/output/fuel等の手がかりを利用)。

### 実機検証 (フル262mod環境)

| 検証 | 結果 |
|---|---|
| `mekanism:enrichment_chamber` menu構造調査 | slot 0,1=virtual (energy/upgrade), 2=input, 3=output, 4=extra. `container_idx` で機械(0-4)とプレイヤー(5+)を正しく分離 |
| quick_move自動振り分け | プレイヤーinv→raw_tinをquick_moveで機械input slot 2へ自動振り分け |
| 機械への電力供給 | `mekanism:creative_energy_cube` (config依存で出力せず) / `ae2:creative_energy_cell` では不通 → **`energizedpower:creative_battery_box` をsetblockで設置したら全方向FE給電で加工開始**。mod間のFE互換はブロック依存 |
| `process_in_machine` enrichment_chamber (定義経由) | open→投入→poll→`tin_dust`回収→chat報告「tin_dust を4個作ったよ (定義slot)」 全自動 |
| `process_in_machine` furnace (定義経由, input+fuel) | raw_tin+coal投入→`tin_ingot`回収 全自動 |
| 出力アイテムIDの非一致 | 依頼`mekanism:raw_tin`→成果`thermal:tin_dust`/`thermal:tin_ingot` — skillは実際の出力slot中身を拾う方式で対応済み |

### 判明した制約

- **機械の電力はmod依存**: Mekanism機械は外部FE供給が必要で、供給ブロックとの互換は実機で要確認。skill側は加工が進まない場合timeoutで「入れたまま」を報告 (raw_tinは機械内に残る)
- virtual slot (energy/upgrade等) への意図しない投入を防ぐためヒューリスティックでは `slot_class` に `virtual` を含むslotを除外
- ヒューリスティックはクラス名依存 — Mekanismのように全slotが汎用クラスの機械では役割分解が弱い。確実性が必要な機械は `machines/*.json` に定義を足す運用
- `menu_id` は `container.read` で実測するのが確実 (ブロックIDと一致しない場合あり)


---

# 追記: 本番インスタンス (1.20.1) の鯖接続調整

§185の「本番からも外す必要あり」リストは実際より不足していた。鯖modsとの実diffを取った結果、必要な調整は以下の通り (接続の実機検証はこれから)。

## 実施した調整 (`instances/1.20.1/minecraft/mods/`)

- **無効化 (.disabled化) 7本**: ArsCurios, SlashNouveau (TConstruct非互換), Chunk-Pregenerator (レジストリ不一致), sob (FD 1.3.4非互換), JustEnoughResources, jerintegration, nolijium (鯖・bot両側で除外済)
- **追加 3本**: CreateDragonsPlus, bobo_lib, delightlib (鯖・botにはあり本番に欠落 — §158の依存不足jarと同一)
- **再有効化 1本**: farmersrespite (鯖側はrespiteful依存として有効。本番の .disabled のままだとレジストリ不一致)
- **変更なしで残した本番独自mod 15本**: emi系5, journeymap, jmi, DistantHorizons, embeddium, oculus, appleskin, BetterAdvancements, BorderlessWindow, FPS-Monitor, FasterLadderClimbing — 全てクライアント限定modでバニラ鯖互換の設計。チャンネル不一致が出れば個別に無効化する方針

調整後のprod↔server差分は「本番独自=クライアント限定modのみ」「鯖独自=なし」の状態。変更前のmods一覧は `instances/1.20.1/minecraft/mods-backup-*.txt` に保存済みで、元に戻す場合は .disabled を外し追加3本を削除すればよい。

Forge/ MCバージョンは両インスタンスとも 47.4.28 / 1.20.1 で鯖と一致を確認済み。


## Phase 3: mod解析拡張 + 新原始操作 (6/14 実機検証)

### 機械GUI自動発掘ループ
- 2段階自動発掘を実施: (1) `use_item`でGUI開放→`container.read`でmenu構造取得 (111台調査)
- (2) quick_moveプローブで実際にアイテムを投入しinput slotを実証的特定 (120台)
- 生成定義: `machines/*.json` に 107+6(外部mod定義) = 113個
- mekanism系全機械 (enrichment実機検証済含む)、thermal全family (in0)、
  enderio (in1)、ad_astra (in1)、industrialforegoing (titanium container)、
  energizedpower (direct挿入系)、ae2、forestry、rftools、botania/ars/tcon (GUI不可を特定)
- 検知できた「GUIが開けない機械」: botania brewery/enchanter、ars imbuement、
  tconstruct seared_melter、evolvedmekanism solidification → mod-support.mdに記録

### 新原始操作
| op | 結果 |
|---|---|
| `look_info` | OK。Jade経由でenrichment_chamberの電力(EMC表示)/内容物を日本語ツールチップ取得 |
| `interact` | OK。牛entity_idにwheat餌やり(pass)、バケツで乳搾り(milk_bucket取得) |
| `container.button` | OK。stonecutterでbutton_id=1押下→stone_brick_slab生成 |
| `container.trade` | 部分。村人merchant menu開放+index選択は動くが、offer成立の完全経路は未確認 |
| `hold_ticks` | OK。弓を装備し25tick保持→release→**実際に矢消費(13→12)を確認**。実装はkeyUse実入力経路 |
| `block_state` | 未検証 (blockEntityのupdateTag経由) |

### solapplepie調査
- configに無効化オプションなし。offline/bot playerにFoodList capabilityが付かないmod bug。
- 対策候補: bot側除外 (接続可否要確認) or 食事を使わない運用 or mod本体patch。
- 現状は食事成功→kick→自動再接続で復帰するので実害は限定的。

### docs/mod-support.md 新設
mod別対応マトリクス: 対応済/定義あり/部分/未対応/非互換 + パック外有名modの解析方針を記録。
- `block_state` 追加検証 (後日): enrichment_chamberで properties(active/facing) + be_nbt(componentConfig側面設定/owner) の取得を確認。machine_status の補完経路として有効

## Phase 3b: entity操作全系統 + 連携機能 (6/14 深夜検証)

### container.trade 完全経路 — 成立
- 農民のmerchant menuで index0選択→cost slot0にエメラルド投入→
  result slot2からquick_moveで `tofucraft:edamame_boild` 96個取得 (maxUsesまで自動反復)。
- 進捗「良い取引だ！」達成 = サーバー確定。

### interact 全系統 (距離ガード追加: OUT_OF_RANGE/reach3.0)
| 操作 | 結果 |
|---|---|
| 狼・懐き | 骨x2でconsume→Owner NBTにRin UUID入り |
| お座りトグル | 素手interactでSitting 0b→1b |
| 毛刈り | shearsでsuccess→Sheared=1b・羊毛item entity確認 |
| リード | leadでsuccess→Leash.UUID=Rin |
| 騎乗 | 素手interact success→騎乗、sneakで降りる (y 64.4→63.5)。Passengers検証の方が追いつかず |
| 取引開始 | villager interact→merchant menu開放 |

失敗から分かった運用注意: 「consume」はクライアント側予測で、距離外でも返ることがある。
interactにreach検査を追加したので、今後はOUT_OF_RANGEで明示失敗する。
give直後のクライアントinventory同期ずれが繰り返し発生 — kick再接続で治るが頻度が高い。

### 新機能
- `container.repo` — AE2系ターミナル画面のrepo (ネットワーク仮想在庫) を
  reflectionで全量dump (IClientRepo→GridInventoryEntry)。soft-dep、menu非依存。
- `craft_plan` スキル — recipe.lookup再帰展開で不足素材+手順を計算。
  pistonで実動 (mod鉱石の別modレシピも拾う)。
- `waypoint` スキル — 名前付き地点の記憶/list/goto/remove。bridge/waypoints.json永続化。

### solapplepie結論
side:BOTHなのでbot側だけ外せない (ハンドシェイク拒否)。pack全体から外すかは要裁定。
食事成功→kick→自動再接続で実害は限定的、のまま維持。

### container.repo (AE2) 検証結果
- MEチェスト/ケーブル上ターミナルで `ae2:item_terminal` menu + `MEStorageScreen` repo を検出、
  `container.repo` が IClientRepo→GridInventoryEntry を正しく列挙 (空ネットワークでsize:0)。
- MEネットワーク構築のゲーム内制約: drive が cable 直隣接でも `proxy:{p:-1}` のまま
  (グリッド接続は cable の向き/channels の制約)。cell挿入は hopper 経由でも入らず、
  MEチェストのGUIもcell装着前は開かない設計。
- 入庫 (quick_move deposit) は AE2 独自 InventoryAction packet が必要で未成立 — 読み取り専用として確定。

### interact 補足
- 騎乗は素手interactで success→実際に馬上に移動 (y+1.5)、sneak降りで元位置に戻るまで確認。
  server側 Passengers 検証は別entityを拾ったため不一致だったが実動はしていた。

## 2026-10-28 AE2入出庫・solapplepie恒久対策・環境問題

### solapplepie kick恒久対策 (実機確認済)
- `SolApplePieGuardMixin` → `FoodListMessage$Handler` 冒頭で `SOLSweetPotatoAPI.foodCapability`
  未装着なら `setPacketHandled(true)`+cancel (disconnectを潰す。能力欠落時の同期pktだけ捨てる)。
- mixinはjar manifest `MixinConfigs` 属性で登録 (Forge 47.xはmods.toml `[[mixins]]`未対応)。
- ログで `Mixing SolApplePieGuardMixin ... into FoodListMessage$Handler` 実適用を確認。
  以降、食事・リスポーン時の同期でkickされなくなった (食事成功・死亡復帰とも継続)。

### respawn 追加
- `respawn` op: 死亡画面からリスポーン。dispatch/capabilities/bridgeで同期済み。

### AE2 MEネットワーク: 読み・入庫・引出し 全成立
- ネットワーク無電源が全失敗の根因だった。`gn:{p:0}`のpはグリッドIDではなく
  **owningPlayerId** (GridNode.saveToNBT実装で確定)。グリッド存在はタグの有無で見る。
- **罠**: `ae2:cable_bus` item はケーブル芯なし裸バス → パーツだけのバスは外接続不可で
  ターミナルが孤立 (Jade「デバイスオフライン」)。`ae2:fluix_smart_cable`等の芯を
  別途装着すると `gn:{p:0,e:25.0}` (e=grid電力) で通電。
- 電源: creative_energy_cellはIAEPowerStorageをnode service登録する正規電源。
  今回の検証は `ae2:vibration_chamber`+石炭で供給 (NBT burnTime減少・e値上昇を確認)。
- `container.repo` 訂正: `MEStorageScreen.repo` フィールドは親クラス探索が必要
  (ChestScreenはrepoを持たず別物)。修正後 serial/id/amount/requestable/craftable全取得。
- **入庫**: 通常quick_moveが正規経路 (transferStackToMenu→canInteractWithGrid)。
  wheat x28 が repo serial:2 として出現するのを確認。
- **引出し**: `container.repo_action {serial:N, action}` →
  `MEInteractionPacket(containerId, serial, InventoryAction)` を toPacket(PLAY_TO_SERVER)
  で送信 (AE2がrepoクリック時に実際に使うパケット)。SHIFT_CLICKで全量取り出し、
  repo消滅+player inv着弾を確認。

### 環境問題 (bot instanceの設定変更)
- post-joinで `tconstruct:jei_plugin` のJEI登録が7分超走りrender/nettyが凍結→
  30s keep-alive timeoutで蹴られる繰り返し + 過負荷native crash (WER dump多発)。
- JEI jar除外は「mismatched mod channel list」で握手拒否 (このpackは両側一致必須)。
- **対処: instance.cfg MaxMemAlloc 6144→12288, MinMemAlloc→4096**。GC圧が減り
  keep-aliveが通りJEI完了まで接続が持つようになった。
- give直後のクライアントinventory同期ずれは相変わらず発生。kick再接続で解消。

## 2026-10-28 夜 (続)

### respawn 実機検証
- `/kill Rin` → hp:0・死亡画面 → `respawn` op → hp:20・スポーン地点 (9.5,62,-9.5) 復帰。
  `{was_alive:false}` で死亡状態の検出→復帰の両分岐を確認。

### AE2 オートクラフト依頼 — 全3段を実機検証
- `container_repo_action` に3経路を実装:
  1. `AUTO_CRAFT` + serial → `MEInteractionPacket` でサーバーが `ae2:craftamount`
     (数量選択menu) を実際に開くことを確認 (item_terminal cid1→craftamount cid2)。
  2. `CONFIRM_AUTO_CRAFT` + amount(/craft_missing/auto_start) →
     `ConfirmAutoCraftPacket(int,boolean,boolean)` で `ae2:craftconfirm` (計画確認menu)
     が開くことを確認 (cid3)。
  3. `GUI_ACTION` + name → `GuiDataSyncPacket(containerId, buf)` で
     `buf.writeUtf(action名)` を送出。`startJob`/`replan`/`back`/`cycleCpu` が
     CraftConfirmMenuの登録アクション名。`startJob`送信を確認
     (対象は1kセル=パターン無しなのでjob自体は起動しないが、パケット経路は成立)。
- 完全なクラフトジョブ成立の検証には encoded pattern + crafting CPU が要るため、
  「パケット経路の成立 + menu遷移の実証」までで記録を区切る。

### inventory.resync 実装 (同期ずれの根本対策)
- `inventory.resync` op: `ServerboundContainerClickPacket(containerId, stateId=-1,
  slot=slots.size(), PICKUP, empty, {})` を送出。
  stateId不整合でサーバー側が `sendAllDataToRemote()` を呼ぶ vanillaの
  デシンク復旧経路を利用。slot番号は末尾外なので clicked() は無視、持ち物も動かない。
- 検証: GUI開放中 (container_id:1) に give→resync → メニュー内のplayer inv slotに
  新規アイテムが届くことを確認。GUI無し (container_id:0) でも送出・整合確認。
- 従来の give直後の表示遅延は本セッションでは発生せず、健全同期下でもresyncが
  安全に通ることを確認 (真のパケット喪失時の復旧は次回発生時に見る)。

### JourneyMap 連携 (autonomy 8.5 第一弾)
- `JourneyMapBridge` 新設 (全リフレクション・soft-dep、journeymap-forge-1.20.1-6.0.7)。
  `ClientAPI.INSTANCE` (enumシングルトン) → `WaypointFactory.createWaypoint` →
  `addWaypoint("agentmod", wp)` で agentmod グループに永続登録。
- `waypoint.set` → JMミラー `journeymap:true`、`waypoint.del` → JM削除も確認。
  botマップ上にwaypoint表示、プレイヤーとの地点共有の土台ができた。

## 2026-10-28 深夜 (外部提案の取り込み)

### FTB Quests 導入 + quest.* API
- `ftb-quests-forge-2001.4.22` + `ftb-teams-forge-2001.3.2` を
  server/bot/ユーザー側の3箇所に導入 (FTB公式Maven、依存は既存modで充足)。
- サーバーログで `ftbquests:*` レシーバ登録を確認 (submit_task, claim_reward 等)。
- `QuestBridge` 新設 (全リフレクション): `ClientQuestFile.INSTANCE` +
  `selfTeamData` から `forAllQuests` → 章/タイトル/started/completed。
- `quest.list` / `quest.inspect` を dispatch・capabilities・bridge登録。
  実機: `quest_list` → `{"synced":true,"quests":[]}`。
  `ClientQuestFile.INSTANCE` へのサーバー同期と経路成立を確認
  (クエスト定義はパック未同梱のため空は期待値 — config/ftbquests に
  クエストSNBTを配置すれば一覧・進捗が出る)。

### ReflexGuard (LLM非依存の反射層) — 実機検証済
- `ReflexGuard` 新設、ClientEvents.onClientTick で通常タスクtickより先に評価。
- 被弾検知 → 実行中タスクをINTERRUPTED + `reflex`イベント発火
  + Baritoneで離脱 (8m敵接近も同様に中断、peacefulのため未検証)。
- 実機: `tp`で6m落下×3回 → 3回とも`reflex{hurt,hp17-18}`発火 +
  `reflex-t1/t2/t3`離脱タスクが`arrived:true`で完了 (+10〜12m逃走)。
  サーバー難易度はpeacefulだったため敵接近分岐は未検証
  (summonしたモブは即消滅した)。

### container.click の操作後検証 — 実機検証済
- レスポンスに `container_id`/`state_id`/操作後slot内容を付加。
  実機: furnace結果slot pickup →
  `{"clicked":2,"container_id":1,"state_id":1,"after":{"slot":2,"id":null,"count":0}}`。
  不整合時は `inventory.resync` で `sendAllDataToRemote()` を引き出して復旧。

### Bridge作業ジャーナル — 実機検証済
- `bridge/src/journal.ts` 新設: JSONL永続化 (`bridge/data/journal.jsonl`)。
  work_id は WS世代に非依存の連番。kind: work.start / work.end /
  checkpoint / evt(task.done・skill.done・reflexを自動収集)。
- skill実行は自動で work.start + work.end(全result) を記録、
  `work_journal`(読み出し)/`work_checkpoint`(手動記録)のMCPツール追加。
- 実機: `work_checkpoint`→`w-1`割当・永続化・読み戻し、
  craft_plan実行で`w-2`にgoal/args/resultが自動記録されたことを確認。
- 設計意図: 再起動後は「操作の再実行」ではなく「観測→照合→再開」で復旧
  (Codex Companionの NpcTaskPersistence 参照)。

### schematic 取り込み (.litematic/.schem)
- `bridge/src/schematic.ts` 新設: `prismarine-nbt` で
  `.litematic` (regions→blocks/palette/size) と `.schem` を解析。
- `schematic_inspect` (寸法・ブロック種類数・主成分) /
  `schematic_plan` (配置手順リスト化) のMCPツール追加。
  実ファイルでの検証は今後 (Litematica出力のテスト用図面が必要)。

### craft_plan の機械工程統合 + 循環/選択バグ修正 — 実機検証済
- 非クラフトRecipeTypeも再帰展開し、`machines/*.json` 定義と突合して
  machine/menu_id/input_slots を step に付記 (`needs_machine` も返す)。
- 修正1: `visiting`セットで bread→wheat→hay_block→wheat 型の循環を遮断
  (実機: missingが wheat243→wheat9 に正常化)。
- 修正2: レシピ材料を同一itemに集約 (hay_block 9slot分岐の9x9爆発を解消)。
- 修正3: 機械レシピもcrafting同様にスコア選択 (`mrs[0]`固定で
  create:framed_glass→glass の回遊を選ぶ問題を解消)。
- 修正4: `minecraft:`成果物は「全材料にバニラ選択肢がある」レシピのみ採用
  (mysticalagriculture:essence→sand 等のmodded疑似クラフトを排除)。
- 実機: `craft_plan glass 3` → `missing:{sand:4}`,
  steps=[sandstone→millstone→smelting] の機械工程付き計画を確認。

### mod追加ツールとdig (自動ツール選択) — 実機検証済
- `ae2:certus_quartz_pickaxe` で stone→cobblestone 採掘成功 (modツール通常動作)。
- `mekanism:atomic_disassembler` **無充電** は stone 1個で60s TIMEOUT
  (`getDestroySpeed`≈0相当。充電式ツールはFE充電が前提)。
- 対策: `DigTask`にホットバー最適ツール自動選択を追加 —
  `getDestroySpeed`+`isCorrectToolForDrops`採点 (適正ツールを速度より優先)。
- 実機: slot0=無充電disassembler・slot1=certus pickaxe・手持ちslot0で
  `dig` → 自動でslot1に切替 `{"broken":true,"tool":"ae2:certus_quartz_pickaxe"}`。
- 残gapは docs/mod-support.md「mod追加アイテム起因のケース監査」参照
  (equip=hotbar限定・sneak修飾無し・NBT識別不可・countItemsの
  クロスnamespace・AoE/Tinkers未検証等)。

### 監査gap対応 (全実機検証済)
- `equip` armor/offhand: `equip{item:"minecraft:iron_helmet",slot_name:"head"}`
  → `equipped:true`、読み戻しも確認。インベントリ内itemを
  container click経路でarmorスロットに移動 (Curios系は別APIで今後)。
- `use_item` sneak修飾: `sneak:true`でPRESS/RELEASE_SHIFT_KEYを挟む。
  実機: 通常use→チェストGUI開放(`container_id:1`) vs
  sneak+use→GUI回避(`container_id:0`)の対比を確認。
- `item.info` 新op: 耐久・Forge ENERGY/FLUID・エンチャ・NBTキー要約。
  実機: 無充電disassembler → `energy:{stored:0,max:400000}`、
  日本語名「原子分解機」取得。mod道具の状態が見える化できた。
- `countItems`クロスnamespace: `_ore`のドロップ候補 (raw_X/shard/gem等)
  を全namespace走査に拡張 (ad_astra:moon_iron_ore→minecraft:raw_iron型)。

### 監査gap対応 第2弾 (全実機検証済, 軽量パック上)
- `get_state` `inventory_detail[].attrs` 拡張: `nbt_keys` (同idバリアント
  識別: disassembler mode, Tinkers tic_materials等) + `energy_stored`
  (state単体で充電切れを判別)。実機: disassembler→`energy_stored:0`、
  pickaxe→`nbt_keys:["Damage"]` 確認。
- `container_open_curios` 新op: `CPacketOpenCurios`送信で
  `curios:curios_container_v2` メニューを開放。`container_read`が
  `CurioSlot`に`curios_id`を付記 (27スロット: back/jetpack/scuba_*/
  free_runners/klein_star/necklace/ring等 — Mekanism登録分を含む)。
  実機: `travelersbackpack:standard` (menu slot40) → `curios_id:"back"`
  (slot61)へpickup/place → サーバー同期で装備・永続確認。
  backpackのようなcurios専用装備を意味level clickで扱えるようになった。
- `dig` に `tool_slot` 引数追加 (auto-scoreを迂回してホットバーslotを
  強制)。AoEツールはauto-scoreが範囲価値を見られないため明示にした。
- AoE採掘 実機検証: `energizedpower:diamond_hammer`で3x3 `bricks`壁の
  中央を`dig{tool_slot:4}` → 9個中**7個が破壊** (残2)。通常入力経路で
  mod側範囲破壊ロジックが発火することを確認。
- /give直後のget_state遅延: inventory反映がcontainer同期ベースなので
  `inventory_resync`後に確定する挙動を再確認 (hammer×2が初見で見えず、
  resync+container_readでmenu slot40/41に確認)。

### キーバインド/スクロール ops (全実機検証済, 軽量パック上)
- `key_list`: 234 mappings列挙 (modキー名/category/表示キー)。
- `key{mapping,down}`注入パス (`KeyboardHandler#keyPress`経由):
  `key.forward`ホールド→実座標移動、Curios G→`CuriosScreenV2`開放、
  Esc(code:256)→PauseScreenトグルを確認。
- `press:true`: consumeClick待ちmodへ届く (isDownは応答時点の瞬間値;
  mod側tick検出のためPRESS後150msでRELEASEを遅延発行)。
- `real:true`経路 (JNA `keybd_event` + 自動`glfwFocusWindow`):
  AWT Robotはjavawのheadless環境で不可のためWin32 API直接呼出し。
  Mekanism独自キー実装 (`MekKeyBinding`+GLFWコールバック) へ到達確認:
  `key_hud`押下で`client.toml`の`enableHUD`がtrue→falseに反転。
- **Mekanismモード切替の全フロー実証**: disassembler (radial対象) で
  `key{key.mekanism.mode,down:true,real:true}`→`GuiRadialSelector`開放
  →`scroll{delta:1}`(via:screen,handled:true)→`down:false`→
  NBT `mekData:{mode:0→1}` に更新。radial型アイテムはpressでは
  `isModeItem(allowRadial=false)`で弾かれるためホールド+スクロール必須。
- `scroll`: 画面オープン時`Screen#mouseScrolled`直接呼出し
  (`via:"screen"`+handled返却)、画面なし時はOSホイール
  (`mouse_event` WHEEL, `via:"os_wheel"`)。
- `get_state` `container.screen`追加: メニューを持たない純Screen
  (radial/PauseScreen等) のクラス名を返す。GUIデバッグで有用。
- 注意: EscはPauseScreenをトグルするので`screen`確認後に送信すること。
  `real`の`is_down`応答は非同期送信前の瞬間値 (実押下は数十ms後に反映)。

### Screen/テキスト/未バインドキー ops (全実機検証済)
- `screen_read`: 開いているScreenのwidget列挙 (CuriosScreenV2→
  CuriosButton/RenderButton等、ChatScreen→EditBox検出)。
- `screen_click`: index/text一致でwidget中心click — CuriosButtonで
  InventoryScreen切替、SignEditScreen「完了」ボタンで閉鎖を確認。
- `screen_close`: 強制setScreen(null)。
- `type_text`拡張: 金床以外にScreen内EditBoxへ汎用insertText
  (focused優先/index指定可)。実機: ChatScreenのEditBoxへ入力→
  Enter→`<Rin> hello from type_text`がゲームチャットに送信確認。
- `sign_write`実証: `use_item{x,y,z}`で看板右クリック→
  `playerWhoMayEdit`権利付与→`ServerboundSignUpdatePacket`で
  front_text=["Hello","from","Rin","2026"]書込確認。
  ※看板編集権は「右クリックで付与→更新送信で消費」のワンショット。
  setblock/他者設置の看板はnon-editableで拒否される (サーバーログ確認)。
- **未バインドキーの仮バインド機構**: `key.ftbultimine`(key:'')に
  F13-F24の空きkeysymを一時割当→keyPress注入→RELEASE時に復元。
  実機: 仮バインド保持中にdig→FTB Ultimine発動で3x3 coal_ore全9個を
  一撃採掘 (vein-mine)。
- バグ修正: 仮バインドrelease復元漏れ / GLFW F13=302起点のずれ /
  AWT VK_F13系(61440+, keybd_event範囲外)→Win32 VK(124-135)変換 /
  real経路も未バインド対応 / Win32 VK値をOEM記号系含め全見直し。
- `key.ftbquests.quests`はキー自体は届くがクエストデータ空のため
  GUI未開放 (mod側の期待挙動。ATM9等の実データ環境で再確認要)。
- Tinkers/soulbound系は現パックに本体modが無く検証対象外
  (create_tinkers_compat/tinkersdelightのみ)。ATM9で要検証。
