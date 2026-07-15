import { getAll } from '@vercel/edge-config';
import { next, ipAddress } from '@vercel/functions';

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

export default async function middleware(request) {
  const { agents, allowed_ips } = await getAll(['agents', 'allowed_ips']);

  const ip = ipAddress(request);
  if (!allowed_ips?.includes(ip)) return forbidden();

  const url = new URL(request.url);
  const agentParam = url.searchParams.get('agent')?.trim();
  const expectedUser = agentParam || ADMIN_USER;

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();

  let user, pass;
  try {
    [user, pass] = decodeBasicAuth(auth.slice(6)).split(':');
  } catch {
    return unauthorized();
  }

  return user === expectedUser && agents?.[user] === pass ? next() : unauthorized();
}
