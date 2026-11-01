# 層3 Tier-B バッチ計画 (D57 の実行計画)

作成: 2026-11-01。方針は decisions.md D57 (二層化・運用可能性で
深さを配分・急がない・深さは少し深めに倒す)。手順は
mod-knowledge/README.md の Analysis playbook に従う。
本書は「対象と順番」の確定まで。解析の実行は後日、波ごとに。

## 範囲の決め方

- 母集団: 2026-11-01 mod 監査 (docs/mod-support-audit-2026-11-01.md)
  の本番パック 1.20.1 (266 jar) 分類。
- 除外: ライブラリ/クライアント/性能系 約125 jar (質問対象の
  ルールを持たない)。JEI・JourneyMap・EMI 系プラグイン等の
  ユーティリティも同様 (連携は既存のまま)。
- 除外: 深掘り済みの5テーマ (ProjectE / AE2 本体 / Twilight
  Forest / Mekanism 本体群 / RFToolsDim)。ただしアドオンは
  本体と別物のルールを持つため対象に入れる。
- 単位: jar でなく mod ファミリー単位に束ねる (Thermal 7 jar =
  1単位、ProjectRed 7 jar = 1単位 等)。結果として全48単位、
  約110 jar をカバーする。監査の「約60」は jar 寄りの概数。

## 深さの定義 (D57 修正)

- 中 (medium): 運用可能系 (機械/マルチブロック/エネルギー/
  進行を bot が回す・建てる)。目標 10–20 ルール: 中核機構 +
  運用数値 + 失敗モード。
- 軽 (light): 受動系 (モブ/バイオーム/ルート/食品/装飾)。
  目標 5–10 ルール: 中核機構 + 主要数値/ゲート + ハマり所。
- 迷ったら深い方 (大晃の較正)。実質問がカードを超えたら
  その mod を深掘りに昇格 (D57 の昇格シグナル)。

## 波の構成と順番

### Wave 1 — 隣接テーマと滞留解除 (8単位)

D51 の endgame 再開と、キュー済み技能 (エンチャント/醸造)
に直結するものから。

| # | 単位 | パック版 | 深さ | 備考 |
|---|------|---------|------|------|
| 1 | Create | 6.0.8 | 中 | sources.json 登録済。SU/RPM/加工レシピ系。コントラプション制御は運用対象外だがルールは質問対象 |
| 2 | Botania | 1.20.1-456 | 中 | 登録済。マナ生成/機能花/ゲート |
| 3 | Ars Nouveau | 4.12.7 | 中 | 登録済。ソース/グリフ/apparatus |
| 4 | Tinkers' Construct | 3.12.1.231 | 中 | 登録済。精錬/合金/素材特性。実機検証候補とも連動 |
| 5 | Ad Astra (+ Giselle Addon) | 1.15.21 / 6.27 | 中 | D51-7 の前提。ロケット/酸素/惑星ゲート |
| 6 | Enchanting Infuser | 8.0.3 | 中 | エンチャント技能キューの前提知識 |
| 7 | ProjectE アドオン (ProjectExpansion + PE Integration) | 1.1.3 / 7.2.5 | 中 | 本体 D52 の隣。matter 階梯/final star |
| 8 | AE2 アドオン (AEAdditions / Applied Flux / AppliedE / Applied Mekanistics / Applied Botanics) | 5.1.1 ほか | 軽 | D53 の隣。セル/変換の追加分のみ |

### Wave 2 — 大型テック系 (9単位)

| # | 単位 | パック版 | 深さ | 備考 |
|---|------|---------|------|------|
| 9 | Thermal 系 (Foundation/Expansion/Dynamics/Cultivation/Innovation/Locomotion/Integration + Thermal Extra) | 11.0.x / 3.3.3 | 中 | def 15×7 の裏付け。ダイナモ/増設/加工数値 |
| 10 | Immersive Engineering (+ Immersive Petroleum) | 10.2.0-183 / 4.3.1 | 中 | マルチブロック/電線損失/石油蒸留 |
| 11 | EnderIO | 6.2.18-beta | 中 | コンジット/機械/エンチャンター (技能キュー隣接) |
| 12 | Forestry | 2.11.1 | 中 | 養蜂/樹木育種/マルチファーム |
| 13 | RFTools 系 (Base/Power/Utility/Storage/Builder) | 5.0.7 ほか | 中 | D56 の隣。crafter/電力/Builder は質問対象のみ |
| 14 | Industrial Foregoing | 3.5.22 | 中 | レーザードリル/機械群 |
| 15 | Energized Power | 2.15.22 | 中 | def 16 の裏付け |
| 16 | Evolved Mekanism | 1.3.0-fix1 | 中 | D55 の隣。追加機械/素材 |
| 17 | Mystical Agriculture (+ Agradditions) | 7.0.24 / 7.0.12 | 中 | エッセンス階梯/作物成長/infusion |

### Wave 3 — 魔法・装備・食のシステム系 (6単位)

