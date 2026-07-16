import { redis, LOGIN_HISTORY_DISPLAY_LIMIT } from '../lib/redis.js';

export const config = { runtime: 'edge' };

export default async function handler() {
  const users = await redis.smembers('login:users');

  const results = await Promise.all(
    users.map(async (user) => {
      const [lastRaw, historyRaw, historyTotal] = await Promise.all([
        redis.get(`login:last:${user}`),
        redis.lrange(`login:history:${user}`, 0, LOGIN_HISTORY_DISPLAY_LIMIT - 1),
        redis.llen(`login:history:${user}`),
      ]);
      const last = lastRaw ? JSON.parse(lastRaw) : null;
      const history = (historyRaw || []).map((h) => JSON.parse(h));
      return { user, last, history, historyTotal };
    })
  );

  results.sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));

  return new Response(JSON.stringify({ users: results }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
