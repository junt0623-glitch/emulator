/* カートリッジ棚 — オフライン用 Service Worker
   ・アプリ本体（index.html）を保存
   ・CDN(EmulatorJS)から来たものは【コア本体も含めて全部】保存する

   以前は「コアは EmulatorJS 自身が IndexedDB に保存するので二重に持たない」
   としていたが、それだと オフラインで動くかどうかが EmulatorJS 内部の
   キャッシュ実装（版数チェックのために通信するか等）に依存してしまい、
   実際にオフラインで起動しなかった。こちらで全部持てば依存しなくなる。
   容量は増えるが、確実にオフラインで動くことを優先する。 */

/* アプリ本体のキャッシュ。index.html / sw.js を更新したらここだけ上げる */
const SHELL = "shell-v13";

/* EmulatorJS 本体のキャッシュ。
   ここに版数を付けて上げると activate のときに中身が消え、
   「オンラインで一度起動したのに、オフラインで起動しない」状態になる。
   CDN の URL は /stable/ 配下で固定なので、名前は固定のままにする。 */
const FRAME = "ejs-frame";

const CDN  = "https://cdn.emulatorjs.org/";
const KEEP = [SHELL, FRAME];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(["./", "./index.html"]))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

/* 旧 ejs-frame-vN の中身を固定名のキャッシュへ引き継ぐ。
   この更新自体でオフラインを失わないようにするため */
async function adoptOldFrames() {
  const names = await caches.keys();
  const olds = names.filter(n => n !== FRAME && n.startsWith("ejs-frame"));
  if (!olds.length) return;
  const dest = await caches.open(FRAME);
  for (const n of olds) {
    const src = await caches.open(n);
    for (const req of await src.keys()) {
      if (await dest.match(req)) continue;
      const res = await src.match(req);
      if (res) await dest.put(req, res);
    }
  }
}

self.addEventListener("activate", e => {
  e.waitUntil(
    adoptOldFrames()
      .catch(() => {})
      .then(() => caches.keys())
      .then(k => Promise.all(k.filter(n => !KEEP.includes(n)).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/* 拡張子で絞ると「その1ファイルだけ未キャッシュでオフライン起動できない」が起きる。
   CDN から来たものは種類を問わず全部保存する */
function isFramework(url) {
  return url.startsWith(CDN);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;

  // アプリ本体：キャッシュ優先、裏で更新
  if (req.mode === "navigate" || url.startsWith(self.registration.scope)) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      });
      if (hit) { net.catch(() => {}); return hit; }
      try { return await net; }
      catch (err) {
        // 未キャッシュのURLでも、本体が残っていればそれを返す
        const shell = await cache.match("./index.html", { ignoreSearch: true });
        if (shell) return shell;
        throw err;
      }
    })());
    return;
  }

  // EmulatorJS（コア本体を含む）：キャッシュ優先
  // CDN は別オリジンで opaque なレスポンス（status 0）になるため res.ok は見ない
  if (isFramework(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(FRAME);
      // 完全一致 →（版数つきURL等のために）検索文字列とVaryを無視して再照合
      let hit = await cache.match(req);
      if (!hit) hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      // 部分応答(206)は保存できないので弾く。容量超過などは握りつぶす
      if (res && res.status !== 206) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
