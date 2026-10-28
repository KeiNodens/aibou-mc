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
| AE2 MEターミナル在庫操作 | 対応済 | `container_repo` でネットワーク在庫全量読取 (serial/id/amount/requestable/craftable)、入庫はquick_move、引出しは`container_repo_action` (MEInteractionPacket・serial指定) で実機検証。オートクラフトは`AUTO_CRAFT`+`CONFIRM_AUTO_CRAFT`を実装済 (実機検証は要パターン網) |
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
| ae2 | MEターミナル/チェスト | [x] | `container_repo`読取 + quick_move入庫 + `container_repo_action` serial引出しを実機検証。オートクラフトは `AUTO_CRAFT`→`CONFIRM_AUTO_CRAFT` (ConfirmAutoCraftPacket) を実装済・パターン付き網での実機検証は未 |
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
| solapplepie | ~~食事完了時にbotがkickされるmod側bug~~ → **agent-mod側で恒久対処済** (`SolApplePieGuardMixin`がcapability未装着時の`FoodListMessage`を安全に捨てる)。パック維持・多様性バフ継続利用可 |

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
| FTB Quests | クエスト/進捗API | 実データ全ループ検証済: `quest.list`/`quest.inspect` (章・タスク進捗・報酬id/claimed)、GUI開放は`screen_click{sidebar:"ftbquests"}`でQuestScreen到達 (FTB sidebarは実マウスhover依存のため`SidebarButtonManager`反射経路で発火。キー未バインドでも可)、ItemTaskはインベントリ検出で自動完了、`quest_claim`でClaimAllRewards/個別ClaimReward送信→報酬配布確認。クエスト定義がパックに無い環境では synced:true・空リスト |
| JourneyMap | map/waypoint | mod連携案 (autonomy.md) — waypoint共有が本体候補 |
| Simple Voice Chat | 音声 | 将来枠 (autonomy.md) |

## 機械対応の追加方法 (反復可能なprobe手順)

既存の半自動パイプライン:

1. `tools/discover-machines.sh` — `MACHINES` リストに対象 `modid:block` を追加して実行。
   各ブロックを setblock→`use_item`で開く→`container.read`→closeし、
   `machines/discovery/<modid>_<name>.json` にmenu_id/slot構造/`slot_class`を保存
2. `tools/probe-machines.sh` — discovery結果を読み、cobbleを `container.click quick_move`
   で送り、着地したslot番号=実inputを `machines/probe/<modid>_<name>.json` に記録。
   着地しない = quick_moveルーティング無し → `insert:"direct"` 前提
3. `tools/gen-machine-defs.py` — probe結果から `machines/<menu_id>.json` 定義を生成
   (`verified_input:true` はprobe着地済みのみ)
4. 手動で input/output/fuel/virtual を整えたら `process_in_machine` で実加工検証

`slot_class` に `virtual`/`output`/`fuel`/`upgrade`/`augment` があれば手がかりになる。
定義が無い機械でも heuristic (input=先頭実slot, output=残り実slot) で動くが精度は低め。

### 未導入mod (Powah等) の検証方針

パック外modは**導入時に上記パイプラインをそのまま通す**のが手順。
Powah / Iron Furnaces / Blood Magic 等はGUI構造が単純なのでdef追加は容易と見込む
(外部表の対応方針欄参照)。RS/PneumaticCraft等の特殊系は個別実装が要る可能性が高い。

## mod追加アイテム起因のケース監査 (2026-10-28)

「modアイテムがvanilla前提の動作を壊す」パターンの棚卸し。
凡例: ✅対処済 / ⚠️既知GAP / ?要個別検証

