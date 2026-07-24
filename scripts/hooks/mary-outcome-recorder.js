#!/usr/bin/env node
/**
 * Mary — PostToolUse / PostToolUseFailure 결과 기록
 *
 * 게이트가 물어본 것이 실제로 어떻게 끝났는지 원장에 닫는 기록을 남긴다.
 * 이것이 없으면 "승인했다"까지만 남고 "그래서 됐는가"는 아무도 모른다.
 *
 * 이 훅은 아무것도 막지 않는다. 도구는 이미 실행된 뒤다.
 * 그래서 판정을 하지 않고, 실패해도 조용히 끝난다 — 기록 실패가 작업을 방해하면 안 된다.
 *
 * 결과가 끝내 오지 않으면(세션 강제 종료·호스트 장애) 그 승인은 열린 채 남는다.
 * 그 상태는 "실패"가 아니라 **unknown** 이고, 다음 세션 시작 때 보고된다.
 * unknown 을 자동 재시도의 근거로 쓰지 않는다 — 실제로 실행됐을 수 있기 때문이다.
 */

'use strict';

const { requestHash, append } = require('./lib/ledger');

function summarize(res) {
  if (res == null) return null;
  const s = typeof res === 'string' ? res : JSON.stringify(res);
  return s.length > 400 ? s.slice(0, 400) + ' …' : s;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const p = JSON.parse(raw || '{}');
      const failed = p.hook_event_name === 'PostToolUseFailure';
      append({
        event: failed ? 'failed' : 'succeeded',
        session: p.session_id || null,
        tool: p.tool_name || null,
        tool_use_id: p.tool_use_id || null,
        request_hash: requestHash(p.tool_name, p.tool_input),
        summary: summarize(p.tool_response),
      });
    } catch {
      /* 기록 실패는 작업을 막지 않는다 */
    }
    process.exit(0);
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();
