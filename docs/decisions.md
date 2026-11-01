# 決定記録 (Decision Record)

grillingによる設計ヒアリングの結果を記録する。各決定は「決定 → 候補 → 理由 → 根拠」の形式。日付はすべて 2026-10-27。v0.2の改訂 (review-2026-10-27.md 反映) は末尾にまとめる。

## D1. アーキテクチャ

- **決定**: 案3 (第2クライアント + クライアントmod + Baritone) を本線、案1 (サーバー側フェイクプレイヤーmod) を退路とする
- **候補**: 案1 / 案2 (Mineflayerフォーク) / 案4 (既存fake player mod流用)
- **理由**: mod互換性が必須級の要件であり、本物のForgeクライアントならFML3ハンドシェイク・動的レジストリ・mod固有ペイロードの問題を完全に回避できる。Baritoneも使えて経路探索が最強。案2はresearchメモでL2を山とする実装リスクが指摘済み。案1は互換性同等だが経路探索がバニラMob式に落ちる
- **根拠**: research/Mineflayer_Forge対応フォーク設計.md, research map「同居プレイヤー方式」検討課題
- **退路口**: design.md §8のゲートG1/G2

## D2. エージェントの役割

- **決定**: 相棒型 (チャット駆動) をMVP、自律機能は後付け
- **候補**: 自律型 / 相棒+自律の同時開発
- **理由**: 「一緒に遊ぶ」体験を最短で作れるのは相棒型。自律はVoyager式で設計余地があるが、技能層の上に載せられる構造なので後で足せる
- **根拠**: research/Voyager要素の分割可能構造

## D3. System2 (LLM側)

- **決定**: ゲーム側をMCPサーバーとして公開。Muse 等のホストがMCPクライアントとして接続。OSSとして公開可能な構成
- **候補**: 独自エージェントループ (Mindcraft式) / ローカルモデル / 特定クライアント専用
- **理由**: MCP標準に寄せれば特定モデルに依存せず、Claude Desktop・独自ループ・どのホストでも繋げる。OSS公開の意向とも合致
- **根拠**: MCPサーバー化してOSS公開するプロジェクト方針

## D4. サーバー形態

- **決定**: このPC上に専用Forgeサーバーを立てる
- **候補**: シングルをLAN公開 / 外部サーバー
- **理由**: modをサーバー側だけに入れられる、botが常駐できる、ワールドが永続、開発検証も回しやすい
- **根拠**: ユーザー回答

## D5. 対象パック

- **決定**: 本番=Prism「1.20.1」インスタンス (Forge 47.4.28 / 262mod)。開発検証用の軽量パックを併用
- **候補**: 262modのみ / 軽量パックのみ
- **理由**: ユーザーは「軽量パックの方が実験しやすい」としつつ任せる旨。実験速度と本番互換性の両立として2系統運用を採用
- **根拠**: 環境調査で262modインスタンスを検出、mod一覧を確認

## D6. ツール/APIの粒度と技能の置き場所

- **決定**: 2層構造 (高レベル技能 + 低レベル原始操作)。技能ロジックはbridge (Node/JS) 側
- **候補**: 高レベルのみ・技能はmod側 / 低レベルのみ (yuniko式)
- **理由**: 高レベルはLLMのトークン節約と連鎖失敗を防ぎ、低レベルは逃生路として必要。技能をJS側に置くとホットリロードで開発が速く、Voyager式スキル蓄積にそのまま拡張できる
- **根拠**: yuniko式細粒度 vs Voyager式コード技能の比較 (research)

## D7. 対話チャネル

- **決定**: ゲーム内チャットのみ
- **候補**: +補助UI / 音声まで視野
- **理由**: プレイヤーとして振る舞う相棒の最も自然な形。UI/音声は拡張として後で足せる
- **根拠**: ユーザー回答

## D8. リポジトリ・ライセンス

- **決定**: monorepo + MIT + 英語README (+日本語docs可)
- **候補**: Apache-2.0 / 公開は後で考える
- **理由**: MCPエコシステムでは英語READMEが有利。agent-mod・bridge・skills・tools・docsを1リポジトリで管理する方が連携変更に強い
- **根拠**: ユーザー回答

