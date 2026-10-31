# 設計: waypoint 統合 / world_craft / ProjectE / Create 対応

2026-11-01 のユーザー裁定（decisions.md D20–D22）に基づく設計メモ。
実機検証は従来分と合わせて次回合同セッションでまとめて行う。

## 1. waypoint 統合（D20）

現状は二重管理:

| | mod 側 | skills 側 |
|---|---|---|
| 実装 | `Waypoints.java` | `skills/waypoint.mjs` |
| 保存先 | gameDir `agentmod-waypoints.json` | リポジトリ `bridge/waypoints.json` |
| スキーマ | {x,y,z, r?, dim?} | {x,y,z, dim, set_at} |
| 備考 | r 付き = 領域（反射の安全圏判定）、JourneyMap へミラー | 半径なし、journal 施設記憶に残らない |

**正を mod 側に統一する。**

- `skills/waypoint.mjs` を薄いアダプタに書き換える: remember/goto/list/remove を
  `waypoint.set/get/list/del`（ctx.call）+ `baritone.goto` で実装する。
  言い回しと action 体系は現行のまま。`radius` 引数を追加し MCP 側と同等にする。
- 移行: 旧 `bridge/waypoints.json` があれば、アダプタ初回実行時に
  mod 側に無い名前だけを取り込む（同名衝突は mod 側優先）。
  移行後に旧ファイルは `waypoints.json.migrated` へ改名して残す。
- 検証: fixture で「skill で remember → MCP waypoint_list に見える」
  「MCP で保存 → skill の goto が解決する」を確認する。

## 2. world_craft 実行器（D21）

GUI を持たず「ワールド内操作」で加工する系を、1 つの実行器で受ける。

### 型

投入 → 変化を観測して待つ → 回収。レシピは `recipe_lookup` で引き
（カスタム RecipeType は D17 で対象内）、振る舞いは定義 JSON で与える。

### 定義（stations/*.json、新規ディレクトリ）

```jsonc
{
  "id": "botania_mana_infusion",
  "recipeTypes": ["botania:mana_infusion"],
  "station": { "block": "botania:mana_pool" },   // scan_area で発見
  "steps": [
    { "do": "goto_station" },
    { "do": "toss_inputs" },                      // 材料をステーションへ投入
    { "do": "wait_transform", "timeout_s": 60 },  // item entity の変化を観測
    { "do": "collect" }                           // 近づいて回収
  ]
}
```

ステップ原語: goto_station / toss_inputs / place_on（台座等へ手持ちを置く）/
right_click_station（杖・蛇口等）/ wait_transform / wait_block_state / collect。
事後条件はインベントリ差分で判定する（D19 の「権威ある状態で判定」準拠）。

### 線引き

- ステーションの前提インフラ（マナ供給、動力、形成済み構造）はプレイヤーの担当。
  bot は操作だけを行う。前提が崩れている場合（変換が起きない等）は
  タイムアウトで「何が足りていない可能性が高いか」を報告して止まる。
- 初期定義の候補:
  - Botania: mana_infusion / petal_apothecary / runic_altar
  - AE2: 結晶育成（種を水へ投入して待つ）、fluix 生成（材料を水へ投入）
  - Ars Nouveau: enchanting_apparatus（台座配置の振る舞い）
  - Tinkers: 鋳造（蛇口を開く → 流れるのを待つ → 鋳型から回収）
  - Create: millstone（上に投入）/ fan の水洗い・精霊憑依 / press（depot 上）/
    crushing_wheels（隙間へ投入）

## 3. Create 対応（D21）

- 本体は world_craft のステーション定義として対応する（上記）。
- GUI を持つ単体ブロックは機械定義の候補: deployer、
  mechanical_crafter（形成済み前提。開経路は実機で確認）。
- **コントラプション（列車・回転/移動構造・エレベーター）の制御は対象外。**
  動く構造物上での経路探索は Baritone の前提にない。
- 動力（応力ネットワーク）はプレイヤーが用意する。bot は操作のみ。

## 4. ProjectE 対応（D22）

変換表（transmutation_table）は特殊 GUI のため段階を分ける。

1. **調査（実機）**: GUI を開いて screen_read の構造を取る
   （学習済みアイテムのグリッド、EMC 表示の出所、検索欄）。
   あわせて condenser 等の通常 GUI 系が機械定義に乗るか確認する。
2. **状態読み取りは mod 側リフレクション**: 知識プロバイダ経由で
   EMC 残高と学習済み一覧を返す `projecte.status` op を新設する
   （Jade / AE2 と同じ soft dependency + リフレクション方式）。
   画面テキストの OCR には依存しない。
3. **操作は GUI 駆動の skill `transmute`**: withdraw（学習済みを取り出す）/
   deposit（アイテムを EMC 化する）を、調査で得た slot 配置で実装する。
4. 知識と EMC は bot プレイヤー自身のものとして扱う
   （プレイヤー本人の進行とは分離される。これは仕様として明記する）。

## 5. 「開かない GUI」群の再調査（実機バッチに同梱）

本来 GUI があるのに probe で開かなかった群は、対応可否の前に開経路の
再確認を行う: Tinkers melter / smeltery controller（形成済みで）、
Ars imbuement_chamber、IE crusher / arc_furnace（形成済みで）。
開けば機械定義、開かなければ world_craft か対象外に振り分ける。

## 実装順序（提案）

1. waypoint 統合（自己完結、fixture で検証可能）
2. world_craft 枠組み + AE2 結晶育成 + Botania mana_infusion の定義
3. 実機バッチ: 開経路の再調査、ProjectE 調査、既存チェックリスト
4. 調査結果を受けて ProjectE アダプタ、Create / Ars / Tinkers の定義追加
