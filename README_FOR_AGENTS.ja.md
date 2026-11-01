# aibou-mc — AIエージェント向け README

[English](README_FOR_AGENTS.md) | 日本語 | [人間向け README](README.ja.md)

あなたは aibou-mc を**操作**または**開発**するAIエージェント（MCPホスト /
LLM）です。aibou-mc はモッド環境の Minecraft 1.20.1 (Forge) 向けの、
LLM駆動コンパニオンプレイヤーです。この文書は運用上の契約です。人間向け
README は人向けの導入を扱い、こちらはあなたが正しく動くために必要なことを
扱います。

## システム構成

```
あなた (MCP ホスト)
  │  MCP over HTTP  http://127.0.0.1:25589/mcp   (設定時は Bearer BRIDGE_TOKEN)
  ▼
bridge (Node/TS, bridge/) — MCP ツール、スキル、ジャーナル、ツールゲート、チャットランナー
  │  WebSocket JSON-RPC  ws://127.0.0.1:25587
  ▼
agent-mod (Forge クライアントmod, agent-mod/) — ゲームプリミティブ + 動詞タスク
  ▼
Forge 1.20.1 サーバ上の Minecraft クライアント (ボットアカウント「Rin」)
```

頼りにしていい事実:

- ポート: mod の WS は **25587**、bridge の MCP は **25589**
  （`GET /healthz` が bridge と mod の接続状態を返し、`GET /events` は
  SSE のイベントストリーム）。
- ボットは実在のクライアントで、実際のインベントリ・体力・位置を持つ。
  ボットの行動はすべて他のプレイヤーから見え、ゲームの制約を受ける。
- アイテム/ブロック/エンティティのアドレスはすべてレジストリID
  （`modid:name`）。IDを推測しないこと——`registry_items`、`find_item`、
  `knowledge` で引くこと。

## 接続

1. bridge が起動していること（`cd bridge && npm run build && node
   dist/index.js`）、ボットのクライアントがゲーム内にいること。まず
   `/healthz` を確認: `mod: true` がゲーム側の接続を意味する。
2. MCP ホストは `http://127.0.0.1:25589/mcp` を向ける。エンドポイントを
   localhost の外に出す場合は `BRIDGE_TOKEN` が必須で、
   `Authorization: Bearer <token>` として送る。トークンの値は慣例として
   チャットやログに決して出さない——リポジトリの外に置かれる。
3. 外部ホストとして接続する場合は、内蔵のチャット→LLM ランナーを切る
   （`RUNNER=off`）。2つのホストが同じチャットに二重応答しないため。

## ツールモデル

提示されるツールは3つの規則で形作られます:

- **ツールゲート（mod連動）。** 特定の mod を必要とするツール（FTB
  Quests、AE2、Create、ProjectE など）は、その mod が接続中のパックに
  ある時だけ提示される。mod 未接続なら、壊れているのではなく隠れる。
- **グループ/既定値。** 低頻度の管理/デバッグ/建築ツールは既定でオフ。
  `bridge/data/tool-config.json`（`enabled`/`disabled` リストとグループ
  スイッチ）で再起動なしに調整できる。開発とフィクスチャ実行は
  `AIBOU_TOOL_PROFILE=full` で全提示にする。
- **ドメインツール。** 近い薄ツールはアクション振り分けのドメインツールに
  統合されている——旧来のアクション別名称は存在しないので、この名前を
  使うこと: `quest`（list/inspect/frontier/plan/claim/aside）、
  `schematic`（inspect/plan/create）、`journal`（read/checkpoint/
  snapshot/session_summary/resume_plan）、`approvals`
  （list/approve/deny）、`task`（status/result/cancel_all）、`screen`
  （read/click/close）、`bots`（status/multi/loop_status/loop_resume）。

層は下から:

1. **プリミティブ**（mod の操作）: `get_state`、`get_chat`、`send_chat`、
   観測（`look_info`、ツール経由の `obs_*`）、`move`、`dig`、`look_at`、
   `equip`、`toss`、コンテナ操作、Baritone（`goto`、`mine`、`follow`）…
2. **mod タスク**（数秒〜数十秒の動詞チャンク）: `combat.engage`、
   `combat.shoot`、`build.place`、`wait.condition`、`fishing.start`、
   `glide.start`、`drive.start`、`contraption.follow_local`。各タスクは
   `task_id` を返し、完了は結果オブジェクト付きの `task.done` イベントで
   届く。**タスクは意図的にブラックボックスにしていない**: 節目の
   イベントを出すので、途中で語り、止め（`task` cancel）、進路を変えられる。
3. **スキル**（bridge、`skills/*.mjs`、47個）: 判断の要る手順——
   `cave_assist`、`branch_mine`、`process_chain`、`build_schematic`、
   `logistics`、`dragon_fight` など。プリミティブの手組みよりスキルを
   優先すること。パック固有の教訓がそこに符号化されている。

## 行動契約

以下は提案ではなく設計判断（docs/decisions.md）です:

- **プレイヤーと一緒に遊ぶ。** スキルは `mode: auto|together|solo`
  を取る（`auto` = プレゼンス連動）。同伴モード: 行動前に声をかけ、
  貴重な発見を共有し（ダイヤ/エメラルド/古代の残骸は知らせて、
  一緒に掘るために掘らずに残す）、プレイヤーの作業範囲を譲り、
  幸運の所有で掘り役を分ける（プレイヤーの手持ちを観測するか、
  `party_tools` の申告を使う）。単独モード: 静かに働き、記録は
  要約のみ。
