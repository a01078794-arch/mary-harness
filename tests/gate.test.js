#!/usr/bin/env node
/**
 * Mary 게이트·원장 테스트
 *
 *   node tests/gate.test.js
 *
 * 실제 ~/.claude/mary/ 를 건드리지 않는다. MARY_DIR 을 임시 폴더로 돌려놓고 돈다.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mary-test-'));
process.env.MARY_DIR = TMP;

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'scripts', 'hooks', 'mary-irreversible-gate.js');
const RECORDER = path.join(ROOT, 'scripts', 'hooks', 'mary-outcome-recorder.js');
const REPORT = path.join(ROOT, 'scripts', 'hooks', 'mary-session-report.js');

const { decide } = require(GATE);
const ledger = require(path.join(ROOT, 'scripts', 'hooks', 'lib', 'ledger.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

/** 훅을 하위 프로세스로 실제 실행한다. 출력 계약까지 검증하기 위해서다. */
function runHook(script, payload) {
  const r = spawnSync(process.execPath, [script], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, MARY_DIR: TMP },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function decisionOf(payload) {
  const r = runHook(GATE, payload);
  assert.strictEqual(r.code, 0, `exit code 는 항상 0 이어야 한다 (받음: ${r.code})`);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.hookSpecificOutput.hookEventName, 'PreToolUse');
  return j.hookSpecificOutput.permissionDecision;
}

const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
const write = file_path => ({ tool_name: 'Write', tool_input: { file_path } });

console.log('\n[판정 — 비가역 행동은 ask]');
t('rm -rf',            () => assert.strictEqual(decide(bash('rm -rf ./build')).decision, 'ask'));
t('git push',          () => assert.strictEqual(decide(bash('git push origin main')).decision, 'ask'));
t('--no-verify',       () => assert.strictEqual(decide(bash('git commit --no-verify -m x')).decision, 'ask'));
t('curl POST',         () => assert.strictEqual(decide(bash('curl -X POST https://a.b -d @f')).decision, 'ask'));
t('DROP TABLE',        () => assert.strictEqual(decide(bash('psql -c "drop table users"')).decision, 'ask'));
t('terraform destroy', () => assert.strictEqual(decide(bash('terraform destroy')).decision, 'ask'));

console.log('\n[판정 — 무해한 것은 defer. allow 를 반환하지 않는다]');
t('ls',                () => assert.strictEqual(decide(bash('ls -la')).decision, 'defer'));
t('git push --dry-run',() => assert.strictEqual(decide(bash('git push --dry-run')).decision, 'defer'));
t('일반 파일 쓰기',    () => assert.strictEqual(decide(write('C:/p/src/app.ts')).decision, 'defer'));
t('어떤 경로도 allow 아님', () => {
  for (const c of ['ls', 'echo hi', 'cat x']) {
    assert.notStrictEqual(decide(bash(c)).decision, 'allow', `${c} 가 allow 를 반환했다`);
  }
});

console.log('\n[자기 보호]');
t('settings.json',     () => assert.strictEqual(decide(write('C:/p/.claude/settings.json')).decision, 'ask'));
t('settings.local.json',() => assert.strictEqual(decide(write('C:/p/.claude/settings.local.json')).decision, 'ask'));
t('hooks.json',        () => assert.strictEqual(decide(write('C:/p/hooks/hooks.json')).decision, 'ask'));
t('게이트 스크립트 자신',() => assert.strictEqual(decide(write('C:/p/scripts/hooks/x.js')).decision, 'ask'));

console.log('\n[fail-closed — 판정 불가는 통과가 아니다]');
t('깨진 JSON',         () => assert.strictEqual(decisionOf('{"tool_name":'), 'ask'));
t('빈 입력',           () => assert.strictEqual(decisionOf(''), 'ask'));
t('빈 명령',           () => assert.strictEqual(decide(bash('')).decision, 'ask'));
t('공백만 있는 명령',  () => assert.strictEqual(decide(bash('   ')).decision, 'ask'));
t('tool_input 없음',   () => assert.strictEqual(decisionOf({ tool_name: 'Bash' }), 'ask'));

