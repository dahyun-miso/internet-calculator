// ── 허브스팟 연동: 오늘 배정된 리드 조회 + 상담 메모 전송 ──
(function(){
  const panelToggleBtn = document.getElementById('hubspot-panel-toggle');
  const panelOverlay = document.getElementById('hubspot-panel-overlay');
  const panel = document.getElementById('hubspot-panel');
  const panelCloseBtn = document.getElementById('hubspot-panel-close');
  const panelBadge = document.getElementById('hubspot-panel-badge');

  const agent = new URLSearchParams(window.location.search).get('agent')?.trim();
  if(agent !== '박다현'){ // 테스트 기간 동안 다른 상담사에게는 노출하지 않음
    panelToggleBtn.style.display = 'none';
    return;
  }

  function openPanel(){
    panel.classList.add('open');
    panelOverlay.classList.add('open');
  }
  function closePanel(){
    panel.classList.remove('open');
    panelOverlay.classList.remove('open');
  }
  panelToggleBtn.addEventListener('click', openPanel);
  panelCloseBtn.addEventListener('click', closePanel);
  panelOverlay.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closePanel(); });

  const card = document.getElementById('hubspot-leads-card');
  const listEl = document.getElementById('hubspot-leads-list');
  const noteArea = document.getElementById('hubspot-note-area');
  const noteText = document.getElementById('hubspot-note-text');
  const sendBtn = document.getElementById('hubspot-note-send');

  let selectedDealId = null;
  const notesHistory = document.getElementById('hubspot-notes-history');

  function formatKst(ts){
    if(!ts) return '';
    return new Date(ts).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  // ── 오늘 마감 Task 목록 (페이지당 10개, </> 로 넘겨보기) ──
  const tasksCard = document.getElementById('hubspot-tasks-card');
  const tasksListEl = document.getElementById('hubspot-tasks-list');
  const tasksCountEl = document.getElementById('hubspot-tasks-count');
  const tasksRefreshBtn = document.getElementById('hubspot-tasks-refresh');
  const tasksUpdatedEl = document.getElementById('hubspot-tasks-updated');
  const tasksPrevBtn = document.getElementById('hubspot-tasks-prev');
  const tasksNextBtn = document.getElementById('hubspot-tasks-next');
  const TASKS_PAGE_SIZE = 10;
  let allTasks = [];
  let taskPage = 0;
  let awaitingTaskReturn = false; // Task 제목을 눌러 HubSpot으로 이동한 뒤, 이 탭에 돌아왔을 때만 새로고침

  function renderTasksPage(){
    const total = allTasks.length;
    tasksCountEl.textContent = total ? `(총 ${total}개)` : '';
    tasksPrevBtn.disabled = taskPage === 0;
    tasksNextBtn.disabled = (taskPage + 1) * TASKS_PAGE_SIZE >= total;

    if(!total){
      tasksListEl.textContent = '오늘 마감인 Task가 없습니다.';
      return;
    }
    const pageTasks = allTasks.slice(taskPage * TASKS_PAGE_SIZE, (taskPage + 1) * TASKS_PAGE_SIZE);

    tasksListEl.innerHTML = '';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    table.innerHTML = `<thead><tr style="border-bottom:1px solid #ddd;color:#888;font-size:12px">
      <th style="text-align:left;padding:4px 6px">제목</th>
      <th style="text-align:right;padding:4px 6px">만기일</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    pageTasks.forEach(t => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #f0f0f0'
        + (t.priority === 'HIGH' ? ';background:#fdecea' : '');

      const titleTd = document.createElement('td');
      titleTd.style.padding = '6px';
      if(t.dealUrl){
        const link = document.createElement('a');
        link.href = t.dealUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.cssText = 'color:#1a73e8;text-decoration:none';
        link.textContent = t.subject || '(제목 없음)';
        link.addEventListener('click', () => { awaitingTaskReturn = true; });
        titleTd.appendChild(link);
      } else {
        titleTd.style.color = '#1a73e8';
        titleTd.textContent = t.subject || '(제목 없음)';
      }

      const dueTd = document.createElement('td');
      dueTd.style.cssText = 'padding:6px;text-align:right;white-space:nowrap;color:#666';
      dueTd.textContent = formatKst(t.timestamp);

      tr.appendChild(titleTd);
      tr.appendChild(dueTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tasksListEl.appendChild(table);
  }

  tasksPrevBtn.addEventListener('click', () => { if(taskPage > 0){ taskPage--; renderTasksPage(); } });
  tasksNextBtn.addEventListener('click', () => { if((taskPage + 1) * TASKS_PAGE_SIZE < allTasks.length){ taskPage++; renderTasksPage(); } });

  // ── 마감 지난 Task 개수 뱃지 (팝업/토스트 알림 없이, 헤더 버튼에 조용히 숫자만 표시) ──
  function checkDueTasks(){
    const now = Date.now();
    const dueCount = allTasks.filter(t => t.timestamp && t.timestamp <= now).length;
    panelBadge.textContent = dueCount > 9 ? '9+' : String(dueCount);
    panelBadge.style.display = dueCount > 0 ? '' : 'none';
  }

  setInterval(checkDueTasks, 30000);

  function loadTasks(){
    tasksRefreshBtn.disabled = true;
    tasksRefreshBtn.style.opacity = '0.5';
    fetch('/api/hubspot-tasks?agent=' + encodeURIComponent(agent))
      .then(r => r.json().then(data => ({ok: r.ok, data})))
      .then(({ok, data}) => {
        if(!ok || data.mapped === false){
          if(!ok) console.error('hubspot-tasks error', data);
          return;
        }
        tasksCard.style.display = '';
        allTasks = data.tasks || [];
        taskPage = 0;
        renderTasksPage();
        checkDueTasks();
        tasksUpdatedEl.textContent = '새로고침: ' + new Date().toLocaleTimeString('ko-KR');
      })
      .catch(e => console.error('hubspot-tasks fetch failed', e))
      .finally(() => { tasksRefreshBtn.disabled = false; tasksRefreshBtn.style.opacity = '1'; });
  }

  tasksRefreshBtn.addEventListener('click', loadTasks);

  // Task 제목 클릭으로 HubSpot을 보러 간 뒤 이 탭으로 돌아왔을 때만 새로고침 (주기적 폴링 없음)
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && awaitingTaskReturn){
      awaitingTaskReturn = false;
      loadTasks();
    }
  });

  loadTasks();

  function loadNotesHistory(dealId){
    notesHistory.textContent = '메모 불러오는 중...';
    fetch('/api/hubspot-deal-notes?dealId=' + encodeURIComponent(dealId))
      .then(r => { if(!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        const notes = data.notes || [];
        if(!notes.length){ notesHistory.textContent = '등록된 메모가 없습니다.'; return; }
        notesHistory.innerHTML = '';
        notes.forEach(n => {
          const item = document.createElement('div');
          item.style.cssText = 'padding:5px 0;border-bottom:1px solid #eee;white-space:pre-wrap';
          const time = document.createElement('div');
          time.style.cssText = 'color:#999;font-size:11px;margin-bottom:2px';
          time.textContent = formatKst(n.timestamp);
          item.appendChild(time);
          item.appendChild(document.createTextNode(n.body));
          notesHistory.appendChild(item);
        });
      })
      .catch(() => { notesHistory.textContent = '메모를 불러오지 못했습니다.'; });
  }

  let allDeals = [];

  function selectDeal(dealId){
    selectedDealId = dealId;
    noteArea.style.display = '';
    loadNotesHistory(dealId);
    listEl.querySelectorAll('input[type=radio]').forEach(r => { r.checked = (r.value === dealId); });
  }

  // 메모/Task 생성 기능은 잠시 비활성화 — 거래 제목 + 지속부재 횟수만 표시 (selectDeal 미호출)
  function renderDeals(deals){
    if(!deals.length){
      listEl.textContent = '일치하는 리드가 없습니다.';
      return;
    }
    listEl.innerHTML = '';
    deals.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:4px 0;border-bottom:1px solid #f0f0f0';
      const noAnswerText = d.noAnswerCount ? ` · 부재 ${d.noAnswerCount}회` : '';
      row.textContent = `${d.dealname || '(제목 없음)'}${noAnswerText}`;
      listEl.appendChild(row);
    });
  }

  // hubspot_owner_map에 매핑된 상담사에게만 카드를 노출한다 (매핑 안 된 경우/에러 시 조용히 숨김).
  function loadLeads(){
    fetch('/api/hubspot-deals?agent=' + encodeURIComponent(agent))
      .then(r => r.json().then(data => ({ok: r.ok, data})))
      .then(({ok, data}) => {
        if(!ok || data.mapped === false){
          if(!ok) console.error('hubspot-deals error', data);
          return;
        }
        card.style.display = '';
        allDeals = (data.deals || []).filter(d => d.dealstageLabel === '전화 시도(1st Attempt Try)');
        renderDeals(allDeals);
      })
      .catch(e => console.error('hubspot-deals fetch failed', e));
  }
  loadLeads();

  const leadsRefreshBtn = document.getElementById('hubspot-leads-refresh');
  leadsRefreshBtn.addEventListener('click', () => {
    leadsRefreshBtn.disabled = true;
    leadsRefreshBtn.style.opacity = '0.5';
    fetch('/api/hubspot-deals?agent=' + encodeURIComponent(agent))
      .then(r => r.json().then(data => ({ok: r.ok, data})))
      .then(({ok, data}) => {
        if(!ok){ showToast('❌ 새로고침 실패'); return; }
        if(data.mapped !== false){ allDeals = (data.deals || []).filter(d => d.dealstageLabel === '전화 시도(1st Attempt Try)'); renderDeals(allDeals); }
      })
      .catch(() => showToast('❌ 새로고침 실패'))
      .finally(() => { leadsRefreshBtn.disabled = false; leadsRefreshBtn.style.opacity = '1'; });
  });

  sendBtn.addEventListener('click', () => {
    const note = noteText.value.trim();
    if(!selectedDealId){ showToast('⚠️ 거래를 먼저 선택하세요'); return; }
    if(!note){ showToast('⚠️ 메모를 입력하세요'); return; }
    sendBtn.disabled = true;
    fetch('/api/hubspot-note?agent=' + encodeURIComponent(agent), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ dealId: selectedDealId, note }),
    })
      .then(r => { if(!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        showToast('✅ 메모가 전송되었습니다');
        noteText.value='';
        if(selectedDealId) loadNotesHistory(selectedDealId);
      })
      .catch(() => showToast('❌ 메모 전송 실패'))
      .finally(() => { sendBtn.disabled = false; });
  });

  const taskSubject = document.getElementById('hubspot-task-subject');
  const taskBody = document.getElementById('hubspot-task-body');
  const taskDue = document.getElementById('hubspot-task-due');
  const taskPriority = document.getElementById('hubspot-task-priority');
  const taskSendBtn = document.getElementById('hubspot-task-send');

  taskSendBtn.addEventListener('click', () => {
    const subject = taskSubject.value.trim();
    const dueDate = taskDue.value;
    if(!selectedDealId){ showToast('⚠️ 거래를 먼저 선택하세요'); return; }
    if(!subject){ showToast('⚠️ 작업 제목을 입력하세요'); return; }
    if(!dueDate){ showToast('⚠️ 마감일을 선택하세요'); return; }
    taskSendBtn.disabled = true;
    fetch('/api/hubspot-task?agent=' + encodeURIComponent(agent), {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        dealId: selectedDealId,
        subject,
        body: taskBody.value.trim(),
        dueDate,
        priority: taskPriority.value,
      }),
    })
      .then(r => { if(!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        showToast('✅ Task가 생성되었습니다');
        taskSubject.value = '';
        taskBody.value = '';
        taskDue.value = '';
        loadTasks();
      })
      .catch(() => showToast('❌ Task 생성 실패'))
      .finally(() => { taskSendBtn.disabled = false; });
  });
})();
