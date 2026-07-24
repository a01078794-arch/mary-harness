#!/usr/bin/env node
/**
 * Mary — PreToolUse 비가역 행동 게이트
 *
 * SKILL.md 의 "되돌릴 수 없는 행동은 사전 승인" 규칙을 문서가 아니라 훅으로 집행한다.
 *
 * 설계 원칙 (모두 의도적이다):
 *
 *  1. fail-CLOSED. 판정할 수 없으면 통과시키지 않고 사용자에게 묻는다.
 *     입력 파싱 실패·예외까지 전부 ask 로 끝난다. fail-open("훅이 죽으면 통과")을 따르지 않는다.
 *
 *  2. 정규식을 승인 판정의 단일 근거로 쓰지 않는다.
 *     패턴은 "확인이 필요하다"는 신호일 뿐이고, 어떤 패턴도 자동 허용을 만들지 않는다.
 *     매칭되지 않으면 allow 가 아니라 defer 다 — 판단을 호스트의 정상 권한 흐름에 넘긴다.
 *
 *  3. 자동 허용 경로가 없다. 세션 캐시도, 타임아웃도, "두 번째 호출은 통과"도 없다.
 *     한 번 물어본 것을 기억해 다음에 안 묻는 구조는 그 자체가 승인 재사용이다.
 *
 *  4. 자기 보호. 이 훅의 설정 파일을 고치려는 시도도 게이트를 통과해야 한다.
 *
 *  5. 물어본 것은 원장에 남긴다. 승인과 실행을 묶는 유일한 근거다(lib/ledger.js).
 *     기록 실패가 판정을 바꾸지는 않는다 — 원장이 안 써져도 게이트는 그대로 묻는다.
 *
 * 출력 계약: exit 0 + stdout JSON.
 *   permissionDecision: "ask"   → 사용자에게 권한 대화상자
 *                       "defer" → 호스트의 정상 권한 흐름
 * exit 2 는 쓰지 않는다. 하드 블록은 사용자에게 선택권을 주지 않는다.
 */

'use strict';

const { requestHash, append } = require('./lib/ledger');

const HOOK_ID = 'mary:pre:irreversible-gate';

/* ── 액션 레지스트리 ────────────────────────────────────────────────
 * 도구 단위가 1차 판정이다. 명령 패턴은 Bash 안에서만 2차 신호로 쓴다.
 * category 는 SKILL.md 0단계 (a) 의 분류와 같은 어휘를 쓴다.
 */
const BASH_PATTERNS = [
  { re: /(^|[\s;&|])rm\s+(-\w*\s+)*-\w*[rf]/i,          category: '삭제' },
  { re: /(^|[\s;&|])(rmdir|del|Remove-Item)\b/i,         category: '삭제' },
  { re: /\bgit\s+push\b(?![^\n]*--dry-run)/i,            category: '외부 전송' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-\w*[fdx])/i,   category: '덮어쓰기' },
  { re: /\bgit\s+(commit|push)\b[^\n]*--no-verify/i,     category: '게이트 우회' },
  { re: /\b(drop\s+table|delete\s+from|truncate\s+table)\b/i, category: '업무시스템 쓰기' },
  { re: /\bdd\s+if=/i,                                   category: '덮어쓰기' },
  { re: /(^|[\s;&|])(curl|wget|Invoke-WebRequest)\b[^\n]*(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s)/i,
    category: '외부 전송' },
  { re: /\b(npm|yarn|pnpm)\s+publish\b/i,                category: '배포' },
  { re: /\b(docker\s+push|kubectl\s+(apply|delete)|terraform\s+(apply|destroy))\b/i, category: '배포' },
];

/* 이 훅 자신의 집행 설정. 고치려면 사용자를 거쳐야 한다. */
const SELF_PROTECTED = [
  /[\\/]\.claude[\\/]settings(\.local)?\.json$/i,
  /[\\/]managed-settings\.json$/i,
  /[\\/]hooks[\\/]hooks\.json$/i,
  /[\\/]\.claude-plugin[\\/]plugin\.json$/i,
  /[\\/]scripts[\\/]hooks[\\/]/i,
];

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/* ── 판정 (순수 함수. 테스트가 이걸 직접 부른다) ──────────────────── */

