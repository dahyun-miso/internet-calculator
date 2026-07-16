import { Redis } from '@upstash/redis';

// Vercel의 Marketplace(Upstash) 스토리지 연동 시 주입되는 변수명이
// KV_REST_API_* / UPSTASH_REDIS_REST_* 두 가지로 갈릴 수 있어 둘 다 지원한다.
export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  // 값을 직접 JSON.stringify/parse로 다루므로 클라이언트의 자동 (역)직렬화는 끈다.
  automaticDeserialization: false,
});

// 조회 시 화면/응답 크기를 위해 최근 몇 건만 가져올지 (저장 자체는 무제한 누적)
export const LOGIN_HISTORY_DISPLAY_LIMIT = 200;

export async function recordLogin(user, ip) {
  const entry = JSON.stringify({ ip, ts: Date.now() });
  await Promise.all([
    redis.set(`login:last:${user}`, entry),
    redis.lpush(`login:history:${user}`, entry),
    redis.sadd('login:users', user),
  ]);
}
