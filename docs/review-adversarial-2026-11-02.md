# aibou-mc 敵対的レビュー (2026-11-02)

「正しいはず」ではなく「壊れているはず」の前提で読んだレビュー。前回レビュー
`docs/review-main-2026-11-01.md` の 12 件 (D58 で修正済み) は蒸し返さず、
修正の抜け・回帰と、前回が見ていない範囲を優先した。各指摘には再現する
具体的な失敗シナリオ (入力・状態・順序) を付け、シナリオが作れない指摘は
落とした (末尾の「検証したが指摘にしなかったもの」参照)。

- 対象: `main` の `6df1c20` (レビュー開始時点で origin/main より 11 コミット先行。
D58 修正と D57 Tier-B Wave 1 を含むローカル最新状態)
- 範囲: bridge (Node/TS)、skills/*.mjs、agent-mod (Java)、mod-knowledge の
パス処理、tools の fixture/verify 群。コード変更なし。実機 (ゲーム起動) 検証なし
- 内訳: P1 ×9、P2 ×27、P3 ×14 (一部は同型を束ねたグループ指摘)

## 検証結果 (ベースライン)

| 検証 | 結果 |
| --- | --- |
| TypeScript `tsc --noEmit` (bridge) | PASS |
| verify-toolgate / verify-runhold (tsx 経由) / verify-scale / verify-logistics / verify-waypoint / verify-build-extras / verify-catalog | ALL PASS |
| verify-schematic-create | ALL PASS (ただし P2-24 の通り、意味 op の検証ブロックは到達不能) |
| verify-skills-d23 | FAIL 2 件 (T8c train / T8d deck、`reason:op_unavailable`。前回レビュー時と同じ既存失敗) |
| 動的プローブ: schematic `cable_run` 小数座標 | **再現** — 15 秒経過しても復帰せず、プロセスを強制終了するまで bridge 全体が固まる (P1-6) |
| 動的プローブ: knowledge の末尾空白/ピリオド成分での脱出 | **再現せず** — 字句検査は通過するが Node の `readFile` は当該成分を文字通りの名前として扱い ENOENT。指摘から除外 (末尾参照) |

## D58 修正の再検証 (効いているもの / 残っているもの)

- S1 (Origin): 有効。URI パース + ホスト完全一致で前回の迂回は通らない
- F7 (gate timer): 有効。`server.close` で `clearInterval` され、この経路では残留しない
- F6 (knowledge path): 字句レベルの脱出 (`../`、絶対パス) は塞がれている。ただし
symlink/junction の実パス検証がない (P2-23)
- F5 (stop): BUSY で LLM 経路に落ちる元の問題は解消。ただし停止を排他枠の外で
走らせる設計が新しい競合を生んだ (P1-8)
- S2 (反射 vs 依頼戦闘): 被弾逃走経路にはガードが入ったが、policy 経路
(RETREAT/EAT) には入っていない (P2-4)
- S3 (負の Y): GameOps 経路は移行済み。反射の退避/帰還は旧ヒューリスティクス
のまま (P2-7)
- S4 (pause): 主要タスクは対応したが、cancel/pause の実停止漏れが 4 件残る (P2-8)
- S5 (クラフト計測): 通常ケースは実測化。取り出し計測窓の固定 3 tick が残る (P3-7)
- F1 (物流の向き): logistics は直ったが、コピペ元の cook に旧ヒューリスティクス
が残る (P2-11)

---

## P1

### P1-1. 承認ゲートを、ゲート対象のエージェント自身が承認できる

対象: `bridge/src/mcp.ts` の `approvals` ツール (approve/deny)、`bots` ツールの
`loop_resume`、`bridge/src/modclient.ts:73-77`

ModClient が危険操作を `APPROVAL_REQUIRED` で止めても、同じ MCP 利用者に向けて
`approvals {action:"approve"}` が公開されており、呼び出し主体の区別がない。
`approvals` は DEFAULT_OFF でも mod gate 対象でもない。`loop_resume` は引数なしで
全 hold を解除できる。

シナリオ: ゲーム内チャット等で prompt injection を受けた runner の Codex が
`run_command` で `/op` 等を試行し、`APPROVAL_REQUIRED a7` を受けたら、そのまま
`approvals approve a7` を呼んで 5 分枠で再実行する。所有者が立てた `owner_stop`
や死亡時の `dead` hold も `bots loop_resume` でエージェント側から解除できる。
人手承認の境界として機能していない。承認と hold 解除はエージェント向け MCP から
外し、所有者専用チャネルに分けるべきもの。

### P1-2. ドット命令・直パース・runner 起動に発言者認証がない

対象: `bridge/src/runner.ts:142-225`、`bridge/src/directparse.ts`

`state.onChat` は bot 本人の発言を除くだけで、`handleDot` は `c.from` を所有者と
照合しない。`.ok` / `.deny` / `.goal`、直パースの「来て/止まれ/ついてきて」、
通常発言による `owner_stop` / `failed` / `blocked` の一括解除まで、全て任意の
発言者に開かれている。mod 側には `AGENTMOD_OWNER` の所有者名設定があるのに、
bridge 側はそれを使っていない。

シナリオ: マルチプレイ中、bot が「chat.command は承認が必要。`.ok a3`」と通知した
直後、無関係のプレイヤーが `.ok a3` と打つと危険コマンドが承認される。逆に他人の
通常発言 1 つで所有者の「止まれ」による `owner_stop` が解除され LLM ランが再開
する。他プレイヤーの素の依頼文も runner の LLM ランを起動する (対話相手の想定が
所有者だけなら、それ自体が想定外の操作面)。

### P1-3. bridge HTTP が全インターフェースに bind し、トークン未設定/空だと無認証で全面開放

対象: `bridge/src/index.ts:88-95,195-197`

`app.listen(MCP_PORT)` に host 指定がなく、ログ表示は `127.0.0.1` なのに実際は
全インターフェース待ち受け。`requireAuth` は `if (!BRIDGE_TOKEN) return next();`
で、未設定だけでなく空文字でも認証が無効になる。単一トークンが `/mcp`、
`/inject`、`/events`、承認 API の全部を兼ね、スコープ分離もない。

シナリオ: 家庭内 LAN や tailnet 上の侵害済み端末から、トークン未設定で起動した
bridge の `POST /mcp` に `run_command`、`POST /inject` に偽イベントを送ると、
ゲーム操作・イベント偽装・承認操作まで無認証で届く。既定は loopback bind にし、
非 loopback 公開時だけトークン必須を起動条件にすべきもの。

### P1-4. 承認 UI に保存型 XSS があり、Bearer トークンを盗める/自己承認できる

対象: `bridge/src/index.ts` の APPROVALS_PAGE (pending 一覧の `innerHTML` 構築)、
`bridge/src/mcp.ts` の pending 返却 (params をそのまま返す)

承認待ち一覧を `innerHTML` で組み立て、pending の `params` を
`JSON.stringify` しただけで無エスケープに埋め込む。`JSON.stringify` は
`<` `>` をエスケープしない。

シナリオ: autonomy level 1 で、エージェント (または P1-2 経由の第三者) が
`run_command` に引用符を含まない payload
(例: `x</small><img src=x onerror=...>`) を渡して pending 化する。所有者が
`/approvals` を開いてトークンを入力し更新すると、payload が bridge の origin で
実行され、入力欄のトークン窃取や任意 pending の approve が可能になる。
描画は `textContent`/DOM API にし、CSP を付けるべきもの。

### P1-5. mod 側 WS に認証がなく、identify の role が controller へ fail-open する

対象: `agent-mod/src/main/java/com/minecrafttogether/agent/net/AgentWsServer.java:146-165`、
`bridge/src/modclient.ts:44-46`、`bridge/src/bots.ts:56-60`

WS にはトークン等の認証が一切なく、権限は自己申告のみ。しかも未知の role
文字列も、role 省略も、「拒否」ではなく最強権限 controller に倒れる。
さらに bridge の `ModClient` は role 引数を持たず常時 controller で identify
するため、`BotManager` の observer 用接続までプロトコル上は controller として
接続される (observer 側 ModClient は autonomy ゲートも持たない)。
加えて `emit()` は未 identify の接続にも全イベントを broadcast する。

シナリオ: (a) 同一 PC 上の任意プロセス、または localhost で配信される Web
ページのスクリプトが `ws://127.0.0.1:25587` に接続し
`{"type":"identify","role":"observre"}` (タイプミス) を送るだけで controller に
なり、`chat.command` (bot の権限次第で `/op`・サーバー停止系を含む) から OS 実
キー注入まで全 method が呼べる。bridge の承認ゲートはこの経路では完全に迂回
される。(b) identify を送らない接続でも chat/damage/task.done 等のイベントは
届き続け、切断→再接続の繰り返しでチャットストリームを恒常的に盗聴できる
(identify timeout は req を止めるだけで evt 配送は止まらない)。

### P1-6. schematic の cable_run / line が小数・巨大座標で同期無限ループし bridge 全体が固まる

対象: `bridge/src/schematic.ts:489-499` (cable_run)、`297-331` (line)、
`bridge/src/mcp.ts` の schematic create (ops 座標を無検証で素通し)

cable_run は `while (cur[axis]!== op.to[axis]) cur[axis] += Math.sign(...)` と
厳密等値で到達判定し、整数性・到達可能性・反復上限の検証がない。line
(Bresenham) も小数端点では `x!== b.x` が永遠に真になる。box には体積上限が
あるのに、この 2 つにはない。

シナリオ (実プローブで再現): `cable_run from(0,0,0) to(2.5,0,0)` を 1 回渡すと
x は 2.5 を通過し続け、`addCable` で Map が成長し続ける。ループは完全同期
(await なし) なのでイベントループごと停止し、MCP・WS・healthz が全て応答不能
になる。復帰はプロセス再起動のみ。整数でも `to(2000000000,0,0)` で実質同等
(メモリ枯渇まで成長)。LLM の誤生成 1 回で踏めるのが厄介なところ。

### P1-7. RunHold の queued が滞留・消失する — pump を再駆動する者がいない

対象: `bridge/src/runhold.ts:132-156`、`bridge/src/runner.ts` (respawned→release、
runGated の見送り)

(a) `pump()` のコメントは「queued が残っていれば続けてもう 1 本」と言うが実装は
1 回実行して `return 'ran'`。実行中に来た指示は `queued=true` になるが、ラン終了
後に再 pump する者がいない。(b) `release()` は全経路 (respawn での `dead` 解除、
MCP の loop_resume) で pump を呼ばない。(c) `runGated` が同伴マナーで見送る
場合、pump が既に `queued=false` に消費済みなので指示自体が消える。
スキル実行中に pump が `held` を返した場合も、スキル終了時に再 pump されない。

シナリオ: codex ラン実行中にユーザーが追加指示を送る → デバウンス後の pump は
`busy` で queued が立つ → ラン終了。以後、次の無関係なチャットが来るまで追加
指示は実行されない。死亡→hold 中に送った指示もリスポーンで hold が解けても
眠り続ける。「言ったのに動かない」が無言で起きる。

### P1-8. stop_all 先行 (F5 修正) の競合 — 停止が無効化される/後発スキルを巻き込んで止める

対象: `bridge/src/skills.ts:143-176,204-205`、`skills/stop_all.mjs`

stop_all 経路は先行スキルを abort するが、stop_all 自身を `this.current` に
登録しない。先行スキルが畳まれるとその `finally` が無条件に
`this.current = null` を書くため、stop_all がまだ停止処理中の間も排他スロットが
空き、新規スキルを受け付けてしまう。stop_all 自身は `cancel()` の対象にも
ならない。

シナリオ: (a) 長いスキル A に「止まれ」→ stop_all 起動、A が 1.5 秒レース前に
終了 → 直後に (LLM の遅延ツール呼出等で) スキル B が開始し goto を始める →
stop_all の `task.cancel_all` の後に B のタスクが mod 側で走り始め、止めた
はずの bot が再び動き出す。(b) 逆向きでは、後から着弾した stop_all の
cancel_all が、停止指示より後に正当に開始された B のタスクまで取り消す。
stop_all 完了まで排他枠を占有するか、停止対象を開始前の task_id 群に限定
すべきもの。

### P1-9. toolgate の適用が非同期で、無効化したツールを各 HTTP リクエストで先行実行できる

対象: `bridge/src/mcp.ts:34-62,2182-2192`、`bridge/src/index.ts:150-163`

ツールは登録時点で有効で、`applyGate()` は `void` で走り、mod 接続時は
`await mod.call('meta.mods')` の後でなければ disable しない。HTTP はリクエスト
ごとに新しい McpServer を作るため、この競合が毎回起きる。

シナリオ: `tool-config.json` で `run_command` を disabled にしておく。
`meta.mods` の応答が遅い (mod のメインスレッドが忙しい) 状態で新しい
`POST /mcp` の `tools/call run_command` を送ると、gate が閉じる前にハンドラが
実行され得る。DEFAULT_OFF の `reload_skills` や mod gate 対象ツールでも同じ
先行窓がある。gate 適用は `transport.handleRequest` の前に await し、安全目的の
無効化はハンドラ側でも強制すべきもの。

---

## P2

### P2-1. 承認が method 単位・5 分間・引数無制限で、通知は引数を表示しない

対象: `bridge/src/autonomy.ts:78-114`、`bridge/src/runner.ts` の承認通知

`approve()` は method 名だけを `approvedUntil` に入れ、params の照合も単回
消費もしない。pending には有効期限も掃除もない (`APPROVE_GRACE_MS` は未使用の
死定数)。runner の承認通知は method 名と id だけで、event に含まれる params を
捨てている。`.ok` 無引数は「最新の pending」を承認する。

シナリオ: 所有者が「石を 1 回配る chat.command」のつもりで (引数を見ずに)
`.ok` → その後 5 分間、同じ method の任意コマンド (`/op`、`/kill`、停止系)
が無審査で通る。承認待ちが 2 件ある時に古い方へ応答したつもりの `.ok` が
新しい方を承認する取り違えも起こる。数時間前の古い pending も残っていれば
後から承認できてしまう。

### P2-2. level 0 では bridge 内部の meta.mods が承認対象になり、承認スパムと pending 増殖が起きる

対象: `bridge/src/mcp.ts:47-52`、`bridge/src/autonomy.ts:31-37` (READONLY 集合)

bridge 側 Autonomy の READONLY には `meta.mods` や `registry.*` がない
(Java 側 `AgentWsCapabilities.READONLY` にはある — 集合が層間でずれている)。
toolgate はサーバー生成時と周期処理で内部呼出として `mod.call('meta.mods')`
するため、level 0 ではそのたびに pending と approval イベントが作られる。
重複抑止もない。

シナリオ: `AUTONOMY_LEVEL=0` で通常の MCP リクエストを繰り返すだけで、
利用者が要求していない meta.mods の承認待ちが増え続け、runner がゲーム内へ
承認通知を繰り返す。gate は失敗し続けるので `lastMods` も更新されず、mod 連動
ツールは隠れたままになる。

### P2-3. 単一 bot に対する writer lease がなく、直接ツールがスキル排他を迂回する

対象: `bridge/src/index.ts:150-160`、`bridge/src/skills.ts` (排他はスキル同士のみ)、
`bridge/src/runhold.ts` (スキル競合チェックは runner の pump 専用)

HTTP はステートレスでリクエストごとに別サーバーを作るが、背後の ModClient /
State / Skills は共有される。直接ツールは `Skills.runningName()` を見ない。

シナリオ: クライアント A が `gather` スキルを実行中に、クライアント B (または
同じ LLM の並行呼出) が `container_click`、`goto`、`task cancel_all` を投入
すると、A の前提だった画面・位置・タスクが途中で変わり、誤クリックや素材
喪失が起きる。状態変更系の直接ツールもスキルと同じ実行枠を通すべきもの。

### P2-4. ReflexPolicy の RETREAT / EAT は依頼タスク・依頼戦闘を無視する

対象: `agent-mod/.../game/ReflexPolicy.java:36-44`、`game/ReflexGuard.java:87-88,157-167`

`decide()` で `anyUserTaskRunning` を参照するのは SLEEP 分岐だけで、RETREAT と
EAT は無条件に発火する。しかも `anyUserTaskRunning()` は CombatTask/ShootTask
を意図的に除外している。S2 修正の `requestedCombatRunning()` ガードは被弾逃走
経路にしか入っていない。

シナリオ: (a) `combat.engage` (hp_abort 指定で低 HP まで戦う依頼) の戦闘中、
HP が退避閾値に達した tick に policy が RETREAT を返し `reflex-home`
GotoTask を登録。CombatTask と GotoTask が同一の Baritone プロセスを毎 tick
奪い合い、「依頼した戦闘を反射が潰さない」という S2 の保証が policy 経路で
破れる。(b) 満腹度低下でクラフト/掘削タスク実行中に EAT が発火し、EatTask が
hotbar 選択やクリックを奪い合って作業タスクの前提が silent に壊れる。

### P2-5. 全タスク同時実行 + Baritone 単一資源の無調停 — 1 件の cancel/完了が他タスクの移動を殺す

対象: `agent-mod/.../task/TaskManager.java:51-58`、`task/GotoTask.java`、
`task/MineTask.java`、`task/CombatTask.java` (各タスクの `cancelEverything()`)

TaskManager は全 RUNNING タスクを毎 tick 駆動し、資源カテゴリの排他がない。
Goto/Mine/Follow/Sleep/Combat は同一 Baritone の PathingBehavior を共有する
のに、各タスクの CANCELLING・成功・timeout 処理が無条件に
`cancelEverything()` を呼ぶ。

シナリオ: `baritone.goto` (帰宅中) と `baritone.mine` (採集) を続けて投入すると
両者が並行に走り、先に完了/キャンセルした側の `cancelEverything()` が他方の
パスを消す。他方は `started=true` のまま `isActive=false` を観測して到達可能な
のに `UNREACHABLE` で失敗する。「1 件の停止」が「全部の移動の停止」になる。

### P2-6. TaskManager の保持上限 eviction が実行中タスクを追放し、キー保持・移動が孤児化する

対象: `agent-mod/.../task/TaskManager.java:17,31-39`

`register` は `while (order.size() > MAX_KEPT) tasks.remove(最古)` と状態を
見ずに削除する (MAX_KEPT=128)。

シナリオ: DriveTask (keyUp を保持し、解放は自タスクの tick 内でのみ行う) で
走行中に、反射タスク等の登録が累計 128 件を超えると DriveTask が map から
消える。以後 tick されないためキー解放も finish も呼ばれず、keyUp が押下
されたまま車両が走り続ける。GotoTask の場合は Baritone が歩き続けても
`task.done` が emit されず、`task.status` は STALE 扱い、cancel も届かない。

### P2-7. 反射の退避/帰還が旧 4 引数 GotoTask (y >= 0 ヒューリスティクス) を経由する

対象: `agent-mod/.../game/ReflexGuard.java:186-188,216-218`、`task/GotoTask.java:20-22`

GameOps 側は 5 引数版 (hasY 明示) に移行済みだが、反射の `retreat()` と
`returnHome()` は 4 引数版 = `y >= 0` 判定のまま。

シナリオ: home waypoint が地下拠点 (y=-32) だと退避は GoalXZ になり、地表の
同 XZ に着いた時点で成功判定 → bot は拠点に入っていないのに「退避完了」と
なり、その場で敵に囲まれる。深い拠点ほど踏みやすい。

### P2-8. pause/cancel の実停止漏れ 4 件

対象: `agent-mod/.../task/EmoteTask.java`、`task/ShootTask.java:91-93,179-182`、
`task/UseHoldTask.java:56-57,82-85`、`task/CombatTask.java:269-272`

- EmoteTask は `cancel()` を override せず、既定 cancel が即 CANCELLED 化する
ため tick 内の CANCELLING 分岐 (keyShift 解放) が到達不能のデッドコード。
crouch_dance 開始直後に cancel → sneak が押下固定され、以後の移動と
useItemOn の sneak 修飾が化ける
- ShootTask の `onPause` は keyUse を離すだけで phase を戻さない。再開後は
引き直していないのに phaseT だけで `shots++` に到達し、1 本も撃っていない
のに `done` で SUCCEEDED する (虚偽成功)
- UseHoldTask の `onPause` は `releaseUsingItem` まで呼ぶため、pause が
「その場で解放 = 弓の発射/盾解除」になる。再開しても再押下されず、最終的に
SUCCEEDED になる
- CombatTask の `onPause` は `stopPathing` のみで盾を下ろさない。keyUse が
残り、他タスク (食事・射撃) と競合する

### P2-9. コンテナ開閉状態を無視した containerId=0 前提クリック — silent な失敗 + 能力学習の永続汚染 / 装備の虚偽報告

対象: `agent-mod/.../task/EatTask.java:56-59,83`、`game/GameOps.java` の equip
事後読み取り、`game/AgentCapabilities.java` (学習結果はファイル永続化)

シナリオ: (a) チェスト/機械メニューを開いた状態で反射 EAT が発火すると、
EatTask は containerId=0 宛に swap を送り (開いている menu と不一致で無効)、
食品は手に渡らないまま USE_FAILED →
`AgentCapabilities.learn("eat", false)` がディスクに永続化される。以後
eatCapable=false で自動食事は二度と発火せず、再学習経路にも到達できない。
一過性の状態が恒久的な反射喪失になる。(b) チェストを開いたまま
`equip {slot_name:"head", item:"X"}` を呼ぶと、クリックは無効でも事後読み取りは
開いている menu 側の slot 5 を読み、その slot に偶然 X が入っていれば
`equipped:true` を返す (何も装備していない)。

### P2-10. BuildTask.ensureHeld が swap 成否を検証せず常に成功を返す (`|| true`)

対象: `agent-mod/.../task/BuildTask.java:196-203`

根拠は `return inv.getSelected().is(item) || true;`。

シナリオ: main インベントリからの SWAP が (メニュー開閉等で) 失敗しても
「持った」扱いで進み、手持ちの別アイテム (例: 土) で `useItemOn` して誤った
ブロックを世界に設置する。設置後検証で mismatched とは数えるが、設置された
誤ブロックは残留し、対象座標は「別ブロック占有」で以後の再試行も failed 固定
になる。

### P2-11. cook.mjs に旧式 splitSides (最大コンテナ = プレイヤー) が残存

対象: `skills/cook.mjs:7-12` (対照: 修正済み `skills/logistics.mjs:33-46`)

logistics は `player_container_idx` の精密判定に直ったが、cook はコピペ元の
`idxs.reduce((a,b) => sizes[a] >= sizes[b]? a: b)` (最大コンテナをプレイヤー
扱い) のまま。

シナリオ: コンテナ側が 36 スロット以上の調理鍋系メニュー (大型鍋 mod 等) を
開くとプレイヤー側と鍋側が反転し、材料探索は鍋の中から、投入先はプレイヤー
インベントリ側になる。既に鍋に入っていた他人の材料まで動かす。

### P2-12. cook の材料投入が「1 単位 = 1 クリック」前提で壊れる

対象: `skills/cook.mjs:104-119`

材料を単位ごとにループし、毎回「src を pickup (スタック全量を掴む) → dst へ
pickup (全量置く)」する。

シナリオ: 牛肉 2 個必要なレシピで牛肉 64 個を 1 スタック所持 → 単位 0 で
64 個全部が鍋スロットへ入り、単位 1 で在庫から材料が消えているため
`ingredient_vanished` で失敗を返す。材料は鍋に残ったままスキルは失敗報告し、
LLM がリトライすると二重投入で鍋の中身が壊れる。

### P2-13. quick_move の成否を検証せず数える「数えただけ」パターンが 4 スキルに残存 (F2/S5 の同型)

対象: `skills/process_in_machine.mjs:175-190` (collectPass)、
`skills/logistics.mjs:53-63` (fetch) / `203-220` (deposit)、
`skills/cook.mjs:123-135` (回収 poll)。
対照的に正しい実装: `skills/logistics.mjs:76-98` (ME 引き出しは在庫差分で実測)

いずれも `container.click quick_move` を await した直後に、スロットの旧
`count` をそのまま成果に加算する。quick_move は「宛先が満杯なら何も動かさず
正常応答」が vanilla の通常動作であり、例外にならない。

シナリオ: プレイヤーインベントリ満杯で process_in_machine が出力 32 個の回収を
試行 → 実移動 0。だが `produced=32` となり、300ms 後の 2 回目の collectPass で
同じスロットを再び数えて `produced=64`、「64 個作ったよ」と `done:true` で
報告する。成果物は機械の中に残ったまま。logistics deposit ではチェスト満杯時に
「預けた」と虚偽報告し、アイテムは手元に残る (LLM は預けた前提で次に進む)。

### P2-14. dig の成否を検証せず数えるスキル群 (lumber / branch_mine / clear_area)

対象: `skills/lumber.mjs:56-73`、`skills/branch_mine.mjs:70-80`、
`skills/clear_area.mjs:38-47`。対照: `skills/farm.mjs` は `dt.state === 'succeeded'`
を確認している

3 者とも `dig` を `.catch(() => {})` で握り潰し、task の完了結果も見ずに
カウンタを増やす。

シナリオ: 届かない/掘れないセル (保護区域・道具不足) があると、lumber は同じ
セルを再スキャンするたび掘ったことにして guard 上限まで `chopped` を水増しし
「切った」と報告する。branch_mine は掘れていないセルへ進んだことにして論理
座標だけが前進し、報告の坑道長と実態が乖離する。clear_area は全 dig 失敗でも
`done:true`。

### P2-15. give が到達確認なしにアイテムを投げる — 追いつけなくてもその場に全量を捨てる

対象: `skills/give.mjs:26-49`

追従ループは「対象が消えた」「120 回経過」のどちらでも抜けるが、その後に
距離の事後条件チェックがないまま equip → toss を実行する。

シナリオ: 相手がテレポート/走って逃げて 60 秒追いつけない → ループを回数切れ
で抜け、現在地 (追跡途中の野外・溶岩脇でも) で指定個数を全部投げ、
`{given: n}` と成功報告する。相手は受け取っていない。

### P2-16. build_schematic の事前スキャンが無制限・中断不能、かつ commission 対象から既設機械が漏れる (F3 修正の副作用)

対象: `skills/build_schematic.mjs:127-145` (事前スキャン)、`183-200` (commission
と remaining)

(a) F3 修正で入った事前スキャンは、未配置 max_blocks 個が集まるまで計画全
ブロックに `obs.block_state` を 1 件ずつ直列 RPC する。ループ内に
`throwIfCancelled` がない。(b) commission 対象は今回配置した placements だけで、
既設として skip された機械は対象外。(c) `remaining = plan.total - placed -
skipped` はスキャン範囲外の既設を数えていないため過大表示になる。

シナリオ: (a) 1 万ブロックの完成済み建築を再実行 → 1 万回の直列 RPC の間
(数分〜数十分) スキルスロットを占有し、「止まれ」の abort もスキャン中は
効かない。(b) 初回ランが機械を置いた直後に落ち、再実行するとその機械は skip
扱いで commission が二度と走らず、未設定の機械が「設定も済ませたよ」の対象
から静かに漏れる。

### P2-17. スキル引数の数値検証が体系的に無い — 負数が mod まで届き、偽の成功も生む

対象: `bridge/src/skills.ts:127-140` (`zodShape` は `z.number().int()` に
min/max なし)、`skills/craft_plan.mjs`、`skills/give.mjs`、
`skills/clear_area.mjs`、`skills/branch_mine.mjs`

上限クランプはスキルごとに散在するが下限はほぼ皆無。しかも直パース/runner の
内部呼出は `Skills.run` 直通で zod すら通らない。

シナリオ: `craft_plan count=-3` → `{done:true, already_have:true, count:-3}` の
偽成功。`give count=-1` → `{given:-1}`。`clear_area radius=-1` /
`branch_mine length=-5` → 何もせず `done:true`。`craft count=-1` はそのまま
mod の CraftTask へ渡る。数値検証は zodShape の共通層で type ごとに既定の
下限を持つべきもの。

### P2-18. スキル実行にタイムアウト/ウォッチドッグがなく、中断を無視するスキルが排他スロットを永久に塞ぐ

対象: `bridge/src/skills.ts:178-210`、`skills/craft_plan.mjs:212-270` (`expand`)

`Skills.run` には実行時間上限がない。`craft_plan.expand` は再帰全体で
`throwIfCancelled` を一度も呼ばず、展開ノード数の予算もない (深さ制限は引数
`depth` 任せで上限なし)。

シナリオ: `craft_plan depth=50` を広いレシピツリーで呼ぶ → 展開が事実上
終わらず、`cancel()`/stop_all の abort は誰も見ていないため効かない。以後
すべてのスキル呼出が `BUSY` を返し続け、bridge 再起動まで技能層が死ぬ。

### P2-19. Skills ホットリロードの競合 — リロード窓でツール一覧が欠け、旧版モジュールが復活し得る

対象: `bridge/src/skills.ts:80-110` (`load`/`watch`)

`load()` は冒頭で `registry.clear()` し、47 ファイルを直列 await import する。
`watch` は保存イベントごとにデバウンスなしで `load()` を多重起動する。MCP
サーバーはリクエストごとに `skills.list()` からツール登録するため、窓の間は
欠けたツール一覧が配られる。重なった 2 つの load は後勝ちでなく混ざり、先に
始めた側が旧モジュールを後から再登録する。

シナリオ: スキルファイルを編集保存 (通常の開発フロー) した 1 秒以内に LLM が
そのスキルを呼ぶ → `unknown skill`、または修正前の旧版が実行される。複数 fs
イベントで load が 3 重に走れば、最終レジストリが「一部旧版」の混合状態で
安定する。

### P2-20. QuestGraph watch の初回ポーリングが「既完了クエスト全件」を新規完了として通知する

対象: `bridge/src/questgraph.ts` (`knownCompleted` 初期は空集合)、startWatch の
30 秒ポーリング

起動時に現在の完了集合でベースラインを初期化せず、最初のポーリングで
`fresh = now - ∅` = 全件が「新規完了」になる。完了ごとに chat 送信と
screenshot が走る。

シナリオ: 終盤ワールド (完了クエスト 200 件) で bridge を再起動 → 30 秒後に
ゲーム内チャットへ完了通知が 200 件流れ、journal の episodes (上限 500 件) に
quest:complete が 200 件積まれて本来の行動履歴を押し出す。screenshot も連発
される。

### P2-21. schematic 読み取り側: litematic のリージョン位置・向きを無視し、寸法の無検証で巨大展開する

対象: `bridge/src/schematic.ts:105-145` (readLitematic)、`154-167` (inspect)、
`61-66` (loadNbt)

各リージョンの `Position` を読まず、負サイズの向きも `Math.abs` で潰し、
ブロック座標をリージョンローカルのまま全リージョン分 push する。返却 size は
各軸 max の合成で実境界ではなく、inspect の `regions` は実数でなく常に 1。
`readLitematic` は `total = sx*sy*sz` を BlockStates 配列の実長と照合せずに
ループし、`loadNbt` にはファイルサイズ/gunzip 展開後サイズの上限がない。

シナリオ: (a) 2 リージョンが (0,0,0) と (20,0,0) にある litematic → 第 2
リージョンのブロックが第 1 リージョンに重なって計画され、build_schematic が
全く別の建物を建てる。inspect は `regions:1` と報告するので気付けない。
(b) Size=1000^3・パレット [stone]・BlockStates が短い細工ファイル →
10^9 回ループで blocks を積み続け、ハング/メモリ枯渇 (作成側には上限が
あるのに読み側にはない非対称)。

### P2-22. ModClient に heartbeat がなく、切断時に pending も即時失敗させない

対象: `bridge/src/modclient.ts:28-85`

WS の `open` で `connected=true` にし、`close` でしか戻さない。ping/pong の
死活監視がなく、`close` ハンドラも応答待ちの pending を一括 reject せず、
各呼出は個別の 30 秒タイマ満了まで残る。

シナリオ: スリープや Tailscale の黙った経路断で FIN/RST が来ないと、
`/healthz` は古い generation のまま `mod:true` を返し続け、各 MCP 呼出は
30 秒ハングしてから失敗し、再接続も始まらない。実際に close が来た場合も、
飛行中の複数呼出 (例: craft 実行中の mod 落ち) は即座には失敗しない。

### P2-23. /events の SSE 購読が解除されず、再接続のたびに listener と応答オブジェクトが残る

対象: `bridge/src/index.ts:105-121`、`bridge/src/state.ts:21-28`

`State.onEvent` は登録だけで解除 API がない。`/events` は切断時に closed
フラグと heartbeat 停止だけを行い、listener 自体は配列に残る。

シナリオ: 通知デーモンが再接続を繰り返す、または接続/切断を繰り返すと
`evtListeners` が単調増加する。以後の全 `state.push` が死んだ購読者を走査し、
閉じた `res` への参照も保持されるため、メモリとイベント配送コストが劣化し
続ける。runhold や journal の恒常購読と違い、こちらは接続ごとに増えるのが
問題。

### P2-24. fixture/verify が「通っているのに守れていない」箇所 (4 件)

(a) **verify-schematic-create の意味 op 検証が到達不能コード**
対象: `tools/verify-schematic-create.mjs:70-71,74-115`。
`console.log(...); process.exit(...)` の後ろに D34 意味 op のケース
(machine_row/cable_run/power_spine の配置数・面解決・ケーブル集計・
マニフェスト sidecar、44 行) が置かれており、一切実行されない。他の verify 群は
全て exit が最終行で、このファイルだけが死んでいる。にもかかわらず
`docs/followup-2026-11-01.md` の D34 記録は「verify-schematic-create ALL PASS
(意味 op のケース追加…)」と検証済み扱いで、記録と実態が乖離している。
schematic.ts の面解決を壊しても、このスクリプトは ALL PASS・exit 0 を返す。

(b) **p22 の F6 回帰テストが空転している**
対象: `tools/fixtures/p22-knowledge.mjs:38-42`。
escape 検査は `mod:'../outside', path:'marker.txt'` を投げるだけで、fixture は
knowledge の外に marker.txt を作らない。正常な get の成功ケース (陽性対照) も
無い。F6 の検証コードを丸ごと削除しても、外側ファイルが存在しないため
`readFile` が ENOENT でエラーになり assert は合格する。前回レビューが隔離
環境にマーカーを置いて再現した条件を fixture が再現していない。get が常時
エラーになる退行 (層 2 の本文読みが全滅) でも、mods/search の検査だけで
合格してしまう。

(c) **run-fixture は固定ポート + healthz の同一性未確認 + 子プロセス終了未監視**
対象: `tools/run-fixture.mjs` (ポート既定 25687/25689 固定、`waitHealthz` は
`r.ok` のみ、spawn したプロセスの exit 未監視、`killTree` は戻り値未確認)。
前回実行の bridge が kill 失敗で残りポートを握っている状態で再実行すると、
新 bridge はポート競合で起動失敗 (未検知) → healthz は旧 bridge が応答 →
assert は旧コード・旧状態に対して実行され、現行コードが壊れていても PASS に
なる。旧 mock への stub 登録も同型。

(d) **認証境界が全 fixture の対象外**
`tools/run-fixture.mjs` の `mcp()` は Authorization ヘッダを送らず、
`BRIDGE_TOKEN` も設定しない。全 52 fixture は無認証構成でのみ成立する作りで、
`requireAuth` が (a) 常時 401 に壊れても (b) 認証が外れてトンネル公開された
`/mcp`・承認 API が無認証になっても、全 fixture が PASS する。誤 token・
ヘッダなし・正 token の 3 ケースを固定する fixture が 1 本も無い。同様に、
mock を落とす手段がハーネスに無いため、切断・再接続・空応答の経路
(P2-22 の 30 秒ハング含む) は構造的に検証できない。

### P2-25. journal.jsonl が無制限に肥大し、tail/failedWorks が毎回全ファイルを同期で読み直す

対象: `bridge/src/journal.ts:168-186,414-455`、`bridge/src/runner.ts` の毎ラン
`failedWorks(2)` 呼出

JSONL にはローテーションも上限もない (task.done/skill.done/reflex を無期限
append)。一方 `tail` は「末尾 n 件」のためにファイル全体を `readFileSync` +
全行 `JSON.parse` する。`failedWorks`/`openWorks` は `tail(2000)` 経由で
毎回これを払う。

シナリオ: 数ヶ月運用で journal.jsonl が数百 MB・数百万行になる → codex ラン
開始のたびに数秒〜数十秒イベントループが止まり、その間 ModClient の 30 秒
タイムアウトや MCP リクエストが巻き添えで失敗し始める。

### P2-26. OS 実キー注入 (real) がフォーカス成功を検証せずに keybd_event を送る

対象: `agent-mod/.../game/GameOps.java:381-386,418-446`

`glfwFocusWindow` を呼んで 60ms 待つだけで、実際に自ウィンドウがフォア
グラウンドになったか (GLFW FOCUSED / GetForegroundWindow) を確認せず
`keybd_event` する。コードコメント自身が「フォーカスがある前提 — 無いと
別窓へ入力が飛ぶ」と認めている。

シナリオ: bot の自律動作中にユーザーが別アプリ (ブラウザ/エディタ) に
alt-tab している状態で bridge が `key {code:257(Enter), real:true, press:true}`
や文字キーを発行すると、フォーカス移行が失敗し、キー入力がユーザーの前面
アプリに届く (チャット誤送信・Enter 確定・文字入力)。scroll の OS ホイール
経路も同型。

### P2-27. knowledge get は実パス解決をしないため、symlink/junction で外へ出られる (F6 残差)

対象: `bridge/src/mcp.ts:716-735`

修正後は modId の区切り文字と `..` を禁じ、`path.resolve` 後の接頭辞も見るが、
`realpath` はしていない。mod を index に存在する ID へ制限もしていない。

シナリオ: `knowledge/<mod>` 自体、またはその配下が外部ディレクトリへの
symlink / Windows junction になっている状態で
`knowledge {action:"get", mod:"linked", path:"secret.txt"}` を呼ぶと、字句上の
検証は通り、`readFile` がリンクを辿って knowledge 外のテキストを最大
20,000 文字返す。抽出・同期の過程でリンクが混入する経路が現実にあるかが
前提条件になるため P2 に置く。

---

## P3

### P3-1. journal スナップショットの復元で lastSummaryAt が落ちる / 破損が silent に全リセットされる

対象: `bridge/src/journal.ts:148-164,458-467`

復元のホワイトリストに `lastSummaryAt` が無いため、再起動のたびに
`sessionSummary` の since が 0 に戻り「前回: 作業 N 件」が全履歴集計になる。
また snapshot の JSON パース失敗時は空スナップショットで起動し、次の flush で
破損ファイルを上書するため、goals/facilities が警告なく全損する (隔離・
バックアップなし)。flush が 1 秒遅延 + unref のため、work.start を JSONL に
書いた直後に落ちると counter が巻き戻り、再起動後の最初の作業が前回と同一の
`w-N` を再利用して checkpoint が混線し得る。

### P3-2. 永続化が非原子的 + 例外握り潰しで、waypoint 等が silent に全損する

対象: `agent-mod/.../game/Waypoints.java:41,55,60-71`、
`game/AgentCapabilities.java:31,39,49`、`skills/places.mjs`、
`skills/dimension_profile.mjs`、`bridge/src/directparse.ts:84-92` (capabilities)

Journal/RunHold/QuestGraph は tmp→rename を使うのに対し、これらは対象
ファイルへ直接書込 (truncate→write) し、IOException を握り潰す。Waypoints の
読込失敗も握り潰した上で `loaded=true` になる。

シナリオ: save 中のクラッシュ/電源断で JSON が途中で切れる → 次回起動で
読込失敗が無視され空 map で確定 → 次の `waypoint.set` 1 回でファイルが
上書され、home を含む全 waypoint が恒久消失 (反射は retreat_no_home を
出し続ける)。逆に書込失敗時も `waypoint.set` は `saved:true` を返す。

### P3-3. GotoTask / SleepTask にタイムアウトが存在しない

対象: `agent-mod/.../task/GotoTask.java`、`task/SleepTask.java` (他タスクは
Combat 300s・Mine 停滞 5 分・Craft 60s 等の上限あり)

シナリオ: 封じられた部屋や未ロード遠方チャンクへ `baritone.goto` すると
Baritone の `isActive` が落ちず、タスクは RUNNING のまま永久に終わらない。
bridge 側の waitTask も巻き込まれ、その間も P2-5 の Baritone 競合を
引きずる。ベッド手前で経路が詰まった SleepTask も同型。

### P3-4. mod 層の未検証パラメータ群 (上限なし・範囲なし・長さなし)

対象: `agent-mod/.../task/UseHoldTask.java:28` + `game/GameOps.java:1249-1252`、
`game/GameOps.java` の obs.entity / chat.send / chat.command

- `hold_ticks` は `Math.max(1, holdTicks)` で上限なし。`use_item
{hold_ticks: 100000000}` で keyUse が約 58 日分の tick 保持され、cancel
以外に解除手段がない
- `obs.entity` の radius だけ未クランプ (obs.scan/obs.block は 64 に制限)。
`radius: 100000` で巨大 AABB の全 entity 走査がメインスレッドを占有し、
`radius: -48` では box が反転して常に 0 件という silent な空応答になる
- `chat.send` / `chat.command` に長さ検証なし。フレーム上限 64KiB 内の長文を
`sendChat` すると vanilla サーバーのチャット長制限に触れて bot 自身が
サーバーから切断される自己 DoS になる

MCP 側 zod で制限されている項目もあるが、WS 直結経路 (P1-5) では mod 層が
最後の砦になる。層間での二重検証がない。

### P3-5. WS エンベロープの型検証が甘く、壊れた 1 フレームで処理が死ぬ

対象: `agent-mod/.../net/AgentWsServer.java:137-142,146-147,164,169-170`、
`bridge/src/modclient.ts:35-50`、`bridge/src/state.ts:34-44`

Java 側は try で囲まれているのが JSON パースのみで、その後の
`get("type").getAsString()`、`get("id").getAsLong()`、
`get("role").getAsString()` は無防備。bridge 側も `JSON.parse` の成功しか
見ておらず、chat イベントの data を型断定し、chat listener だけ try/catch で
隔離されていない (evt listener は隔離済み — 非対称)。

シナリオ: (a) `{"type":"req","id":"abc","method":"obs.state"}` を 1 回送ると
`getAsLong` が例外を投げ、エラー応答なく接続処理が異常終了する。在 flight の
他リクエストの応答も失われ、ゲーム内タスクだけが走り続ける。(b) mod/mock が
`{type:"evt", name:"chat", data:{from:"x"}}` (text 欠落) を送ると、ModClient の
ハンドラや runner の `c.text.trim()` で例外になり、`wake()` に到達せず
待機者が固まる。

### P3-6. 「何もしていないのに成功」系の silent success 群

- `task/DigTask.java:53-66`: 対象が最初から空気 (座標タイポ等) でも
`broken:true, block:"air"` で SUCCEEDED。何も掘っていないことが成功として
bridge に返る
- `task/WaitConditionTask.java:113-126`: 条件の評価例外は全て
`catch (Exception) { return false;}`。条件 type の打ち間違いや必須キー
欠落でも即エラーにならず、最大 1800 秒待って `reason=timeout` の SUCCEEDED
が返り、呼び出し側は「正当なタイムアウト」と区別できない
- `skills/process_batch.mjs:51-57` 経由の process_chain: 最終 `done` が
`produced > 0` 判定のため、`count=100` を依頼して 10 個しかできなくても
`done:true`。chat 文面は実数を言うため被害は構造化結果側に限る
- quest 系ハンドラ (`bridge/src/mcp.ts` の frontier/plan/prepare/guide):
`mod.call('quest.list').catch(() => ({ quests: []}))` で通信失敗を
「完了ゼロ」に化けさせ、実際は完了済みのクエストまで frontier に戻して
`completed:0` と報告する

### P3-7. CraftTask の取り出し計測窓が固定 3 tick で、サーバーラグ時に過剰クラフトする

対象: `agent-mod/.../task/CraftTask.java:36-37,102-117`

配置側は非同期対応で PLACE_WAIT=20 を取るのに、取り出し側は TAKE_WAIT=3。
`produced += max(0, pendingTake - left)` は 3 tick 時点のクライアント menu
状態で確定する。

シナリオ: modded サーバーの TPS 低下で QUICK_MOVE の反映が 10 tick 遅れると、
結果がまだ slot 0 に残って見えて `produced += 0` と過小計上し、レシピを
再配置して余分に材料を消費する。want 到達判定が実績ではなく計測タイミングに
依存している。

### P3-8. ルール検索が版を区別せず、fixture も「最初の一致 + 部分文字列」しか見ない

対象: `bridge/src/mcp.ts:675-689` (knowledge search)、
`tools/fixtures/p33`–`p47` の同型パターン

`mod-knowledge/README.md` は「cache key は mod id + version + source commit」
と版固定を前提にするが、検索は全版のルールファイルを無差別に走査し、パック側
の導入版で絞らない。走査順は readdir 順 (未定義)。fixture 側は
`rule_files.find(f => f.mod === X)` の最初の 1 件と、検索ヒットの最初の 1 件に、
JSON 全体への数値部分文字列一致 (例: p34 は `'32'`、quote や source_line に
含まれても合格) しか課していない。

シナリオ: ProjectE の版上げで新版ファイルを追加し旧版が残ると、検索は旧版の
種 EMC を先に返しうる (LLM は版違いの数値で運用判断する) が、fixture は
合格する。AE2 の channel ルールの `value` だけを誤って書き換えても (件数・
commit 不変、quote に `32` が残る) fixture は合格する。

### P3-9. knowledge 周りの silent failure / 状態不整合 3 件

対象: `bridge/src/mcp.ts:580-626,647,716-735`

- 壊れたルール JSON は `catch { /* skip broken rule file */}` でログも痕跡も
なく消える。新規ルールに末尾カンマ等が混入すると、その mod のルールは一覧と
検索から完全に消え、専用 fixture の無い mod では全検証 PASS のまま、LLM が
ルールなしで推測回答するようになる
- `knowledgeIndex` は初回読込後に再読されない一方、`get` は毎回
`knowledgeDir()` を探し直す。稼働中に再抽出すると、mods/search は旧索引を
返し続け (新 mod が見えない)、get は新 mod のファイルを読める、という
不整合が再起動まで無言で続く
- `search` の `limit` に上下限がない (他ツールの多くにはある)。
`query:'e', limit:1000000` で索引全体が 1 レスポンスに直列化され、消費者が
LLM であるこのツールの文脈を圧迫する
- (仕様乖離として記録) 説明文は「path from the index」と言うが実装は索引への
存在確認をせず、mod 配下の任意ファイルを読める。`mod:'.'` では knowledge
ルート自体が base になり、全 mod のファイルと index.json を読める。漏洩先は
knowledge 内に留まるため影響は小さい

### P3-10. screenshot が mod の返す任意パスをそのまま読み、画像以外のファイルを返せる

対象: `bridge/src/mcp.ts:1545-1562`

`mod.call('screenshot')` の結果 `r.path` を検証なしに `readFile` し、base64 化
して `image/png` として返す。保存先ディレクトリ、拡張子、サイズ、PNG 署名の
確認がない。

シナリオ: MOD_URL 先の mock/侵害された mod が screenshot 結果として任意の
テキストファイルのパスを返すと、bridge がその内容を読み、MCP 呼出側へ
base64 で渡す (形式が PNG でなくても中身は復号できる)。mod を信頼する前提
ではあるが、bridge が「ファイル読み出しプリミティブ」を無検証で公開している
形になっている。

### P3-11. tool-config の検証不足で、タイプミスが gate の例外か設定の silent 無効化になる

対象: `bridge/src/toolgate.ts:49-72`、`bridge/src/mcp.ts:38-62`

`loadToolConfig` は配列かどうかだけを見て要素型を検証せず、JSON 構文エラー時
はログなしで既定値へ戻す。`expand` は要素が文字列前提で `startsWith` を呼ぶ。

シナリオ: `{"enabled":[123]}` と書くと `computePresentation` 内で TypeError に
なり、非同期 `applyGate` の unhandled rejection になり得る。逆に `disabled` に
危険ツールを書いたつもりでカンマを落とすと、設定全体が黙って無効化され、
そのツールが再表示される (fail-open)。

### P3-12. State.waitFor が since 境界を見ず、未来 seq の待機を空応答で早期終了する

対象: `bridge/src/state.ts:48-79`

`wake()` は最新イベントの名前一致だけで waiter を起こし、返却フィルタが空でも
resolve する。`latest.seq > w.since` の確認がない。

シナリオ: bridge 再起動で seq が 0 に戻ったあと、旧プロセスの
`since_seq=1000` を保持するクライアントが `wait_event` すると、seq 1000 以下
の一致イベントが来るたびに本来の対象でないのに `[]` で即時復帰し、
「イベントなし」と誤判定する (ポーリングが空転する)。

### P3-13. 機械/ステーション定義キャッシュが「初回の空結果」をプロセス寿命まで固定する

対象: `bridge/src/commission.ts:12-31`、`skills/world_craft.mjs:14-28`、
`skills/build_schematic.mjs:7-23`

いずれもモジュール変数に初回ロード結果を入れ、空 (dir 不在・cwd 違い・全
ファイル破損) でもキャッシュ確定する。再読込経路がない。特に commission は
`process.cwd()` 相対で探す。

シナリオ: bridge を repo ルート以外から起動 → 初回 commission で `machines/`
が見つからず空キャッシュが固定 → 定義ファイルを追加しても・正しい cwd の
つもりでも、再起動するまで全ての commission が理由を示さず
`no commission plan` を返し続ける (silent)。

### P3-14. その他の確認済みの小さな欠陥 (同型の参考)

- `bridge/src/snbt.ts:96-103`: SNBT パーサが末尾ゴミを無言で捨てる。生成物の
元になる.snbt が途中で壊れていても最初の compound が閉じた時点で成功に
なり、欠けたクエストグラフが「正常品」として生成される。深いネストでは
再帰下降が RangeError で tools/build-quest-graph.mjs ごと落ちる
- `bridge/src/catalog.ts:51-67`: catalog refresh にページ上限がない。mod 側が
`total` に巨大値を返しつつ少しずつしか返さない不整合を起こすと、refresh が
総件数ぶん直列 RPC を続けて事実上終わらない
- `skills/world_craft.mjs:154,304-320`: 開始時 `obs.state` が一時失敗すると
`invBefore` が空 Map になり、終了時インベントリの「入力以外の全アイテム」
が新規生産物として数えられ、何も生産されていない回に元々持っていた松明等で
`done:true` になる。注記の「成否はインベントリ差分 (権威ある状態) で判定」
が、基準側の欠測で崩れる

---

## 検証したが指摘にしなかったもの

- **knowledge の末尾空白/ピリオド成分による脱出**: 字句層では
`path:'.. /secret.txt'` が `startsWith(base + sep)` 検査を通過するが、
Windows 実機 + Node の `readFile` で実証したところ、当該成分は文字通りの
ディレクトリ名として扱われ ENOENT になった (Node の fs は DOS 名正規化を
適用しない)。bridge の読み経路では再現しないため落とした。Node 以外の
ランタイムに読み手を変える場合は再評価が要る
- **Bearer トークンの `===` 比較 (定数時間でない)**: 高エントロピーのトークン
に対し HTTP 越しのタイミング抽出は現実的なシナリオを作れず落とした
- **S1 の handshake で 403 を builder に載せる方式が実際に接続を拒むか**:
java-websocket の内部仕様依存で確証が取れなかった。P1-5 の認証不在が
解消されれば実害は大幅に下がるため、単独の指摘にはしていない
- **ModClient 再接続の多重予約、State の events 配列 shift コスト等**:
実害のシナリオが弱く落とした

## まとめ

最重大は承認・認証の境界 (P1-1〜P1-5) で、「止める仕組みはあるが、止められる
側と同じ主体が解除でき、そもそも所有者以外も解除できる」状態が複数経路で
重なっている。次いで、LLM の誤生成 1 回で bridge 全体が固まる P1-6 と、
「指示したのに動かない」「止めたのに動く」が無言で起きる P1-7/P1-8。
P2 は silent failure と虚偽成功の蓄積が中心で、特に「数えただけ」パターン
(P2-13/P2-14) と反射・タスク層の競合 (P2-4〜P2-8) は、個別には小さく見えて
実プレイの信頼を削る種類のもの。検証基盤側 (P2-24) は、PASS の安心感に対して
実カバレッジが最も過大になっている箇所。
