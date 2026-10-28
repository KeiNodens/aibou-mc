# Mod 対応状況 (mod compatibility matrix)

aibou-mc (agent-mod + bridge) が各modコンテンツをどこまで操作できるかの台帳。
判別基準:

- **対応済** — 実機で動作確認済み (GUI読取・投入・取り出し等)
- **定義あり** — `machines/*.json` にslot定義があるが実機未検証
- **部分対応** — 動く部分と動かない部分がある
- **未対応** — 現状では操作不能 (要追加実装 or 設計上の限界)
- **非互換** — 組み合わせ上パックから除外したもの

機械GUIは原則 `container.read/click` + `machines/<menu_id>.json` の定義で扱う。
`use_item` でGUIが開けるものは大半がこの経路で動く。

## 基本操作 (mod非依存)

| 能力 | 状態 | 補足 |
|---|---|---|
| 移動・採掘・追従 (Baritone) | 対応済 | `modid:name` のmod鉱石も採掘可 |
| コンテナslot操作 | 対応済 | menu_id + slot indexで操作、画面座標非依存 |
| クラフト (2x2/3x3) | 対応済 | レシピ帳packet。FastSuite等の非同期も吸収 |
| use_item (右クリック) | 対応済 | 設置・GUI開放・食事・ドア等 |
| use_item hold (弓・盾・トライデント) | 対応済 | `hold_ticks` で保持→release |
| entity interact | 対応済 | 餌やり・懐き・お座り・乳搾り・毛刈り・リード・騎乗・取引開始を全検証。reachガード付き (OUT_OF_RANGE) |
| 取引 (村人) | 対応済 | merchant menu + container.trade で完全取引確認 (edamame 96個・進捗達成) |
| AE2 MEターミナル在庫読取 | 部分対応 | `container_repo` でMEStorageScreenのrepo全量読取確認。入庫/引き出しはAE2独自packet要 |
| GUIボタン (石切台・織機・エンチャ・ビーコン) | 対応済 | container.button |
| GUIボタン (石切台・織機・エンチャ・ビーコン) | 対応済 | container.button |
| Jade連携 `look_info` | 対応済 | 機械の電力・進捗・内容物を汎用読取。Jade無しでもid+基本情報にfallback |
| BlockEntity NBT `block_state` | 対応済 | getUpdateTag相当。機械診断用 |

## 機械GUI: パック内mod別

凡例: [x]=対応済実機検証 / [d]=定義JSONあり未検証 / [~]=部分 / [ ]=未対応

