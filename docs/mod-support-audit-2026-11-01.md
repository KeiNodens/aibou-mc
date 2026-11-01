# mod 対応監査 (2026-11-01)

Prism の実インスタンスの mod 一覧と、aibou-mc の対応証跡を突き合わせた棚卸し。
「軽く一周」が目的なので、判定は mod ファミリー単位の概算。

## 方法と前提

- mod 一覧: prismlauncher-mcp `list_mods` (有効 jar のみ)。
  対象は本番 `1.20.1` (266 jar)、`All the Mods 9 - No Frills` (324 jar)、
  `All the Mods 9 - To the Sky` (308 jar)。
  なお `atm9-bot` インスタンスは mod 0 件 (空) だった
- 対応証跡: `docs/mod-support.md` の台帳、`machines/*.json` (112 件)、
  `stations/*.json` (world_craft 定義 12 件)、専用 op / スキル
  (ME 在庫 ops、quest API、jei/emi_search、projecte_status、cook 等)
- jar 名 → modid はファイル名の正規化 + alias 表で推定
- **大前提**: 汎用 op (Baritone 採掘・設置、use_item、汎用 container 読取、
  レシピ帳クラフト、entity インタラクト) は全 mod のブロック/アイテムに効く。
  ここでの判定は「その mod の GUI・専用機構まで踏み込んだ対応」の深さ

凡例: ◎ 実機検証済 / ○ 定義あり・未検証 / △ 部分対応 /
× 未対応 (記録あり) / 方針のみ / FD系 = Farmer's Delight 汎用経路に乗る見込み /
記録なし = 対応証跡なし

## 主な発見

1. **Tinkers' Construct 本体が現パックに居る** (`TConstruct-1.20.1-3.12.1.231.jar`)。
   mod-support.md の「現パックは create_tinkers_compat/tinkersdelight のみ」
   という記述は古い。smeltery / casting の実機検証が現パックで可能になった
2. **machines/ には「パック外」扱いだった mod の定義が既にある**:
   powah_furnator、bloodmagic_altar、cookingforblockheads_cooking_table、
   ironfurnaces_furnace、sophisticatedbackpacks_backpack。
   ATM9 ではこれらは「方針のみ」でなく「定義あり」に格上げされる
3. ATM9 の進行管理の本命 **FTB Quests は実機検証済みの資産がそのまま効く**

## 本番パック 1.20.1 (266 jar) の集計

| 区分 | 数 | 主なもの |
|---|---|---|
| ◎ 実機検証済 | 10 | AE2 系 (本体 + AEAdditions + Applied Flux)、Mekanism 系 (本体 + Generators + Tools + Additions)、FTB Quests、JEI、Twilight Forest |
| ○ 定義あり・未検証 | 31 | Thermal 系 (本体群 + Extra、def 15)、Energized Power (def 16)、Forestry (def 9)、Ender IO、Ad Astra、Evolved Mekanism、Enchanting Infuser、Sakura、TofuCraft、MNA、Mystical Agriculture、ProjectE (status op 付き)、Project Red (def あり・挙動特殊の注記)、RFTools Base/Power、Immersive Engineering (単体機のみ)、Farmer's Delight (台帳 [d] だが station + cook スキルで実質 △ 以上) |
| △ 部分対応 | 11 | Botania (station 3 種 / GUI 系は開かない)、Ars Nouveau (station / imbuement は未対応)、Create (station 2 種 / GUI 系は設計上対象外)、Tinkers' Construct (casting station draft / smeltery 未検証)、Industrial Foregoing、RFTools Utility (crafter は ghost slot 系)、Croptopia、Pam's HarvestCraft 2、JourneyMap (waypoint 連携段階)、EMI (コードのみ・パックに無し) |
| × 未対応 | 2 | RFTools Builder、Steve's Carts |
| FD 系アドオン | 23 | Delight 系各種。cook / cutting / farm の汎用経路 (farmersdelight:cooking 等のレシピ型) に乗る見込み。Brewin' And Chewin' の keg のような専用 GUI は個別確認が要る |
| 方針のみ | 2 | Easy Villagers、Functional Storage |
| 記録なし (コンテンツ系の主なもの) | 約 20 | Apotheosis、Silent Gear、Building Gadgets 2、Construction Wand、SlashBlade 系、Immersive Petroleum (IE マルチブロック)、Advanced Generators、Create アドオン群 (Enchantment Industry / Diesel Generators / Ore Excavation 等、Create 本体の station では届かない専用機構)、industrialforestry、ShinColle、Urushi、DonutMod 等 |
| ライブラリ / クライアント / 性能系 | 約 125 | 操作対象を持たないものが大半 |