## 私が設計書内で定めた細部 (ユーザー承認済み・異議あれば変更可)

| # | 決定 | 値 |
|---|---|---|
| D9 | WSプロトコルの向き | mod=サーバー / bridge=クライアント。JSON-RPC風 |
| D10 | MCP transport | stdio主、Streamable HTTP副 |
| D11 | 観測の表現 | イベント差分込みのテキスト化 (DEPS式descriptor相当) |
| D12 | 危険操作 | `dangerous` フラグ + `confirm:true` 必須の確認フック |
| D13 | bot表示名 | `Rin` デフォルト (英数字制約、configで変更可) |
| D14 | botアカウント | Prismオフラインアカウント (第2Microsoftアカウント不要) |
| D15 | Java | 開発・サーバー・botインスタンスはJDK17系。既存のプレイ用インスタンスは触らない |
| D16 | 状態の記憶 | ツール呼出間で記憶しない (都度取得、mc-mcp方式。観測のみで実行管理状態はR1で明確化) |

## 改訂 (v0.2 / review-2026-10-27.md 反映)

レビュー指摘7件を反映した。ユーザー判断が要った2件は新たな決定 (D17/D18) として記録し、設計の修正はR1〜R5として記録する。

### D17. FR-05「modレシピ対応」の範囲

- **決定**: 全RecipeTypeを範囲に含め、標準作業台→列挙したmod加工設備の順に段階対応する (design §6.5)
- **候補**: 標準作業台のみ / 代表設備まで即座に対象
- **理由**: 全種類を要件に含める判断をユーザーが確認。MVPの肥大化は段階対応で抑制する
- **根拠**: ユーザー回答 (Q10)

### D18. MVP検証ホスト

- **決定**: CodexをMVPの動作確認ホストとし、bridge内runnerがcodex execを起動して「chat→推論→返信」を検証する。Muse連携は接続方式が判明次第の後続
- **候補**: Museを最初から / Claude Desktop等の既製ホスト
- **理由**: Museは最近公開されたMetaのもので、連携が難しい見込み。Codexなら先に始められる
- **根拠**: ユーザー回答 (Q9)

### R1. D16の適用範囲を明確化

「記憶しない」は観測状態のみに適用する。実行管理状態 (task_id・進行状態・結果) はmod側で一定期間保持し、再接続後も照会できる (spec NFR-03 / design §2.1, §2.3)。

### R2. 掘削経路とスレッド境界の修正

`destroyBlock` の直接呼出をやめ、通常入力と同じ startDestroyBlock / continueDestroyBlock / stopDestroyBlock の経路に修正した。WSコールバックからゲームオブジェクトを直接触らず `Minecraft#execute` へ引き渡す規約も明記した (design §2.1)。

### R3. prodパック分類手順の訂正

mods.tomlの `side` は依存要求であり実行側を保証しない。候補抽出→根拠記録→固定jarでの起動確認という手順に書き換え、起動エラーだけから自動的に除外を広げない方針を明記した (design §6.1)。

### R4. スタック識別の契約追加

インベントリを要約/詳細の2形式に分け、操作は slot + container.generation を必須とし、世代不一致は STALE_STATE で拒否する (design §4)。

### R5. 退路案1の格付け変更

「実装差し替えで済む」から「第一候補の仮説・要PoC」に格下げした。移動・採掘・コンテナ操作の最小実証を移行の条件とし、共通APIは意味操作で定義、実装別のcapabilitiesとUNSUPPORTEDエラーを規約とした (design §7)。

## D19. 他プロジェクト比較に基づく機能追加方針 (2026-10-29)