| mod | 機械 (menu_id) | 状態 | slot構造/備考 |
|---|---|---|---|
| minecraft | furnace / blast_furnace / smoker | [x] | in0 fuel1 out2。twilightforest:cinder_furnaceも同menu |
| minecraft | brewing_stand | [d] | in3(材料) out0-2(瓶) fuel4(ブレイズP) |
| minecraft | stonecutter | [x] | in0 out1 + button_idでレシピ選択 (実証済) |
| minecraft | grindstone / loom / smithing / cartography / anvil / enchanting / beacon | [d] | 定義あり |
| minecraft | hopper / shulker_box / dispenser / dropper | [d] | 汎用containerとして読める |
| mekanism | enrichment_chamber | [x] | 実機動作確認 (in2 out3、virtual 0,1=energy/upgrade) |
| mekanism | crusher / energized_smelter / osmium_compressor / precision_sawmill | [d] | probe実証input=2。同型layout |
| mekanism | combiner / metallurgic_infuser | [d] | probe実証input=3 |
| mekanism | factory (basic/elite/ultimate全tier共通) | [d] | in2実証。in/out分割はtier依存で保守定義 |
| mekanism | purification / chemical_injection / isotopic_centrifuge | [d] | 推定in2。要probe |
| mekanism | chemical_* (dissolution/oxidizer/washer/infuser) | [~] | gas/液体主体。item slotは読めるが加工には流体必要 |
| mekanism | solar_neutron_activator / rotary_condensentrator / electrolytic_separator / electric_pump | [~] | 同様に流体/gas主体 |
| mekanism | formulaic_assemblicator / painting_machine / nutritional_liquifier | [d] | 複雑GUI。要個別調整 |
| evolvedmekanism | chemixer / laser_disenchanter | [d] | GUI開くが投入実証未 |
| evolvedmekanism | solidification_chamber | [ ] | use_itemでGUIが開かない (要調査) |
| thermal | machine_furnace / pulverizer / crucible / bottler | [d] | probe実証input=0。同familyは全機械in0 |
| thermal | smelter/insolator/centrifuge/press/chiller/refinery/pyrolyzer/sawmill/brewer/crafter/potion_infuser/soil_infuser | [d] | in0推定 (同family構造) |
| thermal_extra | fluid_mixer | [d] | |
| enderio | alloy_smelter / sag_mill / enchanter | [d] | probe実証input=1。alloy_smelterはin0-2想定 |
| enderio | primitive_alloy_smelter / slice_and_splice / soul_binder / wired_charger / crafter | [d] | 推定。要probe |
| energizedpower | powered_furnace / crusher / pulverizer / sawmill / alloy_furnace / induction_smelter / compressor / stone_solidifier / plant_growth_chamber 等 | [d] | **quick_moveがslotルーティングしないのでdirect挿入前提**。creative_battery_boxが全方向給電として実用確認済 |
| energizedpower | auto_crafter / advanced_auto_crafter | [~] | probeでcobbleがslot41に着地 (crafting grid領域)。機械処理系とは別物 |
| ae2 | charger / inscriber | [d] | 定義あり。投入item限定でprobe未通過 |
| ae2 | vibration_chamber | [d] | |
| ae2 | MEターミナル/チェスト | [x] | `container_repo`でネットワーク在庫を読取 (実機検証)。入出庫は独自packetで未対応 |
| ad_astra | compressor / etrionic_blast_furnace | [d] | probe実証input=1 |
| forestry | carpenter / squeezer / centrifuge / fabricator / fermenter / moistener / bottler / still / smelter | [d] | 定義あり。多くは流体+電力が前提で運用ハードル高 |
| immersiveengineering | alloy_smelter / bottling_machine / sawmill | [d] | 単体機は定義あり。**crusher/arc_furnace等のマルチブロックは対象外** |
| industrialforegoing | dissolution_chamber / material_stonework_factory | [~] | `titanium:addon_container` menu。dissolutionはinput 4-11をprobe実証 |
| projecte | dm_furnace / rm_furnace | [d] | probe実証input=1 |
| projecte | transmutation_table | [ ] | 特殊GUI (EMC学習)。未調査 |
| rftoolsbase | machine_infuser | [d] | 単一container (player inv分離不可→末尾36slot判定で対応) |
| rftoolsutility | crafter | [~] | Ghost slot系。通常加工用途外 |
| rftoolspower | blazing_infuser | [d] | |
| rftoolsbuilder/dim | builder/space_chamber等 | [ ] | 複雑GUI・マルチブロック扱い |
| sakura | distiller / fermenter | [d] | |
| tofucraft | salt_furnace | [d] | probe実証input=0 |
| twilightforest | cinder_furnace | [x] | vanilla furnace menu流用で自動対応 |
| mna | disenchanter | [d] | |
| mysticalagriculture | enchanter | [d] | |
| enchantinginfuser | enchanting_infuser / advanced | [d] | probe実証input=0 |
| ars_nouveau | imbuement_chamber | [ ] | GUI未確認 (use_itemで開かず) |
| botania | brewery / enchanter | [ ] | GUIが開かない。botaniaは基本的に「ワールド内操作」設計 (mana pool等はuse_item経路で別途検証要) |
| tconstruct | seared_melter / smeltery_controller | [ ] | GUIが開かない。smelteryはマルチブロック |
| projectred_expansion | auto_crafter | [~] | probeでslot36着地 (grid領域)。挙動特殊 |
| stevescarts | module_* | [ ] | cart assembler等。未検証 |
| create | mechanical_crafter/mixer/press等 | [ ] | **設計上GUI非依存** (ワールド内コントラプション)。機械操作APIの適用範囲外 |
| farmersdelight | cooking_pot | [d] | 調査未実施だがslot構造は汎用 |
| farmersdelight | cutting_board / skillet | [~] | ワールド内操作型 (use_item経路で扱うべきもの) |
| pamhc2 / croptopia | 作物・食料 | [~] | 植え付け=use_item経路 (未検証) |

