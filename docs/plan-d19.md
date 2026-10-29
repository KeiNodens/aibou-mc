# 実装計画: D19 機能拡充 (P1〜P6)

実装担当向け変換版。出典は `research/深堀_高価値実装_2026-10-29.md` (実装用マスター) と
`research/他AIエージェント比較_2026-10-29.md` (索引)。この文書だけ読めば実装に入れるよう、
「作るもの・参照機構・コード接続点・検証」を機能単位で揃えた。発見の経緯や競合評価は省略。

## 全体設計原則 (全フェーズ共通)

1. **LLMは意図、実行はdeterministic** — mc_aiplayer/pincercraft/cairn/codex-companion/本PJが独立に収束した業界結論。新機能もこの型を守る
2. **割込挿入点は2箇所のみ** (Numen): 現在actionの安全な中断点 (steering) と、終了直前 (follow-up)。「いつでも割込める」は作らない
3. **検証済みのみ復元** (bingdongni): 再起動時、evidence検証を通った記憶だけ復元。実行中state・身体所有権は復元しない (幽霊plan防止)
4. **終了判定は権威stateで** (bingdongni/mc_aiplayer): 「action呼び出しが成功した」≠「目的が達成された」。終了は必ずworld state照合
5. **文脈3層化** (凛案): prompt/応答を不変部 (rule・skill catalog) →半不変部 (世界state・frontier) →可変部 (直近event) の順に並べ、cacheを効かせる

## P0. 先行 (コスト小・効果即効)

- **明示コマンド直パース** [Elly式]: `skills/` レベルで「来て」「止まれ」「ついてきて」等をLLM非経由で即実行。parserはbridge側 (skill logic はbridge/JSに置く D6)。未対応コマンドは `capability` として学習して以後LLMへ回す
- **文脈Bounded化**: journal→prompt変換で「直近N turn verbatim + 旧分の要約 + 世界文脈1行」の形に。Quackingly実測 (~2.2k in/~150 out) を目安

## P1. 生存反射 (一次参照: Elly reflexTick)

作るもの: `ReflexGuard` 拡張 + `agent-mod` 側の反射tick。構成:

- **AUTO_EAT**: `food <= threshold` (閾値低め・非強制) && `last_eat_at + cooldown <= now` → `EAT:BEST` 相当の食事action。unsupported応答→`capabilities.eat=false`を学習
- **SLEEP_SYNC**: `owner_sleeping` (ownerが寝た) をtriggerに1回だけ試行、cooldown付き。**非強制** — 夜作業を阻害しない
- **GUARD/RETREAT**: `inHome` (home safe area) なら発動しない。`byHp` (hp<=threshold) と `byHostiles` (戦闘disabled時のみcount閾値)。`alreadyRetreating` (active_goal.label=="HOME") と cooldownで spam防止 → retreat goal発行
- **死亡→帰還**: respawn後に拠点/死亡地点への帰還skill発火。waypointの拡張で実現 (P2のHome記憶と接続)
- **溺死回避**: air低下→岸上がり (Numen)
- **装備自動選択 / hunt・guardモード**: combat.mode=normal|death (death=絶対退避しない)
- **制約宣言** (将来): 指示「夜は寝る」「biome Xに留まる」をDFA化してReflexGuardに (CEDAR)

接続点: `ReflexGuard.java` に発火条件とcooldown管理、`AgentConfig.java` にthreshold/cooldown/mode、retreat goal発行は既存task機構 (FollowTask等と同じAgentTask経由)。`isInHomeSafeArea` はwaypointのHome領域拡張で実装。

検証: mock-modで「hp低下→retreat goal発行」「home内では発動しない」をfixture検証。verification-m2.5.mdに記録。

## P2. 記憶・継続 (一次参照: codex agent-journal + Elly memory.json)

作るもの: `bridge/src/journal.ts` の永続schema拡張。現1種 (work journal) → 6分類:

```
{ goals[], workGraphs[], facilities[],    // spatial: 施設=位置+用途+最終使用 (作業台/かまど/チェスト)
  reservations[], knowledge[],            // semantic
  episodes[] }                            // episodic: {at,pos,action,params,result,related_goal}
```

