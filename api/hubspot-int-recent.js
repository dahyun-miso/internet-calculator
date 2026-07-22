import { getAll } from '@vercel/edge-config';
import { getOwnerIdByEmail, searchIntRecentDealsByOwner } from '../lib/hubspot.js';

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
    const ownerId = await getOwnerIdByEmail(email);
    if (!ownerId) {
      return new Response(JSON.stringify({ deals: [], mapped: true, ownerFound: false }), { headers: jsonHeaders });
    }
    const deals = await searchIntRecentDealsByOwner(ownerId);
    return new Response(JSON.stringify({ deals }), { headers: jsonHeaders });
  } catch (e) {
    console.error('hubspot-int-recent error', e);
    return new Response(JSON.stringify({ error: 'hubspot lookup failed' }), { status: 502, headers: jsonHeaders });
  }
}