| # | ケース | 状態 | 詳細・対処 |
|---|--------|------|-----------|
| 1 | 充電式ツールが無充電で掘れない | ✅ | `DigTask`にホットバー最適ツール自動選択を追加。`isCorrectToolForDrops`を速度より優先するため無充電電動ツール (Mekanism disassembler等) は自然に除外。実機: 無充電disassemblerが石1個で60s timeout → 修正後certus pickaxeへ自動切替 |
| 2 | `equip` がhotbar(0-8)のみ | ✅ | `equip{item, slot_name:"head|chest|legs|feet|offhand"}` でインベントリ内のitemをclick経路で装備。`slot_name`単独で現在装備の読み取り。実機: iron_helmet→head確認 (Curios系スロットは別APIなので別途) |
| 3 | `use_item` にスニーク修飾なし | ✅ | `use_item{sneak:true}`/`hold_ticks`両対応。PRESS/RELEASE_SHIFT_KEYパケット+client-side setShiftKeyDown。実機: 通常use→チェストGUI開放 vs sneak+use→GUI回避を確認 |
| 4 | NBTバリアント識別不可 | ✅ | `item.info` op新設: 耐久・Forge ENERGY/FLUID capability・エンチャ・NBTキー要約を返す。加えて`get_state`の`inventory_detail[].attrs`に`nbt_keys`+`energy_stored`を追加し、state単体で同idバリアントを識別可能にした。実機: 無充電disassemblerで`energy:{stored:0,max:400000}`取得 |
| 5 | `countItems` DROP_ALIASがvanillaのみ | ✅部分 | `_ore`ブロックのドロップ候補を全namespace走査で拾うよう拡張 (`ad_astra:moon_iron_ore`→`minecraft:raw_iron`系を捕捉)。fortune/silk touchは依然不考慮 |
| 6 | AoE採掘ツール (3x3ハンマー等) | ✅ | 通常入力経路でmod側の範囲破壊が発火することを実機確認: `energizedpower:diamond_hammer`で3x3 bricks壁の中央を`dig` → **9個中7個が破壊**。AoE範囲・mode指定はサーバー側ロジック依存なので`dig{tool_slot}`で使用ツールを明示できるよう拡張 (auto-scoreはAoE価値を見られない) |
| 7 | Tinkersツールの素give | ? | `tconstruct:pickaxe` は素材NBTが無いと性能ゼロ相当の可能性。素材指定NBT付きgiveで要検証 |
| 12 | Curiosスロットへ装備不可 | ✅ | `container_open_curios`追加: `CPacketOpenCurios`送信でサーバーに`curios:curios_container_v2`メニューを開かせ、以降は通常の`container_read`/`container_click`で操作。`container_read`は`CurioSlot`へ`curios_id` (back/jetpack/klein_star等) を付記。実機: `travelersbackpack:standard`を`back`スロットへclick装備→永続確認 (Mekanismはjetpack/scuba/free_runners等のcuriosスロットを多数登録) |
| 8 | 捨てられない/動かせないアイテム | ? | soulbound・カーソルバインド系は`toss`/container操作がサーバー側で拒否され得る。`container_click`の`after`返却で検知可能 |
| 9 | 食料capability系modの同期切断 | ✅ | Sol Apple Pieの`FoodListMessage`問題は`SolApplePieGuardMixin`で対処済。同パターン (他capability同期) の再発はログ監視対象 |
| 10 | アイテムGUI (backpack/携帯端末等) | ✅ | `use_item`でmenu開放→`container.*`で操作 — 既存経路で対応可能 |
| 11 | Baritone内部ツール選択 | ? | Baritoneは`getDestroySpeed`比較で選択。無充電でも高い速度を返す不正直なmod itemはミス選択の可能性 (要観察) |

### 背景となる設計原則

- `dig`/`use_item`は**通常入力経路**なのでmod側のサーバー処理 (mineBlock,
  onItemUse等) は自然に発火する。問題になるのは「こちらがアイテムを選ぶ」
  タイミング — 選定基準を`isCorrectToolForDrops`/`getDestroySpeed`実測値に
  寄せておけばmodの内部ロジックに介入せず済む。
- ツール「モード」のようなNBT状態依存の挙動は id では識別できない。
  `item.info`でNBTキー・energy等の要約を返す土台は実装済。

## キーバインド型mod機能の監査 (2026-10-28 追記)

`key`/`scroll` opの実装・実機検証で判明したmodキー系の到達性まとめ。