- **facility自動記憶**: machine/container操作成功時に `{pos, type, lastUsed}` をepisodesに→consolidationでfacility昇格 (Numen式)
- **goal.set/get**: 永続目標 + 再開提案 (Elly memory.json相当; autonomy.md §7.1設計済み)
- **中断作業リストア**: workGraphsをdisk永続、再起動時に「検証済みのみ」復元
- **終了まとめ**: session終了時の自動summary
- **上限管理**: codex式 `byNewest` prune + 種別毎cap (goals512/graphs512/facilities2048/reservations4096/knowledge4096/evidence8192を目安)
- **episode→原本参照**: 検索用textは要約、原本episodeへの参照を保持 (MFM)。要約で失われた詳細を原本から回復

接続点: `bridge/src/journal.ts` 全改訂 + `agent-mod`側の施設検出 (GameOps経由でcontainer使用成功をreport)。`Waypoints.java` のHome領域拡張はP1と共有。

検証: 再起動を挟んだlive fixture (codexの `live-*-restart-smoke` 型) で「記憶が復元される」「身体所有権は復元されない」を確認。

## P3. 実行管理 (一次参照: Numen Run/Hold/pump + mc_aiplayer)

作るもの: task機構の上位層 (agent-level state)。`TaskManager`/`AgentTask` に追加:

- **Run/Hold 2状態モデル**: `run` (phase: MODEL|TOOLS|COMPACT, cancel token, retried) + `hold` (DEAD|EXTERNAL|OWNER_STOP|BLOCKED|FAILED)。`run==null` =暇。非同期callbackはrun.id照合でstale破棄 (現task generation機構と同型)
- **pump()**: 「開runできるかも」の全事象が通る唯一の進行点。キューは自走しない
- **LoopStatus**: UI唯一の読口 `{phase, hold, bodyTaskRunning, queuedPreview, activity}` → busy()/canInterrupt()
- **postcondition**: `AgentTask`に `postcondition` フィールド追加。task.done発火時にeval、falseなら `task.postcondition_failed` event→plannerがreplan (HiSTEVE/StructAgent式: 検証はタスク内部ではなく外部)
- **pause/resume**: 割込時に中止ではなく一時停止→復帰 (nested対応、mc_aiplayer)
- **atomic snapshot**: versioned runtime snapshot + stale job lease回収 (再起動復元)
- **suffix repair**: 失敗時は全体restartではなく「壊れたnode以降」だけ計り直す (bingdongni/StructAgent)
- **profile**: `strict_survival`/`operator` — privileged能力 (hidden scan/emergency teleport/forced pickup相当) を個別禁止

接続点: `TaskManager.java` にrun/hold管理、`AgentTask`にpostcondition+pause、bridge `state.ts`にsnapshot保存、`GameOps.dispatch`のtool catalogに`task.pause/resume`追加 (AgentWsCapabilities+mcp.tsの3点同期規約遵守)。

検証: 「pause→resume→完了」「postcondition失敗→replan発火」「再起動→stale lease回収」のfixture。

## P4. クエスト自律 (一次参照: Minemind build_quest_graph.py)

作るもの: `tools/build_quest_graph.py` 相当をbridge側に (SNBT解析)。実装:

- `config/ftbquests/quests/chapters/*.snbt` + kubejs lang file → `data/quest_graph.json`
- テキスト解決: `{ftbquests...}` lang key参照 + `&0-9a-fk-or` format code除去
- task保持フィールド: `id/type/item(+item_nbt)/count/advancement/criterion/dimension/structure/biome/entity/stat/value/fluid/amount/to_kill/block/force/consume_items`
- reward: `type/item/count/xp/xp_levels/table_id/command`
- 無題quest fallback: 最初のtaskのitem名
- sanity check: dangling dep + cycle検出
- **frontier計算**: `isVisible && !isCompleted && canStartTasks` (Numen設計と同じ式)
- **.goal差し込み**: chat起点の目標注入/解除
- **set-aside**: 繰返し失敗questの棚上げ (Minemind)
- **達成記念screenshot**: quest完了検出時に自動SS

