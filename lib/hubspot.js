const HUBSPOT_BASE = 'https://api.hubapi.com';
const NOTE_TO_DEAL_ASSOCIATION_TYPE_ID = 214;
const TASK_TO_DEAL_ASSOCIATION_TYPE_ID = 216;
const HUBSPOT_PORTAL_ID = '20652401';
const DEAL_RECORD_OBJECT_TYPE_ID = '0-3';
const NO_ANSWER_COUNT_PROPERTY = 'int________'; // "지속부재 횟수" 내부 이름
const PHONE_ATTEMPT_STAGE_LABEL = '전화 시도(1st Attempt Try)';
const INT_RESUBMIT_LIST_NAME = '[INT] 재제안 대상';

function dealRecordUrl(dealId) {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/${DEAL_RECORD_OBJECT_TYPE_ID}/${dealId}`;
}

function hubspotHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

const ownerIdCache = new Map(); // email -> ownerId (HubSpot 계정이 살아있는 한 고정값이라 만료 없이 캐싱)

export async function getOwnerIdByEmail(email) {
  if (ownerIdCache.has(email)) return ownerIdCache.get(email);

  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/owners/?email=${encodeURIComponent(email)}`, {
    headers: hubspotHeaders(),
  });
  if (!res.ok) throw new Error(`owners lookup failed: ${res.status}`);
  const data = await res.json();
  const ownerId = data.results?.[0]?.id || null;
  ownerIdCache.set(email, ownerId);
  return ownerId;
}

// KST(UTC+9) 기준 오늘 00:00 ~ 다음날 00:00을 UTC epoch ms 범위로 변환
function kstTodayRangeMs() {
  const now = Date.now();
  const kstNow = now + 9 * 60 * 60 * 1000;
  const kstMidnight = Math.floor(kstNow / 86400000) * 86400000;
  const startUtc = kstMidnight - 9 * 60 * 60 * 1000;
  return { startUtc, endUtc: startUtc + 86400000 };
}

let dealStageMapCache = null; // 파이프라인 구조는 거의 바뀌지 않으므로 워밍 인스턴스 동안 캐싱 (동시 요청은 같은 promise 공유)