| # | 単位 | パック版 | 深さ | 備考 |
|---|------|---------|------|------|
| 18 | Mana and Artifice | 3.1.11 | 中 | 魔法進行/派閥/儀式 |
| 19 | Apotheosis (+ Apothic Attributes) | 7.4.8 / 1.3.7 | 中 | アフィックス/ジェム/サルベージ。数値質問が濃い |
| 20 | Silent Gear | 3.6.7 | 中 | 素材特性/グレード/シナジー。数値主体 |
| 21 | Farmer's Delight 本体 | 1.3.4 | 中 | cook スキルの裏付け。鍋/作物/効果 |
| 22 | TofuCraft Reload (+ TofuCreate) | 5.18.4.1 | 軽 | 次元+豆腐加工 |
| 23 | Sakura | 1.1.16 | 軽 | 食品/装飾/温泉等 |

### Wave 4 — 軽量テール (25単位)

全て軽。順番は「聞かれやすさ」の見立て。

| # | 単位 | パック版 | 備考 |
|---|------|---------|------|
| 24 | ProjectRed (7 jar) | 4.21.0 | ロジック/配線。構築は運用対象外 |
| 25 | FTB Quests 本体 | 2001.4.22 | タスク種別/依存/報酬の意味論 (API は検証済) |
| 26 | Create アドオン群 | 各種 | うち Enchantment Industry (2.5.4b) / Diesel Generators (1.3.12) / Ore Excavation (1.6.6) / Crafts & Additions (1.3.3) は機械系として中寄り、残り (Dragons Plus / Central Kitchen / Confectionery / Gunsmithing / Mechanical Companion / Vinery / Winery / Bitterballen / Deepfried / Factory) は軽 |
| 27 | TiCon アドオン群 (TicEX / Twilight Construct / TC Integrations / Create TiCon Compat) | 各種 | 本体 Wave 1 の後 |
| 28 | Croptopia (+ Additions / Farmer's Croptopia) | 4.0.1 | 作物/料理 |
| 29 | Pam's HarvestCraft 2 (Crops/FoodCore/Trees/Food Extended) | 1.0.x | 作物/果樹/食品 |
| 30 | FD アドオン群 (23 本) | 各種 | 汎用経路に乗る前提の確認 + 例外 (Brewin' And Chewin' の keg 等の専用 GUI) を拾う |
| 31 | Let's Do 系 (Bakery/Brewery/Vinery/Farm & Charm + Create Winery) | 2.0.6 ほか | 生産チェーン |
| 32 | 食系小型群 (Neapolitan / Collector's Reap / Large Meals / Farmer's Respite / Respiteful / AlcoCraft+ / Chewy Cheeses / Gourmet / BlockDonalds / Create Food) | 各種 | 効果/レシピの要点のみ |
| 33 | Easy Villagers | 1.1.39 | 村人アイテム化/取引リロール |
| 34 | Functional Storage | 1.2.14 | ドロワー/リンク/アップグレード |
| 35 | Steve's Carts | 1.1.21 | 運用対象外。モジュール構成の質問対象のみ |
| 36 | Building Gadgets 2 | 1.0.8 | モード/上限 |
| 37 | Construction Wand | 2.11 | 材質別上限/モード |
| 38 | SlashBlade 系 (Resharped + SJAP Resharpened + 追加刀剣 2) | 1.9.65 ほか | SA/コンボ/ステータス |
| 39 | Advanced Generators | 1.6.0.6 | 発電効率/タービン |
| 40 | Industrial Forestry | 0.4.1 | 小型。ゴム/機械 |
| 41 | ShinColle Kai | 0.13.0 | 艦娘/資源 |
| 42 | Urushi | 6.7.0 | 漆/和風ブロック |
| 43 | Bamboo Everything (bamboomod) | 0.6.2 | 竹加工 |
| 44 | Spice of Life: Apple Pie | 2.3.0 | 食事バフ (soft dep でもある) |
| 45 | DonutMod | 1.0.0 | 小型 |
| 46 | CAC | 2.3.0 | 実行時に正体を同定 (jar 名から確定できず) |
| 47 | Snow Under Trees / Faster Ladder Climbing | — | ルール面がほぼ無い。実行時に最終確認し、無ければ「対象外」と記録して閉じる |
| 48 | Waystones 系 | — | 監査一覧に jar が見当たらない。warp スキルが前提にしているため実行時に在庫を再確認 (あれば軽で追加) |

## 実行時の約束 (playbook の要約)

- 単位ごとに: 版の固定 (タグ優先、無ければブランチ先端+
  理由を source_ref に) → ソースを .sources/ にキャッシュ →
  rules/<modid>@<version>.json + .md → knowledge ツールの
  fixture (p33 型) で検証 → コミット。
- sources.json に未登録の repo は実行時に同定して追記する
  (Wave 1 の4単位は登録済)。
- 1単位 = 1コミットを基本。波の途中でも止められる粒度に
  する (急がない方針なので、中断耐性を優先)。
- 実機検証バッチとは独立に進める。層3 の結果が実機スポット
  チェック項目を増やしたら followup 文書に足す。

## 対象外の再確認

- ATM9 等の他パック専用 mod (Refined Storage 等) は本バッチ
  の対象外。やるなら別バッチ (パック指紋が違う)。
- Integrated Dynamics のロジック構築、Create コントラ
  プション制御は従来裁定で運用対象外。ただし質問に答える
  ためのルール化は裁定の範囲外ではない — 必要になったら
  その時点で判断する。
