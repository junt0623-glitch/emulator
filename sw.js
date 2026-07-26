/* カートリッジ棚 — オフライン用 Service Worker
   ・アプリ本体（index.html）を保存
   ・EmulatorJS の本体スクリプト/CSS/翻訳を保存
   ・コア本体（/cores/）は EmulatorJS 自身が IndexedDB に保存するので二重に持たない */
const SHELL = "shell-v4";
const FRAME = "ejs-frame-v4";
const CDN   = "https://cdn.emulatorjs.org/";

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(["./", "./index.html"]))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== SHELL && n !== FRAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isFramework(url) {
  if (!url.startsWith(CDN)) return false;
  if (url.includes("/cores/")) return false;          // 巨大なコアは対象外
  return /\.(js|css|json|svg|png|woff2?)(\?|$)/.test(url);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;

  // アプリ本体：キャッシュ優先、裏で更新
  if (req.mode === "navigate" || url.startsWith(self.registration.scope)) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // EmulatorJS 本体：キャッシュ優先
  if (isFramework(url)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        caches.open(FRAME).then(c => c.put(req, res.clone()));
        return res;
      }))
    );
  }
});