async function getDealStageMap() {
  if (dealStageMapCache) return dealStageMapCache;
  dealStageMapCache = (async () => {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/pipelines/deals`, { headers: hubspotHeaders() });
    if (!res.ok) throw new Error(`pipelines lookup failed: ${res.status}`);
    const data = await res.json();
    const map = {};
    (data.results || []).forEach((pipeline) => {
      (pipeline.stages || []).forEach((stage) => {
        map[stage.id] = { label: stage.label, order: stage.displayOrder };
      });
    });
    return map;
  })();
  try {
    return await dealStageMapCache;
  } catch (e) {
    dealStageMapCache = null; // 실패 시 다음 호출에서 재시도
    throw e;
  }
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
      properties: ['dealname', 'amount', 'dealstage', 'hubspot_owner_assigneddate', NO_ANSWER_COUNT_PROPERTY],
      sorts: [{ propertyName: 'hubspot_owner_assigneddate', direction: 'DESCENDING' }],
      limit: 100,
    }),
  });
  if (!res.ok) throw new Error(`deals search failed: ${res.status}`);
  const data = await res.json();
  const deals = (data.results || []).map((d) => ({
    id: d.id,
    dealname: d.properties?.dealname || '',
    amount: d.properties?.amount || '',
    dealstage: d.properties?.dealstage || '',
    noAnswerCount: d.properties?.[NO_ANSWER_COUNT_PROPERTY] || null,
    dealUrl: dealRecordUrl(d.id),
  }));
  if (!deals.length) return deals;

  const stageMap = await getDealStageMap();
  deals.forEach((d) => {
    const stage = stageMap[d.dealstage];
    d.dealstageLabel = stage?.label || d.dealstage || '(단계 없음)';
    d.dealstageOrder = stage?.order ?? 9999;
    // 전화 시도 단계가 아니면 지속부재 횟수는 화면에 노출하지 않는다.
    if (d.dealstageLabel !== PHONE_ATTEMPT_STAGE_LABEL) d.noAnswerCount = null;
  });

  // 파이프라인상의 단계 순서로 그룹핑되도록 정렬 (같은 단계 안에서는 배정일 순서 유지 - stable sort)
  return deals.sort((a, b) => a.dealstageOrder - b.dealstageOrder);
}

const listIdCache = new Map(); // 목록 이름 -> listId (이름이 바뀌지 않는 한 고정값이라 만료 없이 캐싱)

async function getListIdByName(name) {
  if (listIdCache.has(name)) return listIdCache.get(name);
  const res = await fetch(
    `${HUBSPOT_BASE}/crm/v3/lists/object-type-id/${DEAL_RECORD_OBJECT_TYPE_ID}/name/${encodeURIComponent(name)}`,
    { headers: hubspotHeaders() }
  );
  if (res.status === 404) { listIdCache.set(name, null); return null; }
  if (!res.ok) throw new Error(`list lookup failed: ${res.status}`);
  const data = await res.json();
  const listId = data.list?.listId || null;
  listIdCache.set(name, listId);
  return listId;
}

async function getListMemberIds(listId) {
  const ids = new Set();
  let after;
  let pageCount = 0;
  do {
    const url = new URL(`${HUBSPOT_BASE}/crm/v3/lists/${listId}/memberships`);
    url.searchParams.set('limit', '250');
    if (after) url.searchParams.set('after', after);
    const res = await fetch(url, { headers: hubspotHeaders() });
    if (!res.ok) throw new Error(`list memberships lookup failed: ${res.status}`);
    const data = await res.json();
    (data.results || []).forEach((m) => ids.add(String(m.recordId)));
    after = data.paging?.next?.after;
    pageCount += 1;
  } while (after && pageCount < 100); // 안전장치: 커서가 잘못 반복될 경우의 무한 루프 방지 (최대 25,000건)
  return ids;
}

// "INT 최근(2일) 상담" 뷰 재현: [INT] 재제안 대상 목록에 속하면서, 다음 활동 날짜가 오늘이거나 아예 없는 내 거래
// 포탈 전체를 property 필터로 스캔하면 목록 밖의 거래까지 훑게 되어 느려지므로, 목록 멤버만 batch read로 조회한다.
export async function searchIntRecentDealsByOwner(ownerId) {
  const { startUtc, endUtc } = kstTodayRangeMs();
  const listId = await getListIdByName(INT_RESUBMIT_LIST_NAME);
  if (!listId) return [];
  const memberIds = Array.from(await getListMemberIds(listId));
  if (!memberIds.length) return [];

  const deals = [];
  for (let i = 0; i < memberIds.length; i += 100) {
    const batchIds = memberIds.slice(i, i + 100);
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/batch/read`, {
      method: 'POST',
      headers: hubspotHeaders(),
      body: JSON.stringify({
        properties: ['dealname', 'dealstage', 'notes_next_activity_date', 'hubspot_owner_id', NO_ANSWER_COUNT_PROPERTY],
        inputs: batchIds.map((id) => ({ id })),
      }),
    });
    if (!res.ok) throw new Error(`int-recent deals batch read failed: ${res.status}`);
    const data = await res.json();
    deals.push(...(data.results || []).map((d) => ({
      id: d.id,
      dealname: d.properties?.dealname || '',
      dealstage: d.properties?.dealstage || '',
      ownerId: d.properties?.hubspot_owner_id || null,
      nextActivityDate: d.properties?.notes_next_activity_date || null,
      noAnswerCount: d.properties?.[NO_ANSWER_COUNT_PROPERTY] || null,
      dealUrl: dealRecordUrl(d.id),
    })));
  }

  const filtered = deals.filter((d) => {
    if (String(d.ownerId) !== String(ownerId)) return false;
    if (!d.nextActivityDate) return true; // 다음 활동 날짜가 아예 없는 경우도 포함
    const ts = new Date(d.nextActivityDate).getTime();
    return ts >= startUtc && ts < endUtc;
  });
  if (!filtered.length) return filtered;

  const stageMap = await getDealStageMap();
  filtered.forEach((d) => { d.dealstageLabel = stageMap[d.dealstage]?.label || d.dealstage || '(단계 없음)'; });
  return filtered;
}

