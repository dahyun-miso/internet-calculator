import { getAll } from '@vercel/edge-config';
import { next, ipAddress } from '@vercel/functions';
import { recordLogin } from './lib/redis.js';

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Restricted"' },
  });
}

function forbidden() {
  return new Response('Forbidden', { status: 403 });
}

const ADMIN_USER = '관리자';

function decodeBasicAuth(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// ── 임시 비활성화 (2026-07-16) ──
// IP 화이트리스트 + 아이디/비번 인증을 잠시 꺼둔 상태. IP 기록 기능만 배포하기 위함.
// 재활성화할 때: 아래 주석 블록의 주석(/* */)을 해제하고, 그 아래
// "임시: 인증 없이 기록" 블록을 삭제할 것.
export default async function middleware(request) {
  const url = new URL(request.url);
  const agentParam = url.searchParams.get('agent')?.trim();
  const ip = ipAddress(request);

  /*
  const { agents, allowed_ips } = await getAll(['agents', 'allowed_ips']);

  if (!allowed_ips?.includes(ip)) return forbidden();

  const expectedUser = agentParam || ADMIN_USER;

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();

  let user, pass;
  try {
    [user, pass] = decodeBasicAuth(auth.slice(6)).split(':');
  } catch {
    return unauthorized();
  }

  // agents[user]가 문자열로 등록돼 있는지 먼저 확인한다.
  // (없으면 pass가 undefined인 잘못된 헤더와 비교했을 때 undefined === undefined로
  // 통과해버리는 인증 우회가 발생했었음)
  if (!agents || typeof agents[user] !== 'string') return unauthorized();
  if (user !== expectedUser || agents[user] !== pass) return unauthorized();

  try {
    await recordLogin(user, ip);
  } catch (e) {
    console.error('recordLogin failed', e);
  }

  return next();
  */

  // 임시: 인증 없이 기록만 남기고 통과시킨다. agent 파라미터가 없으면 'anonymous'로 기록.
  try {
    await recordLogin(agentParam || 'anonymous', ip);
  } catch (e) {
    console.error('recordLogin failed', e);
  }

  return next();
}