- **決定**: Minemind (Boyan253) / Elly AI Agent (Smekkamite) / minecraft-codex-companion (Hakurei-git) / Marionette (Prattlemob) と Numen / mc_aiplayer / AIRI / awesome-mineflayer-mcp との比較で出した差分機能を**全項目採用**する。実装は下記の順序で段階的に行う
- **候補**: 一部のみ採用 (生存反射のみ / 記憶のみ) / 採用しない
- **理由**: 比較の結果、本プロジェクトはmodded到達範囲 (AE2・機械定義・JEI/Jade/キー注入等) では突出している一方、「自律エージェントとしての体裁」(生存ループ・記憶・実行管理・権限) で全プロジェクトに見劣りする構図が確認された。ユーザーは「AIエージェントと遊んでる感」を重視し、自己保全は強制ではなく閾値低め・バランス重視の指示あり
- **根拠**: ユーザー回答 (全カテゴリ「全部」採用) + 比較調査 (MinemindのFTB DAG、Ellyの直パース/生存反射、codex-companionのWorkGraph復帰/ローカルチェーン、mc_aiplayerの型付き事後条件/atomic snapshot/strictプロファイル、Numenの施設記憶/生存ループ、AIRIの4層認知)

### 採用スコープと実装順序

| Phase | 内容 | 由来 |
|---|---|---|
| P1 生存反射 | 自動食事 (閾値低め・非強制) / 退避・帰宅 (戦闘バランス) / 夜間睡眠 (夜作業許容) / 死亡→帰還・回収 | Elly, Numen |
| P2 記憶継続 | goal.set/get 永続目標 / 施設・チェスト自動記憶 (waypoint拡張) / 中断作業の再起復帰 / 終了まとめ自動化 | Elly, Numen, codex-companion |
| P3 実行管理 | pause/resume / 事後条件チェック / 再起動スナップショット復元 / 検証インフラ | mc_aiplayer |
| P4 クエスト自律 | FTB SNBT→DAGオフライン解析 / チャット.goal差し込み / 失敗棚上げ / 達成記念撮影 | Minemind |
| P5 技能・経路 | 明示コマンドのLLMレス直パース / 畑スキル / 構造物・バイオームlocate / schematic実建築 / エリトラ飛行 / ペット世話 | Elly, Numen, mc_aiplayer, codex-companion |
| P6 権限・将来 | autonomy.level (0/1/2) + safe/assist/auto相当 / 複数bot・多段LLM | mc_aiplayer, Elly, codex-companion |

## D20. waypoint の正を mod 側に統一 (2026-11-01)

- **決定**: waypoint の保存・解決の正を mod 側 (`Waypoints.java` / gameDir `agentmod-waypoints.json`) とし、skills 側 `skills/waypoint.mjs` は mod op を叩く薄いアダプタに書き換える。旧 `bridge/waypoints.json` は初回実行時に移行する (mod 側に無い名前のみ、同名は mod 優先)
- **候補**: bridge 側ファイルを正にする / 二重管理のまま運用で吸収する
- **理由**: mod 側スキーマが半径 (領域・反射の安全圏判定) を含むスーパーセットであり、JourneyMap ミラーも mod 側のみ。skills 側の登録は地図に出ず journal の施設記憶にも残らない。保存先もチェックアウト依存で worktree ごとに分裂する
- **根拠**: ユーザー裁定 (2026-11-01、凛の提案を採用)

## D21. world_craft 実行器の新設と Create 対応 (2026-11-01)

- **決定**: GUI を持たない「ワールド内操作」型の加工を、汎用実行器スキル `world_craft` (投入→観測して待つ→回収、振る舞いは定義 JSON) で受ける。対象: Botania / Ars 装置 / Tinkers 鋳造 / AE2 結晶育成 / Create ステーション (millstone・fan 加工・press 等)。ステーションの前提インフラ (マナ・動力・形成) はプレイヤー担当とし、bot は操作のみ。前提不備は報告して止まる
- **候補**: mod ごとに個別スキル / 機械定義 API の拡張で吸収する
- **理由**: 対象群は全て同じ型 (投入→変化待ち→回収) で、レシピ自体は recipe_lookup で取得できる。Create は大型かつ現行バージョンで代表的な mod であり、ユーザーから対応希望が明示された
- **対象外**: Create コントラプション (列車・移動/回転構造) の制御。動く構造物は Baritone の経路探索の前提にない
- **根拠**: ユーザー裁定 (2026-11-01。「AE にも対応できるはず」との指摘を受け AE2 結晶育成を初期定義に含めた)