## GUIが開けない機械 (発掘時player_inventoryのまま)

`evolvedmekanism:solidification_chamber`、`botania:brewery`、`botania:enchanter`、`ars_nouveau:imbuement_chamber`、`tconstruct:seared_melter`、`minecraft:lectern`(本設置時のみ開く)、`minecraft:anvil`(再現不能だったが本来開ける。要再調査)

## 非互換 (パックから除外したmod)

| mod | 理由 |
|---|---|
| ArsCurios + SlashNouveau | EquipmentSlot mixin拡張がTConstructの固定長UUID[6]と衝突 (`Invalid player data`) |
| Chunk-Pregenerator | コマンド引数型のレジストリ不一致 + JM6非互換 |
| sob (Stuff On Breadsticks?) | Farmer's Delight 1.3.4との非互換 (FD 1.2.x向け) |
| JustEnoughResources + jerintegration | worldgen走査で未登録biome参照で落ちる |
| nolijium | クライアントQoL mod (botでは不要。本番は任意) |
| solapplepie | **食事完了時にbotがkickされるmod側bug** (offline playerにfood capabilityが付かない)。恒久対策はbot側除外要検討 — 接続可否は要確認 |

## パック外の有名mod (未導入だが将来対応の解析)

| mod | 機械GUI構造 | 対応方針 |
|---|---|---|
| Powah | furnator/generator系は input0 + battery slot の単純構造 | `machines/*.json` に def 追加可能 (要pack導入時検証) |
| Iron Furnaces | 各tier furnaceはvanilla準拠 in0 fuel1 out2 | vanilla furnace defでそのまま動く見込み |
| Refined Storage | Grid/Crafterは大GUI + ネットワーク概念 | container ops自体は動くはずだが、在庫はblockではなくnetwork参照。専用対応要 |
| Sophisticated Backpacks/Storage | 大きめの汎用container | container opsで扱える見込み |
| Storage Drawers / Functional Storage | ワールド内操作 (右クリック出し入れ) | use_item経路で対応 |
| Cooking for Blockheads | キッチンGUI | container opsで扱える見込み |
| Blood Magic | Blood Altarは in0 + out1 単純構造 | def容易。要導入時検証 |
| Easy Villagers | trader/breeder系 GUI | container opsで扱える見込み |
| PneumaticCraft | 圧力系機械 + 複雑GUI | 高難度。気体タンク概念があり汎用化困難 |
| Draconic Evolution | Fusion Craftingは中心+周辺核 | 特殊。個別対応要 |
| Embers Rekindled | 熔鉱炉系 | 要実機調査 |
| Occultism | dimensional storage / ritual | ritualはワールド内構築。storageはcontainer ops見込み |
| Integrated Dynamics | ロジック系 | GUI複雑。対象外寄り |
| XNet / Pipez / Modular Routers | 搬送制御 | config GUI。低優先 |
| Waystones | ワープGUI | ボタン選択式 — container.button経路で対応可能と推定 |
| FTB Quests | クエスト画面 | 画面操作系で slot ops の適用範囲外。autonomy.md §8.5 参照 |
| JourneyMap | map/waypoint | mod連携案 (autonomy.md) — waypoint共有が本体候補 |
| Simple Voice Chat | 音声 | 将来枠 (autonomy.md) |

## 機械対応の追加方法

1. 対象ブロックを置いて `use_item` で開く
2. `container.read` で `menu_id` と slot構造 (`container_idx`/`slot_class`) を確認
3. `machines/<menu_id>.json` に input/output/fuel/virtual を記述
   (slot_classに `virtual`/`output`/`fuel`/`upgrade`/`augment` があれば手がかりになる)
4. `process_in_machine` スキルが自動で定義を読む
5. 定義が無い機械でも heuristic で input=先頭実slot, output=残り実slot で動く (精度は低め)

probe実証のやり方: 適切な投入物をplayer invから `container.click quick_move` で送り、
着地したslot番号がinput。着地しない = quick_moveルーティング無し = direct挿入要。
