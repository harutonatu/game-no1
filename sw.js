// オフラインでも遊べるようにするための Service Worker（ゲーム集「ゆびあそび」全体で1つ）
// ファイルを更新したら CACHE_VERSION を上げる（古いキャッシュを削除させるため）
const CACHE_VERSION = "v10";
const APP_PREFIX = "yubiasobi-app-";
const APP_CACHE = `${APP_PREFIX}${CACHE_VERSION}`;
const FONT_CACHE = "yubiasobi-fonts";
const FONT_LIMIT = 20;          // フォント用キャッシュの上限（超えたら古いものから削除）
const NAV_TIMEOUT = 3000;       // ページの移動でネットワークを待つ時間(ms)。過ぎたらキャッシュを使う
// 以前の名前（ブロックパズル単体だったころ）のキャッシュ。activate で削除する
const OLD_APP_PREFIX = "blockpuzzle-app-";
const OLD_FONT_CACHE = "blockpuzzle-fonts";
const APP_FILES = [
  "./",
  "./index.html",
  "./games/blocks/",
  "./games/blocks/index.html",
  "./games/2048/",
  "./games/2048/index.html",
  "./common/sfx.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// 事前キャッシュは、ブラウザの HTTP キャッシュを通さずにサーバーから取り直す（古いファイルを入れないため）
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) =>
        k.startsWith(OLD_APP_PREFIX) ||
        k === OLD_FONT_CACHE ||
        (k.startsWith(APP_PREFIX) && k !== APP_CACHE)
      ).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 同じオリジンのファイルは、クエリ文字列を除いた URL をキーにする（?utm= などで重複させない）
function keyOf(url) {
  return url.origin + url.pathname;
}
function store(key, res) {
  // 正常な応答だけを保存する（リダイレクトを経た応答は、ページの移動に使うと Safari でエラーになるため入れない）
  if (!res || !res.ok || res.type !== "basic" || res.redirected) return Promise.resolve();
  const copy = res.clone();
  return caches.open(APP_CACHE).then((c) => c.put(key, copy)).catch(() => {});
}
// メニューの URL（この Service Worker の scope）
function menuURL() {
  return new URL("./", self.registration.scope).href;
}
function isMenu(key) {
  const m = menuURL();
  return key === m || key === m + "index.html";
}

// ページの移動：ネットワークを約3秒待ち、返らなければキャッシュを使う。
// ネットワークの応答が後から来たら、キャッシュの更新に使う。
// キャッシュにもないとき（存在しないパスなど）は、メニューへリダイレクトする
// （存在しないパスで index.html をそのまま返すと、相対パスがずれてリンクや画像が壊れるため）
function navigate(e, req, key) {
  const net = fetch(req).then((res) => { e.waitUntil(store(key, res)); return res; });
  e.waitUntil(net.catch(() => {}));
  const fromCache = () => caches.match(key);
  const fallback = () => (isMenu(key) ? Response.error() : Response.redirect(menuURL(), 302));

  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (!done) { done = true; resolve(res); } };
    const timer = setTimeout(() => {
      fromCache().then((hit) => { if (hit) finish(hit); });
    }, NAV_TIMEOUT);
    net.then((res) => { clearTimeout(timer); finish(res); })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => finish(hit || fallback()), () => finish(fallback()));
      });
  });
}

// フォント用キャッシュが上限を超えたら、古いもの（先に入れたもの）から削除する
function trimFonts(c) {
  return c.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - FONT_LIMIT)).map((k) => c.delete(k))));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const key = keyOf(url);
    if (req.mode === "navigate") {
      e.respondWith(navigate(e, req, key));
      return;
    }
    // 画像などのファイル：まずネットから最新を取り、つながらなければ保存済みのもの。どちらもなければエラー
    e.respondWith(
      fetch(req)
        .then((res) => { e.waitUntil(store(key, res)); return res; })
        .catch(() => caches.match(key).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Google Fonts：保存済みがあればそれを使い、裏で更新する
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(FONT_CACHE).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              if (res.ok || res.type === "opaque") e.waitUntil(c.put(req, res.clone()).then(() => trimFonts(c)).catch(() => {}));
              return res;
            })
            .catch(() => hit || Response.error());
          if (hit) e.waitUntil(net.catch(() => {}));
          return hit || net;
        })
      )
    );
  }
});
