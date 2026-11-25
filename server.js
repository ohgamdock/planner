/*
 * 나만의 플래너 — 정적 파일 + 동기화 API 서버 (외부 의존성 없음)
 *
 * 실행: node server.js            (기본 포트 4310, 환경변수 PORT로 변경)
 * 데이터: ./data/<동기화코드>.json  (코드별로 완전히 분리 저장)
 *
 * API
 *   GET  /api/health              -> { ok: true }
 *   GET  /api/data/:key           -> 저장된 데이터 (없으면 404)
 *   PUT  /api/data/:key  (JSON)   -> 기존 데이터와 병합해 저장하고 병합 결과를 돌려준다
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const merge = require('./merge.js');

const DEFAULT_PORT = Number(process.env.PORT) || 4310;
const ROOT = __dirname;
let DATA_DIR = process.env.PLANNER_DATA_DIR || path.join(ROOT, 'data');
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 5 * 1024 * 1024;

const STATIC = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/merge.js': { file: 'merge.js', type: 'application/javascript; charset=utf-8' },
  '/sw.js': { file: 'sw.js', type: 'application/javascript; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/assets/icon.png': { file: path.join('assets', 'icon.png'), type: 'image/png' },
  '/assets/icon-192.png': { file: path.join('assets', 'icon-192.png'), type: 'image/png' },
  '/assets/icon-512.png': { file: path.join('assets', 'icon-512.png'), type: 'image/png' },
  '/assets/icon-maskable-192.png': { file: path.join('assets', 'icon-maskable-192.png'), type: 'image/png' },
  '/assets/icon-maskable-512.png': { file: path.join('assets', 'icon-maskable-512.png'), type: 'image/png' },
  // 매일 바뀌는 로고(작은 것 + 크게 보기용 원본) 1~5
  '/assets/logo-1.png': { file: path.join('assets', 'logo-1.png'), type: 'image/png' },
  '/assets/logo-2.png': { file: path.join('assets', 'logo-2.png'), type: 'image/png' },
  '/assets/logo-3.png': { file: path.join('assets', 'logo-3.png'), type: 'image/png' },
  '/assets/logo-4.png': { file: path.join('assets', 'logo-4.png'), type: 'image/png' },
  '/assets/logo-5.png': { file: path.join('assets', 'logo-5.png'), type: 'image/png' },
  '/assets/logo-1-full.png': { file: path.join('assets', 'logo-1-full.png'), type: 'image/png' },
  '/assets/logo-2-full.png': { file: path.join('assets', 'logo-2-full.png'), type: 'image/png' },
  '/assets/logo-3-full.png': { file: path.join('assets', 'logo-3-full.png'), type: 'image/png' },
  '/assets/logo-4-full.png': { file: path.join('assets', 'logo-4-full.png'), type: 'image/png' },
  '/assets/logo-5-full.png': { file: path.join('assets', 'logo-5-full.png'), type: 'image/png' },
  // 낚시 게임 사진 (f01~f14)
  '/assets/fish/f01.jpg': { file: path.join('assets', 'fish', 'f01.jpg'), type: 'image/jpeg' },
  '/assets/fish/f02.jpg': { file: path.join('assets', 'fish', 'f02.jpg'), type: 'image/jpeg' },
  '/assets/fish/f03.jpg': { file: path.join('assets', 'fish', 'f03.jpg'), type: 'image/jpeg' },
  '/assets/fish/f04.jpg': { file: path.join('assets', 'fish', 'f04.jpg'), type: 'image/jpeg' },
  '/assets/fish/f05.jpg': { file: path.join('assets', 'fish', 'f05.jpg'), type: 'image/jpeg' },
  '/assets/fish/f06.jpg': { file: path.join('assets', 'fish', 'f06.jpg'), type: 'image/jpeg' },
  '/assets/fish/f07.jpg': { file: path.join('assets', 'fish', 'f07.jpg'), type: 'image/jpeg' },
  '/assets/fish/f08.jpg': { file: path.join('assets', 'fish', 'f08.jpg'), type: 'image/jpeg' },
  '/assets/fish/f09.jpg': { file: path.join('assets', 'fish', 'f09.jpg'), type: 'image/jpeg' },
  '/assets/fish/f10.jpg': { file: path.join('assets', 'fish', 'f10.jpg'), type: 'image/jpeg' },
  '/assets/fish/f11.jpg': { file: path.join('assets', 'fish', 'f11.jpg'), type: 'image/jpeg' },
  '/assets/fish/f12.jpg': { file: path.join('assets', 'fish', 'f12.jpg'), type: 'image/jpeg' },
  '/assets/fish/f13.jpg': { file: path.join('assets', 'fish', 'f13.jpg'), type: 'image/jpeg' },
  '/assets/fish/f14.jpg': { file: path.join('assets', 'fish', 'f14.jpg'), type: 'image/jpeg' },
  // 파티 모드 고양이
  '/assets/party/cat-dance.mp4': { file: path.join('assets', 'party', 'cat-dance.mp4'), type: 'video/mp4' },
  '/assets/party/cat-dance.gif': { file: path.join('assets', 'party', 'cat-dance.gif'), type: 'image/gif' },
  // 안드로이드 앱 설치 파일 (휴대폰에서 이 주소를 열면 바로 내려받음)
  '/planner.apk': { file: path.join('downloads', 'planner.apk'), type: 'application/vnd.android.package-archive', download: 'planner.apk' }
};

// 다른 출처(데스크톱 앱의 localhost 페이지 등)에서도 API를 쓸 수 있게 한다.
// 데이터는 비밀 동기화 코드로만 접근되므로 출처 제한은 두지 않는다.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Planner-Build',
  'Access-Control-Max-Age': '86400'
};

// 실시간 알림(SSE): 코드별로 열린 연결을 기억했다가 저장이 일어나면 모두에게 알린다
const streams = new Map();
function addStream(key, res) {
  if (!streams.has(key)) streams.set(key, new Set());
  streams.get(key).add(res);
}
function removeStream(key, res) {
  const set = streams.get(key);
  if (!set) return;
  set.delete(res);
  if (!set.size) streams.delete(key);
}
function broadcast(key, payload) {
  const set = streams.get(key);
  if (!set) return;
  const line = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const res of set) {
    try { res.write(line); } catch (e) { /* 끊긴 연결은 close에서 정리 */ }
  }
}
function handleStream(req, res, key) {
  res.writeHead(200, Object.assign({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  }, CORS));
  res.write('retry: 3000\n\n');
  addStream(key, res);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* 무시 */ }
  }, 25000);
  req.on('close', () => { clearInterval(heartbeat); removeStream(key, res); });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    'X-Planner-Build': BUILD_STAMP
  }, CORS));
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 식단 사진: 동기화 JSON에 넣으면 금방 용량을 넘으므로 코드별 폴더에 파일로 둔다
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function photoFile(key, id) { return path.join(DATA_DIR, 'photos', key, id + '.jpg'); }
async function handlePhoto(req, res, key, id) {
  if (!KEY_RE.test(key) || !PHOTO_ID_RE.test(id)) return sendJson(res, 400, { error: '잘못된 주소' });
  const file = photoFile(key, id);
  if (req.method === 'GET') {
    let buf;
    try { buf = fs.readFileSync(file); } catch (e) { return sendJson(res, 404, { error: '사진 없음' }); }
    res.writeHead(200, Object.assign({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }, CORS));
    return res.end(buf);
  }
  if (req.method === 'PUT') {
    let buf;
    try {
      const m = (await readBody(req)).match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw new Error('bad');
      buf = Buffer.from(m[1], 'base64');
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('bad');
    } catch (e) {
      return sendJson(res, 400, { error: '사진을 읽을 수 없음' });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    fs.rmSync(file, { force: true });
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405, { Allow: 'GET, PUT, DELETE' });
  res.end();
}

// ---------------------------------------------------------------- 보노보노 (친구와 함께 쓰는 방)
// 동기화 코드는 내 기록 전체의 열쇠라서 친구에게 주면 안 된다. 그래서 코드에서 되돌릴 수 없는
// '친구 코드'(8글자)를 만들어 그걸 주고받는다. 서로 상대 친구 코드를 넣어야(양쪽 다) 방이 열린다.
const crypto = require('crypto');
const BONO_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BONO_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const BONO_KINDS = ['msg', 'art', 'todo', 'poke'];
const BONO_MAX_ITEMS = 2000;
function bonoCode(key) {
  const h = crypto.createHash('sha256').update('bonobono:' + key).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += BONO_ALPHA[h[i] % 32];
  return s;
}
function bonoDir(...p) { return path.join(DATA_DIR, 'bono', ...p); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj));
  fs.renameSync(file + '.tmp', file);
}
function bonoUser(code) { return readJson(bonoDir('users', code + '.json'), null); }
function bonoSaveUser(code, u) { writeJson(bonoDir('users', code + '.json'), u); }
function bonoRoomId(a, b) { return [a, b].sort().join('_'); }
function bonoRoomFile(id) { return bonoDir('rooms', id + '.json'); }
function bonoRoom(id) { return readJson(bonoRoomFile(id), null) || { items: [], moods: {}, updatedAt: 0 }; }
function bonoId() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
// 내 정보(없으면 만든다). 이름이 비어 있으면 '친구'
function bonoMe(key) {
  const code = bonoCode(key);
  let u = bonoUser(code);
  if (!u) { u = { key, name: '', friends: [], createdAt: Date.now() }; bonoSaveUser(code, u); }
  else if (u.key !== key) { u.key = key; bonoSaveUser(code, u); }
  return { code, u };
}
function bonoMutual(meCode, me, friendCode) {
  if (!me.friends.includes(friendCode)) return null;
  const f = bonoUser(friendCode);
  if (!f || !f.friends.includes(meCode)) return null;
  return f;
}
// 방이 바뀌면 두 사람의 모든 기기에 알린다 (각자 열려 있는 실시간 연결로)
function bonoNotify(meCode, me, friendCode, friend, extra) {
  const t = Date.now();
  broadcast(me.key, Object.assign({ bono: friendCode, by: meCode, t }, extra));
  if (friend && friend.key) broadcast(friend.key, Object.assign({ bono: meCode, by: meCode, from: me.name || '친구', t }, extra));
}
function bonoView(meCode, me, friendCode, room) {
  const f = bonoUser(friendCode);
  return { code: friendCode, name: (f && f.name) || '친구', items: room.items, moods: room.moods, updatedAt: room.updatedAt, me: meCode };
}
function bonoPhotoFile(roomId, id) { return bonoDir('rooms', roomId, id + '.jpg'); }
function bonoJpeg(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf[0] === 0xFF && buf[1] === 0xD8 ? buf : null;
}

