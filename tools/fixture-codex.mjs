// fixture用の偽codex: stdin(prompt)を FIXTURE_PROMPT_OUT へ保存して即終了する。
// runner.ts が spawn する `codex exec ... -` の差替え (RUNNER_COMMAND で指定)。
// FIXTURE_RESPONSE があればその内容をstdoutに流す (run-fixtureの判定用ログにもなる)。
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

const out = process.env.FIXTURE_PROMPT_OUT;
if (out) {
  mkdirSync(path.dirname(out), { recursive: true });
  appendFileSync(out, `\n===== ${new Date().toISOString()} =====\n${input}\n`);
}
if (process.env.FIXTURE_RESPONSE) process.stdout.write(process.env.FIXTURE_RESPONSE);
process.exit(0);
