/* 휴대폰 설치형(PWA) 서비스 워커
 * - 화면 파일(index/style/app/merge)은 항상 서버에서 먼저 받고, 서버가 안 될 때만 저장본을 쓴다.
 *   (옛 화면 + 새 동작 파일이 섞여 깨지는 일을 막기 위함)
 * - 아이콘 같은 정적 파일은 저장본을 먼저 쓴다.
 * - /api/ 요청은 절대 캐시하지 않는다.
 */
var VERSION = 'planner-v5';
var PRECACHE = ['/', '/assets/icon.png', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(PRECACHE).catch(function () { /* 일부 실패해도 설치 진행 */ }); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isShell(url) {
  return url.pathname === '/' || url.pathname === '/index.html' ||
    /\.(js|css|webmanifest)$/.test(url.pathname);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;

  if (req.mode === 'navigate' || isShell(url)) {
    // 서버 우선: 받으면 저장하고 돌려준다. 실패하면(오프라인) 저장본.
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || (req.mode === 'navigate' ? caches.match('/') : undefined);
        });
      })
    );
    return;
  }

  // 아이콘·이미지: 저장본 우선, 없으면 받아서 저장
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
