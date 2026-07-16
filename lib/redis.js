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

// KST(UTC+9) 기준 날짜 문자열 (한국 시간 자정 기준으로 "하루"를 나눔)
function kstDateString(ts) {
  return new Date(ts + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordLogin(user, ip, expectedIp) {
  const now = Date.now();

  const lastRaw = await redis.get(`login:last:${user}`);
  const last = lastRaw ? JSON.parse(lastRaw) : null;

  // 같은 IP로 같은 날짜에 이미 기록이 있으면 새로고침 등으로 인한 중복 기록을 생략한다.
  if (last && last.ip === ip && kstDateString(last.ts) === kstDateString(now)) {
    return;
  }

  // expectedIp(등록된 예상 IP)가 있는데 다르면 대시보드에서 경고 표시할 수 있게 플래그를 남긴다.
  const mismatch = Boolean(expectedIp) && expectedIp !== ip;
  const entry = JSON.stringify({ ip, ts: now, mismatch });
  await Promise.all([
    redis.set(`login:last:${user}`, entry),
    redis.lpush(`login:history:${user}`, entry),
    redis.sadd('login:users', user),
  ]);
}