注: Evolved Mekanism は chemixer 等は定義ありだが solidification_chamber は
「GUI が開かない」未対応が混在。Mekanism の chemical 系は流体主体で △ 扱いが台帳にある。

## ATM9 No Frills (324 jar) の集計

| 区分 | 数 | 主なもの |
|---|---|---|
| ◎ 実機検証済 | 9 | AE2 系 (本体 + AEAdditions + MEGA Cells)、Mekanism 系、FTB Quests、JEI、Twilight Forest |
| ○ 定義あり・未検証 | 21 | 本番と共通の Thermal / Ender IO / IE / Ad Astra / Mystical Agriculture / Farmer's Delight / RFTools 系に加え、定義が効く Powah、Blood Magic、Iron Furnaces、Cooking for Blockheads、Sophisticated Backpacks |
| △ 部分対応 | 6 | Botania、Ars Nouveau、Create、Industrial Foregoing、Croptopia、JourneyMap |
| 方針のみ | 16 | **Refined Storage (専用対応が要る。ATM9 のもう一つの倉庫網で主力なので優先度高)**、Occultism、Waystones、PneumaticCraft: Repressurized (高難度)、Draconic Evolution、Integrated Dynamics 系、XNet / Pipez / Modular Routers (搬送制御・低優先)、Sophisticated Storage、Easy Villagers、Functional Storage |
| × 未対応 | 1 | RFTools Builder |
| 記録なし (コンテンツ系の主なもの) | 約 40 | Productive Bees、Hostile Neural Networks、Extreme Reactors、Flux Networks、Laser IO、RFTools Control、EvilCraft、Nature's Aura、Forbidden & Arcanus、Iron's Spells、Mahou Tsukai、Reliquary、Silent Gear、Quark、Supplementaries、Cataclysm、Stargate Journey、Mystical Agradditions / Customization (本体 MA は定義あり)。Allthemodium 等の素材系は採掘自体は汎用 op で可。RS アドオン群 (ExtraStorage / Reborn Storage 等) は Refined Storage 本体対応に従属 |
| ライブラリ / クライアント / 性能系 | 約 149 | |

ATM9 側の確認事項: Tinkers' Construct は **ATM9 に入っていない** (代わりに
Silent Gear)。GregTech / Modern Industrialization も No Frills には不在。

## ATM9 To the Sky (308 jar)

集計のみ: ◎ 8 / ○ 20 / △ 5 / 方針のみ 16 / × 1 / 残りは記録なし・
ライブラリ系。中身は No Frills と大差なし。空島系の中核 (Ex Nihilo 等) は記録なし。

## 次の候補 (優先順メモ)

1. **Tinkers' Construct の実機検証を現パックで** — 従来「現パックでは検証不可」
   だった項目が、パック更新で検証可能になった。smeltery GUI が開かない問題の
   再確認 + casting station の実走が一組
2. **ATM9 をやるなら Refined Storage の在庫 op** が最大の新規開発。
   次点は Productive Bees / Extreme Reactors の GUI probe (汎用 container で
   届く可能性の確認)
3. 本番パックの「定義あり 31」は実機スポットチェックの費用対効果が良い
   (特に Energized Power / Forestry は定義数が多い)