- **未知の次元は、先回りで解かずに探索する。** 次元の振る舞いは
  プロファイル（`dimension_profile` スキル）に、プレイヤーと一緒に
  探索しながら起草する。層3の知識は補完には使えるが、初回訪問の
  体験の代わりにはしない。
- **危険な操作は止まって聞く。** 自律ゲートが DANGEROUS な操作
  （例: `chat.command`、`toss`、`sign.write`、`container.repo_action`、
  `quest.claim`）を捕捉する: 呼び出しは APPROVAL_REQUIRED を返し、
  プレイヤーがチャットで `.ok`/`.deny` と答え（あるいはプレイヤーの
  指示で `approvals` ツールを使い）、承認はそのメソッドを約5分間
  開く。自律レベル: 0 = 観測のみ、1 = 通常プレイ（既定）、
  2 = 事前承認セッション。
- **記憶の置き場所は種類ごとに1つだけ。** ウェイポイントは mod 側、
  ジャーナル・場所・パーティ申告・次元プロファイルは bridge
  （`bridge/data/`）、関係/エピソードの文脈はホストLLM側。作業
  しながらジャーナルへチェックポイントを書くこと——再起動後、
  次セッションは `journal resume_plan` で続きから始める。
- **意図ではなく結果を報告する。** スキルが返ったことは世界が
  変わった証拠ではない。状態/インベントリ差分で確かめること
  （スキル側は事後条件を持ち、`FAILED(POSTCONDITION)` は世界が
  期待状態に届かなかったことを意味する）。

## 知識

mod の振る舞いを捏造する前に `knowledge` ツールを使うこと:

- **層1 — ゲームデータ**: レジストリ（`registry_items`、
  `registry_blocks`）、レシピ（`recipe_lookup`）、実地プローブ
  （`probe_energy` — クライアント側の目安値）。
- **層2 — jar内蔵ドキュメント**: パックごとに抽出された Patchouli
  ガイドと言語ファイルが `knowledge/<modid>/` に入り、`knowledge`
  （search/get/mods）で検索できる。再生成は
  `tools/extract_knowledge.py --mods-dir <dir>`。
- **層3 — ソース由来ルール**: `mod-knowledge/rules/<mod>@<version>.json`。
  全ルールが repo@commit + ファイル + 逐語引用を持つ（`knowledge` の
  action `rules`。検索もルールにヒットする）。ルールはインスタンスや
  パックを越えて共有される——mod を再解析する前にカバレッジを
  確認すること（`tools/knowledge_coverage.py`）。
- **プレイヤーへの回答**: チャットの質問には層1〜3を基に答える。
  近くに機械を置いて実演するのも正当な答え方。

## 開発

- ビルド: `cd agent-mod && ./gradlew build`（Java）、`cd bridge &&
  npm run build`（tsc）。スキルはホットリロードされる `.mjs` で、
  ビルド不要。
- Minecraft なしのテスト: `tools/mock-mod/` がゲーム側を模倣し、
  `tools/fixtures/*.mjs` のフィクスチャ（37本）が bridge の通し
  フローを駆動する（ジャーナルの永続化、承認、戦闘、建築、クエスト、
  知識）。単体チェックは `tools/verify-*.mjs`。フィクスチャの注意:
  スタブ登録はフィクスチャの `script(ctx)` スコープに置くこと。
  スキルの結果はジャーナルの `work.end` エントリ経由で表れる。
- 機械定義: `machines/*.json`（`process_in_machine` 用のスロット
  配置）。ステーション定義: `stations/*.json`（`world_craft` 用の
  振付）。未検証マークの定義は草案——実機の振る舞いは未証明として
  扱うこと。
- 正本の判断記録: `docs/decisions.md`（D1…）。層分けの根拠:
  `docs/design-layering.md`。知識の設計: `docs/design-knowledge.md`。
  実機検証の積み残し: `docs/verification-m2.5.md` +
  `docs/followup-2026-11-01.md`。

## 既知の限界（過大に主張しないこと）

- AE2 自動クラフト: パケット経路は実装済み。パターン供給ネットワーク
  での実ジョブ完了は未検証。`pattern_encode` は調査のみ。
- `commission`（配置後の機械設定）: 枠組みは稼働、同梱プランはゼロ——
  プランは実機GUIデータから起こす。
- Java 側の機構いくつか（盾ガード、クリーパーのカイト、射撃の弾道、
  エフェクト値）はコンパイル/フィクスチャ検証済み。実機確認は
  共同プレイセッション向けに一括で積んである。
- サブボットは観測専用。コマンドのルーティングは未実装。
- エンチャントと醸造は定義のみ（エンチャント台/醸造台と mod の
  変種）。どちらも統括するスキルは無い——プレイヤーに約束しないこと。
- 長時間ソークテストは未実施。

## 安全性

- バインドは既定で localhost。`BRIDGE_TOKEN` なしに bridge を
  外部に出さないこと。トークンをチャットに貼るよう人に求めないこと。
- `run_command` はボットの権限レベルで走る。管理していないサーバでは
  ボットに OP を付けないこと。
- ボットのインベントリや EMC/知識の進行は*ボットのもの*であり、
  プレイヤーのものではない——プレイヤーの成果として提示しないこと。
