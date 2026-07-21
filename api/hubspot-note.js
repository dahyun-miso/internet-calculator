import { createNoteOnDeal } from '../lib/hubspot.js';

export const config = { runtime: 'edge' };

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: jsonHeaders });
  }

  const dealId = body?.dealId?.toString().trim();
  const note = body?.note?.toString().trim();
  if (!dealId || !note) {
    return new Response(JSON.stringify({ error: 'dealId and note required' }), { status: 400, headers: jsonHeaders });
  }

  try {
    const noteId = await createNoteOnDeal(dealId, note);
    return new Response(JSON.stringify({ noteId }), { headers: jsonHeaders });
  } catch (e) {
    console.error('hubspot-note error', e);
    return new Response(JSON.stringify({ error: 'note creation failed' }), { status: 502, headers: jsonHeaders });
  }
}