## D22. ProjectE 対応 (2026-11-01)

- **決定**: ProjectE に対応する。変換表は特殊 GUI のため、(1) 実機で GUI 構造を調査、(2) EMC・学習済み一覧は mod 側リフレクション op `projecte.status` で読む、(3) 取り出し/EMC 化は GUI 駆動スキル `transmute` で行う、の3段とする。知識と EMC は bot プレイヤー自身のものとして扱う
- **候補**: 対象外のまま / GUI 駆動のみで状態も画面から読む
- **理由**: ユーザーが愛好してきた mod であり使う意思が明示された。EMC 残高のような数値は画面テキスト依存にせず、Jade/AE2 と同じ soft dependency + リフレクションで確実に読む
- **根拠**: ユーザー裁定 (2026-11-01)

## D23. schematic 拡充: 生成・材料集め・取り出し・配置 (2026-11-01)

- **決定**: schematic 系を4段で拡充する。S1 生成 (MineBench 方式: プリミティブ/座標列 → Sponge .schem 書き出し。形式層の props 分離修正と、registry.blocks カタログ + block_search を含む)、S2 build_prepare (材料集計→在庫・チェスト・ME 照合→調達と不足報告)、S3 チェスト/ME からの個数指定取り出し (logistics 拡張)、S4 build_schematic v2 (props 検証・配置コンテキスト制御・自動補充・回転)。目標には mod 機械を詰めた工場建築も含め、生成スペックに対で必要な commissioning plan (配置後設定) と意味レベルプリミティブ (machine_row 等) を設計に含める
- **候補**: 読み取り+建築のみの現状維持 / Litematica 形式での生成
- **理由**: ユーザーから「AI と話して schematic を作れる」「置くアイテムを一緒に集める」「チェストから取り出せる」の3点と、工場建築・配線の肩代わりへの希望が明示された。MineBench が「モデルによる設計図生成」の成立を実証しており、書き出し形式 (.schem) は既存の読み取り・建築と直結する。block state と mod block の問題は、カタログ (実在 id + state 語彙) と配置層の段階導入で対処する
- **根拠**: ユーザー裁定 (2026-11-01) + MineBench 調査 (voxel.exec プリミティブと .schem v3 書き出し)
- **詳細**: docs/design-schematic-expansion.md

## D24. Farmer's Delight 対応 (2026-11-01)

- **決定**: FD を3経路で扱う。作物は farm スキル拡張 (キャベツ/タマネギは dig+植え直し、トマトは右クリック収穫、米は対象外)、まな板・ストーブ・スキレットは world_craft のステーション定義、cooking pot は専用 cook スキル (レシピ駆動、draft)
- **理由**: ユーザーから農作物と FD 料理の対応状況の質問があり、現行ギャップ (farm はバニラ5種のみ、FD は機械定義のみ) を埋めるため。FD の調理系は「GUI の鍋」と「ワールド内操作」に分かれ、既存の枠組み (world_craft / レシピ解決) に素直に乗る
- **根拠**: ユーザーの質問 (2026-11-01) + mod-support.md の FD 棚卸し (cooking_pot [d]、cutting_board/skillet はワールド内操作型)


## D25. 全 mod 対応化 (2026-11-01)



- **決定**: 監査対象の全パック (本番 1.20.1 / ATM9 No Frills・To the Sky / Essential TerraFirmaCraft / Monifactory) の全コンテンツ mod に、aibou-mc 側の対応経路 (機械 def / station 定義 / 専用 op・スキル / 汎用経路の明記) をコードとして用意する。実機検証は従来通りバッチ送り

- **線引き**: Create のコントラプション制御 (D21) と Integrated Dynamics のロジック構築は従来裁定どおり対象外。multiblock の「形成」は設計図ビルド経路、形成後の操作は def/station で扱う

- **実装**: 機械 def +31 件 (計 143)、station +9 件 (計 21)、Refined Storage の汎用リフレクション probe op、Waystones の warp スキル、Ad Astra 酸素チェーンの def、TFC / GregTech のコア def

