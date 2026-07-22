import { getAll } from '@vercel/edge-config';
import { searchIntRecentDeals } from '../lib/hubspot.js';

export const config = { runtime: 'edge' };

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export default async function handler(request) {
  const url = new URL(request.url);
  const agent = url.searchParams.get('agent')?.trim();
  if (!agent) {
    return new Response(JSON.stringify({ error: 'agent required' }), { status: 400, headers: jsonHeaders });
  }

  const { hubspot_owner_map } = await getAll(['hubspot_owner_map']);
  const email = hubspot_owner_map?.[agent];
  if (!email) {
    return new Response(JSON.stringify({ deals: [], mapped: false }), { headers: jsonHeaders });
  }

  try {
    const deals = await searchIntRecentDeals();
    return new Response(JSON.stringify({ deals }), { headers: jsonHeaders });
  } catch (e) {
    console.error('hubspot-int-recent error', e);
    // TODO: 원인 파악 후 아래 debug 필드 제거
    return new Response(JSON.stringify({ error: 'hubspot lookup failed', debug: String(e?.message || e) }), { status: 502, headers: jsonHeaders });
  }
}
