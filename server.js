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
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    'Content-Length': Buffer.byteLength(text)
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
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, time: Date.now(), realtime: true });
  }
  const s = url.pathname.match(/^\/api\/stream\/([^/]+)$/);
  if (s) {
    if (!KEY_RE.test(s[1])) return sendJson(res, 400, { error: '잘못된 동기화 코드' });
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); return res.end(); }
    return handleStream(req, res, s[1]);
  }
  const m = url.pathname.match(/^\/api\/data\/([^/]+)$/);
  if (!m) return sendJson(res, 404, { error: 'not found' });
  const key = m[1];
  if (!KEY_RE.test(key)) return sendJson(res, 400, { error: '잘못된 동기화 코드' });

  if (req.method === 'GET') {
    const data = loadData(key);
    if (!data) return sendJson(res, 404, { error: '데이터 없음' });
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
    const merged = await withLock(key, () => {
      const current = loadData(key) || merge.emptyData();
      const result = merge.mergeData(current, incoming);
      result.updatedAt = Math.max(result.updatedAt, Date.now());
      saveData(key, result);
      return result;
    });
    broadcast(key, { updatedAt: merged.updatedAt });
    return sendJson(res, 200, merged);
  }

  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end();
}

// 화면 파일 버전 꼬리표: 서버가 시작될 때(=새 코드가 올라갈 때) 바뀌어 옛 파일이 섞여 쓰이지 않게 한다
const BUILD_STAMP = Date.now().toString(36);

function handleStatic(req, res, url) {
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
