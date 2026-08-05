// 관리자 웹업로드로 받은 PRODUCTS 패치를 GitHub의 index.html에 직접 커밋한다.
// Vercel이 main 브랜치 push를 감지해 자동 재배포한다.
export const config = { runtime: 'edge' };

const OWNER = 'dahyun-miso';
const REPO = 'internet-calculator';
const BRANCH = 'main';
const FILE_PATH = 'index.html';

const KNOWN_ISPS = ['KT', 'KT 오피스넷', 'LGU', 'LG 소호', 'SKB', 'SKT', '헬로비전', 'SKY'];
const KNOWN_CATEGORIES = ['internet', 'tv', 'tv-extra', 'router', 'phone', 'addon', 'install', 'bundle', 'gift'];

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function badRequest(msg) {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: jsonHeaders });
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch가 객체가 아닙니다';
  const isps = Object.keys(patch);
  if (isps.length === 0) return '변경 사항이 없습니다';
  for (const isp of isps) {
    if (!KNOWN_ISPS.includes(isp)) return `알 수 없는 통신사: ${isp}`;
    const cats = patch[isp];
    if (!cats || typeof cats !== 'object' || Array.isArray(cats)) return `${isp}: 필드 목록이 객체가 아닙니다`;
    for (const cat of Object.keys(cats)) {
      if (!KNOWN_CATEGORIES.includes(cat)) return `${isp}: 알 수 없는 필드 "${cat}"`;
      const items = cats[cat];
      if (!items || typeof items !== 'object' || Array.isArray(items)) return `${isp}.${cat}: 값이 객체가 아닙니다`;
      for (const [k, v] of Object.entries(items)) {
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) return `${isp}.${cat}."${k}": 숫자가 유효하지 않습니다`;
          continue;
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const extraKeys = Object.keys(v).filter(kk => !['t', 'c', 'v'].includes(kk));
          if (extraKeys.length) return `${isp}.${cat}."${k}": 허용되지 않은 필드 (${extraKeys.join(',')})`;
          if (typeof v.t !== 'number' || !Number.isFinite(v.t)) return `${isp}.${cat}."${k}": t 필드가 유효한 숫자가 아닙니다`;
          continue;
        }
        return `${isp}.${cat}."${k}": 값 타입이 올바르지 않습니다`;
      }
    }
  }
  return null;
}

function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'GITHUB_TOKEN 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트 설정에서 등록 후 재배포해주세요.' }),
      { status: 500, headers: jsonHeaders }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid json');
  }

  const patch = body?.patch;
  const err = validatePatch(patch);
  if (err) return badRequest(err);

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'miso-calculator-admin',
  };

  // 1) 현재 index.html 가져오기
  let getRes;
  try {
    getRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers: ghHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: 'GitHub 연결 실패: ' + e.message }), { status: 502, headers: jsonHeaders });
  }
  if (!getRes.ok) {
    const t = await getRes.text();
    return new Response(
      JSON.stringify({ error: `GitHub 파일 조회 실패 (${getRes.status})`, detail: t.slice(0, 300) }),
      { status: 502, headers: jsonHeaders }
    );
  }
  const fileData = await getRes.json();
  const sha = fileData.sha;
  const html = b64DecodeUtf8(fileData.content);

  // 2) PRODUCTS 선언 블록 찾아 patch 적용
  const startMarker = 'const PRODUCTS=';
  const startIdx = html.indexOf(startMarker);
  const endMarker = '\nconst BUNDLE_SPEED_MAP=';
  const endIdx = startIdx === -1 ? -1 : html.indexOf(endMarker, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    return new Response(
      JSON.stringify({ error: 'index.html에서 PRODUCTS 선언부를 찾지 못했습니다 (파일 구조가 바뀌었을 수 있음)' }),
      { status: 500, headers: jsonHeaders }
    );
  }

  const jsonText = html.slice(startIdx + startMarker.length, endIdx).trim().replace(/;$/, '');
  let currentProducts;
  try {
    // PRODUCTS는 키가 인용부호 없는 JS 객체 리터럴이라 JSON.parse가 아니라 평가로 읽는다.
    // eslint-disable-next-line no-new-func
    currentProducts = new Function('return (' + jsonText + ')')();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'PRODUCTS 파싱 실패: ' + e.message }), { status: 500, headers: jsonHeaders });
  }

  const changeLog = [];
  for (const isp of Object.keys(patch)) {
    currentProducts[isp] = currentProducts[isp] || {};
    for (const cat of Object.keys(patch[isp])) {
      currentProducts[isp][cat] = patch[isp][cat];
      changeLog.push(`${isp}.${cat}`);
    }
  }

  const newBlock = startMarker + JSON.stringify(currentProducts) + ';';
  const newHtml = html.slice(0, startIdx) + newBlock + html.slice(endIdx);

  // 3) 커밋
  const commitMessage = `[관리자 웹업로드] 계산기 데이터 갱신 (${changeLog.join(', ')})`;
  let putRes;
  try {
    putRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage,
        content: b64EncodeUtf8(newHtml),
        sha,
        branch: BRANCH,
      }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'GitHub 커밋 요청 실패: ' + e.message }), { status: 502, headers: jsonHeaders });
  }
  if (!putRes.ok) {
    const t = await putRes.text();
    return new Response(
      JSON.stringify({ error: `GitHub 커밋 실패 (${putRes.status})`, detail: t.slice(0, 300) }),
      { status: 502, headers: jsonHeaders }
    );
  }
  const putData = await putRes.json();

  return new Response(
    JSON.stringify({ ok: true, commitUrl: putData.commit?.html_url, changed: changeLog }),
    { headers: jsonHeaders }
  );
}
