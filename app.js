/* 나만의 플래너 — 화면 로직 */

// 자가 복구: 저장된 옛 화면 파일과 새 파일이 섞여 오류가 나면, 저장본을 모두 지우고 한 번만 다시 읽는다.
(function () {
  var FLAG = 'planner.selfheal';
  var armed = true;
  function heal() {
    if (!armed) return;
    armed = false;
    try { if (sessionStorage.getItem(FLAG)) return; sessionStorage.setItem(FLAG, '1'); } catch (e) { return; }
    var jobs = [];
    if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    }
    Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
  }
  window.addEventListener('error', function () { heal(); });
  window.__plannerHealed = function () { try { sessionStorage.removeItem(FLAG); } catch (e) { /* 무시 */ } armed = false; };
})();

(function () {
  'use strict';

  var M = window.PlannerMerge;
  if (!M) throw new Error('merge.js가 로드되지 않았어요');

  var STORAGE_KEY = 'planner.v1.data';
  var SYNC_KEY = 'planner.v1.syncKey';
  var SERVER_KEY = 'planner.v1.server';
  // 인터넷에 올린 동기화 서버. 데스크톱 앱(localhost 페이지)은 기본으로 여기에 붙고,
  // 휴대폰처럼 서버에서 직접 연 페이지는 자기 주소를 쓴다. 기기 연결 패널에서 바꿀 수 있다.
  var CLOUD_URL = 'https://planner.34-50-58-33.sslip.io';
  var DOUBLE_TAP_MS = 600;
  var POLL_MS = 15000;
  var PUSH_DELAY_MS = 500;
  var MAX_NOTES_SHOWN = 6;

  var DEFAULT_TASKS = [
    '가장 중요한 일 하나를 10분만 시작하기',
    '진행 중인 프로젝트 하나에 진행 기록 한 줄 남기기'
  ];
  var DEFAULT_PROJECTS = {
    work: ['21VIEW / AEO·GEO', '네이버 플레이스 운영', '일본 역직구 MVP'],
    personal: ['선수농원', '로봇팔·하드웨어 자동화', '생활·건강 루틴']
  };
  var EMPH_LINES = [
    '10분만 해도 충분해요.',
    '오늘은 하나만 끝내도 성공이에요.',
    '다시 열어본 것부터 이미 시작이에요.'
  ];
  var LOGO_COUNT = 5;
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var KIND_LABEL = { anniversary: '기념일', schedule: '일정' };

  // ---------------------------------------------------------------- 날짜 도구
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayKey() { return keyOf(new Date()); }
  function shiftDay(k, n) { var d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function fmtLong(k) {
    var d = parseKey(k);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일';
  }
  function fmtMonthDay(k) { var d = parseKey(k); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function now() { return Date.now(); }

  // ---------------------------------------------------------------- DOM 도구
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 목록 항목을 그 자리에서 고치는 입력 칸: 저장(Enter / Ctrl+Enter) · 취소(Esc)
  function inlineEdit(host, opts) {
    var box = el('div', 'inline-edit');
    var input = el(opts.multiline ? 'textarea' : 'input', 'inline-edit-input');
    if (opts.multiline) input.rows = 3; else input.type = 'text';
    input.value = opts.value || '';
    if (opts.maxlength) input.maxLength = opts.maxlength;
    input.setAttribute('aria-label', opts.label || '수정');
    box.appendChild(input);
    var extra = null;
    if (opts.extra) {
      extra = el('input', 'inline-edit-extra'); extra.type = 'text';
      extra.value = opts.extra.value || ''; extra.placeholder = opts.extra.placeholder || '';
      extra.maxLength = opts.extra.maxlength || 20;
      extra.setAttribute('aria-label', opts.extra.label || '');
      box.appendChild(extra);
    }
    var row = el('div', 'inline-edit-actions');
    var ok = el('button', 'btn primary small', '저장'); ok.type = 'button';
    var cancel = el('button', 'btn ghost small', '취소'); cancel.type = 'button';
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(row);
    var done = false;
    function finish(saveIt) {
      if (done) return; done = true;
      if (saveIt) opts.onSave(input.value, extra ? extra.value : undefined); else opts.onCancel();
    }
    ok.addEventListener('click', function () { finish(true); });
    cancel.addEventListener('click', function () { finish(false); });
    function keys(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && (!opts.multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    }
    input.addEventListener('keydown', keys);
    if (extra) extra.addEventListener('keydown', keys);
    host.innerHTML = '';
    host.classList.add('is-editing');
    host.appendChild(box);
    input.focus({ preventScroll: true });
    if (!opts.multiline) input.setSelectionRange(input.value.length, input.value.length);
  }

  var toastTimer = null;
  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.classList.toggle('is-error', !!isError);
    requestAnimationFrame(function () { t.classList.add('is-visible'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('is-visible');
      setTimeout(function () { t.hidden = true; }, 200);
    }, 2200);
  }

  // ---------------------------------------------------------------- 상태
  var data = loadLocal();
  var syncKey = '';
  try { syncKey = localStorage.getItem(SYNC_KEY) || ''; } catch (e) { /* 저장소 사용 불가 */ }

  var view = 'month';
  var selectedKey = todayKey();
  var viewYear = parseKey(selectedKey).getFullYear();
  var viewMonth = parseKey(selectedKey).getMonth();
  var projectCat = 'work';
  var editingEventId = null;
  var lastCalendarTap = { date: '', time: 0 };

  var sync = { dirty: false, pushing: false, serverOk: null, pushTimer: null, pollTimer: null };

  function loadLocal() {
    var d = null;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) d = M.normalize(JSON.parse(raw));
    } catch (e) { d = null; }
    if (!d) d = M.emptyData();
    seedIfEmpty(d);
    return d;
  }

  // 비어 있는 계정에만 초기 예시를 넣는다. 데이터가 있으면 절대 덮어쓰지 않는다.
  function seedIfEmpty(d) {
    if (!M.isEmptyData(d)) return;
    // 새 사용자용(깨끗한) 설치판: 예시 데이터를 전혀 넣지 않는다
    if (/[?&]clean=1/.test(location.search)) return;
    var t = now();
    if (!d.meta.seededPlan) {
      d.days[todayKey()] = {
        tasks: DEFAULT_TASKS.map(function (text, i) {
          return { id: M.uid(), text: text, done: false, createdAt: t + i, updatedAt: t + i, seed: true };
        })
      };
      d.meta.seededPlan = true;
    }
    if (!d.meta.seededProjects) {
      ['work', 'personal'].forEach(function (cat) {
        d.projects[cat] = DEFAULT_PROJECTS[cat].map(function (title, i) {
          return { id: M.uid(), title: title, next: '', status: 'active', memo: '', tasks: [], log: [], createdAt: t + i, updatedAt: t + i, seed: true };
        });
      });
      d.meta.seededProjects = true;
    }
  }

  function persistLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { toast('이 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.', true); }
  }

  // 데이터가 바뀐 뒤 항상 호출: 로컬 저장 → 서버 전송 예약
  function save() {
    data.updatedAt = now();
    persistLocal();
    schedulePush();
    renderGlance();
    scheduleMobileNotifications();
  }

  function tombstone(id) { data.deleted[id] = now(); }

  // ---------------------------------------------------------------- 데이터 질의
  function tasksOf(key) { return data.days[key] ? data.days[key].tasks : []; }
  function notesOf(key) {
    return data.notes.filter(function (n) { return n.dayKey === key; })
      .sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
  }
  // 기간 일정: endDate가 있으면 date~endDate 모든 날에 표시
  function eventSpan(e) { return e.endDate ? daysBetween(e.date, e.endDate) : 0; }
  function yearlyStart(e, yr) {
    return keyOf(new Date(yr, Number(e.date.slice(5, 7)) - 1, Number(e.date.slice(8, 10))));
  }
  // key가 속한 발생 회차의 시작일(없으면 null)
  function occurrenceStart(e, key) {
    var span = eventSpan(e);
    if (e.repeat !== 'yearly') return (key >= e.date && key <= shiftDay(e.date, span)) ? e.date : null;
    var y = Number(key.slice(0, 4));
    var firstYear = Number(e.date.slice(0, 4));
    for (var yr = y; yr >= y - 1; yr--) {
      if (yr < firstYear) break;
      var s = yearlyStart(e, yr);
      if (key >= s && key <= shiftDay(s, span)) return s;
    }
    return null;
  }
  function eventsOf(key) {
    return data.events.filter(function (e) {
      return occurrenceStart(e, key) !== null;
    }).sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'anniversary' ? -1 : 1;
      return a.title.localeCompare(b.title, 'ko');
    });
  }

  // ---------------------------------------------------------------- 동기화
  function isLocalOrigin() {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|$)/.test(location.host) || location.protocol === 'file:';
  }
  function serverBase() {
    var custom = '';
    try { custom = localStorage.getItem(SERVER_KEY) || ''; } catch (e) { /* 무시 */ }
    if (custom) return custom.replace(/\/+$/, '');
    if (isLocalOrigin()) return CLOUD_URL;
    return location.origin;
  }
  function setServerBase(url) {
    url = (url || '').trim().replace(/\/+$/, '');
    try {
      if (url && url !== (isLocalOrigin() ? CLOUD_URL : location.origin)) localStorage.setItem(SERVER_KEY, url);
      else localStorage.removeItem(SERVER_KEY);
    } catch (e) { /* 무시 */ }
  }
  function apiUrl(path) { return serverBase() + '/api/' + path; }

  // 실시간 알림: 서버가 "바뀜" 신호를 보내면 바로 받아온다 (끊기면 브라우저가 알아서 다시 연결)
  var stream = null;
  function startStream() {
    stopStream();
    if (!syncKey || typeof EventSource === 'undefined') return;
    try {
      stream = new EventSource(apiUrl('stream/' + encodeURIComponent(syncKey)));
      stream.onmessage = function () { poll(); };
      stream.onopen = function () { if (sync.serverOk === false) poll(); };
    } catch (e) { stream = null; }
  }
  function stopStream() {
    if (stream) { try { stream.close(); } catch (e) { /* 무시 */ } stream = null; }
  }

  function statusText() {
    if (!syncKey) return '이 기기에 저장 · 로그인 후 동기화';
    if (sync.pushing || sync.dirty) return '저장 중…';
    if (sync.serverOk === false) return '연결되면 동기화 · 이 기기에 저장됨';
    if (sync.serverOk === true) return '☁️ 모든 기기와 동기화됨';
    return '연결 확인 중…';
  }

  function renderStatus() {
    var b = $('syncStatusBtn');
    b.title = '설정 · ' + statusText();
    $('syncStatusText').textContent = statusText();
    var synced = !!syncKey && sync.serverOk === true && !sync.dirty && !sync.pushing;
    b.classList.toggle('is-synced', synced);
    b.classList.toggle('is-saving', sync.pushing || sync.dirty);
  }

  // ---------------------------------------------------------------- 오늘의 각오
  var RESOLUTION_LATER_KEY = 'planner.v1.resolutionLater';
  function resolutionOf(key) { return data.resolutions && data.resolutions[key] ? data.resolutions[key].text : ''; }
  function renderResolution() {
    // 일 다이어리 날짜 옆: 보고 있는 날짜의 각오 (오늘이고 아직 없으면 적기 버튼)
    var text = resolutionOf(selectedKey);
    $('resolutionText').textContent = text ? '🔥 ' + text : '';
    $('resolutionText').hidden = !text;
    $('resolutionBtn').hidden = !!text || selectedKey !== todayKey();
    if (resolutionOf(todayKey()) && !$('resolutionModal').hidden) $('resolutionModal').hidden = true;
  }
  function openResolutionModal() {
    $('resolutionModalDate').textContent = fmtLong(todayKey());
    $('resolutionInput').value = '';
    $('resolutionModal').hidden = false;
    setTimeout(function () { $('resolutionInput').focus(); }, 50);
  }
  function closeResolutionModal(later) {
    $('resolutionModal').hidden = true;
    if (later) { try { sessionStorage.setItem(RESOLUTION_LATER_KEY, todayKey()); } catch (e) { /* 무시 */ } }
  }
  function maybeAskResolution() {
    var tKey = todayKey();
    if (resolutionOf(tKey)) return;
    var later = '';
    try { later = sessionStorage.getItem(RESOLUTION_LATER_KEY) || ''; } catch (e) { /* 무시 */ }
    if (later === tKey) return;
    openResolutionModal();
  }
  function bindResolution() {
    $('resolutionBtn').addEventListener('click', openResolutionModal);
    $('resolutionLaterBtn').addEventListener('click', function () { closeResolutionModal(true); });
    $('resolutionBackdrop').addEventListener('click', function () { closeResolutionModal(true); });
    $('resolutionForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('resolutionInput').value.trim();
      if (!v) { toast('한마디만 적어 주세요.', true); return; }
      var tKey = todayKey();
      if (resolutionOf(tKey)) { closeResolutionModal(false); renderResolution(); return; }
      if (!data.resolutions) data.resolutions = {};
      data.resolutions[tKey] = { text: v, updatedAt: now() };
      save();
      closeResolutionModal(false);
      renderResolution();
      toast('🔥 오늘의 각오를 새겼어요.');
    });
    $('resolutionInput').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('resolutionForm').requestSubmit(); }
    });
  }

  function schedulePush() {
    if (!syncKey) { renderStatus(); return; }
    sync.dirty = true;
    renderStatus();
    clearTimeout(sync.pushTimer);
    sync.pushTimer = setTimeout(push, PUSH_DELAY_MS);
  }

  function applyRemote(remote) {
    var merged = M.mergeData(data, remote);
    if (M.sameContent(merged, data)) {
      // 내용이 같으면 메타 시각만 맞춘다
      data.updatedAt = Math.max(data.updatedAt, merged.updatedAt);
      return false;
    }
    data = merged;
    persistLocal();
    renderAll();
    scheduleMobileNotifications();
    return true;
  }

  function push() {
    if (!syncKey || sync.pushing) return;
    sync.pushing = true;
    sync.dirty = false;
    renderStatus();
    var snapshot = JSON.stringify(data);
    fetch(apiUrl('data/' + encodeURIComponent(syncKey)), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: snapshot
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (remote) {
      sync.serverOk = true;
      sync.pushing = false;
      // 전송 중에 또 바뀌었으면 병합 결과가 로컬과 다를 수 있으므로 다시 보낸다
      var changedLocally = JSON.stringify(data) !== snapshot;
      applyRemote(remote);
      if (changedLocally || !M.sameContent(data, remote)) schedulePush();
      renderStatus();
    }).catch(function () {
      sync.serverOk = false;
      sync.pushing = false;
      sync.dirty = true; // 로컬은 보존, 다음 폴링에서 재시도
      renderStatus();
    });
  }

  function poll() {
    if (!syncKey) return;
    if (sync.dirty && !sync.pushing) { push(); return; }
    fetch(apiUrl('data/' + encodeURIComponent(syncKey)), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) { schedulePush(); return null; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (remote) {
        sync.serverOk = true;
        if (remote) {
          applyRemote(remote);
          if (!M.sameContent(data, remote)) schedulePush();
        }
        renderStatus();
      }).catch(function () {
        sync.serverOk = false;
        renderStatus();
      });
  }

  function startPolling() {
    clearInterval(sync.pollTimer);
    sync.pollTimer = setInterval(poll, POLL_MS);
    poll();
    startStream();
  }

  function setSyncKey(key) {
    syncKey = key || '';
    try {
      if (syncKey) localStorage.setItem(SYNC_KEY, syncKey);
      else localStorage.removeItem(SYNC_KEY);
    } catch (e) { /* 무시 */ }
    sync.serverOk = null; sync.dirty = false; sync.pushing = false;
    clearTimeout(sync.pushTimer);
    clearInterval(sync.pollTimer);
    stopStream();
    renderSyncPanel();
    renderStatus();
    if (syncKey) startPolling();
  }

  function makeCode() {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var out = '';
    var bytes = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 12; j++) {
      out += alphabet[bytes[j] % alphabet.length];
      if (j === 3 || j === 7) out += '-';
    }
    return out;
  }

  function createSyncCode() {
    var code = makeCode();
    fetch(apiUrl('health')).then(function (r) {
      if (!r.ok) throw new Error();
      setSyncKey(code);
      schedulePush();
      toast('동기화 코드를 만들었어요. 다른 기기에서 입력하면 이어 볼 수 있어요.');
    }).catch(function () {
      toast('서버에 연결할 수 없어요. 서버가 켜져 있는지 확인해 주세요.', true);
    });
  }

  function joinSyncCode(code) {
    code = (code || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{8,64}$/.test(code)) {
      toast('코드 형식이 올바르지 않아요.', true);
      return;
    }
    fetch(apiUrl('data/' + encodeURIComponent(code)), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) { toast('그 코드로 저장된 기록이 없어요. 코드를 다시 확인해 주세요.', true); return null; }
        if (!r.ok) throw new Error();
        return r.json();
      }).then(function (remote) {
        if (!remote) return;
        // 이 기기에 예시만 있으면 서버 데이터를 그대로 받고, 실제 기록이 있으면 병합한다
        if (M.isOnlySeeds(data)) data = M.normalize(remote);
        else data = M.mergeData(data, remote);
        persistLocal();
        setSyncKey(code);
        renderAll();
        $('syncJoinInput').value = '';
        toast('연결했어요. 이제 이 기기에서도 같은 기록을 봐요.');
        if (!M.sameContent(data, remote)) schedulePush();
      }).catch(function () {
        toast('서버에 연결할 수 없어요.', true);
      });
  }

  function renderSyncPanel() {
    var has = !!syncKey;
    $('syncCurrent').hidden = !has;
    $('syncActions').hidden = has;
    $('syncCodeText').textContent = syncKey;
    $('syncHelp').textContent = has
      ? '다른 기기에서 이 코드를 입력하면 같은 기록을 실시간으로 이어 볼 수 있어요.'
      : '동기화 코드를 만들면 다른 기기에서 같은 코드를 입력해 기록을 이어 볼 수 있어요.';
    $('syncServerInput').value = serverBase();
    $('syncServerHelp').textContent = isLocalOrigin()
      ? '이 앱은 인터넷의 동기화 서버에 붙어요. 같은 Wi-Fi에서만 쓰려면 이 PC 주소(예: http://192.168.0.10:4310)로 바꿀 수 있어요.'
      : '지금 이 페이지를 연 서버에 저장돼요.';
    renderNotifyBox();
  }

  // ---------------------------------------------------------------- 탭/뷰
  var VIEWS = ['month', 'day', 'projects', 'routines'];
  function showView(next) {
    view = VIEWS.indexOf(next) >= 0 ? next : 'month';
    VIEWS.forEach(function (v) {
      var on = v === view;
      var tab = $('tab-' + v);
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('panel-' + v).hidden = !on;
    });
    // 월간: 화면에 꽉 차는 앱 셸 / 나머지: 페이지 전체 스크롤
    document.body.classList.toggle('view-day', view !== 'month');
    document.body.classList.toggle('view-projects', view === 'projects');
    document.body.classList.toggle('view-diary', view === 'day');
    document.body.classList.toggle('pp-detail', view === 'projects' && projectPage === 'detail');
    if (view === 'month') {
      var d = parseKey(selectedKey);
      if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth) {
        viewYear = d.getFullYear(); viewMonth = d.getMonth();
      }
      renderCalendar();
      renderEventsCard();
    } else if (view === 'day') {
      renderDay();
    } else if (view === 'routines') {
      renderRoutines();
    } else {
      renderProjectsView(true);
    }
  }

  function openDayDiary(key) {
    selectedKey = key;
    showView('day');
    var col = document.querySelector('.main-col');
    if (col) col.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- 달력
  function renderCalendar() {
    var grid = $('calendarGrid');
    $('monthTitle').textContent = viewYear + '년 ' + (viewMonth + 1) + '월';
    var first = new Date(viewYear, viewMonth, 1);
    var offset = (first.getDay() + 6) % 7; // 월요일 시작
    var start = new Date(viewYear, viewMonth, 1 - offset);
    var tKey = todayKey();
    var frag = document.createDocumentFragment();

    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var key = keyOf(d);
      var inside = d.getMonth() === viewMonth;
      var tasks = tasksOf(key);
      var notes = notesOf(key);
      var evs = eventsOf(key);
      var dow = d.getDay();

      var btn = el('div', 'day-cell');
      btn.setAttribute('role', 'button');
      btn.tabIndex = 0;
      btn.dataset.date = key;
      if (!inside) btn.classList.add('is-outside');
      if (key === tKey) btn.classList.add('is-today');
      if (key === selectedKey) btn.classList.add('is-selected');
      if (dow === 6) btn.classList.add('is-sat');
      if (dow === 0) btn.classList.add('is-sun');

      var label = fmtLong(key);
      if (tasks.length) label += ', 할 일 ' + tasks.length + '개';
      if (notes.length) label += ', 기록 ' + notes.length + '개';
      if (evs.length) label += ', 기념일·일정 ' + evs.length + '개';
      if (key === tKey) label += ', 오늘';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', key === selectedKey ? 'true' : 'false');

      var top = el('span', 'day-top');
      top.appendChild(el('span', 'day-num', String(d.getDate())));
      var badges = el('span', 'day-badges');
      var done = tasks.filter(function (t) { return t.done; }).length;
      if (tasks.length) badges.appendChild(el('span', 'b-task', done + '/' + tasks.length));
      if (notes.length) badges.appendChild(el('span', 'b-note', '📝'));
      top.appendChild(badges);
      btn.appendChild(top);

      if (evs.length) {
        var list = el('span', 'day-events');
        var shown = evs.slice(0, window.innerWidth <= 760 ? 3 : 2);
        shown.forEach(function (e) {
          var cls = 'day-ev ' + e.kind;
          if (e.endDate) {
            cls += ' is-span';
            if (occurrenceStart(e, key) !== key) cls += ' is-cont';
          }
          var item = el('span', cls, e.title);
          item.dataset.id = e.id;
          item.title = KIND_LABEL[e.kind] + ' · ' + e.title + (e.endDate ? ' (' + fmtMonthDay(e.date) + ' ~ ' + fmtMonthDay(e.endDate) + ')' : '') + ' · 누르면 수정';
          list.appendChild(item);
        });
        if (evs.length > shown.length) list.appendChild(el('span', 'day-more', '+' + (evs.length - shown.length) + '개 더'));
        btn.appendChild(list);
      }

      // 휴대폰: 숫자와 겹치지 않게 칸 맨 아래에 점으로 표시 (할 일·기록)
      if (tasks.length || notes.length) {
        var dots = el('span', 'day-dots');
        if (tasks.length) dots.appendChild(el('span', 'dot dot-task' + (done === tasks.length ? ' is-done' : ''), ''));
        if (notes.length) dots.appendChild(el('span', 'dot dot-note', ''));
        btn.appendChild(dots);
      }

      frag.appendChild(btn);
    }
    grid.innerHTML = '';
    grid.appendChild(frag);
    renderAgenda();
  }

  // 선택한 날짜의 일정·할 일·기록 요약 (휴대폰에서 달력 아래)
  function renderAgenda() {
    var box = $('agenda');
    if (!box) return;
    var key = selectedKey;
    var tKey = todayKey();
    var d = parseKey(key);
    $('agendaTitle').textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일' + (key === tKey ? ' · 오늘' : '');
    var tasks = tasksOf(key);
    var done = tasks.filter(function (t) { return t.done; }).length;
    var notes = notesOf(key);
    var parts = [];
    parts.push(tasks.length ? '할 일 ' + done + '/' + tasks.length : '할 일 없음');
    parts.push(notes.length ? '기록 ' + notes.length + '개' : '기록 없음');
    $('agendaSub').textContent = parts.join(' · ');

    var list = $('agendaList');
    list.innerHTML = '';
    var evs = eventsOf(key);
    if (!evs.length) {
      list.appendChild(el('li', 'empty', '이 날짜에 기념일·일정이 없어요. 오른쪽 + 일정으로 추가해요.'));
    }
    evs.forEach(function (e) {
      var li = el('li', 'agenda-item ' + e.kind);
      li.dataset.id = e.id;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      var bar = el('span', 'agenda-bar', '');
      li.appendChild(bar);
      var main = el('div', 'agenda-main');
      main.appendChild(el('div', 'agenda-title', e.title));
      var meta = KIND_LABEL[e.kind];
      if (e.endDate) meta += ' · ' + fmtMonthDay(e.date) + ' ~ ' + fmtMonthDay(e.endDate) + ' (' + (eventSpan(e) + 1) + '일간)';
      if (e.repeat === 'yearly') meta += ' · 매년';
      main.appendChild(el('div', 'agenda-meta muted small', meta));
      li.appendChild(main);
      li.appendChild(el('span', 'agenda-edit muted small', '수정 ›'));
      list.appendChild(li);
    });
    if (tasks.length) {
      var tl = el('li', 'agenda-item tasks');
      tl.setAttribute('role', 'button'); tl.tabIndex = 0; tl.dataset.open = 'diary';
      tl.appendChild(el('span', 'agenda-bar', ''));
      var tm = el('div', 'agenda-main');
      tm.appendChild(el('div', 'agenda-title', '할 일 ' + tasks.length + '개 · ' + done + '개 완료'));
      tm.appendChild(el('div', 'agenda-meta muted small', tasks.slice(0, 3).map(function (t) { return (t.done ? '✓ ' : '○ ') + t.text; }).join('  ')));
      tl.appendChild(tm);
      tl.appendChild(el('span', 'agenda-edit muted small', '열기 ›'));
      list.appendChild(tl);
    }
  }

  // 한 번 클릭: DOM 교체 없이 선택 표시·라벨·목록만 갱신 (더블클릭 인식을 위해 필수)
  function selectDate(key) {
    selectedKey = key;
    var grid = $('calendarGrid');
    var prev = grid.querySelector('.day-cell.is-selected');
    if (prev) { prev.classList.remove('is-selected'); prev.setAttribute('aria-pressed', 'false'); }
    var cur = grid.querySelector('.day-cell[data-date="' + key + '"]');
    if (cur) { cur.classList.add('is-selected'); cur.setAttribute('aria-pressed', 'true'); }
    renderEventsCard();
    renderAgenda();
  }

  function handleCalendarDate(key) {
    var t = now();
    if (lastCalendarTap.date === key && t - lastCalendarTap.time < DOUBLE_TAP_MS) {
      lastCalendarTap = { date: '', time: 0 };
      openDayDiary(key);
      return;
    }
    lastCalendarTap = { date: key, time: t };
    selectDate(key);
  }

  function changeMonth(delta) {
    var d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
    renderCalendar();
  }

  // ---------------------------------------------------------------- 기념일·일정 팝업
  function renderEventsCard() {
    $('eventsDateLabel').textContent = fmtLong(selectedKey) + '에 표시된 항목';
    var list = $('eventList');
    list.innerHTML = '';
    var evs = eventsOf(selectedKey);
    $('addEventBtn').hidden = !editingEventId;
    if (!evs.length) {
      list.appendChild(el('li', 'empty', '이 날짜에 등록된 기념일·일정이 아직 없어요.'));
      return;
    }
    evs.forEach(function (e) {
      var li = el('li', 'event-item' + (e.id === editingEventId ? ' is-editing' : ''));
      li.dataset.id = e.id;
      li.appendChild(el('span', 'event-kind ' + e.kind, KIND_LABEL[e.kind]));
      var main = el('div', 'event-main');
      main.appendChild(el('div', 'event-title', e.title));
      var meta = el('div', 'event-meta');
      var span = eventSpan(e);
      var rangeText = e.endDate ? ' ~ ' + fmtMonthDay(e.endDate) + ' (' + (span + 1) + '일간)' : '';
      if (e.repeat === 'yearly') {
        meta.appendChild(el('span', null, '매년 반복'));
        meta.appendChild(el('span', null, '·'));
        meta.appendChild(el('span', null, '매년 ' + fmtMonthDay(e.date) + rangeText + ' (' + e.date.slice(0, 4) + '년부터)'));
      } else {
        meta.appendChild(el('span', null, fmtLong(e.date) + rangeText));
      }
      main.appendChild(meta);
      li.appendChild(main);
      var actions = el('div', 'event-actions');
      var edit = el('button', 'btn link', '수정'); edit.type = 'button'; edit.dataset.action = 'edit';
      var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
      actions.appendChild(edit); actions.appendChild(del);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  var modalReturnFocus = null;
  function openEventForm(ev) {
    editingEventId = ev ? ev.id : null;
    $('eventKind').value = ev ? ev.kind : 'anniversary';
    $('eventDate').value = ev ? ev.date : selectedKey;
    $('eventEndDate').value = ev && ev.endDate ? ev.endDate : '';
    $('eventEndDate').min = $('eventDate').value;
    $('eventTitle').value = ev ? ev.title : '';
    $('eventRepeat').checked = ev ? ev.repeat === 'yearly' : false;
    $('eventSaveBtn').textContent = ev ? '수정 저장' : '저장';
    $('eventModalTitle').textContent = ev ? '기념일·일정 수정' : '기념일·일정 추가';
    hideFormError();
    renderEventsCard();
    if ($('eventModal').hidden) {
      modalReturnFocus = document.activeElement;
      $('eventModal').hidden = false;
      document.body.classList.add('modal-open');
    }
    $('eventTitle').focus();
  }

  function closeEventForm() {
    editingEventId = null;
    hideFormError();
    if (!$('eventModal').hidden) {
      $('eventModal').hidden = true;
      document.body.classList.remove('modal-open');
      if (modalReturnFocus && modalReturnFocus.focus && document.contains(modalReturnFocus)) {
        modalReturnFocus.focus({ preventScroll: true });
      }
      modalReturnFocus = null;
    }
  }

  function modalHasInput() {
    return $('eventTitle').value.trim() !== '' || $('eventEndDate').value !== '';
  }

  function showFormError(msg) {
    var p = $('eventFormError'); p.textContent = msg; p.hidden = false;
  }
  function hideFormError() { $('eventFormError').hidden = true; }

  function submitEventForm() {
    var title = $('eventTitle').value.trim();
    var date = $('eventDate').value;
    var endDate = $('eventEndDate').value;
    if (!title && !date) return showFormError('제목과 날짜를 모두 입력해 주세요.');
    if (!title) return showFormError('제목을 입력해 주세요.');
    if (!M.DATE_RE.test(date)) return showFormError('시작 날짜를 선택해 주세요.');
    if (endDate && !M.DATE_RE.test(endDate)) return showFormError('종료 날짜가 올바르지 않아요.');
    if (endDate && endDate < date) return showFormError('종료 날짜는 시작 날짜보다 뒤여야 해요.');
    if (endDate === date) endDate = '';

    var kind = $('eventKind').value === 'schedule' ? 'schedule' : 'anniversary';
    var repeat = $('eventRepeat').checked ? 'yearly' : 'none';
    var t = now();
    var ex = editingEventId ? data.events.filter(function (e) { return e.id === editingEventId; })[0] : null;
    if (!ex) {
      ex = { id: editingEventId || M.uid() };
      data.events.push(ex);
    }
    ex.title = title; ex.date = date; ex.kind = kind; ex.repeat = repeat; ex.updatedAt = t;
    if (endDate) ex.endDate = endDate; else delete ex.endDate;
    save();
    closeEventForm();

    // 저장한 날짜가 선택 상태로 남고 달력·목록에 즉시 반영
    selectedKey = date;
    var d = parseKey(date);
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
    renderCalendar();
    renderEventsCard();
    toast(editingEventId ? '수정했어요.' : '저장했어요.');
  }

  function deleteEvent(id) {
    var ev = data.events.filter(function (e) { return e.id === id; })[0];
    if (!ev) return;
    if (!confirm('‘' + ev.title + '’ 항목을 삭제할까요?' + (ev.repeat === 'yearly' ? '\n매년 반복 표시도 함께 사라져요.' : ''))) return;
    data.events = data.events.filter(function (e) { return e.id !== id; });
    tombstone(id);
    if (editingEventId === id) {
      // 수정 중이던 항목을 지우면 새 항목 입력 상태로 돌린다
      editingEventId = null;
      $('eventTitle').value = ''; $('eventEndDate').value = '';
      $('eventSaveBtn').textContent = '저장';
      $('eventModalTitle').textContent = '기념일·일정 추가';
    }
    save();
    renderCalendar();
    renderEventsCard();
    toast('삭제했어요.');
  }

  // ---------------------------------------------------------------- 일 다이어리
  function renderDay() {
    $('dayTitle').textContent = fmtLong(selectedKey);
    renderResolution();
    renderTasks();
    renderNotes();
  }

  function renderTasks() {
    // 이 날짜에 해당하는 루틴을 채워 넣는다
    if (ensureRoutineTasks(selectedKey)) { data.updatedAt = now(); persistLocal(); schedulePush(); }
    var all = tasksOf(selectedKey).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    // 루틴은 하루 계획과 따로 보여준다
    var tasks = all.filter(function (t) { return !t.routineId; });
    var routines = all.filter(function (t) { return !!t.routineId; });
    var done = tasks.filter(function (t) { return t.done; }).length;
    $('taskCount').textContent = done + ' / ' + tasks.length + ' 완료';
    $('taskProgress').style.width = tasks.length ? Math.round(done / tasks.length * 100) + '%' : '0%';
    var list = $('taskList');
    list.innerHTML = '';
    if (!tasks.length) list.appendChild(el('li', 'empty', '할 일을 비워둬도 괜찮아요. 하나부터 시작해요.'));
    tasks.forEach(function (t, i) { list.appendChild(taskItem(t, i === 0)); });

    var rdone = routines.filter(function (t) { return t.done; }).length;
    $('routineDayCard').hidden = !routines.length;
    $('routineTaskCount').textContent = rdone + ' / ' + routines.length + ' 완료';
    $('routineProgress').style.width = routines.length ? Math.round(rdone / routines.length * 100) + '%' : '0%';
    var rlist = $('routineTaskList');
    rlist.innerHTML = '';
    routines.forEach(function (t) { rlist.appendChild(taskItem(t, false)); });
  }

  function taskItem(t, isCore) {
    var li = el('li', 'task-item' + (t.done ? ' is-done' : ''));
    li.dataset.id = t.id;
    var label = el('label');
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = t.done; cb.dataset.id = t.id;
    cb.setAttribute('aria-label', t.text + (t.done ? ' (완료)' : ''));
    label.appendChild(cb);
    label.appendChild(el('span', 'task-text', t.text));
    if (isCore) label.appendChild(el('span', 'badge-core', '핵심'));
    if (t.projectId) {
      var pf = findProject(t.projectId);
      if (pf) { var pb = el('span', 'badge-proj', '📁 ' + pf.p.title); pb.title = '프로젝트 할 일과 연동됨'; label.appendChild(pb); }
    }
    li.appendChild(label);
    if (!t.routineId) {
      li.draggable = true;
      li.title = '오른쪽 프로젝트로 끌어다 놓으면 그 프로젝트 할 일이 돼요';
      var lk = el('button', 'btn link', '📁'); lk.type = 'button'; lk.dataset.action = 'link';
      lk.title = '프로젝트에 넣기'; lk.setAttribute('aria-label', '‘' + t.text + '’ 프로젝트에 넣기');
      li.appendChild(lk);
    }
    var ed = el('button', 'btn link', '수정'); ed.type = 'button'; ed.dataset.action = 'edit';
    ed.setAttribute('aria-label', '‘' + t.text + '’ 수정');
    li.appendChild(ed);
    var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
    del.setAttribute('aria-label', '‘' + t.text + '’ 삭제');
    li.appendChild(del);
    return li;
  }

  function editTask(li, id) {
    var task = tasksOf(selectedKey).filter(function (t) { return t.id === id; })[0];
    if (!task) return;
    inlineEdit(li, {
      value: task.text, maxlength: 120, label: '할 일 수정',
      onSave: function (v) {
        v = v.trim();
        if (v && v !== task.text) { task.text = v; task.updatedAt = now(); delete task.seed; save(); toast('고쳤어요.'); }
        renderTasks();
      },
      onCancel: renderTasks
    });
  }

  function addTask(text) {
    text = text.trim();
    if (!text) { toast('할 일을 입력해 주세요.', true); return false; }
    if (!data.days[selectedKey]) data.days[selectedKey] = { tasks: [] };
    var t = now();
    data.days[selectedKey].tasks.push({ id: M.uid(), text: text, done: false, createdAt: t, updatedAt: t });
    save();
    renderTasks();
    return true;
  }

  function toggleTask(id, done) {
    var task = tasksOf(selectedKey).filter(function (t) { return t.id === id; })[0];
    if (!task) return;
    task.done = !!done; task.updatedAt = now();
    delete task.seed;
    syncLinkedProjectTask(task);
    // 루틴이 프로젝트에 연결되어 있으면, 그 프로젝트의 날짜별 체크도 함께 바꾼다
    if (task.routineId) {
      var r = findRoutine(task.routineId);
      var found = r && r.projectId ? findProject(r.projectId) : null;
      if (found && checkOf(found.p).on) {
        setCheckDay(found.p, selectedKey, !!done);
        if (view === 'projects') renderProjectsView(false);
      }
    }
    save();
    renderTasks();
  }

  function deleteTask(id) {
    var tasks = tasksOf(selectedKey);
    var task = tasks.filter(function (t) { return t.id === id; })[0];
    if (!task) return;
    var q = task.routineId
      ? '‘' + task.text + '’ 루틴 할 일을 이 날짜에서만 지울까요?\n(루틴 자체는 루틴 탭에서 끄거나 지울 수 있어요)'
      : '‘' + task.text + '’ 할 일을 지울까요?';
    if (!confirm(q)) return;
    var rest = tasks.filter(function (t) { return t.id !== id; });
    if (rest.length) data.days[selectedKey].tasks = rest; else delete data.days[selectedKey];
    // 프로젝트에 연동된 할 일이면 프로젝트 쪽은 남기고 연결만 끊는다 (같은 id를 쓰므로 툼스톤은 만들지 않는다)
    if (task.projectId) {
      var pf = findProject(task.projectId);
      if (pf) { pf.p.tasks.forEach(function (x) { if (x.id === id) { delete x.dayKey; x.updatedAt = now(); } }); touchProject(pf.p); }
    } else {
      tombstone(id);
    }
    save();
    renderTasks();
  }

  function renderNotes() {
    var all = notesOf(selectedKey);
    var list = $('noteList');
    list.innerHTML = '';
    applyNotesFold();
    if (!all.length) {
      list.appendChild(el('li', 'empty', '첫 기록을 남겨보세요. 짧아도, 사진 한 장이어도 충분해요.'));
      return;
    }
    all.slice(0, MAX_NOTES_SHOWN).forEach(function (n) {
      var li = el('li', 'note-item');
      li.dataset.id = n.id;
      var head = el('div', 'note-head');
      head.appendChild(el('span', 'note-time', fmtTime(n.date)));
      if (n.mood) head.appendChild(el('span', 'note-mood', n.mood));
      if (n.image) head.appendChild(el('span', 'note-has-img', '📷'));
      var ed = el('button', 'btn link', '수정'); ed.type = 'button'; ed.dataset.action = 'edit';
      head.appendChild(ed);
      var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
      head.appendChild(del);
      li.appendChild(head);
      if (n.text) li.appendChild(el('div', 'note-text', n.text));
      if (n.image) {
        // 목록에는 작은 미리보기만 그리고, 누르면 그때 본 사진을 읽는다(전환 속도)
        var img = el('img', 'note-img');
        img.src = n.thumb || n.image;
        img.decoding = 'async';
        img.loading = 'lazy';
        img.alt = n.text ? n.text.slice(0, 40) : '기록 사진';
        img.title = '누르면 크게/작게 보기';
        li.appendChild(img);
      }
      list.appendChild(li);
    });
    if (all.length > MAX_NOTES_SHOWN) {
      list.appendChild(el('li', 'empty', '외 ' + (all.length - MAX_NOTES_SHOWN) + '개의 기록이 더 있어요. 백업 파일에는 모두 포함돼요.'));
    }
  }

  // 사진은 긴 변 1200px JPEG(본 사진) + 360px(목록 미리보기)로 줄여서 저장한다
  var pendingImage = null; // { full, thumb }
  function shrink(img, max, quality) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, max / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('이미지 파일이 아니에요.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('파일을 읽지 못했어요.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('이미지를 열 수 없어요.')); };
        img.onload = function () {
          resolve({ full: shrink(img, 1200, 0.8), thumb: shrink(img, 360, 0.7) });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function setPendingImage(pack, name) {
    pendingImage = pack && pack.full ? pack : null;
    var box = $('notePreview');
    box.hidden = !pendingImage;
    $('notePreviewImg').src = pendingImage ? pendingImage.thumb : '';
    $('notePreviewName').textContent = pendingImage ? (name || '사진') + ' · 기록하기를 누르면 함께 저장돼요' : '';
  }

  function addNote(text, mood, image) {
    text = text.trim(); mood = (mood || '').trim();
    if (!text && !image) { toast('기록할 내용을 적거나 사진을 골라 주세요.', true); return false; }
    var t = now();
    var iso = new Date(t).toISOString();
    var note = { id: M.uid(), dayKey: selectedKey, text: text, mood: mood, date: iso, updatedAt: t };
    if (image) { note.image = image.full; note.thumb = image.thumb; }
    data.notes.unshift(note);
    save();
    renderNotes();
    toast(image ? '사진과 함께 기록했어요.' : '기록했어요.');
    return true;
  }

  function editNote(li, id) {
    var n = data.notes.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    inlineEdit(li, {
      value: n.text, multiline: true, label: '기록 수정',
      extra: { value: n.mood, placeholder: '기분 한 단어 (선택)', maxlength: 20, label: '기분' },
      onSave: function (text, mood) {
        text = text.trim(); mood = (mood || '').trim();
        if (!text && !n.image) { toast('내용을 비울 수는 없어요. 지우려면 삭제를 눌러 주세요.', true); renderNotes(); return; }
        if (text !== n.text || mood !== n.mood) { n.text = text; n.mood = mood; n.updatedAt = now(); save(); toast('고쳤어요.'); }
        renderNotes();
      },
      onCancel: renderNotes
    });
  }

  function deleteNote(id) {
    var n = data.notes.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    if (!confirm('이 기록을 지울까요?')) return;
    data.notes = data.notes.filter(function (x) { return x.id !== id; });
    tombstone(id);
    save();
    renderNotes();
  }

  // ---------------------------------------------------------------- 오늘 리셋
  function resetToday() {
    var tKey = todayKey();
    var ok = confirm('오늘(' + fmtMonthDay(tKey) + ') 계획을 기본 상태로 다시 시작할까요?\n오늘 할 일만 초기화되고, 기록·기념일·다른 날짜는 그대로 남아요.');
    if (!ok) return;
    tasksOf(tKey).forEach(function (t) { tombstone(t.id); });
    var t = now();
    data.days[tKey] = {
      tasks: DEFAULT_TASKS.map(function (text, i) {
        return { id: M.uid(), text: text, done: false, createdAt: t + i, updatedAt: t + i, seed: true };
      })
    };
    save();
    renderAll();
    toast('🌱 오늘 계획을 다시 시작했어요.');
  }

  // ---------------------------------------------------------------- 프로젝트
  var renderedProjectCat = null;
  function renderProjects() {
    var list = $('projectList');
    // 같은 탭에서 입력 중이면 재렌더하지 않는다(입력 내용 보호). 탭이 바뀌면 항상 다시 그린다.
    var typing = list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (typing && renderedProjectCat === projectCat) return;
    renderedProjectCat = projectCat;
    $('ptab-work').classList.toggle('is-active', projectCat === 'work');
    $('ptab-personal').classList.toggle('is-active', projectCat === 'personal');
    $('ptab-work').setAttribute('aria-selected', projectCat === 'work' ? 'true' : 'false');
    $('ptab-personal').setAttribute('aria-selected', projectCat === 'personal' ? 'true' : 'false');
    $('ptab-work').tabIndex = projectCat === 'work' ? 0 : -1;
    $('ptab-personal').tabIndex = projectCat === 'personal' ? 0 : -1;

    list.innerHTML = '';
    var items = data.projects[projectCat].slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (!items.length) {
      list.appendChild(el('li', 'empty', '아직 프로젝트가 없어요. 이름 하나만 적어두면 시작이에요.'));
      return;
    }
    items.forEach(function (p) {
      var li = el('li', 'project-item');
      li.dataset.id = p.id;
      var top = el('div', 'project-top');
      var titleEl = el('span', 'project-title is-link', p.title);
      titleEl.title = '프로젝트 탭에서 열기';
      titleEl.dataset.open = p.id;
      top.appendChild(titleEl);
      var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
      del.setAttribute('aria-label', '‘' + p.title + '’ 프로젝트 삭제');
      top.appendChild(del);
      li.appendChild(top);
      list.appendChild(li);
    });
  }

  function addProject(title) {
    title = title.trim();
    if (!title) { toast('프로젝트 이름을 입력해 주세요.', true); return false; }
    var dup = data.projects[projectCat].some(function (p) { return p.title.toLowerCase() === title.toLowerCase(); });
    if (dup) { toast('같은 이름의 프로젝트가 이미 있어요.', true); return false; }
    var t = now();
    data.projects[projectCat].push({ id: M.uid(), title: title, next: '', status: 'active', memo: '', tasks: [], log: [], check: { on: false, label: '', days: {} }, createdAt: t, updatedAt: t });
    save();
    renderProjects();
    return true;
  }

  function deleteProject(id) {
    var p = data.projects[projectCat].filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!confirm('‘' + p.title + '’ 프로젝트를 지울까요?')) return;
    data.projects[projectCat] = data.projects[projectCat].filter(function (x) { return x.id !== id; });
    tombstone(id);
    save();
    renderProjects();
  }

  // ---------------------------------------------------------------- 프로젝트 탭
  var selectedProjectId = null;
  var projectFilter = 'all';
  var STATUS_LABEL = { active: '진행 중', paused: '보류', done: '완료' };
  var CAT_LABEL = { work: '일·제품', personal: '개인' };
  var memoTimer = null;

  function findProject(id) {
    var cats = ['work', 'personal'];
    for (var i = 0; i < cats.length; i++) {
      var list = data.projects[cats[i]];
      for (var j = 0; j < list.length; j++) if (list[j].id === id) return { p: list[j], cat: cats[i], index: j };
    }
    return null;
  }
  function touchProject(p) { p.updatedAt = now(); delete p.seed; }
  function projectProgress(p) {
    var t = p.tasks || [];
    var done = t.filter(function (x) { return x.done; }).length;
    return { done: done, total: t.length };
  }

  // 휴대폰: 목록 ↔ 상세를 한 화면씩 보여준다
  var projectPage = 'list';
  function isNarrow() { return window.innerWidth <= 900; }
  function applyProjectPage() {
    document.body.classList.toggle('pp-detail', view === 'projects' && projectPage === 'detail');
  }
  function enterProjectDetail(id) {
    selectedProjectId = id;
    if (isNarrow()) {
      projectPage = 'detail';
      try { history.pushState({ pp: 'detail' }, ''); } catch (e) { /* 무시 */ }
    }
    renderProjectsView(true);
    window.scrollTo({ top: 0 });
  }
  function leaveProjectDetail() {
    projectPage = 'list';
    applyProjectPage();
    renderProjectList();
    window.scrollTo({ top: 0 });
  }

  function openProject(id) {
    selectedProjectId = id;
    showView('projects');
    if (isNarrow()) enterProjectDetail(id);
  }

  function renderProjectsView(force) {
    // 선택된 프로젝트가 없거나 사라졌으면 첫 진행 중 프로젝트를 고른다
    if (!selectedProjectId || !findProject(selectedProjectId)) {
      var first = data.projects.work.concat(data.projects.personal)
        .filter(function (p) { return p.status !== 'done'; })[0] || data.projects.work[0] || data.projects.personal[0];
      selectedProjectId = first ? first.id : null;
      force = true;
    }
    renderProjectList();
    renderProjectDetail(force);
    applyProjectPage();
  }

  function renderProjectList() {
    var box = $('projectGroups');
    box.innerHTML = '';
    var any = false;
    ['work', 'personal'].forEach(function (cat) {
      var items = data.projects[cat].slice().sort(function (a, b) {
        var order = { active: 0, paused: 1, done: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.createdAt - b.createdAt;
      }).filter(function (p) { return projectFilter === 'all' || p.status === projectFilter; });
      if (!items.length) return;
      any = true;
      box.appendChild(el('div', 'pl-group', CAT_LABEL[cat] + ' · ' + items.length));
      items.forEach(function (p) {
        var li = el('div', 'pl-item' + (p.id === selectedProjectId ? ' is-selected' : '') + (p.status === 'done' ? ' is-done' : ''));
        li.dataset.id = p.id;
        li.setAttribute('role', 'button');
        li.tabIndex = 0;
        var main = el('div', 'pl-main');
        main.appendChild(el('div', 'pl-title', p.title));
        var pr0 = projectProgress(p);
        var sub = p.memo ? p.memo.split('\n')[0]
          : pr0.total ? '할 일 ' + (pr0.total - pr0.done) + '개 남음'
          : (p.log && p.log.length) ? '기록 ' + p.log.length + '개'
          : '메모나 할 일을 적어두세요';
        main.appendChild(el('div', 'pl-next', sub));
        li.appendChild(main);
        var right = el('div', 'pl-right');
        right.appendChild(el('span', 'status-badge ' + p.status, STATUS_LABEL[p.status]));
        var pr = projectProgress(p);
        if (pr.total) right.appendChild(el('span', 'pl-progress', pr.done + '/' + pr.total));
        if (checkOf(p).on) {
          var st = checkStats(p);
          right.appendChild(el('span', 'pl-check', st.streak ? '🔥 연속 ' + st.streak + '일' : '✓ 이번 달 ' + st.thisMonth + '일'));
        }
        li.appendChild(right);
        box.appendChild(li);
      });
    });
    if (!any) {
      box.appendChild(el('p', 'empty', projectFilter === 'all'
        ? '아직 프로젝트가 없어요. 아래에 이름 하나만 적어 시작해요.'
        : '이 상태의 프로젝트가 없어요.'));
    }
    $('projectFilter').querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.filter === projectFilter);
    });
  }

  function setIfNotFocused(elm, value) {
    if (document.activeElement === elm) return;
    if (elm.value !== value) elm.value = value;
  }

  function renderProjectDetail(force) {
    var found = selectedProjectId ? findProject(selectedProjectId) : null;
    $('projectEmpty').hidden = !!found;
    $('projectBody').hidden = !found;
    if (!found) return;
    var p = found.p;
    if (force) {
      $('pdTitle').value = p.title;
      $('pdMemo').value = p.memo || '';
    } else {
      setIfNotFocused($('pdTitle'), p.title);
      setIfNotFocused($('pdMemo'), p.memo || '');
    }
    $('pdCat').value = found.cat;
    $('projectBody').querySelectorAll('.pd-status .tab').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.status === p.status);
    });
    var pr = projectProgress(p);
    var pct = pr.total ? Math.round(pr.done / pr.total * 100) : (p.status === 'done' ? 100 : 0);
    var hero = $('pdHero');
    hero.classList.remove('active', 'paused', 'done');
    hero.classList.add(p.status);
    $('pdRing').style.setProperty('--p', pct);
    $('pdRingText').textContent = pct + '%';
    $('pdStatTasks').textContent = pr.done + '/' + pr.total;
    $('pdStatLogs').textContent = String((p.log || []).length);
    var ud = p.updatedAt ? new Date(p.updatedAt) : null;
    $('pdStatUpdated').textContent = ud ? (ud.getMonth() + 1) + '.' + ud.getDate() : '-';
    $('pdMeta').textContent = CAT_LABEL[found.cat] + ' · ' + STATUS_LABEL[p.status]
      + (pr.total && pr.done < pr.total ? ' · 남은 할 일 ' + (pr.total - pr.done) + '개' : '')
      + (p.status === 'done' ? ' · 마무리된 프로젝트예요' : '');
    $('pdBarTitle').textContent = p.title;
    renderPdCheck(p, force);
    renderMap(p);
    renderPdTasks(p);
    renderPdLog(p);
  }

  function renderPdTasks(p) {
    var tasks = (p.tasks || []).slice().sort(function (a, b) { return (a.done === b.done ? 0 : a.done ? 1 : -1) || a.createdAt - b.createdAt; });
    var pr = projectProgress(p);
    $('pdTaskCount').textContent = pr.done + ' / ' + pr.total + ' 완료';
    $('pdProgress').style.width = pr.total ? Math.round(pr.done / pr.total * 100) + '%' : '0%';
    var list = $('pdTaskList');
    list.innerHTML = '';
    if (!tasks.length) {
      list.appendChild(el('li', 'empty', '이 프로젝트에서 해야 할 일을 하나씩 적어두세요.'));
      return;
    }
    tasks.forEach(function (t) {
      var li = el('li', 'task-item' + (t.done ? ' is-done' : ''));
      li.dataset.id = t.id;
      var label = el('label');
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = t.done; cb.dataset.id = t.id;
      cb.setAttribute('aria-label', t.text + (t.done ? ' (완료)' : ''));
      label.appendChild(cb);
      label.appendChild(el('span', 'task-text', t.text));
      if (t.dayKey) { var db = el('span', 'badge-proj', '📅 ' + fmtMonthDay(t.dayKey)); db.title = '하루 계획과 연동됨'; label.appendChild(db); }
      li.appendChild(label);
      if (!t.done) {
        var today = el('button', 'btn link to-today', '오늘로'); today.type = 'button'; today.dataset.action = 'today';
        today.title = '오늘 하루 계획에 넣기';
        li.appendChild(today);
      }
      var ed = el('button', 'btn link', '수정'); ed.type = 'button'; ed.dataset.action = 'edit';
      li.appendChild(ed);
      var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function renderPdLog(p) {
    var list = $('pdLogList');
    list.innerHTML = '';
    var logs = (p.log || []).slice().sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
    if (!logs.length) {
      list.appendChild(el('li', 'empty', '아직 기록이 없어요. 한 줄이면 충분해요.'));
      return;
    }
    var tKey = todayKey();
    logs.slice(0, 30).forEach(function (l) {
      var li = el('li');
      li.dataset.id = l.id;
      var d = new Date(l.date);
      var dateText = isNaN(d) ? '' : (keyOf(d) === tKey ? '오늘' : (d.getMonth() + 1) + '.' + d.getDate());
      li.appendChild(el('span', 'log-date', dateText));
      li.appendChild(el('span', 'log-text', l.text));
      var ed = el('button', 'btn link', '수정'); ed.type = 'button'; ed.dataset.action = 'edit';
      li.appendChild(ed);
      var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
      li.appendChild(del);
      list.appendChild(li);
    });
    if (logs.length > 30) list.appendChild(el('li', 'empty', '외 ' + (logs.length - 30) + '개'));
  }

  function addProjectTo(cat, title) {
    title = title.trim();
    if (!title) { toast('프로젝트 이름을 입력해 주세요.', true); return null; }
    var dup = data.projects.work.concat(data.projects.personal).some(function (p) { return p.title.toLowerCase() === title.toLowerCase(); });
    if (dup) { toast('같은 이름의 프로젝트가 이미 있어요.', true); return null; }
    var t = now();
    var p = { id: M.uid(), title: title, next: '', status: 'active', memo: '', tasks: [], log: [], check: { on: false, label: '', days: {} }, createdAt: t, updatedAt: t };
    data.projects[cat].push(p);
    save();
    renderProjects();
    return p;
  }

  function deleteProjectById(id) {
    var found = findProject(id);
    if (!found) return;
    if (!confirm('‘' + found.p.title + '’ 프로젝트를 지울까요?\n할 일과 진행 기록도 함께 사라져요.')) return;
    data.projects[found.cat].splice(found.index, 1);
    tombstone(id);
    (found.p.tasks || []).forEach(function (t) { if (t.dayKey) unlinkDayTask(t); else tombstone(t.id); });
    (found.p.log || []).forEach(function (l) { tombstone(l.id); });
    // 이 프로젝트에 연결된 루틴은 연결만 끊는다
    data.routines.forEach(function (r) { if (r.projectId === id) { r.projectId = ''; r.updatedAt = now(); } });
    if (selectedProjectId === id) selectedProjectId = null;
    save();
    renderProjects();
    if (projectPage === 'detail') { projectPage = 'list'; try { if (history.state && history.state.pp === 'detail') history.back(); } catch (e) { /* 무시 */ } }
    renderProjectsView(true);
    toast('삭제했어요.');
  }

  function bindProjectsView() {
    // 목록: 누르면 상세로 (휴대폰은 화면이 바뀌고, 데스크톱은 오른쪽에 표시)
    $('projectGroups').addEventListener('click', function (e) {
      var item = e.target.closest('.pl-item');
      if (item) enterProjectDetail(item.dataset.id);
    });
    $('pdBack').addEventListener('click', function () {
      if (history.state && history.state.pp === 'detail') history.back();
      else leaveProjectDetail();
    });
    // 안드로이드 뒤로 가기 / 브라우저 뒤로 가기 → 목록으로
    window.addEventListener('popstate', function () {
      if (projectPage === 'detail') leaveProjectDetail();
    });
    $('projectGroups').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pl-item')) { e.preventDefault(); e.target.click(); }
    });
    $('projectFilter').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      projectFilter = b.dataset.filter;
      renderProjectList();
    });
    $('projectAddForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var p = addProjectTo($('projectAddCat').value, $('projectAddInput').value);
      if (p) {
        $('projectAddInput').value = '';
        projectFilter = 'all';
        enterProjectDetail(p.id);
        $('pdTaskInput').focus({ preventScroll: true });
      }
    });

    // 상세: 이름·분류·상태·삭제
    $('pdTitle').addEventListener('change', function () {
      var found = findProject(selectedProjectId); if (!found) return;
      var v = this.value.trim();
      if (!v) { this.value = found.p.title; return; }
      var dup = data.projects.work.concat(data.projects.personal).some(function (q) { return q.id !== found.p.id && q.title.toLowerCase() === v.toLowerCase(); });
      if (dup) { toast('같은 이름의 프로젝트가 이미 있어요.', true); this.value = found.p.title; return; }
      found.p.title = v; touchProject(found.p);
      save(); renderProjects(); renderProjectsView(false);
    });
    $('pdTitle').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
    $('pdCat').addEventListener('change', function () {
      var found = findProject(selectedProjectId); if (!found) return;
      var to = this.value;
      if (to === found.cat) return;
      data.projects[found.cat].splice(found.index, 1);
      touchProject(found.p);
      data.projects[to].push(found.p);
      save(); renderProjects(); renderProjectsView(false);
      toast(CAT_LABEL[to] + '(으)로 옮겼어요.');
    });
    $('projectBody').querySelector('.pd-status').addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      var found = findProject(selectedProjectId); if (!found) return;
      found.p.status = b.dataset.status; touchProject(found.p);
      save(); renderProjectsView(false);
      if (b.dataset.status === 'done') toast('완료! 수고했어요 🎉');
    });
    $('pdDelete').addEventListener('click', function () { deleteProjectById(selectedProjectId); });

    // 메모 (자동 저장)
    function saveMemo() {
      var found = findProject(selectedProjectId); if (!found) return;
      var v = $('pdMemo').value;
      if (found.p.memo === v) return;
      found.p.memo = v; touchProject(found.p);
      save(); renderProjectList();
    }
    $('pdMemo').addEventListener('input', function () { clearTimeout(memoTimer); memoTimer = setTimeout(saveMemo, 700); });
    $('pdMemo').addEventListener('change', function () { clearTimeout(memoTimer); saveMemo(); });

    // 할 일
    $('pdTaskForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var found = findProject(selectedProjectId); if (!found) return;
      var text = $('pdTaskInput').value.trim();
      if (!text) { toast('할 일을 입력해 주세요.', true); return; }
      var t = now();
      found.p.tasks.push({ id: M.uid(), text: text, done: false, createdAt: t, updatedAt: t });
      touchProject(found.p);
      save(); $('pdTaskInput').value = ''; renderProjectsView(false);
    });
    $('pdTaskList').addEventListener('change', function (e) {
      if (e.target.type !== 'checkbox') return;
      var found = findProject(selectedProjectId); if (!found) return;
      var task = found.p.tasks.filter(function (x) { return x.id === e.target.dataset.id; })[0]; if (!task) return;
      task.done = e.target.checked; task.updatedAt = now(); touchProject(found.p);
      syncLinkedDayTask(task);
      save(); renderProjectsView(false);
      if (task.dayKey === selectedKey) renderTasks();
    });
    $('pdTaskList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]'); if (!btn) return;
      var found = findProject(selectedProjectId); if (!found) return;
      var id = btn.closest('.task-item').dataset.id;
      var task = found.p.tasks.filter(function (x) { return x.id === id; })[0]; if (!task) return;
      if (btn.dataset.action === 'delete') {
        if (!confirm('‘' + task.text + '’ 할 일을 지울까요?' + (task.dayKey ? '\n(하루 계획 쪽은 남고 연결만 끊겨요)' : ''))) return;
        found.p.tasks = found.p.tasks.filter(function (x) { return x.id !== id; });
        if (task.dayKey) unlinkDayTask(task); else tombstone(id);
        touchProject(found.p);
        save(); renderProjectsView(false);
        if (task.dayKey === selectedKey) renderTasks();
      } else if (btn.dataset.action === 'edit') {
        inlineEdit(btn.closest('.task-item'), {
          value: task.text, maxlength: 120, label: '할 일 수정',
          onSave: function (v) {
            v = v.trim();
            if (v && v !== task.text) { task.text = v; task.updatedAt = now(); touchProject(found.p); save(); toast('고쳤어요.'); }
            renderProjectsView(false);
          },
          onCancel: function () { renderProjectsView(false); }
        });
      } else if (btn.dataset.action === 'today') {
        // 오늘 하루 계획에 "[프로젝트] 할 일" 로 넣는다 (이미 있으면 건너뜀)
        var tKey = todayKey();
        var text = '[' + found.p.title + '] ' + task.text;
        if (!data.days[tKey]) data.days[tKey] = { tasks: [] };
        var exists = data.days[tKey].tasks.some(function (x) { return x.text === text; });
        if (exists) { toast('이미 오늘 계획에 있어요.'); return; }
        var t = now();
        data.days[tKey].tasks.push({ id: M.uid(), text: text, done: false, createdAt: t, updatedAt: t });
        save();
        toast('오늘 하루 계획에 넣었어요.');
      }
    });

    // 진행 기록
    $('pdLogForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var found = findProject(selectedProjectId); if (!found) return;
      var text = $('pdLogInput').value.trim();
      if (!text) { toast('기록할 내용을 입력해 주세요.', true); return; }
      var t = now();
      found.p.log.unshift({ id: M.uid(), text: text, date: new Date(t).toISOString(), updatedAt: t });
      touchProject(found.p);
      save(); $('pdLogInput').value = ''; renderProjectsView(false);
      toast('기록했어요.');
    });
    $('pdLogList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]'); if (!btn) return;
      var found = findProject(selectedProjectId); if (!found) return;
      var id = btn.closest('li').dataset.id;
      if (btn.dataset.action === 'edit') {
        var log = found.p.log.filter(function (x) { return x.id === id; })[0]; if (!log) return;
        inlineEdit(btn.closest('li'), {
          value: log.text, maxlength: 200, label: '진행 기록 수정',
          onSave: function (v) {
            v = v.trim();
            if (v && v !== log.text) { log.text = v; log.updatedAt = now(); touchProject(found.p); save(); toast('고쳤어요.'); }
            renderProjectsView(false);
          },
          onCancel: function () { renderProjectsView(false); }
        });
        return;
      }
      if (!confirm('이 기록을 지울까요?')) return;
      found.p.log = found.p.log.filter(function (x) { return x.id !== id; });
      tombstone(id); touchProject(found.p);
      save(); renderProjectsView(false);
    });
  }

  // ---------------------------------------------------------------- 루틴 (요일마다 하루 계획에 자동 생성)
  var editingRoutineId = null;
  var WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function findRoutine(id) {
    return data.routines.filter(function (r) { return r.id === id; })[0] || null;
  }
  function routineTaskId(r, key) { return 'rt_' + r.id + '_' + key; }
  function routineAppliesTo(r, key) {
    if (!r.active) return false;
    if (r.startDate && key < r.startDate) return false;
    if (!r.days.length) return true;
    return r.days.indexOf(parseKey(key).getDay()) >= 0;
  }
  // key 날짜의 하루 계획에 루틴 할 일을 채운다(이미 있거나 지운 것은 건너뜀). 바뀐 게 있으면 true.
  function ensureRoutineTasks(key) {
    if (!data.routines.length) return false;
    var changed = false;
    data.routines.forEach(function (r) {
      if (!routineAppliesTo(r, key)) return;
      var id = routineTaskId(r, key);
      if (data.deleted[id]) return;
      var tasks = tasksOf(key);
      var existing = tasks.filter(function (t) { return t.id === id; })[0];
      if (existing) return; // 이미 있음(사용자가 글을 고쳤을 수도 있으니 건드리지 않는다)
      // 같은 글의 할 일을 직접 적어둔 날이면 겹치지 않게 그 할 일을 루틴으로 삼는다
      var same = tasks.filter(function (t) { return !t.routineId && t.text.toLowerCase() === r.text.toLowerCase(); })[0];
      if (same) { same.routineId = r.id; same.updatedAt = now(); changed = true; return; }
      if (!data.days[key]) data.days[key] = { tasks: [] };
      var t = now();
      data.days[key].tasks.push({ id: id, text: r.text, done: false, routineId: r.id, createdAt: t, updatedAt: t });
      changed = true;
    });
    return changed;
  }
  // 루틴을 끄거나 지울 때: 오늘 이후의 아직 안 한 루틴 할 일을 걷어낸다
  function removeFutureRoutineTasks(r, fromKey) {
    Object.keys(data.days).forEach(function (key) {
      if (key < fromKey) return;
      var tasks = data.days[key].tasks;
      var rest = tasks.filter(function (t) {
        var drop = t.routineId === r.id && !t.done;
        if (drop) tombstone(t.id);
        return !drop;
      });
      if (rest.length) data.days[key].tasks = rest; else delete data.days[key];
    });
  }
  function routineDaysText(days) {
    if (!days.length || days.length === 7) return '매일';
    var s = days.slice().sort(function (a, b) { return WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b); });
    if (s.join() === '1,2,3,4,5') return '평일';
    if (s.join() === '6,0') return '주말';
    return s.map(function (d) { return WEEKDAYS[d]; }).join('·');
  }
  function pickedDays() {
    return Array.prototype.map.call($('routineDays').querySelectorAll('.wd.is-on'), function (b) { return Number(b.dataset.day); });
  }
  function setPickedDays(days) {
    $('routineDays').querySelectorAll('.wd').forEach(function (b) {
      b.classList.toggle('is-on', !days.length || days.indexOf(Number(b.dataset.day)) >= 0);
    });
  }
  function fillRoutineProjectSelect(selected) {
    var sel = $('routineProject');
    sel.innerHTML = '';
    var none = el('option', '', '연결 안 함'); none.value = '';
    sel.appendChild(none);
    ['work', 'personal'].forEach(function (cat) {
      var items = data.projects[cat].filter(function (p) { return p.status !== 'done' || p.id === selected; });
      if (!items.length) return;
      var grp = document.createElement('optgroup'); grp.label = CAT_LABEL[cat];
      items.forEach(function (p) {
        var o = el('option', '', p.title + (checkOf(p).on ? ' (날짜별 체크 켜짐)' : '')); o.value = p.id;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
    sel.value = selected && findProject(selected) ? selected : '';
  }
  function resetRoutineForm() {
    editingRoutineId = null;
    $('routineText').value = '';
    setPickedDays([]);
    fillRoutineProjectSelect('');
    $('routineSaveBtn').textContent = '+ 루틴 등록';
    $('routineCancelBtn').hidden = true;
  }
  function editRoutine(r) {
    editingRoutineId = r.id;
    $('routineText').value = r.text;
    setPickedDays(r.days);
    fillRoutineProjectSelect(r.projectId);
    $('routineSaveBtn').textContent = '저장';
    $('routineCancelBtn').hidden = false;
    $('routineText').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function submitRoutineForm() {
    var text = $('routineText').value.trim();
    if (!text) { toast('루틴 내용을 입력해 주세요.', true); $('routineText').focus(); return; }
    var days = pickedDays();
    if (!days.length) { toast('요일을 하나 이상 골라 주세요.', true); return; }
    if (days.length === 7) days = [];
    var projectId = $('routineProject').value;
    var t = now();
    var r = editingRoutineId ? findRoutine(editingRoutineId) : null;
    if (r) {
      var wasOnDays = r.days.slice();
      var wasText = r.text;
      r.text = text; r.days = days; r.projectId = projectId; r.updatedAt = t;
      // 요일이 바뀌었으면 오늘 이후 안 한 할 일을 다시 맞추고, 글이 바뀌었으면 아직 안 한 할 일의 글도 바꾼다
      if (wasOnDays.join() !== days.join()) removeFutureRoutineTasks(r, todayKey());
      if (wasText !== text) {
        var tk = todayKey();
        Object.keys(data.days).forEach(function (key) {
          if (key < tk) return;
          data.days[key].tasks.forEach(function (x) { if (x.routineId === r.id && !x.done && x.text === wasText) { x.text = text; x.updatedAt = t; } });
        });
      }
      toast('루틴을 고쳤어요.');
    } else {
      var dup = data.routines.some(function (x) { return x.text.toLowerCase() === text.toLowerCase(); });
      if (dup) { toast('같은 내용의 루틴이 이미 있어요.', true); return; }
      r = { id: M.uid(), text: text, days: days, projectId: projectId, active: true, startDate: todayKey(), createdAt: t, updatedAt: t };
      data.routines.push(r);
      var linked = projectId ? findProject(projectId) : null;
      toast(routineAppliesTo(r, todayKey()) ? '등록했어요. 오늘 하루 계획에도 들어갔어요.' : '등록했어요. 정한 요일에 하루 계획에 들어가요.');
      if (linked && !checkOf(linked.p).on) setTimeout(function () { toast('‘' + linked.p.title + '’의 날짜별 체크를 켜면 완료한 날이 자동으로 표시돼요.'); }, 2400);
    }
    ensureRoutineTasks(todayKey());
    save();
    resetRoutineForm();
    renderRoutines();
  }
  function toggleRoutine(id, on) {
    var r = findRoutine(id); if (!r) return;
    r.active = !!on; r.updatedAt = now();
    if (on) ensureRoutineTasks(todayKey()); else removeFutureRoutineTasks(r, todayKey());
    save();
    renderRoutines();
    toast(on ? '루틴을 다시 켰어요.' : '루틴을 잠시 멈췄어요. 지난 기록은 그대로 남아요.');
  }
  function deleteRoutine(id) {
    var r = findRoutine(id); if (!r) return;
    if (!confirm('‘' + r.text + '’ 루틴을 지울까요?\n이미 완료한 날의 기록은 남고, 앞으로는 생성되지 않아요.')) return;
    removeFutureRoutineTasks(r, todayKey());
    data.routines = data.routines.filter(function (x) { return x.id !== id; });
    tombstone(id);
    if (editingRoutineId === id) resetRoutineForm();
    save();
    renderRoutines();
    toast('삭제했어요.');
  }
  function renderRoutines() {
    var list = $('routineList');
    list.innerHTML = '';
    var tKey = todayKey();
    var todayCount = data.routines.filter(function (r) { return routineAppliesTo(r, tKey); }).length;
    $('routineTodayCount').textContent = data.routines.length ? '오늘 루틴 ' + todayCount + '개' : '';
    $('routineCount').textContent = data.routines.length ? data.routines.length + '개' : '';
    if (!editingRoutineId) fillRoutineProjectSelect($('routineProject').value);
    if (!data.routines.length) {
      list.appendChild(el('li', 'empty', '아직 루틴이 없어요. 위에서 매일(또는 정한 요일마다) 할 일을 하나 등록해 보세요.'));
      return;
    }
    var items = data.routines.slice().sort(function (a, b) { return (a.active === b.active ? 0 : a.active ? -1 : 1) || a.createdAt - b.createdAt; });
    items.forEach(function (r) {
      var li = el('li', 'routine-item' + (r.active ? '' : ' is-off'));
      li.dataset.id = r.id;
      var sw = el('label', 'switch'); sw.title = r.active ? '루틴 멈추기' : '루틴 켜기';
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = r.active; cb.dataset.action = 'toggle';
      cb.setAttribute('aria-label', '‘' + r.text + '’ 루틴 ' + (r.active ? '켜짐' : '꺼짐'));
      sw.appendChild(cb); sw.appendChild(el('span', 'switch-track'));
      li.appendChild(sw);
      var main = el('div', 'rt-main');
      main.appendChild(el('div', 'rt-text', r.text));
      var meta = el('div', 'rt-meta');
      var days = el('span', 'rt-days');
      WD_ORDER.forEach(function (d) {
        days.appendChild(el('span', (!r.days.length || r.days.indexOf(d) >= 0) ? 'is-on' : '', WEEKDAYS[d]));
      });
      meta.appendChild(days);
      meta.appendChild(el('span', '', routineDaysText(r.days)));
      if (r.projectId) {
        var found = findProject(r.projectId);
        if (found) meta.appendChild(el('span', 'rt-link', '📁 ' + found.p.title));
      }
      if (!r.active) meta.appendChild(el('span', '', '멈춤'));
      main.appendChild(meta);
      li.appendChild(main);
      var actions = el('div', 'rt-actions');
      var ed = el('button', 'btn link', '수정'); ed.type = 'button'; ed.dataset.action = 'edit';
      var del = el('button', 'btn link danger', '삭제'); del.type = 'button'; del.dataset.action = 'delete';
      actions.appendChild(ed); actions.appendChild(del);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }
  function bindRoutines() {
    $('routineDays').addEventListener('click', function (e) {
      var b = e.target.closest('.wd'); if (!b) return;
      b.classList.toggle('is-on');
    });
    $('routineForm').querySelector('.wd-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-preset]'); if (!b) return;
      var preset = { all: [], weekday: [1, 2, 3, 4, 5], weekend: [6, 0] }[b.dataset.preset];
      setPickedDays(preset);
    });
    $('routineForm').addEventListener('submit', function (e) { e.preventDefault(); submitRoutineForm(); });
    $('routineCancelBtn').addEventListener('click', resetRoutineForm);
    $('routineList').addEventListener('change', function (e) {
      if (e.target.dataset.action === 'toggle') toggleRoutine(e.target.closest('.routine-item').dataset.id, e.target.checked);
    });
    $('routineList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]'); if (!btn) return;
      var id = btn.closest('.routine-item').dataset.id;
      if (btn.dataset.action === 'delete') deleteRoutine(id);
      else if (btn.dataset.action === 'edit') { var r = findRoutine(id); if (r) editRoutine(r); }
    });
  }

  // ---------------------------------------------------------------- 프로젝트 날짜별 체크 (습관 달력)
  var checkMonth = null;       // { y, m } 보고 있는 달
  var checkProjectId = null;   // 어느 프로젝트의 달인지 (프로젝트가 바뀌면 이번 달로)

  function checkOf(p) {
    if (!p.check || typeof p.check !== 'object') p.check = { on: false, label: '', days: {} };
    if (!p.check.days || typeof p.check.days !== 'object') p.check.days = {};
    return p.check;
  }
  function isChecked(p, key) { var v = checkOf(p).days[key]; return typeof v === 'number' && v > 0; }
  function setCheckDay(p, key, on) {
    var c = checkOf(p);
    if (isChecked(p, key) === !!on) return false;
    c.days[key] = on ? now() : -now();
    touchProject(p);
    return true;
  }
  function checkStats(p) {
    var c = checkOf(p);
    var keys = Object.keys(c.days).filter(function (k) { return c.days[k] > 0; }).sort();
    var tKey = todayKey();
    var monthPrefix = tKey.slice(0, 7);
    var thisMonth = keys.filter(function (k) { return k.slice(0, 7) === monthPrefix; }).length;
    // 연속: 오늘(또는 어제)부터 거꾸로 이어진 날 수
    var streak = 0;
    var cur = isChecked(p, tKey) ? tKey : shiftDay(tKey, -1);
    while (isChecked(p, cur)) { streak++; cur = shiftDay(cur, -1); }
    return { total: keys.length, thisMonth: thisMonth, streak: streak };
  }
  function renderPdCheck(p, force) {
    var c = checkOf(p);
    if (checkProjectId !== p.id || !checkMonth) {
      checkProjectId = p.id;
      var d = new Date(); checkMonth = { y: d.getFullYear(), m: d.getMonth() };
    }
    $('pdCheckOn').checked = c.on;
    $('pdCheckBody').hidden = !c.on;
    $('pdCheckHint').textContent = c.on
      ? (c.label ? '‘' + c.label + '’을(를) 날짜마다 표시해요.' : '무엇을 체크할지 이름을 적어두면 알아보기 쉬워요.')
      : '운동한 날처럼, 날짜마다 표시하고 싶을 때 켜세요.';
    if (!c.on) return;
    if (force) $('pdCheckLabel').value = c.label; else setIfNotFocused($('pdCheckLabel'), c.label);
    var st = checkStats(p);
    var stats = $('pdCheckStats');
    stats.innerHTML = '';
    [[st.thisMonth + '일', '이번 달'], [st.streak + '일', '연속'], [st.total + '일', '전체']].forEach(function (pair) {
      var box = el('div', 'ck-stat');
      box.appendChild(el('b', '', pair[0])); box.appendChild(el('span', '', pair[1]));
      stats.appendChild(box);
    });
    $('pdCheckMonth').textContent = checkMonth.y + '년 ' + (checkMonth.m + 1) + '월';
    var grid = $('pdCheckGrid');
    grid.innerHTML = '';
    var first = new Date(checkMonth.y, checkMonth.m, 1);
    var lead = (first.getDay() + 6) % 7; // 월요일 시작
    var daysInMonth = new Date(checkMonth.y, checkMonth.m + 1, 0).getDate();
    var tKey = todayKey();
    for (var i = 0; i < lead; i++) grid.appendChild(el('span', 'ck-cell is-out'));
    for (var day = 1; day <= daysInMonth; day++) {
      var key = keyOf(new Date(checkMonth.y, checkMonth.m, day));
      var b = el('button', 'ck-cell' + (isChecked(p, key) ? ' is-on' : '') + (key === tKey ? ' is-today' : '') + (key > tKey ? ' is-future' : ''));
      b.appendChild(el('span', 'ck-num', String(day)));
      b.appendChild(el('span', 'ck-mark', '✓'));
      b.type = 'button'; b.dataset.key = key;
      b.setAttribute('aria-pressed', isChecked(p, key) ? 'true' : 'false');
      b.setAttribute('aria-label', fmtMonthDay(key) + (isChecked(p, key) ? ' 체크됨' : ''));
      grid.appendChild(b);
    }
  }
  function bindPdCheck() {
    $('pdCheckOn').addEventListener('change', function () {
      var found = findProject(selectedProjectId); if (!found) return;
      checkOf(found.p).on = this.checked; touchProject(found.p);
      save(); renderProjectsView(false);
      if (this.checked) { $('pdCheckLabel').focus({ preventScroll: true }); toast('날짜를 눌러 체크해 보세요.'); }
    });
    $('pdCheckLabel').addEventListener('change', function () {
      var found = findProject(selectedProjectId); if (!found) return;
      var v = this.value.trim();
      if (checkOf(found.p).label === v) return;
      checkOf(found.p).label = v; touchProject(found.p);
      save(); renderPdCheck(found.p, false);
    });
    $('pdCheckLabel').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
    function moveCheckMonth(delta) {
      var found = findProject(selectedProjectId); if (!found) return;
      var d = new Date(checkMonth.y, checkMonth.m + delta, 1);
      checkMonth = { y: d.getFullYear(), m: d.getMonth() };
      renderPdCheck(found.p, false);
    }
    $('pdCheckPrev').addEventListener('click', function () { moveCheckMonth(-1); });
    $('pdCheckNext').addEventListener('click', function () { moveCheckMonth(1); });
    $('pdCheckToday').addEventListener('click', function () {
      var d = new Date(); checkMonth = { y: d.getFullYear(), m: d.getMonth() };
      var found = findProject(selectedProjectId); if (found) renderPdCheck(found.p, false);
    });
    $('pdCheckGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.ck-cell[data-key]'); if (!b) return;
      var found = findProject(selectedProjectId); if (!found) return;
      var key = b.dataset.key;
      var on = !isChecked(found.p, key);
      setCheckDay(found.p, key, on);
      // 이 프로젝트에 연결된 루틴 할 일이 그날 있으면 완료 상태도 맞춘다
      data.routines.forEach(function (r) {
        if (r.projectId !== found.p.id) return;
        var t = tasksOf(key).filter(function (x) { return x.id === routineTaskId(r, key); })[0];
        if (t && t.done !== on) { t.done = on; t.updatedAt = now(); }
      });
      save();
      renderPdCheck(found.p, false);
      renderProjectList();
      if (selectedKey === key) renderTasks();
    });
  }

  // ---------------------------------------------------------------- 아침 알림
  // 컴퓨터: 데스크톱 앱(트레이 상주)이 정한 시각에 윈도우 알림을 띄운다.
  // 휴대폰: 앱이 앞으로 14일치 알림을 미리 예약해 두고, 앱을 열 때마다 최신 내용으로 다시 예약한다.
  var NOTIFY_KEY = 'planner.v1.notify';
  var NOTIFIED_KEY = 'planner.v1.notifiedDay';
  var NOTIFY_DAYS_AHEAD = 14;
  var isDesktopApp = !!window.plannerDesktop;
  function mobileNotifier() {
    var C = window.Capacitor;
    return C && C.Plugins && C.Plugins.LocalNotifications ? C.Plugins.LocalNotifications : null;
  }
  function notifySettings() {
    try {
      var s = JSON.parse(localStorage.getItem(NOTIFY_KEY) || 'null');
      if (s && typeof s === 'object') return { on: s.on !== false, time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '08:00' };
    } catch (e) { /* 무시 */ }
    return { on: true, time: '08:00' };
  }
  function saveNotifySettings(s) {
    try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ }
  }
  function listNames(items, max) {
    var names = items.slice(0, max);
    var rest = items.length - names.length;
    return names.join(', ') + (rest > 0 ? ' 외 ' + rest + '개' : '');
  }
  // 그날의 요약 글 (알림 제목·본문)
  function daySummary(key) {
    var d = parseKey(key);
    var isToday = key === todayKey();
    var title = (isToday ? '오늘 ' : '') + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일';
    var lines = [];
    var evs = eventsOf(key).map(function (e) { return (e.kind === 'anniversary' ? '🎉 ' : '') + e.title; });
    if (evs.length) lines.push('📅 ' + listNames(evs, 4));
    var tasks = tasksOf(key).filter(function (t) { return !t.done; });
    var covered = {};
    tasks.forEach(function (t) { if (t.routineId) covered[t.routineId] = true; });
    var routineNames = data.routines.filter(function (r) { return routineAppliesTo(r, key) && !covered[r.id] && !data.deleted[routineTaskId(r, key)]; })
      .map(function (r) { return r.text; });
    var todo = tasks.map(function (t) { return t.text; }).concat(routineNames);
    if (todo.length) lines.push('✅ 할 일 ' + todo.length + '개: ' + listNames(todo, 4));
    if (!lines.length) lines.push('적어둔 일정이 없어요. 가볍게 시작해요 🌱');
    return { title: title, body: lines.join('\n') };
  }
  function fireNotification(title, body) {
    if (isDesktopApp) { window.plannerDesktop.notify(title, body); return true; }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification(title, { body: body, icon: $('logoImg').src });
        n.onclick = function () { window.focus(); };
        return true;
      } catch (e) { /* 무시 */ }
    }
    return false;
  }
  // 컴퓨터·브라우저: 1분마다 시각을 확인해 하루 한 번 띄운다
  function notifyTick() {
    var s = notifySettings();
    if (!s.on || mobileNotifier()) return;
    var tKey = todayKey();
    var done = '';
    try { done = localStorage.getItem(NOTIFIED_KEY) || ''; } catch (e) { /* 무시 */ }
    if (done === tKey) return;
    var now_ = new Date();
    var hm = pad2(now_.getHours()) + ':' + pad2(now_.getMinutes());
    if (hm < s.time) return;
    ensureRoutineTasks(tKey);
    var sum = daySummary(tKey);
    if (fireNotification(sum.title, sum.body)) {
      try { localStorage.setItem(NOTIFIED_KEY, tKey); } catch (e) { /* 무시 */ }
    }
  }
  // 휴대폰: 앞으로 14일치를 미리 예약 (내용은 지금 알고 있는 일정·루틴·할 일 기준)
  var mobileScheduleTimer = null;
  function scheduleMobileNotifications() {
    var LN = mobileNotifier();
    if (!LN) return;
    clearTimeout(mobileScheduleTimer);
    mobileScheduleTimer = setTimeout(function () {
      var s = notifySettings();
      Promise.resolve(LN.getPending()).then(function (res) {
        var pending = (res && res.notifications) || [];
        return pending.length ? LN.cancel({ notifications: pending.map(function (n) { return { id: n.id }; }) }) : null;
      }).then(function () {
        if (!s.on) return null;
        return LN.requestPermissions().then(function (perm) {
          if (!perm || perm.display !== 'granted') { toast('휴대폰 설정에서 이 앱의 알림을 허용해 주세요.', true); return null; }
          var hh = Number(s.time.slice(0, 2)), mm = Number(s.time.slice(3, 5));
          var list = [];
          var tKey = todayKey();
          for (var i = 0; i < NOTIFY_DAYS_AHEAD; i++) {
            var key = shiftDay(tKey, i);
            var at = parseKey(key); at.setHours(hh, mm, 0, 0);
            if (at.getTime() <= Date.now()) continue;
            var sum = daySummary(key);
            list.push({ id: 7000 + i, title: sum.title.replace(/^오늘 /, '오늘 '), body: sum.body, schedule: { at: at, allowWhileIdle: true }, smallIcon: 'ic_launcher', largeIcon: 'ic_launcher' });
          }
          return list.length ? LN.schedule({ notifications: list }) : null;
        });
      }).catch(function () { /* 예약 실패는 조용히 */ });
    }, 1500);
  }
  function renderNotifyBox() {
    var s = notifySettings();
    $('notifyOn').checked = s.on;
    $('notifyTime').value = s.time;
    $('notifyTime').disabled = !s.on;
    $('notifyHelp').textContent = isDesktopApp
      ? '그날의 기념일·일정, 하루 계획, 루틴을 정한 시간에 윈도우 알림으로 알려드려요. 창을 닫아도 트레이에서 계속 실행돼요.'
      : mobileNotifier()
        ? '앱을 열 때마다 앞으로 2주치 알림을 예약해요. 하루에 한 번은 앱을 열어 주면 항상 최신으로 맞춰져요. 삼성 폰은 배터리 설정에서 이 앱을 절전 예외로 두세요.'
        : '이 브라우저 창이 열려 있을 때만 알림이 와요. 데스크톱 앱이나 휴대폰 앱에서는 창을 닫아도 와요.';
  }
  function bindNotify() {
    $('notifyOn').addEventListener('change', function () {
      var s = notifySettings(); s.on = this.checked; saveNotifySettings(s);
      renderNotifyBox();
      if (s.on && !isDesktopApp && !mobileNotifier() && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      scheduleMobileNotifications();
      toast(s.on ? '매일 ' + s.time + '에 알려드릴게요.' : '아침 알림을 껐어요.');
    });
    $('notifyTime').addEventListener('change', function () {
      if (!/^\d{2}:\d{2}$/.test(this.value)) return;
      var s = notifySettings(); s.time = this.value; saveNotifySettings(s);
      scheduleMobileNotifications();
      toast('알림 시간을 ' + s.time + '로 바꿨어요.');
    });
    $('notifyTestBtn').addEventListener('click', function () {
      var tKey = todayKey();
      ensureRoutineTasks(tKey);
      var sum = daySummary(tKey);
      var LN = mobileNotifier();
      if (LN) {
        LN.requestPermissions().then(function (perm) {
          if (!perm || perm.display !== 'granted') { toast('휴대폰 설정에서 이 앱의 알림을 허용해 주세요.', true); return; }
          LN.schedule({ notifications: [{ id: 6999, title: sum.title, body: sum.body, schedule: { at: new Date(Date.now() + 2000) }, smallIcon: 'ic_launcher', largeIcon: 'ic_launcher' }] });
          toast('2초 뒤에 알림이 떠요.');
        });
        return;
      }
      if (!isDesktopApp && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission().then(function (p) { if (p === 'granted') fireNotification(sum.title, sum.body); else toast('브라우저에서 알림을 허용해야 해요.', true); });
        return;
      }
      if (!fireNotification(sum.title, sum.body)) toast('이 환경에서는 알림을 띄울 수 없어요.', true);
    });
    setInterval(notifyTick, 60000);
    setTimeout(notifyTick, 3000);
    // 휴대폰: 앱을 열거나(화면 복귀) 데이터가 바뀌면 다시 예약
    document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleMobileNotifications(); });
    scheduleMobileNotifications();
  }

  // ---------------------------------------------------------------- 하루 계획 ↔ 프로젝트 할 일 연동
  // 같은 id의 할 일이 날짜 목록(projectId 표시)과 프로젝트 목록(dayKey 표시) 양쪽에 있으면 연동된 것이다.
  function syncLinkedProjectTask(task) {
    if (!task.projectId) return;
    var found = findProject(task.projectId);
    if (!found) { delete task.projectId; return; }
    var pt = found.p.tasks.filter(function (x) { return x.id === task.id; })[0];
    if (!pt) { delete task.projectId; return; }
    if (pt.done !== task.done) { pt.done = task.done; pt.updatedAt = now(); touchProject(found.p); }
    if (view === 'projects') renderProjectsView(false);
  }
  function unlinkDayTask(pt) {
    if (!pt.dayKey || !data.days[pt.dayKey]) return;
    data.days[pt.dayKey].tasks.forEach(function (x) { if (x.id === pt.id) { delete x.projectId; x.updatedAt = now(); } });
  }
  function syncLinkedDayTask(pt) {
    if (!pt.dayKey || !data.days[pt.dayKey]) return;
    var t = data.days[pt.dayKey].tasks.filter(function (x) { return x.id === pt.id; })[0];
    if (!t) { delete pt.dayKey; return; }
    if (t.done !== pt.done) { t.done = pt.done; t.updatedAt = now(); }
  }
  function linkTaskToProject(taskId, projectId) {
    var task = tasksOf(selectedKey).filter(function (t) { return t.id === taskId; })[0];
    var found = findProject(projectId);
    if (!task || !found) return;
    if (task.projectId === projectId) { toast('이미 이 프로젝트에 연결돼 있어요.'); return; }
    // 다른 프로젝트에 연결돼 있었다면 거기서 뺀다
    if (task.projectId) {
      var old = findProject(task.projectId);
      if (old) { old.p.tasks = old.p.tasks.filter(function (x) { return x.id !== task.id; }); touchProject(old.p); }
    }
    var t = now();
    found.p.tasks.push({ id: task.id, text: task.text, done: task.done, dayKey: selectedKey, createdAt: t, updatedAt: t });
    task.projectId = projectId; task.updatedAt = t;
    delete task.seed;
    touchProject(found.p);
    save();
    renderTasks(); renderProjects();
    if (view === 'projects') renderProjectsView(false);
    toast('‘' + found.p.title + '’ 프로젝트의 할 일에 넣었어요. 양쪽에서 같이 체크돼요.');
  }
  // 연동된 할 일을 완료한 채로 하루가 지나면 프로젝트 진행 기록에 남긴다
  function flushLinkedLogs() {
    var tKey = todayKey();
    var changed = false;
    Object.keys(data.days).forEach(function (key) {
      if (key >= tKey) return;
      data.days[key].tasks.forEach(function (t) {
        if (!t.projectId || !t.done || t.logged) return;
        var found = findProject(t.projectId);
        if (!found) return;
        var d = parseKey(key); d.setHours(23, 59, 0, 0);
        found.p.log.unshift({ id: M.uid(), text: '✅ ' + t.text, date: d.toISOString(), updatedAt: now() });
        touchProject(found.p);
        t.logged = true; t.updatedAt = now();
        var pt = found.p.tasks.filter(function (x) { return x.id === t.id; })[0];
        if (pt) pt.logged = true;
        changed = true;
      });
    });
    if (changed) save();
  }
  // 할 일 옆 📁 버튼: 프로젝트 고르기 (휴대폰처럼 끌어다 놓기가 안 되는 곳용)
  function openProjectPicker(li, taskId) {
    var old = li.querySelector('.proj-picker');
    if (old) { old.remove(); return; }
    var box = el('div', 'proj-picker');
    var items = data.projects.work.concat(data.projects.personal).filter(function (p) { return p.status !== 'done'; });
    if (!items.length) { box.appendChild(el('span', 'muted small', '진행 중인 프로젝트가 없어요.')); }
    items.forEach(function (p) {
      var b = el('button', 'btn ghost small', '📁 ' + p.title); b.type = 'button';
      b.addEventListener('click', function () { linkTaskToProject(taskId, p.id); });
      box.appendChild(b);
    });
    li.appendChild(box);
  }
  function bindTaskLinking() {
    // 데스크톱: 하루 계획 항목을 오른쪽 '진행 중인 프로젝트'로 끌어다 놓기
    $('taskList').addEventListener('dragstart', function (e) {
      var li = e.target.closest('.task-item'); if (!li) return;
      e.dataTransfer.setData('text/plain', li.dataset.id);
      e.dataTransfer.effectAllowed = 'link';
      li.classList.add('is-dragging');
      document.body.classList.add('task-dragging');
    });
    $('taskList').addEventListener('dragend', function (e) {
      var li = e.target.closest('.task-item'); if (li) li.classList.remove('is-dragging');
      document.body.classList.remove('task-dragging');
    });
    var plist = $('projectList');
    plist.addEventListener('dragover', function (e) {
      var item = e.target.closest('.project-item'); if (!item) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'link';
      item.classList.add('is-drop');
    });
    plist.addEventListener('dragleave', function (e) {
      var item = e.target.closest('.project-item'); if (item) item.classList.remove('is-drop');
    });
    plist.addEventListener('drop', function (e) {
      var item = e.target.closest('.project-item'); if (!item) return;
      e.preventDefault(); item.classList.remove('is-drop');
      var id = e.dataTransfer.getData('text/plain');
      if (id) linkTaskToProject(id, item.dataset.id);
    });
    $('taskList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action="link"]'); if (!btn) return;
      openProjectPicker(btn.closest('.task-item'), btn.closest('.task-item').dataset.id);
    });
  }

  // ---------------------------------------------------------------- 이날의 기록 접기/펴기
  var NOTES_FOLD_KEY = 'planner.v1.notesFolded';
  function applyNotesFold() {
    var folded = false;
    try { folded = localStorage.getItem(NOTES_FOLD_KEY) === '1'; } catch (e) { /* 무시 */ }
    $('noteList').hidden = folded;
    $('notesCard').classList.toggle('is-folded', folded);
    $('notesToggle').textContent = folded ? '▸' : '▾';
    $('notesToggle').setAttribute('aria-expanded', folded ? 'false' : 'true');
    var n = notesOf(selectedKey).length;
    $('notesSub').textContent = folded ? (n ? n + '개의 기록이 접혀 있어요' : '기록 없음') : '글과 사진이 시간순으로 쌓여요';
  }
  function bindNotesFold() {
    $('notesToggle').addEventListener('click', function () {
      var folded = !$('noteList').hidden;
      try { if (folded) localStorage.setItem(NOTES_FOLD_KEY, '1'); else localStorage.removeItem(NOTES_FOLD_KEY); } catch (e) { /* 무시 */ }
      applyNotesFold();
    });
  }

  // ---------------------------------------------------------------- 마인드맵 (프로젝트별 키워드 캔버스)
  var MAP_COLORS = ['', 'rose', 'amber', 'sky', 'violet', 'mint'];
  var mapState = { selected: null, linking: false, drag: null, projectId: null };
  function mapOf(p) {
    if (!p.map || typeof p.map !== 'object') p.map = { nodes: [], edges: [], updatedAt: 0 };
    if (!Array.isArray(p.map.nodes)) p.map.nodes = [];
    if (!Array.isArray(p.map.edges)) p.map.edges = [];
    return p.map;
  }
  function mapNode(p, id) { return mapOf(p).nodes.filter(function (n) { return n.id === id; })[0] || null; }
  // 선택 표시만 바꾼다 (목록을 다시 그리면 두 번 누르기가 끊긴다)
  function selectMapNode(id) {
    mapState.selected = id;
    $('mapNodes').querySelectorAll('.map-node').forEach(function (d) { d.classList.toggle('is-selected', d.dataset.id === id); });
  }
  var MAP_FOLD_KEY = 'planner.v1.mapFolded';
  function applyMapFold(p) {
    var m = mapOf(p);
    var folded = false;
    try { folded = localStorage.getItem(MAP_FOLD_KEY) === '1'; } catch (e) { /* 무시 */ }
    var showBody = m.on && !folded;
    $('mapOn').checked = !!m.on;
    $('mapWrap').hidden = !showBody;
    $('mapHint').hidden = !showBody;
    $('mapTools').hidden = !showBody;
    $('mapFoldBtn').hidden = !m.on;
    $('mapFoldBtn').textContent = folded ? '▸' : '▾';
    $('mapFoldBtn').setAttribute('aria-expanded', folded ? 'false' : 'true');
    $('mapDesc').textContent = !m.on ? '키워드를 놓고 선으로 잇는 생각 지도. 쓰고 싶을 때 켜세요.'
      : folded ? (m.nodes.length ? '키워드 ' + m.nodes.length + '개 · 접혀 있어요' : '접혀 있어요')
      : '빈 곳을 두 번 누르면 키워드 추가 · 끌어서 이동 · 두 번 누르면 글 수정';
  }
  function saveMap(p) { mapOf(p).updatedAt = now(); touchProject(p); save(); }
  function currentMapProject() { var f = selectedProjectId ? findProject(selectedProjectId) : null; return f ? f.p : null; }
  function nodeSize(elm) { return { w: elm.offsetWidth || 90, h: elm.offsetHeight || 34 }; }
  function renderMap(p) {
    var m = mapOf(p);
    if (mapState.projectId !== p.id) { mapState.selected = null; mapState.linking = false; mapState.projectId = p.id; }
    applyMapFold(p);
    var wrap = $('mapNodes');
    wrap.innerHTML = '';
    var canvas = $('mapCanvas');
    var maxX = 600, maxY = 320;
    m.nodes.forEach(function (n) {
      var d = el('div', 'map-node' + (n.color ? ' c-' + n.color : '') + (n.id === mapState.selected ? ' is-selected' : ''), n.text);
      d.dataset.id = n.id;
      d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
      d.tabIndex = 0;
      wrap.appendChild(d);
      maxX = Math.max(maxX, n.x + 220); maxY = Math.max(maxY, n.y + 120);
    });
    canvas.style.width = maxX + 'px'; canvas.style.height = maxY + 'px';
    drawMapLines(p);
    $('mapLinkBtn').classList.toggle('is-active', mapState.linking);
    $('mapLinkBtn').setAttribute('aria-pressed', mapState.linking ? 'true' : 'false');
    $('mapHint').textContent = mapState.linking
      ? '연결할 다른 키워드를 누르세요. (취소: 연결 버튼 다시 누르기)'
      : (m.nodes.length ? '키워드를 하나 고른 뒤 ‘연결’을 누르고 다른 키워드를 누르면 선이 이어져요. 선을 누르면 끊겨요.' : '빈 곳을 두 번 누르거나 ‘+ 키워드’로 첫 키워드를 놓아 보세요.');
  }
  function drawMapLines(p) {
    var m = mapOf(p);
    var svg = $('mapLines');
    var canvas = $('mapCanvas');
    svg.setAttribute('width', canvas.style.width); svg.setAttribute('height', canvas.style.height);
    svg.innerHTML = '';
    var pos = {};
    $('mapNodes').querySelectorAll('.map-node').forEach(function (d) {
      var s = nodeSize(d);
      pos[d.dataset.id] = { x: d.offsetLeft + s.w / 2, y: d.offsetTop + s.h / 2 };
    });
    m.edges.forEach(function (e, i) {
      var a = pos[e.a], b = pos[e.b]; if (!a || !b) return;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('class', 'map-edge'); line.dataset.index = i;
      svg.appendChild(line);
    });
  }
  // 새 키워드: 그 자리에 입력 칸을 띄워 바로 적는다 (데스크톱 앱에는 prompt 창이 없다)
  function addMapNode(p, x, y) {
    var n = { id: M.uid(), text: '', x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), color: '' };
    mapState.selected = n.id;
    editMapNodeInline(p, n, true);
    return n;
  }
  function editMapNodeInline(p, n, isNew) {
    var wrap = $('mapNodes');
    var existing = wrap.querySelector('.map-node[data-id="' + n.id + '"]');
    var input = el('input', 'map-node map-node-input'); input.type = 'text'; input.maxLength = 40;
    input.value = n.text; input.placeholder = '키워드';
    input.style.left = n.x + 'px'; input.style.top = n.y + 'px';
    if (existing) existing.replaceWith(input); else wrap.appendChild(input);
    input.focus();
    var done = false;
    function finish(saveIt) {
      if (done) return; done = true;
      var v = input.value.trim();
      if (saveIt && v) {
        n.text = v;
        if (isNew) mapOf(p).nodes.push(n);
        saveMap(p);
      } else if (!isNew) {
        /* 취소: 그대로 */
      } else {
        mapState.selected = null;
      }
      renderMap(p);
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  }
  function bindMap() {
    var nodes = $('mapNodes');
    var wrap = $('mapWrap');
    // 빈 곳 두 번 누르기 → 새 키워드
    $('mapCanvas').addEventListener('dblclick', function (e) {
      if (e.target.closest('.map-node')) return;
      var p = currentMapProject(); if (!p) return;
      var r = $('mapCanvas').getBoundingClientRect();
      addMapNode(p, e.clientX - r.left - 45, e.clientY - r.top - 17);
    });
    $('mapAddBtn').addEventListener('click', function () {
      var p = currentMapProject(); if (!p) return;
      var m = mapOf(p);
      addMapNode(p, 40 + (m.nodes.length % 4) * 150, 40 + Math.floor(m.nodes.length / 4) * 70);
    });
    // 키워드 누르기: 선택 / 연결 모드면 선 잇기
    nodes.addEventListener('click', function (e) {
      var d = e.target.closest('.map-node'); if (!d) return;
      var p = currentMapProject(); if (!p) return;
      if (mapState.drag && mapState.drag.moved) return;
      var id = d.dataset.id;
      if (mapState.linking && mapState.selected && mapState.selected !== id) {
        var m = mapOf(p);
        var exists = m.edges.some(function (x) { return (x.a === mapState.selected && x.b === id) || (x.a === id && x.b === mapState.selected); });
        if (!exists) m.edges.push({ a: mapState.selected, b: id });
        mapState.linking = false;
        saveMap(p); renderMap(p);
        toast(exists ? '이미 이어져 있어요.' : '이었어요.');
        return;
      }
      selectMapNode(id);
    });
    // 두 번 누르기 → 글 수정
    nodes.addEventListener('dblclick', function (e) {
      var d = e.target.closest('.map-node'); if (!d) return;
      e.stopPropagation();
      var p = currentMapProject(); if (!p) return;
      var n = mapNode(p, d.dataset.id); if (!n) return;
      editMapNodeInline(p, n, false);
    });
    // 끌어서 이동 (마우스·터치 공통)
    nodes.addEventListener('pointerdown', function (e) {
      var d = e.target.closest('.map-node'); if (!d) return;
      var p = currentMapProject(); if (!p) return;
      var n = mapNode(p, d.dataset.id); if (!n) return;
      // 누르는 순간 선택 (다시 그리지 않아야 두 번 누르기가 끊기지 않는다)
      if (!mapState.linking) selectMapNode(n.id);
      mapState.drag = { id: n.id, startX: e.clientX, startY: e.clientY, ox: n.x, oy: n.y, moved: false, el: d };
      d.setPointerCapture(e.pointerId);
    });
    nodes.addEventListener('pointermove', function (e) {
      var g = mapState.drag; if (!g) return;
      var dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      g.moved = true;
      var p = currentMapProject(); if (!p) return;
      var n = mapNode(p, g.id); if (!n) return;
      n.x = Math.max(0, Math.round(g.ox + dx)); n.y = Math.max(0, Math.round(g.oy + dy));
      g.el.style.left = n.x + 'px'; g.el.style.top = n.y + 'px';
      drawMapLines(p);
    });
    function endDrag() {
      var g = mapState.drag; if (!g) return;
      var p = currentMapProject();
      if (g.moved && p) { saveMap(p); renderMap(p); }
      setTimeout(function () { mapState.drag = null; }, 0);
    }
    nodes.addEventListener('pointerup', endDrag);
    nodes.addEventListener('pointercancel', endDrag);
    // 선 누르면 끊기
    $('mapLines').addEventListener('click', function (e) {
      var line = e.target.closest('.map-edge'); if (!line) return;
      var p = currentMapProject(); if (!p) return;
      mapOf(p).edges.splice(Number(line.dataset.index), 1);
      saveMap(p); renderMap(p);
    });
    $('mapOn').addEventListener('change', function () {
      var p = currentMapProject(); if (!p) return;
      mapOf(p).on = this.checked;
      saveMap(p); renderMap(p);
    });
    $('mapFoldBtn').addEventListener('click', function () {
      var p = currentMapProject(); if (!p) return;
      var folded = $('mapFoldBtn').textContent === '▾';
      try { if (folded) localStorage.setItem(MAP_FOLD_KEY, '1'); else localStorage.removeItem(MAP_FOLD_KEY); } catch (e) { /* 무시 */ }
      renderMap(p);
    });
    $('mapLinkBtn').addEventListener('click', function () {
      var p = currentMapProject(); if (!p) return;
      if (!mapState.selected) { toast('먼저 이을 키워드를 하나 누르세요.'); return; }
      mapState.linking = !mapState.linking;
      renderMap(p);
    });
    $('mapColorBtn').addEventListener('click', function () {
      var p = currentMapProject(); if (!p) return;
      var n = mapState.selected ? mapNode(p, mapState.selected) : null;
      if (!n) { toast('색을 바꿀 키워드를 먼저 누르세요.'); return; }
      n.color = MAP_COLORS[(MAP_COLORS.indexOf(n.color) + 1) % MAP_COLORS.length];
      saveMap(p); renderMap(p);
    });
    $('mapDeleteBtn').addEventListener('click', function () {
      var p = currentMapProject(); if (!p) return;
      var n = mapState.selected ? mapNode(p, mapState.selected) : null;
      if (!n) { toast('지울 키워드를 먼저 누르세요.'); return; }
      var m = mapOf(p);
      m.nodes = m.nodes.filter(function (x) { return x.id !== n.id; });
      m.edges = m.edges.filter(function (x) { return x.a !== n.id && x.b !== n.id; });
      mapState.selected = null;
      saveMap(p); renderMap(p);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Delete' || view !== 'projects' || !mapState.selected) return;
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      $('mapDeleteBtn').click();
    });
    window.addEventListener('resize', function () { var p = currentMapProject(); if (p && view === 'projects') drawMapLines(p); });
    wrap.addEventListener('scroll', function () { /* 선은 캔버스 좌표라 그대로 */ });
  }

  // ---------------------------------------------------------------- 파티 모드
  // 빠른 기록 칸에 "파티파티"라고 적으면 클럽 테마가 켜지고, "그만!!!"이라고 적으면 원래대로 돌아온다.
  var PARTY_KEY = 'planner.v1.party';
  var partyOn = false;
  function setParty(on, quiet) {
    on = !!on;
    if (partyOn === on) return;
    partyOn = on;
    document.body.classList.toggle('party', on);
    var layer = $('partyLayer');
    layer.hidden = !on;
    var video = $('partyVideo');
    var gif = $('partyGif');
    if (on) {
      if (!gif.getAttribute('src')) gif.src = gif.dataset.src;
      try { var p = video.play(); if (p && p.catch) p.catch(function () { /* 자동 재생 막힘은 무시 */ }); } catch (e) { /* 무시 */ }
      if (!quiet) toast('🪩 파티 타임! 빠른 기록에 ‘그만!!!’이라고 적으면 끝나요.');
    } else {
      try { video.pause(); } catch (e) { /* 무시 */ }
      if (!quiet) toast('🌱 원래 테마로 돌아왔어요.');
    }
    try { if (on) sessionStorage.setItem(PARTY_KEY, '1'); else sessionStorage.removeItem(PARTY_KEY); } catch (e) { /* 무시 */ }
  }
  function checkPartyWords(text) {
    if (!text) return;
    if (/그만!!!/.test(text)) { if (partyOn) setParty(false); return; }
    if (/파티파티/.test(text) && !partyOn) setParty(true);
  }
  function bindParty() {
    $('noteText').addEventListener('input', function () { checkPartyWords(this.value); });
    try { if (sessionStorage.getItem(PARTY_KEY) === '1') setParty(true, true); } catch (e) { /* 무시 */ }
  }

  // ---------------------------------------------------------------- 백업/복원
  function downloadBackup() {
    var payload = JSON.parse(JSON.stringify(data));
    payload.exportedAt = new Date().toISOString();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'planner-backup-' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('백업 파일을 내려받았어요.');
  }

  function restoreBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') throw new Error();
        var incoming = M.normalize(parsed);
        if (M.isEmptyData(incoming)) { toast('백업 파일에 기록이 없어요.', true); return; }
        data = M.mergeData(data, incoming);
        save();
        renderAll();
        toast('백업을 불러와 기존 기록과 합쳤어요.');
      } catch (e) {
        toast('백업 파일을 읽을 수 없어요. JSON 파일인지 확인해 주세요.', true);
      }
    };
    reader.onerror = function () { toast('파일을 읽는 중 문제가 생겼어요.', true); };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------- 오늘 한눈에
  // 오늘 기준으로 진행 중이거나 다음에 올 회차 {start, end} (없으면 null)
  function nextOccurrence(e, tKey) {
    var span = eventSpan(e);
    if (e.repeat !== 'yearly') {
      var end = shiftDay(e.date, span);
      return end >= tKey ? { start: e.date, end: end } : null;
    }
    var y = Number(tKey.slice(0, 4));
    var firstYear = Number(e.date.slice(0, 4));
    for (var yr = y - 1; yr <= y + 1; yr++) {
      if (yr < firstYear) continue;
      var s = yearlyStart(e, yr);
      var en = shiftDay(s, span);
      if (en >= tKey) return { start: s, end: en };
    }
    return null;
  }
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }

  function renderGlance() {
    var tKey = todayKey();
    if (ensureRoutineTasks(tKey)) { data.updatedAt = now(); persistLocal(); schedulePush(); }
    var tasks = tasksOf(tKey);
    var done = tasks.filter(function (t) { return t.done; }).length;
    $('glanceTasksValue').textContent = tasks.length ? done + ' / ' + tasks.length + ' 완료' : '아직 없음';
    $('glanceTasksBar').style.width = tasks.length ? Math.round(done / tasks.length * 100) + '%' : '0%';

    var notes = notesOf(tKey);
    $('glanceNotesValue').textContent = notes.length + '개';
    $('glanceNotesSub').textContent = notes.length
      ? '최근 ' + fmtTime(notes[0].date) + ' · ' + notes[0].text.replace(/\s+/g, ' ').slice(0, 28)
      : '첫 기록을 남겨보세요';

    var best = null;
    data.events.forEach(function (e) {
      var o = nextOccurrence(e, tKey);
      if (!o) return;
      if (!best || o.start < best.start) best = { ev: e, start: o.start, end: o.end };
    });
    var evBtn = $('glanceEvent');
    if (best) {
      var n = daysBetween(tKey, best.start);
      var when = n < 0 ? '진행 중 · ~' + fmtMonthDay(best.end)
        : n === 0 ? '오늘' + (best.end > best.start ? ' ~ ' + fmtMonthDay(best.end) : '')
        : 'D-' + n + ' · ' + fmtMonthDay(best.start) + (best.end > best.start ? ' ~ ' + fmtMonthDay(best.end) : '');
      $('glanceEventValue').textContent = best.ev.title;
      $('glanceEventSub').textContent = when + ' · ' + KIND_LABEL[best.ev.kind];
      evBtn.dataset.date = n < 0 ? tKey : best.start;
    } else {
      $('glanceEventValue').textContent = '없음';
      $('glanceEventSub').textContent = '달력의 + 로 남겨두세요';
      delete evBtn.dataset.date;
    }
  }

  // ---------------------------------------------------------------- 전체 렌더
  function renderHeader() {
    $('todayDate').textContent = fmtLong(todayKey());
    var d = new Date();
    var start = new Date(d.getFullYear(), 0, 1);
    var dayOfYear = Math.floor((d - start) / 86400000);
    renderResolution();
    // 로고·아이콘: 다섯 장을 하루에 한 장씩 돌아가며 쓴다 (데스크톱 앱 창 아이콘도 같은 순서)
    var n = (dayOfYear % LOGO_COUNT) + 1;
    var small = 'assets/logo-' + n + '.png';
    if ($('logoImg').getAttribute('src') !== small) {
      $('logoImg').src = small;
      $('lightboxImg').src = 'assets/logo-' + n + '-full.png';
      $('favicon').href = small;
    }
  }

  function renderAll() {
    renderHeader();
    renderStatus();
    renderGlance();
    if (view === 'month') { renderCalendar(); renderEventsCard(); }
    else if (view === 'day') renderDay();
    else if (view === 'routines') renderRoutines();
    else renderProjectsView(false);
    renderProjects();
  }

  // ---------------------------------------------------------------- 이벤트 바인딩
  function bind() {
    // 메인 탭
    var mainTabs = VIEWS.map(function (v) { return $('tab-' + v); });
    mainTabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { showView(tab.dataset.view); tab.focus(); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + mainTabs.length) % mainTabs.length;
          showView(mainTabs[j].dataset.view); mainTabs[j].focus();
        }
      });
    });
    bindProjectsView();
    bindPdCheck();
    bindRoutines();
    bindNotify();
    bindParty();
    bindTaskLinking();
    bindNotesFold();
    bindMap();
    bindResolution();
    if (window.plannerDesktop) document.body.classList.add('desktop');

    // 달력
    $('calendarGrid').addEventListener('click', function (e) {
      var cell = e.target.closest('.day-cell');
      if (!cell) return;
      var chip = e.target.closest('.day-ev');
      var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
      if (chip && chip.dataset.id && canHover) {
        // 데스크톱: 칸 안의 일정 이름을 누르면 바로 수정 팝업 (휴대폰은 날짜 선택 → 아래 요약에서 수정)
        selectDate(cell.dataset.date);
        var ev = data.events.filter(function (x) { return x.id === chip.dataset.id; })[0];
        if (ev) openEventForm(ev);
        return;
      }
      handleCalendarDate(cell.dataset.date);
    });
    $('calendarGrid').addEventListener('keydown', function (e) {
      var cell = e.target.closest('.day-cell');
      if (!cell) return;
      if (e.target === cell && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleCalendarDate(cell.dataset.date);
        return;
      }
      var delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (delta) {
        e.preventDefault();
        var nextKey = shiftDay(cell.dataset.date, delta);
        var nextCell = $('calendarGrid').querySelector('.day-cell[data-date="' + nextKey + '"]');
        if (nextCell) { nextCell.focus(); }
        else {
          var nd = parseKey(nextKey);
          viewYear = nd.getFullYear(); viewMonth = nd.getMonth();
          renderCalendar();
          var c2 = $('calendarGrid').querySelector('.day-cell[data-date="' + nextKey + '"]');
          if (c2) c2.focus();
        }
      }
    });
    $('prevMonthBtn').addEventListener('click', function () { changeMonth(-1); });
    $('nextMonthBtn').addEventListener('click', function () { changeMonth(1); });

    // 휴대폰: 달력을 좌우로 밀어 달 넘기기
    var swipe = null;
    $('calendarGrid').addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { swipe = null; return; }
      swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    $('calendarGrid').addEventListener('touchend', function (e) {
      if (!swipe || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - swipe.x;
      var dy = e.changedTouches[0].clientY - swipe.y;
      var dt = Date.now() - swipe.t;
      swipe = null;
      if (dt < 600 && Math.abs(dx) > 60 && Math.abs(dy) < 40) {
        changeMonth(dx < 0 ? 1 : -1);
        lastCalendarTap = { date: '', time: 0 };
      }
    }, { passive: true });

    // 달력 아래 요약(휴대폰)
    $('agendaDiaryBtn').addEventListener('click', function () { openDayDiary(selectedKey); });
    $('agendaAddBtn').addEventListener('click', function () { openEventForm(null); });
    $('agendaList').addEventListener('click', function (e) {
      var li = e.target.closest('.agenda-item');
      if (!li) return;
      if (li.dataset.open === 'diary') { openDayDiary(selectedKey); return; }
      var ev = data.events.filter(function (x) { return x.id === li.dataset.id; })[0];
      if (ev) openEventForm(ev);
    });
    $('agendaList').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('agenda-item')) { e.preventDefault(); e.target.click(); }
    });
    $('monthTodayBtn').addEventListener('click', function () {
      var d = new Date();
      viewYear = d.getFullYear(); viewMonth = d.getMonth();
      selectedKey = todayKey();
      renderCalendar(); renderEventsCard();
    });

    // 기념일·일정
    $('calAddEventBtn').addEventListener('click', function () { openEventForm(null); });
    // 팝업 안 "새 항목으로": 수정 모드를 풀고 빈 입력으로
    $('addEventBtn').addEventListener('click', function () { openEventForm(null); });
    $('eventCancelBtn').addEventListener('click', closeEventForm);
    $('eventModalClose').addEventListener('click', closeEventForm);
    // 바깥을 누르면 닫되, 입력 중인 내용이 있으면 버리지 않는다
    $('eventModalBackdrop').addEventListener('click', function () {
      if (!modalHasInput()) closeEventForm();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('eventModal').hidden) {
        if (!modalHasInput() || confirm('입력 중인 내용을 버리고 닫을까요?')) closeEventForm();
      }
    });
    $('eventForm').addEventListener('submit', function (e) { e.preventDefault(); submitEventForm(); });
    $('eventTitle').addEventListener('input', hideFormError);
    $('eventDate').addEventListener('input', function () {
      hideFormError();
      $('eventEndDate').min = this.value;
      if ($('eventEndDate').value && $('eventEndDate').value < this.value) $('eventEndDate').value = '';
    });
    $('eventEndDate').addEventListener('input', hideFormError);
    $('eventList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.closest('.event-item').dataset.id;
      if (btn.dataset.action === 'delete') deleteEvent(id);
      else if (btn.dataset.action === 'edit') {
        var ev = data.events.filter(function (x) { return x.id === id; })[0];
        if (ev) openEventForm(ev);
      }
    });

    // 일 다이어리 날짜 이동
    $('prevDayBtn').addEventListener('click', function () { selectedKey = shiftDay(selectedKey, -1); renderDay(); });
    $('nextDayBtn').addEventListener('click', function () { selectedKey = shiftDay(selectedKey, 1); renderDay(); });
    $('dayTodayBtn').addEventListener('click', function () { selectedKey = todayKey(); renderDay(); });

    // 빠른 기록 (글 + 사진)
    $('noteForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (addNote($('noteText').value, $('noteMood').value, pendingImage)) {
        $('noteText').value = ''; $('noteMood').value = '';
        setPendingImage(null, '');
        $('noteText').focus();
      }
    });
    $('noteText').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('noteForm').requestSubmit(); }
    });
    $('notePhotoBtn').addEventListener('click', function () { $('notePhotoInput').click(); });
    $('notePhotoInput').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      loadImageFile(f).then(function (pack) {
        setPendingImage(pack, f.name);
      }).catch(function (err) {
        toast(err.message || '사진을 불러오지 못했어요.', true);
      });
    });
    $('notePhotoRemove').addEventListener('click', function () { setPendingImage(null, ''); });
    // 붙여넣기로도 사진 첨부
    $('noteText').addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); loadImageFile(f).then(function (pack) { setPendingImage(pack, '붙여넣은 사진'); }); }
          return;
        }
      }
    });
    $('noteList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (btn) {
        var li = btn.closest('.note-item');
        if (btn.dataset.action === 'delete') deleteNote(li.dataset.id);
        else if (btn.dataset.action === 'edit') editNote(li, li.dataset.id);
        return;
      }
      var img = e.target.closest('.note-img');
      if (img) {
        var large = img.classList.toggle('is-large');
        // 크게 볼 때만 본 사진, 작게 돌아가면 다시 미리보기
        var n = data.notes.filter(function (x) { return x.id === img.closest('.note-item').dataset.id; })[0];
        if (n) img.src = large ? n.image : (n.thumb || n.image);
      }
    });

    // 하루 계획
    $('taskForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (addTask($('taskInput').value)) { $('taskInput').value = ''; $('taskInput').focus(); }
    });
    // 하루 계획 목록과 오늘 루틴 목록은 같은 동작(체크·수정·삭제)
    ['taskList', 'routineTaskList'].forEach(function (id) {
      $(id).addEventListener('change', function (e) {
        if (e.target.type === 'checkbox') toggleTask(e.target.dataset.id, e.target.checked);
      });
      $(id).addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-action]');
        if (!btn) return;
        var li = btn.closest('.task-item');
        if (btn.dataset.action === 'delete') deleteTask(li.dataset.id);
        else if (btn.dataset.action === 'edit') editTask(li, li.dataset.id);
      });
    });

    // 백업
    $('backupBtn').addEventListener('click', downloadBackup);
    $('restoreBtn').addEventListener('click', function () { $('restoreInput').click(); });
    $('restoreInput').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) restoreBackup(f);
      this.value = '';
    });

    // 오늘 리셋
    $('resetTodayBtn').addEventListener('click', resetToday);

    // 로고 크게 보기
    $('logoBtn').addEventListener('click', function () { $('logoLightbox').hidden = false; });
    $('logoLightbox').addEventListener('click', function () { this.hidden = true; $('logoBtn').focus({ preventScroll: true }); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('logoLightbox').hidden) { $('logoLightbox').hidden = true; $('logoBtn').focus({ preventScroll: true }); }
    });

    // 오늘 한눈에
    $('glanceTasks').addEventListener('click', function () {
      openDayDiary(todayKey());
      $('taskInput').focus({ preventScroll: true });
    });
    $('glanceNotes').addEventListener('click', function () {
      openDayDiary(todayKey());
      $('noteText').focus({ preventScroll: true });
    });
    $('glanceEvent').addEventListener('click', function () {
      var date = this.dataset.date;
      if (date) {
        selectedKey = date;
        var d = parseKey(date);
        viewYear = d.getFullYear(); viewMonth = d.getMonth();
        showView('month');
      } else {
        selectedKey = todayKey();
        showView('month');
        openEventForm(null);
      }
    });

    // 프로젝트
    var ptabs = [$('ptab-work'), $('ptab-personal')];
    ptabs.forEach(function (tab) {
      tab.addEventListener('click', function () { projectCat = tab.dataset.cat; renderProjects(); tab.focus(); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var other = tab === ptabs[0] ? ptabs[1] : ptabs[0];
          projectCat = other.dataset.cat; renderProjects(); other.focus();
        }
      });
    });
    $('projectForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (addProject($('projectInput').value)) { $('projectInput').value = ''; $('projectInput').focus(); }
    });
    $('projectList').addEventListener('click', function (e) {
      var link = e.target.closest('.project-title[data-open]');
      if (link) { openProject(link.dataset.open); return; }
      var btn = e.target.closest('button[data-action="delete"]');
      if (btn) deleteProject(btn.closest('.project-item').dataset.id);
    });

    // 동기화 패널
    $('syncStatusBtn').addEventListener('click', function () {
      var panel = $('syncPanel');
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      if (!panel.hidden) renderSyncPanel();
    });
    $('syncCloseBtn').addEventListener('click', function () {
      $('syncPanel').hidden = true;
      $('syncStatusBtn').setAttribute('aria-expanded', 'false');
    });
    $('syncServerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('syncServerInput').value.trim();
      if (v && !/^https?:\/\/[^\s/]+/.test(v)) { toast('주소는 http:// 또는 https:// 로 시작해야 해요.', true); return; }
      setServerBase(v);
      renderSyncPanel();
      sync.serverOk = null;
      renderStatus();
      if (syncKey) startPolling();
      toast('서버 주소를 바꿨어요: ' + serverBase());
    });
    $('syncCreateBtn').addEventListener('click', createSyncCode);
    $('syncJoinForm').addEventListener('submit', function (e) { e.preventDefault(); joinSyncCode($('syncJoinInput').value); });
    $('syncCopyBtn').addEventListener('click', function () {
      var code = syncKey;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { toast('코드를 복사했어요.'); }, function () { toast('복사하지 못했어요. 코드를 직접 적어 주세요.', true); });
      } else {
        toast('복사하지 못했어요. 코드를 직접 적어 주세요.', true);
      }
    });
    $('syncDisconnectBtn').addEventListener('click', function () {
      if (!confirm('이 기기의 연결을 해제할까요?\n기록은 이 기기에 그대로 남고, 서버 저장만 멈춰요.')) return;
      setSyncKey('');
      toast('연결을 해제했어요.');
    });

    // 다른 기기 변경 확인
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    window.addEventListener('online', poll);
    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY && e.newValue) {
        try { applyRemote(JSON.parse(e.newValue)); } catch (err) { /* 무시 */ }
      }
    });
  }

  // ---------------------------------------------------------------- 시작
  function init() {
    bind();
    resetRoutineForm();
    renderSyncPanel();
    showView('month');
    renderAll();
    if (syncKey) startPolling();
    // 휴대폰 설치형(PWA): 서버에서 https로 열었을 때만 등록 (데스크톱 앱·개발 중엔 캐시가 방해되지 않게)
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !isLocalOrigin()) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 설치 실패는 조용히 넘어간다 */ });
      // 새 버전 워커가 자리를 잡으면 한 번 새로 읽어 화면·동작 파일을 같은 버전으로 맞춘다
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded || !navigator.serviceWorker.controller) return;
        reloaded = true;
        if (!modalHasInput() && !$('noteText').value) location.reload();
      });
    }
    // 여기까지 왔으면 정상 시작: 자가 복구 플래그를 지운다
    if (window.__plannerHealed) window.__plannerHealed();
    // 날짜가 바뀌면(자정 경과) 헤더와 오늘 표시를 갱신
    flushLinkedLogs();
    // 하루 처음 열면 오늘의 각오를 묻는다 (다른 기기에서 이미 적었으면 동기화 뒤 사라진다)
    setTimeout(maybeAskResolution, 1200);
    setInterval(function () {
      if ($('todayDate').textContent !== fmtLong(todayKey())) { flushLinkedLogs(); renderAll(); maybeAskResolution(); }
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
