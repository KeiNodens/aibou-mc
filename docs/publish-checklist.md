# GitHub公開・pushチェックリスト

リポジトリ: `origin` = `https://github.com/KeiNodens/aibou-mc.git` (public)。
公開前に必ず以下を実施する。2026-10-28 時点で実際に発見・処理した事例をそのまま
チェック項目化してある。

## 1. マスク対象 (このプロジェクトで実際に出たもの)

| 種別 | 例 | 置き換え先 |
|---|---|---|
| 実名・プレイヤー名 | 本名・本名のローマ字表記 (chat例・検証ログ) | `Player` 等の一般名 |
| コミットauthorメール | 個人メールアドレス (実値) | GitHub noreply `211226690+KeiNodens@users.noreply.github.com` |
| Windowsユーザーパス | `C:\Users\<name>`、`/c/dev` | 相対パス・`<path>` 等 |
| プライベートインフラ | Tailscale IP `100.x`、tailnet名、ホスト名 | `<host>.<tailnet>` 等のプレースホルダ |
| アカウント識別子 | Prism `profile.id`、MC UUID | 省略 or `xxxx...` |
| シークレット | `BRIDGE_TOKEN` の実値、APIキー、webhook | コミット禁止 (env var名のみ可) |

`Rin` はbotの製品名 (デフォルト表示名) として使用可。ただし開発者の実名や、
個人の相棒としての固有名の言及は `プレイヤー` / `ホストLLM` 等へ一般化する。
一人称・所有表現もプロジェクト記述へ言い換える。

## 2. 検査コマンド

```bash
# 未push分の追加行を検査 (全履歴なら git log -p に変える)
RANGE=origin/main..HEAD

# 既知パターン一括
git diff $RANGE | grep -n -i -E \
  "yourname|100\.|yourhost|\.ts\.net|C:\\\\Users|gmail|@outlook|@hotmail|webhook|token=|BEGIN.*KEY|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

# chat発言者名の洗い出し (プレイヤー名の混入検出)
git diff $RANGE | grep -oE '"from":"[^"]+"' | sort -u
git diff $RANGE | grep -oE "\[[A-Za-z_0-9]{3,16}\]" | sort -u

# コミットauthorの検査 ← 忘れやすい・最重要
git log $RANGE --format='%an <%ae>' | sort -u
```

## 3. authorメールの書き換え (未pushの範囲で)

```bash
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
if [ "$GIT_AUTHOR_EMAIL" = "personal-mail@example.com" ]; then
  export GIT_AUTHOR_EMAIL="211226690+KeiNodens@users.noreply.github.com"
fi
if [ "$GIT_COMMITTER_EMAIL" = "personal-mail@example.com" ]; then
  export GIT_COMMITTER_EMAIL="211226690+KeiNodens@users.noreply.github.com"
fi
' <clean-base>..HEAD
```

`<clean-base>` は書き換え不要な最後のコミット。書き換え後 `refs/original/`
に旧refが残る (ローカルのみ・pushされない)。問題なければ
`git update-ref -d refs/original/refs/heads/main` で削除。

### 再発防止 (推奨)

- このリポジトリの `git config user.email` を noreply アドレスにしておく
  (実行はリポジトリ所有者が判断)
- GitHub: Settings → Emails → **Keep my email addresses private** をON
  → ウェブ編集のコミットも自動でnoreplyになる

## 4. push手順

```bash
git fetch origin
git rebase origin/main    # リモート側のweb編集等があれば取り込む
git push origin main      # 通常はこれだけ
# 履歴書き換えを伴う場合のみ (要・確認):
git push --force-with-lease origin main
```

- 認証はGit Credential ManagerのOAuth。PAT利用なら Repository access に
  `aibou-mc` を含め Contents: Read and write が必要
- **リポジトリ作成は手動**: fine-grained PATは `POST /user/repos` を呼べない。
  github.com/new で空作成する (README/.gitignore/licenseは付けない)
- リポジトリURLを埋め込んでいる箇所:
  `agent-mod/src/main/resources/META-INF/mods.toml` の `issueTrackerURL`

## 5. push前の最終確認

- `git status` — 他セッション等の作業中の未コミット変更をWIPとして
  コミットから外すか、完成しているか判断する
- `.gitignore` が runtime artifacts (`server/` `packs/` `research/` `tmp/`
  `tools/tunnel/`) を除外していること
- force-pushする場合、リモートのweb編集コミットも書き換え対象になること、
  `--force-with-lease` で他人のpushによる上書きを防ぐこと
