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

// agent 파라미터가 있는 요청(계산기 사용)은 인증 없이 열어두고,
// agent 파라미터가 없는 요청(예: /logins.html 관리자 페이지)만 아이디/비번으로 보호한다.
export default async function middleware(request) {
  const url = new URL(request.url);
  const agentParam = url.searchParams.get('agent')?.trim();
  const ip = ipAddress(request);

  const { agents, allowed_ips, expected_ips } = await getAll(['agents', 'allowed_ips', 'expected_ips']);

  let loginLabel = agentParam || 'anonymous';

  if (!agentParam) {
    if (!allowed_ips?.includes(ip)) return forbidden();

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
    if (user !== ADMIN_USER || agents[user] !== pass) return unauthorized();

    loginLabel = user;
  }

  try {
    await recordLogin(loginLabel, ip, expected_ips?.[loginLabel]);
  } catch (e) {
    console.error('recordLogin failed', e);
  }

  return next();
}
