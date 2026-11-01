# 3層分担の見直し (2026-11-01、D31 検討)

aibou-mc の実行を mod / bridge / LLM の3層で割り直す。
大前提: **「LLM と一緒に遊んでいる」仕組みを守る**。下層に降ろすのは
力学であって、遊びの判断と存在感は LLM 側に残す。

## 配置の原則

1. **反応速度**: tick〜100ms の反応が要るものは mod (反射、間合い、照準)
2. **世界への近さ**: ゲーム内オブジェクトを毎 tick 読む/書くものは mod。
   ファイル・索引・外部データが中心なら bridge
3. **判断の寿命**: 安定した力学は mod、試行錯誤の多い手順は bridge
   (JS の方が直しが速い)、意味・価値・目標の判断は LLM
4. **一緒に遊ぶ粒度**: mod タスクは数秒〜数十秒の「動詞の塊」に切り、
   節目のイベントが bridge 経由で LLM に見えるようにする。LLM は
   いつでも止められる・方向を変えられる・声をかけられる。
   下層をブラックボックスにしない
5. **正本は1か所**: waypoint は mod、journal/索引は bridge、
   関係性と好みは LLM 側メモリ (既存の裁定どおり)

## 層ごとの責務 (現行の棚卸し)

### mod (System 1: 力学と反射)
適正に置かれているもの:
- ReflexPolicy (溺れ・撤退・食事などの反射)
- タスク群: Goto / Follow / Dig / Mine / Craft / Eat / Sleep /
  UseHold / Emote / LookInfo (AgentTask 基盤、postcondition 付き)
- 単発 op: container / screen / equip / use_item / interact /
  entity.attack などのプリミティブ
- 世界データの問い合わせ: obs.* / recipe.lookup / registry.blocks /
  quest.list (同期済みデータはクライアントにしかない)
- waypoint 正本 (D20)、JourneyMap 連携
- contraption.status の反射読み取り (座標変換は mod の知識)

### bridge (System 1.5: 手順と記憶と舞台管理)
適正に置かれているもの:
- スキル層: 複数ステップの手順 (world_craft、logistics、farm、
  build_schematic の段取り、commission の解釈)
- 記憶と索引: journal、quest graph、ブロックカタログ、trail
- runner (LLM 駆動ループ、プロンプト構築、Run/Hold)
- 安全: autonomy gate (方針判断)、toolgate (見せ方)
- schematic の読み書き・生成 (LLM との対話と一体)
- direct-parse (即時コマンドの振り分け。実行は下層タスク)

### LLM (System 2: 遊び相手)
- 目標設定、計画、優先順位、裁定
- 会話、気づき、声かけ、途中介入 (cancel / redirect)
- 結果の解釈と次の行動の選択

## mod に降ろす候補 (優先順)

- **P1 CombatTask** ✅ 実装済み (D31): 戦闘ループ (接近・照準・クールダウン攻撃・
  リーシュ・HP中断)。cave_assist の JS ループ (550ms) を置換する。
  「何を敵とみなすか」は方針パラメータとして外から受ける (力学と
  判断の分離)。postcondition = 対象の死亡確認
- **P1 条件待ちタスク (wait.condition)** ✅ 実装済み (D32): block state / entity 数 /
  inventory 内容などの条件が満たされるまで mod 側で待つ汎用タスク。
  world_craft の wait_transform、cook の再オープンポーリング、
  process の完了待ちなど、bridge のポーリング群をまとめて置換
  できる高レバレッジなプリミティブ
- **P2 contraption 追従タスク** ✅ 実装済み (D33): deck_walk の 350ms 再照準ループを
  「移動体上のローカル座標へ移動する」mod タスクに (座標変換は
  mod 側の知識なので相性が良い)
- **P2 BuildTask** ✅ 実装済み (D32): build_schematic の配置ループ (1ブロックごとに
  WS 往復) を、ブロック列を mod が消化する形に。大規模建築・
  工場で効く。大きいので段階導入
- **P3 FishingTask** ✅ 実装済み (D33): 浮きの沈み込みを tick で監視 (アタリの窓は短い)
- **P3 DriveTask** ✅ 実装済み (D33): train_drive のキー保持+速度監視を mod 側に
- **P3 GlideTask** ✅ 実装済み (D33): fly_elytra の姿勢制御を目標点滑空タスクに

## 降ろさないもの (理由つき)

- commission の手順解釈: GUI は mod ごとに変わり試行錯誤が多い。
  解釈は bridge、クリック実行は mod op のまま
- quest_prepare のような集計・比較: データ加工は bridge の領分
- schematic 生成: LLM との対話そのものなので bridge/LLM に残す
- journal・記憶の正本: bridge (D-メモリ設計の裁定どおり)

## 実施順序

CombatTask ✅ → wait.condition ✅ → BuildTask ✅ → contraption 追従 ✅ → Fishing/Drive/Glide ✅ (全候補消化、D33)
各タスクは「開始 op + task.done (理由と戦績) + cancel 可」の形に
統一し、LLM が節目を見て介入できる粒度を保つ。

## 同伴/単独プロファイル点検 (2026-11-01, D35 の横展開確認)

原則 (D35 で確立): 同伴 = 予告・譲り合い・声かけはライブ、
単独 = 無言・効率・journal 要約のみ。切替信号はプレイヤー近接。

### 既に分化している
- cave_assist (D35〜D35d): mode、鉱脈の譲り合い、発見の共有、
  掘る役のツール判定まで同伴専用挙動が入った。
- ReflexPolicy / CombatTask の hp_abort: 単独時の生存判断は
  mod 側で常時。同伴時の戦闘はプレイヤーアンカー (守る形)。

### 分けた方がいい (推奨)
- branch_mine: 現行は単独専用。同伴版は「並走・合流で待つ・
  溶岩/落下の警告を声に出す」が要る。単独は現行のまま。
- fishing: 同伴時はプレイヤーの隣に陣取る (場所取り自体が社交)。
  単独は定点・無言でよい。
- build 系 (build_schematic/build_prepare): 同伴時は層ごとの
  進捗一言と資材不足の声かけ。単独は完了報告のみ (現行)。
- logistics: 同伴時は共有ストレージから出す前に一言 (無断持ち
  出し感の回避)。単独は記録のみ。
- expedition_prep: 同伴時はプレイヤーの装備も観測/申告ベースで
  チェックに含める。単独は凛のみ (現行)。
- 自律ランナー全般: 一緒に遊んでいる間は新規の自律作業を勝手に
  始めない (割り込みマナー)。自律の主戦場は不在時。

### 分けなくていい
- quest_prepare / commission / pattern_encode 等の道具系スキル
  (状況判断ツールなので不変)。
- farm / ranch: 任された拠点作業として両モード同じでよい
  (同伴時の収穫一言は軽微、様子見)。
- recover: 挙動は不変。同伴時は死亡地点をプレイヤーにも一言
  知らせる程度。
- lead_back / warp: 移動手段は不変。ただし lead_back は現行が
  「凛が先導して案内する」同伴向きの設計。単独帰還は別経路。
