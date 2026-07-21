import { updateTaskStatus } from '../lib/hubspot.js';

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

  const taskId = body?.taskId?.toString().trim();
  if (!taskId) {
    return new Response(JSON.stringify({ error: 'taskId required' }), { status: 400, headers: jsonHeaders });
  }

  try {
    await updateTaskStatus(taskId, 'COMPLETED');
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  } catch (e) {
    console.error('hubspot-task-status error', e);
    return new Response(JSON.stringify({ error: 'task status update failed' }), { status: 502, headers: jsonHeaders });
  }
}
