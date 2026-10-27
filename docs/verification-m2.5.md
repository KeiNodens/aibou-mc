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
- bot Prismインスタンス `bot`: JDK17・6GB・オフラインアカウント `Rin` (profile.id `8f2da33d...0650`) に `UseAccountForInstance` でピン留め。実起動でタイトル画面到達確認
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
