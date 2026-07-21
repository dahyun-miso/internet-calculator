import { getNotesForDeal } from '../lib/hubspot.js';

export const config = { runtime: 'edge' };

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export default async function handler(request) {
  const url = new URL(request.url);
  const dealId = url.searchParams.get('dealId')?.trim();
  if (!dealId) {
    return new Response(JSON.stringify({ error: 'dealId required' }), { status: 400, headers: jsonHeaders });
  }

  try {
    const notes = await getNotesForDeal(dealId);
    return new Response(JSON.stringify({ notes }), { headers: jsonHeaders });
  } catch (e) {
    console.error('hubspot-deal-notes error', e);
    return new Response(JSON.stringify({ error: 'notes lookup failed' }), { status: 502, headers: jsonHeaders });
  }
}