console.log('\n[원장 — 정규화와 해시]');
t('키 순서가 달라도 같은 해시', () => {
  const a = ledger.requestHash('Bash', { command: 'x', timeout: 1 });
  const b = ledger.requestHash('Bash', { timeout: 1, command: 'x' });
  assert.strictEqual(a, b);
});
t('내용이 다르면 다른 해시', () => {
  assert.notStrictEqual(ledger.requestHash('Bash', { command: 'a' }),
                        ledger.requestHash('Bash', { command: 'b' }));
});
t('도구가 다르면 다른 해시', () => {
  assert.notStrictEqual(ledger.requestHash('Bash', { command: 'a' }),
                        ledger.requestHash('Write', { command: 'a' }));
});

console.log('\n[원장 — 승인과 실행의 결속]');
t('ask 하면 asked 가 기록된다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  runHook(GATE, bash('rm -rf ./tmp-x'));
  const rows = ledger.readAll();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event, 'asked');
  assert.ok(rows[0].request_hash.startsWith('sha256:'), 'request_hash 가 있어야 한다');
  assert.ok(rows[0].presented_text.includes('되돌릴 방법'), '사람이 본 문장이 남아야 한다');
});
t('defer 는 기록하지 않는다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  runHook(GATE, bash('ls'));
  assert.strictEqual(ledger.readAll().length, 0);
});
t('결과가 오면 승인이 닫힌다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  const p = bash('rm -rf ./tmp-y');
  runHook(GATE, p);
  assert.strictEqual(ledger.openApprovals().length, 1, '결과 전에는 열려 있어야 한다');
  runHook(RECORDER, { ...p, hook_event_name: 'PostToolUse', tool_response: 'ok' });
  assert.strictEqual(ledger.openApprovals().length, 0, '결과 후에는 닫혀야 한다');
});
t('실패도 승인을 닫는다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  const p = bash('rm -rf ./tmp-z');
  runHook(GATE, p);
  runHook(RECORDER, { ...p, hook_event_name: 'PostToolUseFailure', tool_response: 'denied' });
  assert.strictEqual(ledger.openApprovals().length, 0);
  assert.strictEqual(ledger.readAll().pop().event, 'failed');
});
t('결과가 없으면 열린 채 남는다 (unknown)', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  runHook(GATE, bash('git push origin main'));
  assert.strictEqual(ledger.openApprovals().length, 1);
});
t('다른 요청의 결과는 이 승인을 닫지 못한다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  runHook(GATE, bash('rm -rf ./a'));
  runHook(RECORDER, { ...bash('rm -rf ./b'), hook_event_name: 'PostToolUse', tool_response: 'ok' });
  assert.strictEqual(ledger.openApprovals().length, 1, '해시가 다르면 닫히면 안 된다');
});
t('원장은 덧붙이기만 한다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  runHook(GATE, bash('rm -rf ./c'));
  runHook(GATE, bash('rm -rf ./d'));
  runHook(RECORDER, { ...bash('rm -rf ./c'), hook_event_name: 'PostToolUse', tool_response: 'ok' });
  assert.strictEqual(ledger.readAll().length, 3, '기존 줄이 사라지면 안 된다');
});

console.log('\n[세션 보고]');
t('열린 승인이 있으면 컨텍스트를 낸다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  runHook(GATE, bash('rm -rf ./open-one'));
  const r = runHook(REPORT, { hook_event_name: 'SessionStart', source: 'startup' });
  const j = JSON.parse(r.out);
  const ctx = j.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('unknown'), 'unknown 상태를 명시해야 한다');
  assert.ok(ctx.includes('자동으로 재시도하지 마'), '자동 재시도 금지를 명시해야 한다');
});
t('열린 승인이 없으면 아무것도 안 낸다', () => {
  fs.writeFileSync(path.join(TMP, 'approvals.jsonl'), '');
  const r = runHook(REPORT, { hook_event_name: 'SessionStart', source: 'startup' });
  assert.strictEqual(r.out.trim(), '');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} 통과 / ${fail} 실패\n`);
process.exit(fail === 0 ? 0 : 1);
