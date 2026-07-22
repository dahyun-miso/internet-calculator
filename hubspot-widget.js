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

  function formatKstTime(ts){
    if(!ts) return '';
    return new Date(ts).toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit',
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
      <th style="text-align:left;padding:4px 6px">Task 제목</th>
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
      dueTd.textContent = formatKstTime(t.timestamp);

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
  let awaitingLeadsReturn = false; // 거래 제목을 눌러 HubSpot으로 이동한 뒤, 이 탭에 돌아왔을 때만 새로고침

  function selectDeal(dealId){
    selectedDealId = dealId;
    noteArea.style.display = '';
    loadNotesHistory(dealId);
    listEl.querySelectorAll('input[type=radio]').forEach(r => { r.checked = (r.value === dealId); });
  }

  // 메모/Task 생성 기능은 잠시 비활성화 — 거래 제목(링크) + 지속부재 횟수를 표 형태로 표시 (selectDeal 미호출)
  function renderDeals(deals){
    if(!deals.length){
      listEl.textContent = '일치하는 리드가 없습니다.';
      return;
    }
    listEl.innerHTML = '';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    table.innerHTML = `<thead><tr style="border-bottom:1px solid #ddd;color:#888;font-size:12px">
      <th style="text-align:left;padding:4px 6px">거래단계(전화 시도)</th>
      <th style="text-align:center;padding:4px 6px">부재 횟수</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    deals.forEach(d => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #f0f0f0';

      const titleTd = document.createElement('td');
      titleTd.style.padding = '6px';
      if(d.dealUrl){
        const link = document.createElement('a');
        link.href = d.dealUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.cssText = 'color:#1a73e8;text-decoration:none';
        link.textContent = d.dealname || '(제목 없음)';
        link.addEventListener('click', () => { awaitingLeadsReturn = true; });
        titleTd.appendChild(link);
      } else {
        titleTd.style.color = '#1a73e8';
        titleTd.textContent = d.dealname || '(제목 없음)';
      }

      const noAnswerTd = document.createElement('td');
      noAnswerTd.style.cssText = 'padding:6px;text-align:center;white-space:nowrap;color:#666';
      noAnswerTd.textContent = d.noAnswerCount ? String(d.noAnswerCount) : '0';

      tr.appendChild(titleTd);
      tr.appendChild(noAnswerTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    listEl.appendChild(table);
  }

  // hubspot_owner_map에 매핑된 상담사에게만 카드를 노출한다 (매핑 안 된 경우/에러 시 조용히 숨김).
  // 새로고침 트리거: 1) 최초 로드 2) 🔄 수동 새로고침 클릭 3) 거래 제목 클릭 후 탭 복귀
  function loadLeads(){
    leadsRefreshBtn.disabled = true;
    leadsRefreshBtn.style.opacity = '0.5';
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
      .catch(e => console.error('hubspot-deals fetch failed', e))
      .finally(() => { leadsRefreshBtn.disabled = false; leadsRefreshBtn.style.opacity = '1'; });
  }

  const leadsRefreshBtn = document.getElementById('hubspot-leads-refresh');
  leadsRefreshBtn.addEventListener('click', loadLeads);
  loadLeads();

  // 거래 제목 클릭으로 HubSpot을 보러 간 뒤 이 탭으로 돌아왔을 때만 새로고침 (주기적 폴링 없음)
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && awaitingLeadsReturn){
      awaitingLeadsReturn = false;
      loadLeads();
    }
  });

  // ── 허브스팟 최근(2일) 상품제안: [INT] 재제안 대상 목록 + 다음 활동일이 오늘이거나 없는 전체 거래 ──
  const intRecentCard = document.getElementById('hubspot-int-recent-card');
  const intRecentListEl = document.getElementById('hubspot-int-recent-list');
  const intRecentCountEl = document.getElementById('hubspot-int-recent-count');
  const intRecentRefreshBtn = document.getElementById('hubspot-int-recent-refresh');
  let awaitingIntRecentReturn = false;

  function renderIntRecentDeals(deals){
    intRecentCountEl.textContent = deals.length ? `(총 ${deals.length}개)` : '';
    if(!deals.length){
      intRecentListEl.textContent = '일치하는 거래가 없습니다.';
      return;
    }
    intRecentListEl.innerHTML = '';
    deals.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px;border-bottom:1px solid #f0f0f0';
      if(d.dealUrl){
        const link = document.createElement('a');
        link.href = d.dealUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.cssText = 'color:#1a73e8;text-decoration:none';
        link.textContent = d.dealname || '(제목 없음)';
        link.addEventListener('click', () => { awaitingIntRecentReturn = true; });
        row.appendChild(link);
      } else {
        row.style.color = '#1a73e8';
        row.textContent = d.dealname || '(제목 없음)';
      }
      intRecentListEl.appendChild(row);
    });
  }

  // 새로고침 트리거: 1) 최초 로드 2) 🔄 수동 새로고침 클릭 3) 거래 제목 클릭 후 탭 복귀
  function loadIntRecentDeals(){
    intRecentRefreshBtn.disabled = true;
    intRecentRefreshBtn.style.opacity = '0.5';
    fetch('/api/hubspot-int-recent?agent=' + encodeURIComponent(agent))
      .then(r => r.json().then(data => ({ok: r.ok, data})))
      .then(({ok, data}) => {
        if(!ok || data.mapped === false){
          if(!ok) console.error('hubspot-int-recent error', data);
          return;
        }
        intRecentCard.style.display = '';
        renderIntRecentDeals(data.deals || []);
      })
      .catch(e => console.error('hubspot-int-recent fetch failed', e))
      .finally(() => { intRecentRefreshBtn.disabled = false; intRecentRefreshBtn.style.opacity = '1'; });
  }

  intRecentRefreshBtn.addEventListener('click', loadIntRecentDeals);
  loadIntRecentDeals();

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && awaitingIntRecentReturn){
      awaitingIntRecentReturn = false;
      loadIntRecentDeals();
    }
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
