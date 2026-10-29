/*
 * 플래너 데이터 구조와 병합 규칙.
 * 브라우저(window.PlannerMerge)와 Node(server.js) 양쪽에서 같은 코드를 사용한다.
 *
 * data = {
 *   version: 1,
 *   updatedAt: number,
 *   days: { 'YYYY-MM-DD': { tasks: [{ id, text, done, createdAt, updatedAt, seed? }] } },
 *   notes: [{ id, dayKey, text, mood, date, updatedAt }],
 *   events: [{ id, title, date, kind: 'anniversary'|'schedule', repeat: 'yearly'|'none', updatedAt }],
 *   projects: { work: [{ id, title, next, status, memo, tasks, log, check, createdAt, updatedAt, seed? }], personal: [...] },
 *     check: { on, label, days: { 'YYYY-MM-DD': ts } }   // 날짜별 체크(예: 운동한 날). ts>0 체크, ts<0 해제(시각은 절댓값)
 *   routines: [{ id, text, days: [0..6], projectId, active, startDate, createdAt, updatedAt }],
 *     // 루틴: 해당 요일의 하루 계획에 할 일(id = 'rt_'+루틴id+'_'+날짜)로 자동 생성된다. days가 비면 매일.
 *   deleted: { [id]: deletedAt },      // 삭제 흔적(툼스톤) — 기기 간 병합 시 되살아나지 않게 함
 *   meta: { seededPlan?: true, seededProjects?: true }
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlannerMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000; // 90일
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function emptyData() {
    return {
      version: 1,
      updatedAt: 0,
      days: {},
      notes: [],
      events: [],
      projects: { work: [], personal: [] },
      routines: [],
      deleted: {},
      meta: {}
    };
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  function str(v) {
    return typeof v === 'string' ? v : (v == null ? '' : String(v));
  }

  function isObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function normTask(t, dayKey) {
    if (!isObj(t)) return null;
    var text = str(t.text).trim();
    if (!text) return null;
    var created = num(t.createdAt, num(t.updatedAt, 0)) || 0;
    var task = {
      id: str(t.id) || uid(),
      text: text,
      done: !!t.done,
      createdAt: created,
      updatedAt: num(t.updatedAt, created) || created
    };
    if (t.seed) task.seed = true;
    var routineId = str(t.routineId);
    if (routineId) task.routineId = routineId;
    // 하루 계획 ↔ 프로젝트 할 일 연동: 날짜 할 일에는 projectId, 프로젝트 할 일에는 dayKey (같은 id를 공유)
    var projectId = str(t.projectId);
    if (projectId) task.projectId = projectId;
    var dk = str(t.dayKey);
    if (DATE_RE.test(dk)) task.dayKey = dk;
    if (t.logged) task.logged = true;
    return task;
  }

  // 루틴: 요일(0=일 … 6=토) 목록, 비어 있으면 매일
  function normRoutine(r) {
    if (!isObj(r)) return null;
    var text = str(r.text).trim();
    if (!text) return null;
    var days = [];
    if (Array.isArray(r.days)) {
      r.days.forEach(function (d) {
        var n = Number(d);
        if (n >= 0 && n <= 6 && n === Math.floor(n) && days.indexOf(n) < 0) days.push(n);
      });
      days.sort();
    }
    var created = num(r.createdAt, num(r.updatedAt, 0)) || 0;
    var startDate = str(r.startDate);
    return {
      id: str(r.id) || uid(),
      text: text,
      days: days,
      projectId: str(r.projectId),
      active: r.active !== false,
      startDate: DATE_RE.test(startDate) ? startDate : '',
      createdAt: created,
      updatedAt: num(r.updatedAt, created) || created
    };
  }

  // 프로젝트 날짜별 체크: days[날짜] = 시각(양수 체크, 음수 해제). 오래된 해제 흔적은 버린다.
  function normCheck(c) {
    var out = { on: false, label: '', days: {} };
    if (!isObj(c)) return out;
    out.on = !!c.on;
    out.label = str(c.label).trim();
    if (isObj(c.days)) {
      var cutoff = Date.now() - TOMBSTONE_TTL;
      Object.keys(c.days).forEach(function (k) {
        if (!DATE_RE.test(k)) return;
        var v = c.days[k];
        if (v === true) v = 1;
        var n = Number(v);
        if (!isFinite(n) || n === 0) return;
        n = n > 0 ? Math.floor(n) : -Math.floor(-n);
        if (n < 0 && -n < cutoff) return;
        out.days[k] = n;
      });
    }
    return out;
  }

  // 마인드맵: 키워드 노드(위치·글)와 연결선. 통째로 최신 쪽을 쓴다.
  function normMap(m) {
    var out = { nodes: [], edges: [], updatedAt: 0 };
    if (!isObj(m)) return out;
    var ids = {};
    if (Array.isArray(m.nodes)) m.nodes.forEach(function (n) {
      if (!isObj(n)) return;
      var text = str(n.text).trim(); if (!text) return;
      var id = str(n.id) || uid();
      ids[id] = true;
      out.nodes.push({ id: id, text: text, x: Number(n.x) || 0, y: Number(n.y) || 0, color: str(n.color) });
    });
    if (Array.isArray(m.edges)) m.edges.forEach(function (e) {
      if (!isObj(e)) return;
      var a = str(e.a), b = str(e.b);
      if (a && b && a !== b && ids[a] && ids[b]) out.edges.push({ a: a, b: b });
    });
    out.updatedAt = num(m.updatedAt, 0) || 0;
    return out;
  }

  function mergeCheck(x, y, newerOne) {
    x = normCheck(x); y = normCheck(y);
    var nc = normCheck(newerOne);
    var out = { on: nc.on, label: nc.label || x.label || y.label, days: {} };
    [x.days, y.days].forEach(function (days) {
      Object.keys(days).forEach(function (k) {
        var cur = out.days[k];
        if (cur === undefined || Math.abs(days[k]) > Math.abs(cur)) out.days[k] = days[k];
      });
    });
    return out;
  }

  function normNote(n) {
    if (!isObj(n)) return null;
    var text = str(n.text).trim();
    var image = str(n.image);
    if (image.indexOf('data:image/') !== 0) image = '';
    var dayKey = str(n.dayKey);
    if (!text && !image) return null;
    var date = str(n.date);
    if (!DATE_RE.test(dayKey)) {
      // dayKey가 없으면 date에서 유도
      if (date.length >= 10 && DATE_RE.test(date.slice(0, 10))) dayKey = date.slice(0, 10);
      else return null;
    }
    var updated = num(n.updatedAt, Date.parse(date) || 0) || 0;
    var note = {
      id: str(n.id) || uid(),
      dayKey: dayKey,
      text: text,
      mood: str(n.mood).trim(),
      date: date || new Date(updated || Date.now()).toISOString(),
      updatedAt: updated
    };
    if (image) {
      note.image = image;
      // 목록용 작은 미리보기(없으면 본 사진을 그대로 쓴다)
      var thumb = str(n.thumb);
      if (thumb.indexOf('data:image/') === 0) note.thumb = thumb;
    }
    return note;
  }

  function normEvent(e) {
    if (!isObj(e)) return null;
    var title = str(e.title).trim();
    var date = str(e.date);
    if (!title || !DATE_RE.test(date)) return null;
    var kind = e.kind === 'schedule' ? 'schedule' : 'anniversary';
    var repeat = (e.repeat === 'yearly' || e.repeat === true) ? 'yearly' : 'none';
    var ev = {
      id: str(e.id) || uid(),
      title: title,
      date: date,
      kind: kind,
      repeat: repeat,
      updatedAt: num(e.updatedAt, 0) || 0
    };
    // 기간 일정: endDate가 시작일보다 뒤일 때만 저장
    var endDate = str(e.endDate);
    if (DATE_RE.test(endDate) && endDate > date) ev.endDate = endDate;
    return ev;
  }

  function normLog(l) {
    if (!isObj(l)) return null;
    var text = str(l.text).trim();
    if (!text) return null;
    var updated = num(l.updatedAt, 0) || 0;
    return {
      id: str(l.id) || uid(),
      text: text,
      date: str(l.date) || new Date(updated || Date.now()).toISOString(),
      updatedAt: updated
    };
  }

  var STATUSES = { active: 1, paused: 1, done: 1 };

  // 프로젝트: 제목 + 상태 + 다음 행동 + 메모 + 할 일 목록 + 진행 기록
  function normProject(p) {
    if (!isObj(p)) {
      if (typeof p === 'string' && p.trim()) p = { title: p };
      else return null;
    }
    var title = str(p.title).trim();
    if (!title) return null;
    var created = num(p.createdAt, num(p.updatedAt, 0)) || 0;
    var proj = {
      id: str(p.id) || uid(),
      title: title,
      next: str(p.next).trim(),
      status: STATUSES[p.status] ? p.status : 'active',
      memo: str(p.memo),
      map: normMap(p.map),
      tasks: normList(p.tasks, normTask),
      log: normList(p.log, normLog),
      check: normCheck(p.check),
      createdAt: created,
      updatedAt: num(p.updatedAt, created) || created
    };
    if (p.seed) proj.seed = true;
    return proj;
  }

  function normList(list, fn, extra) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = fn(list[i], extra);
      if (v) out.push(v);
    }
    return out;
  }

  // 어떤 입력이 와도 위 구조로 맞춘다. 알 수 없는 필드는 버린다.
  function normalize(raw) {
    var d = emptyData();
    if (!isObj(raw)) return d;
    d.updatedAt = num(raw.updatedAt, 0) || 0;

    if (isObj(raw.days)) {
      Object.keys(raw.days).forEach(function (key) {
        if (!DATE_RE.test(key)) return;
        var day = raw.days[key];
        var tasks = normList(isObj(day) ? day.tasks : day, normTask, key);
        if (tasks.length) d.days[key] = { tasks: tasks };
      });
    }
    d.notes = normList(raw.notes, normNote);
    d.events = normList(raw.events, normEvent);
    if (isObj(raw.projects)) {
      d.projects.work = normList(raw.projects.work, normProject);
      d.projects.personal = normList(raw.projects.personal, normProject);
    }
    d.routines = normList(raw.routines, normRoutine);
    if (isObj(raw.deleted)) {
      Object.keys(raw.deleted).forEach(function (id) {
        var ts = num(raw.deleted[id], 0);
        if (ts) d.deleted[id] = ts;
      });
    }
    if (isObj(raw.meta)) {
      if (raw.meta.seededPlan) d.meta.seededPlan = true;
      if (raw.meta.seededProjects) d.meta.seededProjects = true;
    }
    return d;
  }

  function isEmptyData(d) {
    d = normalize(d);
    return Object.keys(d.days).length === 0 &&
      d.notes.length === 0 &&
      d.events.length === 0 &&
      d.routines.length === 0 &&
      d.projects.work.length === 0 &&
      d.projects.personal.length === 0;
  }

  // 사용자 입력 없이 초기 예시만 들어 있는 상태인가? (다른 기기 코드로 연결할 때 예시는 버린다)
  function isOnlySeeds(d) {
    d = normalize(d);
    if (d.notes.length || d.events.length || d.routines.length) return false;
    var allSeed = true;
    Object.keys(d.days).forEach(function (k) {
      d.days[k].tasks.forEach(function (t) { if (!t.seed) allSeed = false; });
    });
    d.projects.work.concat(d.projects.personal).forEach(function (p) { if (!p.seed) allSeed = false; });
    return allSeed;
  }

  function newer(a, b) {
    return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  }

  // id 기준으로 합치고(최신 updatedAt 우선), 그 다음 dedupeKey 기준으로 중복을 없앤다.
  function mergeList(a, b, deleted, dedupeKey, combine) {
    var byId = {};
    var order = [];
    function take(item) {
      if (deleted[item.id]) return;
      if (byId[item.id]) byId[item.id] = newer(byId[item.id], item);
      else { byId[item.id] = item; order.push(item.id); }
    }
    a.forEach(take);
    b.forEach(take);

    var byKey = {};
    var out = [];
    order.forEach(function (id) {
      var item = byId[id];
      var key = dedupeKey(item);
      if (byKey[key] !== undefined) {
        var idx = byKey[key];
        out[idx] = combine(out[idx], item);
      } else {
        byKey[key] = out.length;
        out.push(item);
      }
    });
    return out;
  }

  function combineTask(x, y) {
    var keep = (x.createdAt || Infinity) <= (y.createdAt || Infinity) ? x : y;
    var other = keep === x ? y : x;
    var merged = {};
    for (var k in keep) merged[k] = keep[k];
    merged.done = !!(x.done || y.done);
    merged.updatedAt = Math.max(x.updatedAt || 0, y.updatedAt || 0);
    if (!other.seed) delete merged.seed;
    return merged;
  }

  function combineNote(x, y) {
    return (x.updatedAt || 0) >= (y.updatedAt || 0) ? x : y;
  }

  // 같은 프로젝트(같은 id 또는 같은 제목)를 합친다: 글 필드는 최신 쪽, 할 일·기록은 둘 다 합침
  function mergeProjectPair(x, y, deleted) {
    var newerOne = (y.updatedAt || 0) > (x.updatedAt || 0) ? y : x;
    var older = newerOne === x ? y : x;
    var keep = (x.createdAt || Infinity) <= (y.createdAt || Infinity) ? x : y;
    var merged = {
      id: keep.id,
      title: newerOne.title,
      next: newerOne.next || older.next || '',
      status: newerOne.status || 'active',
      memo: newerOne.memo || older.memo || '',
      map: (newerOne.map && newerOne.map.nodes && newerOne.map.nodes.length) ? newerOne.map : (older.map || normMap(null)),
      tasks: mergeList(x.tasks || [], y.tasks || [], deleted, function (t) { return t.text.toLowerCase(); }, combineTask).sort(byCreated),
      log: mergeList(x.log || [], y.log || [], deleted, function (l) { return l.text + '|' + str(l.date).slice(0, 10); }, combineNote).sort(byDateDesc),
      check: mergeCheck(x.check, y.check, newerOne.check),
      createdAt: Math.min(x.createdAt || Infinity, y.createdAt || Infinity),
      updatedAt: Math.max(x.updatedAt || 0, y.updatedAt || 0)
    };
    if (!isFinite(merged.createdAt)) merged.createdAt = 0;
    if (x.seed && y.seed) merged.seed = true;
    return merged;
  }

  function mergeProjects(a, b, deleted) {
    var byId = {};
    var order = [];
    function take(p) {
      if (deleted[p.id]) return;
      if (byId[p.id]) byId[p.id] = mergeProjectPair(byId[p.id], p, deleted);
      else { byId[p.id] = p; order.push(p.id); }
    }
    a.forEach(take);
    b.forEach(take);
    var byTitle = {};
    var out = [];
    order.forEach(function (id) {
      var p = byId[id];
      var key = p.title.toLowerCase();
      if (byTitle[key] !== undefined) out[byTitle[key]] = mergeProjectPair(out[byTitle[key]], p, deleted);
      else { byTitle[key] = out.length; out.push(p); }
    });
    return out.sort(byCreated);
  }

  function byCreated(x, y) { return (x.createdAt || 0) - (y.createdAt || 0); }
  function byDateDesc(x, y) {
    return (Date.parse(y.date) || y.updatedAt || 0) - (Date.parse(x.date) || x.updatedAt || 0);
  }

  function mergeData(a, b) {
    a = normalize(a);
    b = normalize(b);
    var out = emptyData();
    var now = Date.now();

    // 툼스톤 합치기(최신 시각 유지) + 오래된 것 정리
    [a.deleted, b.deleted].forEach(function (del) {
      Object.keys(del).forEach(function (id) {
        var ts = del[id];
        if (now - ts > TOMBSTONE_TTL) return;
        out.deleted[id] = Math.max(out.deleted[id] || 0, ts);
      });
    });
    var deleted = out.deleted;

    // 날짜별 할 일
    var dayKeys = {};
    Object.keys(a.days).forEach(function (k) { dayKeys[k] = true; });
    Object.keys(b.days).forEach(function (k) { dayKeys[k] = true; });
    Object.keys(dayKeys).sort().forEach(function (k) {
      var ta = a.days[k] ? a.days[k].tasks : [];
      var tb = b.days[k] ? b.days[k].tasks : [];
      var tasks = mergeList(ta, tb, deleted, function (t) { return t.text.toLowerCase(); }, combineTask)
        .sort(byCreated);
      if (tasks.length) out.days[k] = { tasks: tasks };
    });

    // 기록: 날짜 + 본문(+사진 길이) 기준으로 중복 제거
    out.notes = mergeList(a.notes, b.notes, deleted, function (n) {
      return n.dayKey + '|' + n.text + '|' + (n.image ? n.image.length : 0);
    }, combineNote).sort(byDateDesc);

    // 이벤트: id 기준으로만 합친다(같은 날 같은 제목이 여러 개여도 허용)
    out.events = mergeList(a.events, b.events, deleted, function (e) { return e.id; }, function (x) { return x; })
      .sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });

    // 프로젝트: 카테고리별로 id·제목 기준 병합(할 일·기록은 합집합).
    // 같은 프로젝트가 다른 카테고리로 옮겨진 경우: 최신 updatedAt 쪽 카테고리만 남긴다.
    var moved = {};
    ['work', 'personal'].forEach(function (cat) {
      out.projects[cat] = mergeProjects(a.projects[cat], b.projects[cat], deleted);
      out.projects[cat].forEach(function (p) {
        if (!moved[p.id] || p.updatedAt > moved[p.id].updatedAt) moved[p.id] = { cat: cat, updatedAt: p.updatedAt };
      });
    });
    ['work', 'personal'].forEach(function (cat) {
      out.projects[cat] = out.projects[cat].filter(function (p) { return moved[p.id].cat === cat; });
    });

    // 루틴: id 기준, 최신 쪽 우선
    out.routines = mergeList(a.routines, b.routines, deleted, function (r) { return r.id; }, combineNote).sort(byCreated);

    if (a.meta.seededPlan || b.meta.seededPlan) out.meta.seededPlan = true;
    if (a.meta.seededProjects || b.meta.seededProjects) out.meta.seededProjects = true;
    out.updatedAt = Math.max(a.updatedAt, b.updatedAt);
    return out;
  }

  // 비교용 안정적 직렬화(키 정렬)
  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ':' + stableStringify(v[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  // updatedAt을 제외한 내용 비교
  function sameContent(a, b) {
    a = normalize(a); b = normalize(b);
    a.updatedAt = 0; b.updatedAt = 0;
    return stableStringify(a) === stableStringify(b);
  }

  return {
    emptyData: emptyData,
    normalize: normalize,
    mergeData: mergeData,
    isEmptyData: isEmptyData,
    isOnlySeeds: isOnlySeeds,
    sameContent: sameContent,
    stableStringify: stableStringify,
    uid: uid,
    DATE_RE: DATE_RE
  };
});