- **根拠**: ユーザー指示「全部対応アリにしたい。実機検証はまだいいけど」(2026-11-01) + 同日の mod 対応監査


## D27. コントラプションの「難しい部分」への着手 (2026-11-01)

- **決定**: D26 の切り分けで「難しい」とした運転と甲板歩行にも着手する。D21 の「コントラプション制御は対象外」は、組み立て済み構造の *運転・乗車・甲板上の移動* については probe 実装で前進させる (構造自体の設計・形成は従来どおりプレイヤー/設計図の仕事)
- **実装**: contraption.status / contraption.ride op (反射で座席解決 + interactAt)、ride / train_drive / deck_walk スキル。運転は move.set の通常移動入力で試し、効果は status の速度で測る
- **根拠**: ユーザー指示「難しい部分もやってみようぜ」(2026-11-01)

## D28. ツールゲート (見せ方の制御) (2026-11-01)

- **決定**: MCP ツール数の削減は、ツールの統合・改名 (破壊的変更) ではなく「見せ方の制御」で行う。全ツールは登録したまま、ホストに見せる集合をゲートで切り替える
- **仕組み**: (1) mod 連動 — projecte_status / refinedstorage_status / contraption 系 / quest 系 / jei_search / warp は、対応 mod が導入されている時だけ出す (agent-mod の meta.mods で判定)。(2) 既定オフ — 低頻度ツール 19 件は普段隠す。(3) 設定ファイル data/tool-config.json の enabled / disabled で誰でも上書きでき、"group:build" 等のグループ指定も可。ファイルは15秒周期で読み直すので再起動なしに反映。(4) AIBOU_TOOL_PROFILE=full で全表示 (検証・fixture 用)
- **理由**: 統合・改名は fixture と他ホスト (Codex) の互換を壊す。disable() による非表示は tools/list から消えるため、トークン消費と選択の迷いは統合と同等に減らせる。ユーザーの「導入 mod に必要なツールだけオンオフ」「不要なツールは設定でオンオフできたらみんな助かる」の意向に直接沿う形
- **根拠**: ユーザー指示 (2026-11-01、ツール多すぎ問題への提案承認 + mod 連動トグルの追加提案)

## D29. ドメイン統合 (D28 の第二層) (2026-11-01)

- **決定**: 薄いラッパーの集まり 27 ツールを、action 振り分けの 7 ドメインツールに統合する: quest (list/inspect/frontier/plan/claim/aside)、schematic (inspect/plan/create)、journal (read/checkpoint/snapshot/session_summary/resume_plan)、approvals (list/approve/deny)、task (status/result/cancel_all)、screen (read/click/close)、bots (status/multi/loop_status/loop_resume)
- **理由**: D28 のゲートは軽い環境で効くが、mod の多い環境 (本番パック・ATM9) ではゲート対象が軒並みオンになり削減が頭打ちになる。統合は環境に依らない削減で、両方合わせて初めて重い環境でも効く
- **実装方針**: 旧ハンドラ本体をそのまま名前付き定数に移し、ドメインツールが action で振り分ける (ロジック変更なし)。fixture 9 本の呼び出しも新形に移行済み
- **互換性**: ツール名の破壊的変更。他ホスト (Codex) は新名への追随が必要。allowlist は 102 → 82
- **根拠**: ユーザーの懸念提起 (2026-11-01「mod多い環境だと結局多くなっちゃいそう」) + 最終判断は凛に委任 (同日)

## D30. 遊び方ベースの抜け埋め (2026-11-01)