function decide(payload) {
  const tool = String((payload && payload.tool_name) || '');
  const input = (payload && payload.tool_input) || {};

  // 어떤 도구인지 모르면 defer 하지 않는다. 모르는 것을 정상 흐름에 넘기면
  // "등록 안 된 도구"와 "판정 실패"가 구별되지 않는다.
  if (!tool) {
    return { decision: 'ask', category: '판정 불가',
      reason: '호출된 도구를 확인하지 못했습니다(tool_name 없음). 판정 불가이므로 확인이 필요합니다.' };
  }

  if (tool === 'Bash') {
    const cmd = String(input.command || '');
    if (!cmd.trim()) {
      return { decision: 'ask', category: '판정 불가',
        reason: 'Bash 호출인데 명령을 읽지 못했습니다. 판정 불가이므로 확인이 필요합니다.' };
    }
    const hits = BASH_PATTERNS.filter(p => p.re.test(cmd));
    if (hits.length) {
      const cats = [...new Set(hits.map(h => h.category))].join(' · ');
      return {
        decision: 'ask',
        category: cats,
        reason:
          `비가역 행동으로 분류됨 (${cats}).\n` +
          `명령: ${cmd.length > 300 ? cmd.slice(0, 300) + ' …' : cmd}\n\n` +
          `승인 전에 다음을 확인하세요 — 정확한 대상 / 영향 범위 / 되돌릴 방법.\n` +
          `(SKILL.md 3단계: "되돌릴 수 없는 조작이 필요하면 먼저 대상·범위·되돌릴 방법을 보여주고 승인받는다")`,
      };
    }
    return { decision: 'defer', reason: '등록된 비가역 행동 아님' };
  }

  if (WRITE_TOOLS.has(tool)) {
    const p = String(input.file_path || input.notebook_path || '');
    if (SELF_PROTECTED.some(re => re.test(p))) {
      return {
        decision: 'ask',
        category: '집행 설정 변경',
        reason:
          `이 하네스의 집행 설정을 수정하려 합니다.\n대상: ${p}\n\n` +
          `이 파일이 바뀌면 게이트 자체가 무력화될 수 있습니다. 의도한 변경인지 확인하세요.`,
      };
    }
    return { decision: 'defer', reason: '등록된 비가역 행동 아님' };
  }

  // 등록되지 않은 도구는 "보호되는 것"으로 간주하지 않는다. 정상 흐름에 넘긴다.
  return { decision: 'defer', reason: '등록된 비가역 행동 아님' };
}

/* ── 출력 ──────────────────────────────────────────────────────── */

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `[${HOOK_ID}] ${reason}`,
    },
  }));
  process.exit(0);
}

/* ── 진입점 ────────────────────────────────────────────────────── */

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => emit('ask', '훅 입력을 읽지 못했습니다(stdin 오류). 판정 불가.'));
  process.stdin.on('end', () => {
    // 빈 입력을 {} 로 대체하지 않는다. 그러면 "아무 정보 없음"이 "무해한 호출"로 둔갑한다.
    if (!raw.trim()) {
      return emit('ask', '훅 입력이 비어 있습니다. 무엇을 실행하려는지 알 수 없으므로 확인이 필요합니다.');
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      // fail-closed: 파싱에 실패했다고 통과시키지 않는다.
      return emit('ask', `훅 입력을 해석하지 못했습니다 (${e && e.message}). 판정 불가이므로 확인이 필요합니다.`);
    }

    const v = decide(payload);

    if (v.decision === 'ask') {
      // 승인 요청을 원장에 남긴다. 사람이 본 문장(presented_text)과
      // 기계 대조용 해시(request_hash)를 함께 적는다 — 둘은 다른 용도다.
      append({
        event: 'asked',
        session: payload.session_id || null,
        cwd: payload.cwd || null,
        tool: payload.tool_name || null,
        category: v.category || null,
        request_hash: requestHash(payload.tool_name, payload.tool_input),
        presented_text: v.reason,
        request: payload.tool_input || {},
      });
    }

    emit(v.decision, v.reason);
  });
}

// 예상 못 한 예외도 통과가 아니라 확인으로 끝난다.
process.on('uncaughtException', e => emit('ask', `훅 내부 오류 (${e && e.message}). 판정 불가.`));

if (require.main === module) main();

module.exports = { decide, BASH_PATTERNS, SELF_PROTECTED };
