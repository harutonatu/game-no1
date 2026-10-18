// オフラインでも遊べるようにするための Service Worker（ゲーム集「ゆびあそび」全体で1つ）
// ファイルを更新したら CACHE_VERSION を上げる（古いキャッシュを削除させるため）。
// メニューに出す版は common/version.js と二重に持つ（sw.js 本体のバイトを変えて、iOS Safari でも更新を確実に検知させるため）。
// 上げるときは version.js の version・date も一緒に変える（テスト L10 が一致を強制する）
const CACHE_VERSION = "v18";
const APP_PREFIX = "yubiasobi-app-";
const APP_CACHE = `${APP_PREFIX}${CACHE_VERSION}`;
const FONT_CACHE = "yubiasobi-fonts";
const FONT_LIMIT = 20;          // フォント用キャッシュの上限（超えたら古いものから削除）
const NAV_TIMEOUT = 3000;       // ページの移動でネットワークを待つ時間(ms)。過ぎたらキャッシュを使う
const FILE_TIMEOUT = 3000;      // キャッシュにないファイル（JS・画像など）でネットワークを待つ時間(ms)。過ぎたらエラー
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
  "./games/kiritori/",
  "./games/kiritori/index.html",
  "./games/irocode/",
  "./games/irocode/index.html",
  "./games/irocode/logic.js",
  "./games/zenmai/",
  "./games/zenmai/index.html",
  "./games/zenmai/logic.js",
  "./games/zenmai/stages.js",
  "./games/zenmai/render.js",
  "./games/zenmai/input.js",
  "./games/pikatto/",
  "./games/pikatto/index.html",
  "./games/pikatto/logic.js",
  "./games/pikatto/input.js",
  "./games/hashi/",
  "./games/hashi/index.html",
  "./games/hashi/course.js",
  "./games/hashi/logic.js",
  "./games/hashi/render.js",
  "./games/hashi/input.js",
  "./games/hashi/main.js",
  "./common/sfx.js",
  "./common/version.js",
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
// 正常な応答か（リダイレクトを経た応答は、ページの移動に使うと Safari でエラーになるため入れない）
function usable(res) {
  return !!res && res.ok && res.type === "basic" && !res.redirected;
}
function sameBody(a, b) {
  return Promise.all([a.arrayBuffer(), b.arrayBuffer()]).then(([x, y]) => {
    if (x.byteLength !== y.byteLength) return false;
    const p = new Uint8Array(x), q = new Uint8Array(y);
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
    return true;
  });
}

// サーバーに、このキャッシュ（install でまとめて入れた版）と中身の違うファイルがあると分かったら true。
// そのあとは JS などもネットワークを優先する（新しい HTML に古い JS が混ざらないように）。
// 新しい sw.js が有効になると、この値ごと入れ替わる
let newerOnServer = false;
let checking = Promise.resolve();   // ページの HTML とキャッシュとの比較（JS などはこれを待ってから取り方を決める）

// ネットワークの応答でキャッシュを更新する。ただし、キャッシュ済みのものと中身が違うとき（＝新しい版が出ている）は入れない。
// 1つのキャッシュに版の違うファイルが混ざらないようにするため（新しい版は、新しい sw.js の install でまとめて入る）
function store(key, res) {
  if (!usable(res)) return Promise.resolve();
  const copy = res.clone(), probe = res.clone();
  return caches.open(APP_CACHE).then((c) => c.match(key).then((hit) => (hit ? sameBody(hit, probe) : true).then((same) => {
    if (same) return c.put(key, copy);
    newerOnServer = true;
    return self.registration.update().catch(() => {});
  }))).catch(() => {});
}
// ms で打ち切る fetch（打ち切ったら失敗にする）
function fetchWithin(req, ms, init = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return fetch(req, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
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
  const net = fetch(req).then((res) => {
    const check = store(key, res);
    checking = check;
    e.waitUntil(check);
    return res;
  });
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

// JS・CSS・画像・manifest など：キャッシュにあればすぐそれを返し、裏でネットワークから取り直してキャッシュを更新する
// （stale-while-revalidate）。キャッシュにないときはネットワークを約3秒まで待ち、だめならエラー。
// ただし、サーバーに新しい版が出ているのが分かったら（newerOnServer）、ネットワークを約3秒まで待ち、だめならキャッシュ
function asset(e, req, key) {
  // 直前のページの移動で HTML とキャッシュを比べている途中なら、その結果を待つ（長くても 1 秒）
  const ready = Promise.race([checking, new Promise((r) => setTimeout(r, 1000))]);
  return ready.then(() => caches.match(key)).then((hit) => {
    if (newerOnServer || !hit) {
      return fetchWithin(req, FILE_TIMEOUT)
        .then((res) => { e.waitUntil(store(key, res)); return res; })
        .catch(() => hit || Response.error());
    }
    // 裏での取り直しは打ち切らない（遅い回線でも、届けばキャッシュを更新する）。HTTP キャッシュは確認だけ（no-cache）
    e.waitUntil(fetch(req, { cache: "no-cache" }).then((res) => store(key, res)).catch(() => {}));
    return hit;
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
    e.respondWith(asset(e, req, key));
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