- **決定**: 実機検証の前に「実際の mod パックの遊び方」から逆算して抜けを埋める。ツール数が増えることは許容する (ユーザーの意向: 機能が全部できる方が嬉しい)
- **実装したもの**: quest_prepare (クエスト→素材不足の橋渡し)、commission (配置後設定の実行フレームワーク。計画は機械定義の commission 配列か引数で渡す)、cave_assist (随行・松明・鉱石手伝い・戦闘アシスト。敵対判定はバニラ既知リストのみ)、lead_back (breadcrumb を逆に辿る帰り道案内)、branch_mine (支坑つき直進掘り)、ranch (繁殖・ミルク・毛刈り・回収)、clear_area (整地。fill は未対応)、recover (deathpoint 記録→死に戻り回収。記録は runner の死亡フック)、expedition_prep (装備・酸素・食料の実測チェック)、pattern_encode (AE2 端末のレイアウト調査ドラフト)、entity.attack op
- **道の記憶**: cave_assist が入口を cave_entry waypoint に記録し、移動経路を data/cave-trail.json に残す。lead_back が逆順に辿る
- **根拠**: ユーザーとの遊び方棚卸し (2026-11-01)。commissioning / パターン作成 / クエスト素材 / 戦闘 / 整地 / 畜産 / 環境スーツ / 死に戻りの 8 件 + 一緒に洞窟・ブランチマイニング + 洞窟の道記憶の要望

## D31 3層分担の見直しと CombatTask (2026-11-01)

- 実行の分担を mod / bridge / LLM で割り直す方針を
  `docs/design-layering.md` に定めた。原則: 反応速度が要るものは
  mod、ファイル・索引が中心なら bridge、意味と価値の判断は LLM。
  下層に降ろすのは力学のみで、タスクは数秒〜数十秒の粒度に切り、
  LLM が節目を見て介入できる形を保つ (一緒に遊ぶ仕組みの維持)
- 第1弾として戦闘ループを mod 側タスク化: CombatTask +
  `combat.engage` op。対象は entity_id 指定 or types フィルタ
  (対象種別の方針は呼び出し側)、anchor/leash で範囲を縛り、
  攻撃は実クールダウン基準。終了理由 (killed/cleared/no_target/
  timeout/low_hp/leash) と戦績を task.done で返す
- cave_assist の JS 戦闘ループ (550ms) は engage 呼び出しに置換。
  新スキル `fight` は engage の薄いラッパ
- `entity.attack` は単発プリミティブとして残す (判断はタスク側)
- 降ろす候補の残り: 条件待ちタスク (P1)、contraption 追従 (P2)、
  BuildTask (P2)、Fishing/Drive/Glide (P3)。実機検証は従来どおり
  まとめて行う

## D32 条件待ちタスクと BuildTask (2026-11-01)

- `wait.condition` + WaitConditionTask: 条件 (block / entity_count /
  inventory / menu_slots、cmp gte|lte|eq|ne、mode all|any) を mod 側
  で評価して待つ汎用タスク。timeout でも SUCCEEDED + reason=timeout
- 配線: world_craft の wait_transform (entity_count ne) と
  wait_block_state (block)、process_in_machine の出力待ち
  (menu_slots) を置換。旧ポーリングはフォールバックとして残置
- `build.place` + BuildTask: 絶対座標のブロック列を mod 側で消化。
  冪等 skip、占有セルは壊さない、同 id・props 不一致は mismatched
  として報告、在庫内移動 (hotbar 選択 / main から swap) と facing
  の立ち位置もタスク側。build_schematic は計画+回転 (bridge) と
  バッチ集計だけに
- 副産物: D30 の clear_area.mjs に潜在的な構文エラー (description の
  apostrophe) がありスキルが読み込まれていなかったのを発見・修正。
  全スキルの構文スイープも実施 (他は正常)

## D33 残りの降下候補をすべて mod タスク化 (2026-11-01)

- DeckFollowTask (`contraption.follow_local`): ローカル→グローバル
  変換 + 素の移動入力で甲板上を追従。キーは終了時に必ず解放
- FishingTask (`fishing.start`): 投げる→水中の浮きの急落下で
  アタリ検知→合わせる。釣果の数え上げは bridge (インベントリ差分)
- DriveTask (`drive.start`): 乗車中に入力を保持し速度を観測。
  Create が素のキーを読むかは従来どおり実機未検証
- GlideTask (`glide.start`): 空中前提で目標点へ姿勢制御。離陸の
  段取りと花火ブーストは bridge に残した (ブーストは task.status を
  見ながら定期発射)
- 対応スキル (deck_walk / fishing / train_drive / fly_elytra) は
  起動と結果の翻訳だけに。これで design-layering の降下候補は全て
  消化した