async function handleBono(req, res, url, key, rest) {
  if (!KEY_RE.test(key)) return sendJson(res, 400, { error: '잘못된 동기화 코드' });
  const { code: meCode, u: me } = bonoMe(key);
  const parts = rest ? rest.split('/').filter(Boolean) : [];
  let body = {};
  if (req.method === 'PUT' || req.method === 'POST') {
    try { body = JSON.parse((await readBody(req)) || '{}') || {}; } catch (e) { return sendJson(res, 400, { error: '본문을 읽을 수 없음' }); }
  }
  // GET /api/bono/<키> — 내 친구 코드·이름·친구 목록
  if (!parts.length && req.method === 'GET') {
    const friends = me.friends.map((c) => {
      const f = bonoUser(c);
      const mutual = !!(f && f.friends.includes(meCode));
      const out = { code: c, name: (f && f.name) || '', mutual };
      if (mutual) {
        const room = bonoRoom(bonoRoomId(meCode, c));
        const last = room.items[room.items.length - 1];
        out.updatedAt = room.updatedAt || 0;
        if (last) out.last = { by: last.by, kind: last.kind, text: String(last.text || '').slice(0, 40), t: last.t };
      }
      return out;
    });
    // 나를 친구로 넣었지만 나는 아직 안 넣은 사람
    let waiting = [];
    try {
      waiting = fs.readdirSync(bonoDir('users')).map((n) => n.replace(/\.json$/, '')).filter((c) => BONO_CODE_RE.test(c) && c !== meCode && !me.friends.includes(c))
        .map((c) => ({ c, f: bonoUser(c) })).filter((x) => x.f && x.f.friends.includes(meCode)).map((x) => ({ code: x.c, name: x.f.name || '' }));
    } catch (e) { /* 아직 아무도 없음 */ }
    return sendJson(res, 200, { code: meCode, name: me.name || '', friends, waiting });
  }
  // PUT /api/bono/<키>/me {name}
  if (parts[0] === 'me' && req.method === 'PUT') {
    me.name = String(body.name || '').trim().slice(0, 20);
    bonoSaveUser(meCode, me);
    me.friends.forEach((c) => { const f = bonoMutual(meCode, me, c); if (f) bonoNotify(meCode, me, c, f, { kind: 'name', quiet: true }); });
    return sendJson(res, 200, { ok: true, name: me.name });
  }
  // PUT·DELETE /api/bono/<키>/friend/<친구코드>
  if (parts[0] === 'friend' && parts[1]) {
    const c = String(parts[1]).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!BONO_CODE_RE.test(c) || c === meCode) return sendJson(res, 400, { error: '친구 코드가 맞지 않아요' });
    if (req.method === 'PUT') {
      if (!me.friends.includes(c)) { me.friends.push(c); me.friends = me.friends.slice(-50); bonoSaveUser(meCode, me); }
      const f = bonoUser(c);
      if (f && f.key) broadcast(f.key, { bono: meCode, by: meCode, from: me.name || '친구', kind: 'friend', t: Date.now() });
      return sendJson(res, 200, { ok: true, code: c, exists: !!f, mutual: !!(f && f.friends.includes(meCode)) });
    }
    if (req.method === 'DELETE') {
      me.friends = me.friends.filter((x) => x !== c);
      bonoSaveUser(meCode, me);
      return sendJson(res, 200, { ok: true });
    }
  }
  // /api/bono/<키>/room/<친구코드>[/photo/<id>]
  if (parts[0] === 'room' && parts[1]) {
    const c = parts[1];
    if (!BONO_CODE_RE.test(c)) return sendJson(res, 400, { error: '친구 코드가 맞지 않아요' });
    const friend = bonoMutual(meCode, me, c);
    if (!friend) return sendJson(res, 403, { error: '두 사람이 서로 친구 코드를 넣어야 열려요' });
    const roomId = bonoRoomId(meCode, c);
    if (parts[2] === 'photo' && parts[3] && req.method === 'GET') {
      if (!PHOTO_ID_RE.test(parts[3])) return sendJson(res, 400, { error: '잘못된 주소' });
      let buf;
      try { buf = fs.readFileSync(bonoPhotoFile(roomId, parts[3])); } catch (e) { return sendJson(res, 404, { error: '사진 없음' }); }
      res.writeHead(200, Object.assign({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }, CORS));
      return res.end(buf);
    }
    if (req.method === 'GET') {
      const room = bonoRoom(roomId);
      const since = Number(url.searchParams.get('since'));
      if (since && room.updatedAt === since) { res.writeHead(204, Object.assign({ 'Cache-Control': 'no-store' }, CORS)); return res.end(); }
      return sendJson(res, 200, bonoView(meCode, me, c, room));
    }
    if (req.method === 'POST') {
      let note = null;
      const result = await withLock('bono:' + roomId, () => {
        const room = bonoRoom(roomId);
        const t = Date.now();
        const find = (id) => room.items.find((x) => x.id === id);
        if (body.op === 'add') {
          const kind = BONO_KINDS.includes(body.kind) ? body.kind : 'msg';
          const item = { id: bonoId(), by: meCode, t, kind, text: String(body.text || '').trim().slice(0, kind === 'todo' ? 200 : 2000) };
          if (body.photo) {
            const buf = bonoJpeg(body.photo);
            if (!buf) return { error: '사진을 읽을 수 없음' };
            const pid = bonoId();
            fs.mkdirSync(path.dirname(bonoPhotoFile(roomId, pid)), { recursive: true });
            fs.writeFileSync(bonoPhotoFile(roomId, pid), buf);
            item.photo = pid;
          }
          if (!item.text && !item.photo && kind !== 'poke') return { error: '내용이 비어 있어요' };
          if (kind === 'todo') item.done = false;
          room.items.push(item);
          if (room.items.length > BONO_MAX_ITEMS) {
            room.items.splice(0, room.items.length - BONO_MAX_ITEMS).forEach((x) => { if (x.photo) fs.rmSync(bonoPhotoFile(roomId, x.photo), { force: true }); });
          }
          note = { kind, preview: item.text.slice(0, 40) };
        } else if (body.op === 'del') {
          const it = find(String(body.id));
          if (!it || it.by !== meCode) return { error: '내가 쓴 것만 지울 수 있어요' };
          if (it.photo) fs.rmSync(bonoPhotoFile(roomId, it.photo), { force: true });
          room.items = room.items.filter((x) => x !== it);
          note = { kind: 'del', quiet: true };
        } else if (body.op === 'toggle') {
          const it = find(String(body.id));
          if (!it || it.kind !== 'todo') return { error: '없는 항목' };
          it.done = !it.done; it.doneBy = it.done ? meCode : ''; it.doneAt = it.done ? t : 0;
          note = { kind: 'toggle', quiet: !it.done, preview: it.text.slice(0, 40) };
        } else if (body.op === 'heart') {
          const it = find(String(body.id));
          if (!it) return { error: '없는 항목' };
          const h = new Set(it.hearts || []);
          if (h.has(meCode)) h.delete(meCode); else h.add(meCode);
          it.hearts = [...h];
          note = { kind: 'heart', quiet: !h.has(meCode) };
        } else if (body.op === 'mood') {
          room.moods[meCode] = { emoji: String(body.emoji || '').slice(0, 8), text: String(body.text || '').trim().slice(0, 60), t };
          note = { kind: 'mood', preview: room.moods[meCode].emoji + ' ' + room.moods[meCode].text };
        } else {
          return { error: '알 수 없는 요청' };
        }
        room.updatedAt = Math.max(t, (room.updatedAt || 0) + 1);
        writeJson(bonoRoomFile(roomId), room);
        return { room };
      });
      if (result.error) return sendJson(res, 400, { error: result.error });
      bonoNotify(meCode, me, c, friend, note || {});
      return sendJson(res, 200, bonoView(meCode, me, c, result.room));
    }
  }
  return sendJson(res, 404, { error: 'not found' });
}

