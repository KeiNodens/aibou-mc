# 設計: schematic 拡充（D23）

2026-11-01 のユーザー裁定（decisions.md D23）に基づく設計メモ。
「AI と話して schematic を作る」「置くアイテムを一緒に集める」
「チェストから取り出せる」の 3 点を、既存部品の合成 + 不足分の新設で実現する。

生成方式は MineBench（github.com/Ammaar-Alam/minebench）の実証済み
アプローチを踏襲する: 小規模はブロック座標の列挙、大規模は
プリミティブ（block / box / line）のツール呼び出しで組み立て、
書き出しは Sponge .schem。aibou-mc の bridge は .schem 読み取り済み
なので、生成物はそのまま build_schematic で建てられる。

## S1. schematic 生成

### S1a 形式層（bridge のみ）— ✅ 実装済み (2026-11-01, tools/verify-schematic-create.mjs ALL PASS)

- **readSchem の props 分離修正**: 現行は palette の blockstate 文字列
  （例 `minecraft:oak_stairs[facing=north]`）を丸ごと id としており、
  state 付きブロックの配置後照合が一致しない実バグがある。
  litematic 側と同様に id + props へ分離する。materials 集計は
  アイテム id 単位に揃う（材料計算にはその方が都合がよい）。
- **.schem ライター**: Sponge v3（Blocks{Palette, Data} 形式、
  DataVersion は 1.20.1 の 3465）を gzip NBT で書く。NBT 書き出しは
  必要タグだけの最小エンコーダを自前実装する（依存追加なし）。
  palette キーは blockstate 文字列（props はキー昇順で正規化）。
- **蓄積器 + `schematic_create` ツール**: プリミティブ列
  （block / box（hollow 可）/ line）と生ブロック列を受けてグリッドに
  蓄積し、占有範囲にクロップして書き出す。書き出し後に既存の
  inspectSchematic で読み戻し、ブロック数が一致しなければ失敗とする
  （自己検証）。保存先は data/schematics/（SCHEMATICS_DIR で変更可）。
  ゲーム未接続でも動く（生成は会話時の作業のため）。
- 上限: 1 辺 256、総セル 2M、実ブロック 500k。名前と id の形式検証あり。

### S1b カタログ層（mod op + bridge）— ✅ 実装済み (2026-11-01, gradle build OK / tools/verify-catalog.mjs ALL PASS。実レジストリ dump は実機バッチ)

- **`registry.blocks` op**（agent-mod）: BuiltInRegistries.BLOCK を
  ページング列挙し、id / 表示名 / アイテム id / state プロパティ定義
  （名前と取りうる値）を返す。クライアント側レジストリなので
  接続先パックの全 mod block が対象になる。
- **bridge カタログ**: data/block-catalog.json にキャッシュ。
  `block_search` ツールで id・表示名の部分一致検索ができる
  （JEI 検索のブロック版）。カタログがある場合、schematic_create は
  未知の id を弾き、近い候補を提示する。
- **配置検証の下準備は既存だった**: obs.block_state は properties を
  既に返している（確認済み）。S4 ではスキル側がそれを使う。

## S2. build_prepare（材料集め）

schematic の材料集計を起点に、手持ち・施設記憶のチェスト・AE2 ME を
照合し、不足分を組み立てるスキル。

- あるもの: S3 の取り出しで bot のインベントリへ集約
- 作れるもの: craft_plan の再帰計算で工程化し、craft / AE2 に流す
- どうにもならないもの: 不足リストとして報告（プレイヤーの仕事を残す）
- 建材置き場として現場近くのチェストを staging に使う

## S3. チェスト / ME からの取り出し

logistics の fetch を「アイテム指定・個数指定」に拡張する。

- 探す順: bot のインベントリ → 施設記憶のチェスト（近い順）→ ME 端末
- 必要数だけ引き出し、余剰は元の場所へ戻す（deposit 流用）
- 見つからないアイテムは S2 の不足リストへ

## S4. build_schematic v2（配置層）

- **props 検証**: 配置後に block_state の properties まで照合し、
  向き違いを failed ではなく mismatched として報告する
- **配置コンテキスト制御**: facing / axis / half の頻出 props について、
  置く前に bot の立ち位置と視線を目標 state に合わせてから use_item
  する（Litematica プリンタ方式）。全 state の完全再現は追わない
- **自動補充**: ホットバーが切れたらインベントリから補充し、
  インベントリも切れたら staging（S2/S3）から取りに行く
- **回転パラメータ**: plan 段階で 0/90/180/270 度回転（props の
  facing も回転に追随させる）

## 工場・配線への含み（S1 / S4 の発展として設計に含める）

目標は単純な建物だけでなく、mod 機械を詰め込んだ工場も建てること。
配線の手間を bot に肩代わりさせるのが価値の中心になる。

- **配線は「置けば繋がる」が多い**: ケーブル類の接続 state はサーバ側で
  自動計算されるので、配置そのものは schematic で足りる。ただし
  ケーブルの種類選択が機能を決める（AE2 の glass / covered / smart /
  dense と色、Mekanism の tier 等）。生成時はカタログ（S1b）に加えて
  「役割」の注釈で種類を選ぶ。
- **機械は置いただけでは動かない**: 向きに加えて配置後の設定
  （Mekanism の side config、AE2 機器の設定等）が要る。生成スペックに
  .schem と対になる **commissioning plan**（座標ごとの設定アクション列）
  を持たせ、建築後に bot が process_in_machine / screen 系 op で実行する。
- **意味レベルの生成プリミティブ**: 自由な座標生成より、工場パターン
  （machine_row、cable_run、power_spine 等）を op 化した方が歩留まりが
  良い。S1 のプリミティブ拡張として追加していく。
- **規模の現実**: bot の配置速度では大規模工場は複数セッション前提。
  build_schematic の冪等再開（実装済み）と staging（S2 / S3）が前提部品。

## 実装順序

1. S1a（bridge のみ、単体検証で round-trip 確認）
2. S1b（Java は gradle build まで、カタログ検索は fake で単体検証。
   実 dump は実機バッチ）
3. S3 → S2（既存部品の合成が中心）
4. S4（実機での配置挙動の確認とセット）