## D34 schematic 意味プリミティブ (2026-11-01)

- schematic_create に意味 op を追加: machine_row / cable_run /
  power_spine。幾何 op と混ぜて使え、展開は決定的
- 生成物は .schem + manifest (戻り値と <name>.manifest.json
  サイドカー): 機械の座標・facing・面の宣言 (絶対方向に解決)、
  ケーブル本数、commission 計画 (machines/*.json に計画がある
  機械のみ、現状は未登録なので空)
- 面と電力の扱い (大晃の確認への回答として明記): 面は「宣言」で
  あって実機の読み取りではない。GUI スロットは defs で分かるが、
  ワールド面の設定・通電・残量を読む op は無い。v1 は宣言 →
  (計画が用意できれば) commission で寄せる方針。デフォルト面
  テーブルの整備は実機データ待ち
- cable_run の経路は x → z → y の直角経路 (決定的)

## D35 (2026-11-01): cave_assist の「一緒に」調整と同伴/単独プロファイル

- cave_assist は既定で together モード: 寄り道の予告・戦闘後の
  声かけ・追随不能時の申告を行い、プレイヤーの作業圏 (3m) の
  鉱脈は掘らない (掘削中に寄ってきたら譲る)。quiet で無言化。
- 足場はプレイヤーが作り bot が辿る分担を現行仕様とする
  (自力足場は保留候補)。
- 同伴/単独で挙動を変えるプロファイル約束を採用。切替は
  プレイヤー近接の自動検出を第一候補とし、展開は段階的に。

## D35 追補 (2026-11-01): 発見の共有
- ダイヤ等の notable 鉱石は together では掘らずに知らせて残し、
  発見イベントは LLM に返す。アイテムの入手より「見つけた」を
  一緒に喜ぶ瞬間を優先する (大晃の指摘)。

## D35 追補2 (2026-11-01): 掘る役はツールで決まる
- inventory_detail にエンチャント (id/レベル) を含める。
- notable 鉱石の掘る役は幸運の有無で決める。凛が幸運持ちなら
  申告し、プレイヤーが近づいたら凛が掘る。申告は幸運がある時
  だけ (無い時の申告はノイズという大晃の整理)。

## D35d (2026-11-01): 掘る役の材料は観測 + 申告メモ
- プレイヤーの手持ちは観測する (obs.entity の held)。所持の
  申告は party-tools に覚え、判定では観測と申告を max 合算する。
- 同伴/単独プロファイルの横展開点検を実施 (design-layering.md)。
  追加の分化は点検リストから裁定する。

## D36 (2026-11-01): 同伴/単独プロファイルの横展開
- 点検で推奨とした 6 件 (branch_mine 同伴版、fishing の隣接、
  build の進捗告知、logistics の取り出し前告知、expedition の
  プレイヤー装備確認、自律ランナーの同伴時停止) を全て実装。
- 各スキルの mode 既定は auto とし、プレイヤー近接で同伴に
  寄ることを全体の約束とする。

## D37 (2026-11-01): 序盤の穴埋めと進行の置き所
- 狩りは専用スキルを作らず fight の targets 拡張で受ける。
  倒した後のドロップ掃引まで含める。
- 整地は fill を clear_area に統合。明かりは設計と分離した
  後付けパス light_up とする。
- 全体の流れ (初日に限らず) は LLM とプレイヤーの会話で決める。
  決定的に用意するのは部品と安全層とチェックリストまで。

## D38 (2026-11-01): 洞窟・資源フェーズの補強
- 携行チェックは汎用スキル outing_prep として用意する。
- 危険対策は「先読みして止まる」を既定とする (奥の溶岩・
  横の溶岩・足元なし)。掘り続ける判断は LLM/プレイヤーへ。
- インベントリ満杯は「LLM に知らせるまで」が機械の仕事で、
  帰る判断は LLM に委ねる。
- 場所の記憶は bridge 側 places に置く (鉱石・洞窟・目印)。
  cave_assist の自動記録と手動の places スキルで読み書きする。