function dataPath(key) {
  return path.join(DATA_DIR, key + '.json');
}

function loadData(key) {
  try {
    const text = fs.readFileSync(dataPath(key), 'utf8');
    return merge.normalize(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

function saveData(key, data) {
  const file = dataPath(key);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// 같은 키에 대한 쓰기는 순서대로 처리한다
const queues = new Map();
function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
  return next;
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (url.pathname === '/api/version') {
    const info = latestWindows();
    if (!info) return sendJson(res, 404, { error: '설치 파일 없음' });
    return sendJson(res, 200, { version: info.version, size: info.size, url: '/download/windows' });
  }
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, time: Date.now(), realtime: true });
  }
  const s = url.pathname.match(/^\/api\/stream\/([^/]+)$/);
  if (s) {
    if (!KEY_RE.test(s[1])) return sendJson(res, 400, { error: '잘못된 동기화 코드' });
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); return res.end(); }
    return handleStream(req, res, s[1]);
  }
  const bn = url.pathname.match(/^\/api\/bono\/([^/]+)(\/.*)?$/);
  if (bn) return handleBono(req, res, url, bn[1], bn[2] || '');
  const ph = url.pathname.match(/^\/api\/photo\/([^/]+)\/([^/]+)$/);
  if (ph) return handlePhoto(req, res, ph[1], ph[2]);
  const m = url.pathname.match(/^\/api\/data\/([^/]+)$/);
  if (!m) return sendJson(res, 404, { error: 'not found' });
  const key = m[1];
  if (!KEY_RE.test(key)) return sendJson(res, 400, { error: '잘못된 동기화 코드' });

  if (req.method === 'GET') {
    const data = loadData(key);
    if (!data) return sendJson(res, 404, { error: '데이터 없음' });
    // ?since=마지막으로 받은 시각 — 그 뒤로 바뀐 게 없으면 내용 없이 204만 보낸다 (전송량 절약)
    const since = Number(url.searchParams.get('since'));
    if (since && data.updatedAt === since) { res.writeHead(204, Object.assign({ 'Cache-Control': 'no-store' }, CORS)); return res.end(); }
    return sendJson(res, 200, data);
  }

  if (req.method === 'PUT') {
    let incoming;
    try {
      const text = await readBody(req);
      incoming = JSON.parse(text);
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('bad');
    } catch (e) {
      return sendJson(res, 400, { error: '본문을 읽을 수 없음' });
    }
    let unchanged = false;
    const merged = await withLock(key, () => {
      const stored = loadData(key);
      const current = stored || merge.emptyData();
      const result = merge.mergeData(current, incoming);
      // 합쳐도 서버 내용이 그대로면: 시각을 바꾸지도, 저장하지도, 다른 기기에 알리지도 않는다
      // (한 기기가 헛저장을 반복해도 다른 기기들이 덩달아 받아 가며 깜빡이지 않게)
      if (stored && merge.sameContent(result, current)) { unchanged = true; return current; }
      result.updatedAt = Math.max(result.updatedAt, Date.now());
      saveData(key, result);
      return result;
    });
    if (!unchanged) broadcast(key, { updatedAt: merged.updatedAt });
    else {
      // 진단용: 바뀐 것 없이 저장을 보낸 기기 (앱 이름/버전, 대략적인 주소)
      const ua = String(req.headers['user-agent'] || '');
      const app = ua.split('Gecko) ')[1] || ua;
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      // 보낸 기록이 서버와 어디가 다른지(분야 이름만) — 같으면 '없음'
      let diff = [];
      try {
        const a = merge.normalize(incoming), b = merge.normalize(merged);
        diff = Object.keys(b).filter((k) => k !== 'updatedAt' && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      } catch (e) { diff = ['?']; }
      console.log('[PUT 변화 없음]', new Date().toISOString(), key.slice(0, 4), app.slice(0, 120), 'lite=' + (url.searchParams.get('lite') || '0'), 'ip=' + ip.split('.').slice(0, 3).join('.') + '.x', 'diff=' + (diff.join(',') || '없음'));
    }
    // ?lite=1 — 보낸 기록과 합친 결과가 같으면 시각만 돌려준다 (다르면 전체를 보내 기기가 맞춘다)
    if (url.searchParams.get('lite') === '1' && merge.sameContent(merged, incoming)) return sendJson(res, 200, { same: true, updatedAt: merged.updatedAt });
    return sendJson(res, 200, merged);
  }

  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end();
}

