const HUBSPOT_BASE = 'https://api.hubapi.com';
const NOTE_TO_DEAL_ASSOCIATION_TYPE_ID = 214;
const TASK_TO_DEAL_ASSOCIATION_TYPE_ID = 216;

function hubspotHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function getOwnerIdByEmail(email) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/owners/?email=${encodeURIComponent(email)}`, {
    headers: hubspotHeaders(),
  });
  if (!res.ok) throw new Error(`owners lookup failed: ${res.status}`);
  const data = await res.json();
  return data.results?.[0]?.id || null;
}

// KST(UTC+9) 기준 오늘 00:00 ~ 다음날 00:00을 UTC epoch ms 범위로 변환
function kstTodayRangeMs() {
  const now = Date.now();
  const kstNow = now + 9 * 60 * 60 * 1000;
  const kstMidnight = Math.floor(kstNow / 86400000) * 86400000;
  const startUtc = kstMidnight - 9 * 60 * 60 * 1000;
  return { startUtc, endUtc: startUtc + 86400000 };
}

export async function searchTodayDealsByOwner(ownerId) {
  const { startUtc, endUtc } = kstTodayRangeMs();
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: hubspotHeaders(),
    body: JSON.stringify({
      filterGroups: [{
        filters: [
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) },
          { propertyName: 'hubspot_owner_assigneddate', operator: 'BETWEEN', value: String(startUtc), highValue: String(endUtc) },
        ],
      }],
      properties: ['dealname', 'amount', 'dealstage', 'hubspot_owner_assigneddate'],
      sorts: [{ propertyName: 'hubspot_owner_assigneddate', direction: 'DESCENDING' }],
      limit: 100,
    }),
  });
  if (!res.ok) throw new Error(`deals search failed: ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((d) => ({
    id: d.id,
    dealname: d.properties?.dealname || '',
    amount: d.properties?.amount || '',
    dealstage: d.properties?.dealstage || '',
  }));
}

// "YYYY-MM-DD"를 KST 기준 hour시로 해석해 UTC epoch ms로 변환
export function kstDateStringToUtcMs(dateStr, hour = 9) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const kstMs = Date.UTC(y, m - 1, d, hour, 0, 0);
  return kstMs - 9 * 60 * 60 * 1000;
}

export async function createTaskOnDeal(dealId, { subject, body, dueTimestamp, priority }) {
  const createRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/tasks`, {
    method: 'POST',
    headers: hubspotHeaders(),
    body: JSON.stringify({
      properties: {
        hs_task_subject: subject,
        hs_task_body: body || '',
        hs_timestamp: dueTimestamp,
        hs_task_status: 'NOT_STARTED',
        hs_task_type: 'TODO',
        hs_task_priority: priority || 'MEDIUM',
      },
    }),
  });
  if (!createRes.ok) throw new Error(`task create failed: ${createRes.status}`);
  const task = await createRes.json();

  const assocRes = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/tasks/${task.id}/associations/deal/${dealId}/${TASK_TO_DEAL_ASSOCIATION_TYPE_ID}`,
    { method: 'PUT', headers: hubspotHeaders() }
  );
  if (!assocRes.ok) throw new Error(`task association failed: ${assocRes.status}`);

  return task.id;
}

export async function createNoteOnDeal(dealId, noteBody) {
  const createRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/notes`, {
    method: 'POST',
    headers: hubspotHeaders(),
    body: JSON.stringify({
      properties: {
        hs_note_body: noteBody,
        hs_timestamp: Date.now(),
      },
    }),
  });
  if (!createRes.ok) throw new Error(`note create failed: ${createRes.status}`);
  const note = await createRes.json();

  const assocRes = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/notes/${note.id}/associations/deal/${dealId}/${NOTE_TO_DEAL_ASSOCIATION_TYPE_ID}`,
    { method: 'PUT', headers: hubspotHeaders() }
  );
  if (!assocRes.ok) throw new Error(`note association failed: ${assocRes.status}`);

  return note.id;
}