| 経路 | 届くもの | 届かないもの |
|------|----------|--------------|
| `key{mapping,down/press}` (KeyboardHandler#keyPress注入) | 通常のKeyMapping全般: consumeClick待ちmod・isDown待ちmod・WASD/ジャンプ等KeyboardInput系・スクリーンのkeyPressed (EscでGUI閉じ等)・Curios G(実機でCuriosScreenV2開放) | `InputConstants.isKeyDown`で生GLFW状態を見るmod・独自GLFWコールバックのmod (Mekanism) |
| `key{...,real:true}` (JNA keybd_event → glfwFocusWindow) | 上記全部 + 独自GLFWコールバック系 (Mekanism keybind全般) | ウィンドウ最小化中などOS入力自体が無効な状況 |

判明したこと:
- javawは`java.awt.headless=true`で起動されるためAWT Robotは使えない。
  代替としてMC同梱JNA経由でWin32 `keybd_event`/`mouse_event`を直接呼ぶ。
- `AppActivate`等の外部フォーカス操作はWindows foreground-lockで失敗しうる。
  `real:true`はmod内で`glfwFocusWindow`してから送信するので確実。
- `key.mekanism.mode`は`MekKeyBinding`独自実装 — `isModeItem(allowRadial=false)`
  のため**radial対象アイテム(disassembler等)ではpressでは何も起きない**。
  radialは`down:true`ホールドで`GuiRadialSelector`が開き、`scroll`で選択、
  `down:false`で確定する。実機: disassembler `mekData:{mode:0→1}`を確認。
- `key.mekanism.key_hud`(H)はクライアントconfigを書き換える — 
  実機で`enableHUD true→false`を確認 (Mekanism到達の検証に使える)。
- EscapeなどKeyMappingに無いキーは`key{code:256,press:true}`で直接注入。
  EscはPauseScreenを**トグル**する (開⇄閉) ので状態確認が要る。
- `get_state`の`container.screen`で開いているScreenのクラス名が分かる
  (メニューを持たない純Screenも検出可 — radial/GUIデバッグの勘所)。
- `scroll`: 画面オープン時は`Screen#mouseScrolled`を直接呼ぶ
  (`via:"screen"`, handled返却)。画面が無い時はOSホイール
  (`via:"os_wheel"`, real指定時は常にこちら)。

## Screen操作・看板・未バインドキー (2026-10-28 追記2)

- `screen_read`/`screen_click`/`screen_close`: メニューを持たない純Screen
  (FTB Quests GUI・mod設定画面・CuriosScreen・SignEditScreen等) のwidgetを
  列挙・text/index指定クリック・強制閉鎖できる。container系が届かないmod GUI
  の抜け道がほぼ塞がった。実機: Curiosボタン切替・看板「完了」押下確認。
- `type_text`はEditBox汎用 — JEI/EMI検索・modのフィルタ欄・チャット入力に
  使える (実機でChatScreen経由の送信まで確認)。
- `sign_write`は看板右クリック(権利付与)→パケット送信の2段。サーバーは
  `playerWhoMayEdit`一致を要求し更新で消費する。setblock看板は不可。
- キーバインド仮バインド機構により**未割当のmodキーも押せる**
  (`key.ftbultimine`等)。F13-F24を一時割当→注入または実キーで発火→復元。
  実機: FTB Ultimineのvein-mine発動 (3x3石炭鉱石一撃)。
- `real:true`の対応VKはA-Z/0-9/主要記号/ファンクション/修飾/ナビキー。
  scancode型・マウスボタン型のバインドは非対応 (UNSUPPORTED)。
- `screen_click`拡張 (2026-10-29): `{x,y}`座標直接指定 (widgetツリー外の
  独自描画領域用、`via:"coords"`) と `{sidebar:"<id部分一致>"}`を追加。
  FTB Library sidebarは`SidebarGroupGuiButton.onPress`が実マウスhover依存の
  `mouseOver`を参照するため、注入clickでは発火できない —
  `SidebarButtonManager`を反射で辿り`SidebarButton.onClicked`を直接呼ぶ。
  `screen_read`は`sidebar[]`(id/group/x)を列挙する。
- 残gap: 独自マウス操作を要求するmod GUIは座標click+sidebarで概ね塞いだが、
  FTB LibraryのBaseScreen系 (QuestScreen等) はAbstractWidgetを持たず
  中身のwidget列挙は空になる (quest APIが代替)。