// 화면 파일 버전 꼬리표: 서버가 시작될 때(=새 코드가 올라갈 때) 바뀌어 옛 파일이 섞여 쓰이지 않게 한다
const BUILD_STAMP = Date.now().toString(36);

// 윈도우 설치 파일: downloads/latest.json 의 { version, file } 을 따른다
function latestWindows() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'downloads', 'latest.json'), 'utf8'));
    if (!/^\d+\.\d+\.\d+$/.test(j.version) || !/^[A-Za-z0-9._-]+\.exe$/.test(j.file)) return null;
    const file = path.join(ROOT, 'downloads', j.file);
    return { version: j.version, file, size: fs.statSync(file).size };
  } catch (e) { return null; }
}

function handleStatic(req, res, url) {
  if (url.pathname === '/download/windows') {
    const info = latestWindows();
    if (!info) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('설치 파일이 아직 없어요'); }
    res.writeHead(200, Object.assign({
      'Content-Type': 'application/octet-stream',
      'Content-Length': info.size,
      'Content-Disposition': 'attachment; filename="planner-setup-' + info.version + '.exe"',
      'Cache-Control': 'no-cache'
    }, CORS));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(info.file).pipe(res);
  }
  const entry = STATIC[url.pathname];
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  fs.readFile(path.join(ROOT, entry.file), (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Read error');
    }
    if (entry.file === 'index.html') buf = Buffer.from(buf.toString('utf8').replace(/__V__/g, BUILD_STAMP));
    const headers = {
      'Content-Type': entry.type,
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    };
    if (entry.download) headers['Content-Disposition'] = 'attachment; filename="' + entry.download + '"';
    res.writeHead(200, headers);
    res.end(buf);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((e) => {
        console.error(e);
        sendJson(res, 500, { error: '서버 오류' });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); return res.end();
    }
    handleStatic(req, res, url);
  });
}

/**
 * 서버 시작. 데스크톱 앱(electron/main.js)과 단독 실행 양쪽에서 쓴다.
 * @param {{ port?: number, host?: string, dataDir?: string }} opts
 * @returns {Promise<{ server: import('http').Server, port: number, dataDir: string }>}
 */
function start(opts = {}) {
  if (opts.dataDir) DATA_DIR = opts.dataDir;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const port = opts.port == null ? DEFAULT_PORT : opts.port;
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host, () => {
      server.removeListener('error', reject);
      resolve({ server, port: server.address().port, dataDir: DATA_DIR });
    });
  });
}

module.exports = { start };

if (require.main === module) {
  start().then(({ port, dataDir }) => {
    console.log(`나만의 플래너: http://localhost:${port}  (데이터 폴더: ${dataDir})`);
  }).catch((e) => {
    console.error('서버를 시작할 수 없어요:', e.message);
    process.exit(1);
  });
}
