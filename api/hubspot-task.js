import { createTaskOnDeal, kstDateTimeStringToUtcMs } from '../lib/hubspot.js';

export const config = { runtime: 'edge' };

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

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
  const subject = body?.subject?.toString().trim();
  const taskBody = body?.body?.toString().trim() || '';
  const dueDate = body?.dueDate?.toString().trim();
  const priority = VALID_PRIORITIES.includes(body?.priority) ? body.priority : 'MEDIUM';

  if (!dealId || !subject || !dueDate) {
    return new Response(JSON.stringify({ error: 'dealId, subject, dueDate required' }), { status: 400, headers: jsonHeaders });
  }

  try {
    const dueTimestamp = kstDateTimeStringToUtcMs(dueDate);
    const taskId = await createTaskOnDeal(dealId, { subject, body: taskBody, dueTimestamp, priority });
    return new Response(JSON.stringify({ taskId }), { headers: jsonHeaders });
  } catch (e) {
    console.error('hubspot-task error', e);
    return new Response(JSON.stringify({ error: 'task creation failed' }), { status: 502, headers: jsonHeaders });
  }
}