export async function searchTodayTasksByOwner(ownerId) {
  const { startUtc, endUtc } = kstTodayRangeMs();
  const tasks = [];
  let after;
  do {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/tasks/search`, {
      method: 'POST',
      headers: hubspotHeaders(),
      body: JSON.stringify({
        filterGroups: [{
          filters: [
            { propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) },
            { propertyName: 'hs_timestamp', operator: 'BETWEEN', value: String(startUtc), highValue: String(endUtc) },
            { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
          ],
        }],
        properties: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_status', 'hs_task_priority'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }],
        limit: 100,
        ...(after ? { after } : {}),
      }),
    });
    if (!res.ok) throw new Error(`tasks search failed: ${res.status}`);
    const data = await res.json();
    tasks.push(...(data.results || []).map((t) => ({
      id: t.id,
      subject: t.properties?.hs_task_subject || '',
      timestamp: t.properties?.hs_timestamp || null,
      status: t.properties?.hs_task_status || 'NOT_STARTED',
      priority: t.properties?.hs_task_priority || 'MEDIUM',
    })));
    after = data.paging?.next?.after;
  } while (after);
  if (!tasks.length) return tasks;

  const dealIdByTaskId = await getDealIdsForTasks(tasks.map((t) => t.id));
  tasks.forEach((t) => {
    const dealId = dealIdByTaskId[t.id];
    t.dealId = dealId || null;
    t.dealUrl = dealId ? dealRecordUrl(dealId) : null;
  });

  // 우선순위 HIGH를 맨 위로 (그 안에서는 원래의 마감시간 순서 유지 - stable sort)
  return tasks.sort((a, b) => (a.priority === 'HIGH' ? 0 : 1) - (b.priority === 'HIGH' ? 0 : 1));
}

async function getDealIdsForTasks(taskIds) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v4/associations/tasks/deals/batch/read`, {
    method: 'POST',
    headers: hubspotHeaders(),
    body: JSON.stringify({ inputs: taskIds.map((id) => ({ id })) }),
  });
  if (!res.ok) throw new Error(`task-deal associations lookup failed: ${res.status}`);
  const data = await res.json();
  const map = {};
  (data.results || []).forEach((r) => {
    const dealId = r.to?.[0]?.toObjectId;
    if (dealId) map[r.from.id] = dealId;
  });
  return map;
}

export async function updateTaskStatus(taskId, status) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/tasks/${taskId}`, {
    method: 'PATCH',
    headers: hubspotHeaders(),
    body: JSON.stringify({ properties: { hs_task_status: status } }),
  });
  if (!res.ok) throw new Error(`task status update failed: ${res.status}`);
}

// "YYYY-MM-DDTHH:mm"(datetime-local 입력값)을 KST 기준 시각으로 해석해 UTC epoch ms로 변환
export function kstDateTimeStringToUtcMs(dateTimeStr) {
  const [datePart, timePart = '09:00'] = dateTimeStr.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const kstMs = Date.UTC(y, m - 1, d, hh, mm, 0);
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

export async function getNotesForDeal(dealId) {
  const assocRes = await fetch(`${HUBSPOT_BASE}/crm/v4/objects/deals/${dealId}/associations/notes`, {
    headers: hubspotHeaders(),
  });
  if (!assocRes.ok) throw new Error(`deal notes association lookup failed: ${assocRes.status}`);
  const assoc = await assocRes.json();
  const noteIds = (assoc.results || []).map((r) => r.toObjectId);
  if (!noteIds.length) return [];

  const batchRes = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/notes/batch/read`, {
    method: 'POST',
    headers: hubspotHeaders(),
    body: JSON.stringify({
      properties: ['hs_note_body', 'hs_timestamp'],
      inputs: noteIds.map((id) => ({ id })),
    }),
  });
  if (!batchRes.ok) throw new Error(`notes batch read failed: ${batchRes.status}`);
  const batch = await batchRes.json();

  return (batch.results || [])
    .map((n) => ({
      id: n.id,
      body: n.properties?.hs_note_body || '',
      timestamp: n.properties?.hs_timestamp || null,
    }))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);
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