接続点: `QuestBridge.java` で同期データ参照は既存→SNBT offline解析をbridgeに追加。`.goal`はchat handler拡張。

## P5. 技能・経路 (一次参照: MCAi鉱山skill + codex policy単位)

作るもの: `skills/*.mjs` の拡充。優先度順:

- **鉱山skill** (MCAi完全仕様): strip mining (階段降下+Y level目標+ore検出+torch) / permanent mine (hub+分岐+内装auto-craft) / **resource mine** (27資源の最適depth table、mod鉱石Mekanism/Thermal/Create/AE2対応) / mine memory (永続+帰還) / dig down 2x1階段 / torch auto-craft / tool replace fallback chain (diamond→iron→stone→wood)
- **畑**: 成熟検出→収穫+植え直し
- **locate**: 構造物・バイオーム (Numen)
- **schematic実建築**: 解析済み→設置skill追加。建築後の「読み戻し照合」loop (Luban/Blockwright)
- **釣り** (小粒)
- **エリトラ**: Baritoneの届かない穴。別skill機構
- **ペット世話** (codex dragon adapter型): feed/heal/tame等のadapter
- **logistics**: containerをInput/Output/Storageにtag→auto-sorting (MCAi Logistics Wand型)。Home Area (保護bounding box) 定義

接続点: `skills/` に新skill追加 (hot-reload)。mine memory/施設記憶はP2のjournalに書込。resource→depth tableは`data/`のstatic tableとして。

## P6. 権限・将来 (一次参照: mc_aiplayer + Numen + Steve)

- **autonomy.level** (0指示/1提案/2自律): autonomy.md §5設計済み。実装は既存config + tool実行時の承認gate
- **profile**: P3のstrict_survival/operatorと統合
- **複数bot**: server-side managerがwork割当を決定的に処理 (Steve式: 空間分割→競合解決→再配分)。LLM協調会話は使わない。GenCoord式commitment DSL `{actor, do, then}` で分担表現
- **approve/deny UI**: ControlNet MineAgent型 (action毎の人間承認、最強監督モード)

## 横断: プロトコル・堅牢化

- **WS bridge強化** (Marionette protocol v2): loopback clamp + Origin 403 + frame 64KiB上限→close 1009 + controller 1本/observer 2本 (read-only、per-connection backpressure) + hello 10s timeout→close 1002。`bridge/src/modclient.ts` + `agent-mod` WS serverに適用
- **capability flags**: hello handshakeで接続側の能力を明示 (凛案+Marionette)

## 検証基盤

- `docs/verification-m2.5.md` への追記を全fixtureの記録場所とする
- **再起動fixture** (codex `live-*-restart-smoke` 型): P2/P3の「再起動で記憶/仕事が復元される」専用fixture
- **policy単位test**: agent-mod Java側の反射/記憶ロジックはpolicy単位で小テスト (codex式)
- **mock-mod**: 新規反射・記憶・quest DAG機能をMinecraft無しで検証

## 順序の目安 (凛案とD19を一本化)

```
P0 直パース+文脈Bounded (コスト最小・即効) 
→ P1 反射 (生存率直結) 
→ P2 journal拡張 (P3以降の土台) 
→ P3 実行管理 (中盤の柱)
→ P4 quest DAG (自律の起点)
→ P5 skills (以降漸増) 
→ P6 権限/multi-bot (将来枠)
```

横断の「WS堅牢化」はP3の実行管理と一緒に入れるのが効率的 (改訂箇所が重なる)。

---

**実装担当へ**: この文書で「何を作るか」は固定。「どう作るか」の詳細は
`research/深堀_高価値実装_2026-10-29.md` の該当節を参照。
発見の経緯・競合比較は `research/他AIエージェント比較_2026-10-29.md` と
統合版 `research/aibou-mc拡張リサーチ_統合版_imozuru×Devin.md`。
