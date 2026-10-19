// ゆびあそび デバッグ表示（全ページで読み込む。ふだんは何もしない）
//
// ・有効にする：URL に ?debug=1 を付けて開く。そのタブの sessionStorage に覚えるので、メニュー→ゲームと移動しても有効のまま。
// ・やめる：?debug=0 を付けて開くか、パネルの「デバッグを終わる」。
// ・無効のときは、DOM・console・イベントに一切触れずに終わる（window.YubiDebug も作らない）。
//
// 中は2つに分かれている（詳しくは docs/debug.md）。
//   1. コア window.YubiDebug … ログの記録・購読（subscribe）・命令（command 名 → 関数）の登録と実行
//   2. 表示（オーバーレイ）   … コアの公開している関数だけを使う「運び役」の1つ
// 将来の遠隔操作は、もう1つの運び役（transport：WebSocket など）が YubiDebug.run(命令, 引数) を呼び、
// YubiDebug.subscribe でログを受け取るだけで足せる。命令は登録済みの関数だけを呼ぶ（文字列を eval しない）。
(function () {
  "use strict";
  var KEY = "yubi.debug";
  var enabled = false;
  try {
    var q = /[?&]debug=([^&#]*)/.exec(location.search);
    if (q && q[1] === "1") { sessionStorage.setItem(KEY, "1"); enabled = true; }
    else if (q && q[1] === "0") { sessionStorage.removeItem(KEY); }
    else enabled = sessionStorage.getItem(KEY) === "1";
  } catch (e) { enabled = false; }   // sessionStorage が使えない（プライベート・保存不可）ときは有効にしない
  if (!enabled || window.YubiDebug) return;

  try {
    var core = createCore();
    window.YubiDebug = core.api;
    registerCommands(core.api);
    startOverlay(core.api);
  } catch (e) { /* デバッグ表示が壊れても、ゲームは止めない */ }

  // ================================================================
  // 1. コア
  // ================================================================
  function createCore() {
    var MAX = 300;                   // 記録するログの上限（超えたら古いものから捨てる）
    var MAX_TEXT = 2000;             // 1件の文字数の上限
    var t0 = Date.now();
    var entries = [], seq = 0, errorCount = 0, dropped = 0;
    var listeners = [];
    var commands = Object.create(null);
    var cleanups = [];
    var origConsole = {};
    var busy = false;                // 記録中の再入を防ぐ（記録の処理が console を呼んでも無限にならない）
    var me = currentScript();

    function currentScript() {
      var s = document.currentScript;
      return s && s.src ? s.src : "";
    }
    function clip(s) { s = String(s); return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "…（" + s.length + " 文字）" : s; }
    function show(v) {
      if (typeof v === "string") return v;
      if (v instanceof Error) {
        var head = (v.name || "Error") + ": " + v.message;
        var st = v.stack ? String(v.stack) : "";
        return st.indexOf(head) === 0 ? st : head + (st ? "\n" + st : "");   // Chrome の stack は先頭に「名前: 文」が入っている
      }
      if (v === undefined) return "undefined";
      if (typeof v === "function") return "[function " + (v.name || "") + "]";
      if (v && typeof v === "object" && typeof v.nodeType === "number") return "[" + describe(v) + "]";
      try { var j = JSON.stringify(v); return j === undefined ? String(v) : j; } catch (e) { return String(v); }
    }
    function emit(ev) {
      for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev); } catch (e) { /* 購読側の失敗は無視 */ } }
    }
    function add(level, source, parts) {
      if (busy) return null;
      busy = true;
      try {
        var msg = clip(parts.map(show).join(" "));
        var e = { id: ++seq, t: Date.now() - t0, time: new Date().toISOString(), level: level, source: source, msg: msg };
        entries.push(e);
        if (entries.length > MAX) { entries.shift(); dropped++; }
        if (level === "error") errorCount++;
        emit({ type: "log", entry: e, errors: errorCount });
        return e;
      } catch (err) { return null; } finally { busy = false; }
    }
    function on(target, type, fn, opt) { target.addEventListener(type, fn, opt); cleanups.push(function () { target.removeEventListener(type, fn, opt); }); }

    // ---- 拾う：実行時エラー・読み込み失敗・Promise の失敗・console ----
    on(window, "error", function (ev) {
      var t = ev.target;
      if (t && t !== window && t.nodeType === 1) {      // <script>・<img> などの読み込み失敗（捕捉段階でしか来ない）
        add("error", "load", ["読み込み失敗: <" + t.tagName.toLowerCase() + "> " + (t.src || t.href || "")]);
        return;
      }
      var where = ev.filename ? " (" + ev.filename.replace(location.origin, "") + ":" + ev.lineno + ":" + ev.colno + ")" : "";
      add("error", "onerror", [ev.error instanceof Error ? ev.error : String(ev.message || "error") + where]);
    }, true);
    on(window, "unhandledrejection", function (ev) {
      add("error", "rejection", ["Promise の失敗（catch なし）:", ev.reason]);
    });
    ["error", "warn", "log", "info"].forEach(function (m) {
      var orig = console[m];
      if (typeof orig !== "function") return;
      origConsole[m] = orig;
      console[m] = function () {
        var a = Array.prototype.slice.call(arguments);
        add(m, "console", a);
        return orig.apply(console, a);    // 元の動作（開発ツールへの表示）はそのまま
      };
    });

    // ---- 命令 ----
    function command(name, fn, meta) {
      if (typeof name !== "string" || !/^[a-z][a-zA-Z0-9_-]*$/.test(name) || typeof fn !== "function") throw new Error("命令の登録の形が違う: " + name);
      commands[name] = { fn: fn, desc: (meta && meta.desc) || "", args: (meta && meta.args) || "" };
    }
    function list() {
      return Object.keys(commands).sort().map(function (n) { return { name: n, desc: commands[n].desc, args: commands[n].args }; });
    }
    // JSON にできる形へ（循環・関数・DOM・巨大な値で落ちない）。運び役がそのまま送れるようにする
    function plain(v) {
      var seen = [];
      try {
        var s = JSON.stringify(v, function (k, x) {
          if (typeof x === "function") return "[function]";
          if (x && typeof x === "object") {
            if (typeof x.nodeType === "number") return "[" + describe(x) + "]";
            if (x instanceof Error) return show(x);
            if (seen.indexOf(x) >= 0) return "[循環]";
            seen.push(x);
          }
          if (typeof x === "number" && !isFinite(x)) return String(x);
          return x;
        });
        return s === undefined ? null : JSON.parse(s);
      } catch (e) { return String(v); }
    }
    // 命令を実行する。必ず Promise<{ ok, result } | { ok:false, error }> を返し、例外を外へ投げない
    function run(name, args) {
      var started = Date.now();
      var done = function (r) {
        r.command = String(name); r.ms = Date.now() - started;
        emit({ type: "command", name: String(name), ok: r.ok, ms: r.ms });
        return r;
      };
      if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(commands, name)) {
        return Promise.resolve(done({ ok: false, error: "そのような命令はない: " + String(name), commands: Object.keys(commands).sort() }));
      }
      try {
        return Promise.resolve(commands[name].fn(args === undefined ? {} : args, api))
          .then(function (res) { return done({ ok: true, result: plain(res) }); },
                function (err) { return done({ ok: false, error: show(err) }); });
      } catch (err) {
        return Promise.resolve(done({ ok: false, error: show(err) }));
      }
    }
    function subscribe(fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }
    function logs(filter) {
      var lv = filter && filter.level;
      var since = (filter && filter.since) || 0;
      return entries.filter(function (e) { return (!lv || e.level === lv) && e.id > since; }).map(function (e) { return Object.assign({}, e); });
    }
    function clear() { entries.length = 0; errorCount = 0; dropped = 0; emit({ type: "clear", errors: 0 }); }
    // デバッグをやめる：console を元に戻し、イベントを外し、覚えた印を消す（表示は "stop" を受けて自分で消える）
    function stop() {
      try { sessionStorage.removeItem(KEY); } catch (e) { /* 無視 */ }
      Object.keys(origConsole).forEach(function (m) { console[m] = origConsole[m]; });
      cleanups.splice(0).forEach(function (f) { try { f(); } catch (e) { /* 無視 */ } });
      emit({ type: "stop" });
      listeners.length = 0;
      try {
        if (/[?&]debug=1/.test(location.search) && history.replaceState) {
          var s = location.search.replace(/([?&])debug=1(&|$)/, function (_, a, b) { return b ? a : ""; }).replace(/[?&]$/, "");
          history.replaceState(history.state, "", location.pathname + s + location.hash);
        }
      } catch (e) { /* 無視 */ }
      try { delete window.YubiDebug; } catch (e) { window.YubiDebug = undefined; }
    }

    var api = {
      enabled: true,
      version: 1,                      // この窓口（命令と戻り値の形）の版。形を変えたら上げる
      startedAt: new Date(t0).toISOString(),
      scriptURL: me,
      log: function (level, msg) { return add(["error", "warn", "log", "info"].indexOf(level) >= 0 ? level : "log", "app", Array.prototype.slice.call(arguments, 1)); },
      logs: logs,
      errorCount: function () { return errorCount; },
      dropped: function () { return dropped; },
      clear: clear,
      subscribe: subscribe,
      command: command,
      commands: list,
      run: run,
      stop: stop,
      describe: describe,
    };
    return { api: api };
  }

  // 要素を短い文字で表す（例 button#helpBtn.tool "?"）
  function describe(el) {
    if (!el || el.nodeType !== 1) return String(el && el.nodeName || el);
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    var label = el.getAttribute("aria-label") || el.getAttribute("data-cmd") || el.getAttribute("data-action") || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 16);
    if (label) s += ' "' + label + '"';
    return s;
  }

  // ================================================================
  // 命令（どれもコアの command で登録する。表示も遠隔も同じものを呼ぶ）
  // ================================================================
  function registerCommands(D) {
    var r1 = function (x) { return Math.round(x * 10) / 10; };

    D.command("help", function () { return D.commands(); }, { desc: "命令の一覧", args: "なし" });

    D.command("logs", function (a) { return { errors: D.errorCount(), dropped: D.dropped(), entries: D.logs(a) }; },
      { desc: "記録したログ", args: "{ level?: 'error'|'warn'|'log'|'info', since?: 前回の最後の id }" });

    D.command("info", function () { return info(); },
      { desc: "端末と環境（画面・safe-area・ホーム画面アプリか・Service Worker・版・保存データのキー）", args: "なし" });

    D.command("layout", function (a) { return layout(a); },
      { desc: "要素の位置・大きさ・画面外・重なり・文字の大きさ", args: "{ selector?: CSS セレクタ（既定は押せる要素すべて）, limit?: 件数（既定 60） } または セレクタの文字列" });

    D.command("state", function () { return state(); },
      { desc: "ゲームがテスト用に公開している窓口（window.〇〇Game の getState / snapshot）の中身", args: "なし" });

    D.command("storage", function (a) { return storage(a || {}); },
      { desc: "localStorage の読み書き（このページのゲームの保存データ）", args: "{ op: 'keys'|'get'|'set'|'remove', key?, value? }" });

    D.command("tap", function (a) { return tap(a || {}); },
      { desc: "座標か要素に合成のポインタイベントを送る（人の操作扱いにはならない）", args: "{ x, y } または { selector, index? }" });

    D.command("report", function () { return report(); }, { desc: "コピー用の文字（環境とログをまとめたもの）", args: "なし" });

    // ---- safe-area（env(safe-area-inset-*)）を測る ----
    function safeArea() {
      var host = document.body || document.documentElement;
      var p = document.createElement("div");
      p.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
        "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
      host.appendChild(p);
      var cs = getComputedStyle(p);
      var r = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
      host.removeChild(p);
      return r;
    }
    D.safeArea = safeArea;

    function info() {
      var vv = window.visualViewport;
      var keys = [];
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); keys.push({ key: k, length: (localStorage.getItem(k) || "").length }); } }
      catch (e) { keys = "読めない: " + e.message; }
      keys.sort && keys.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
      var mm = function (q) { try { return matchMedia(q).matches; } catch (e) { return null; } };
      var out = {
        url: location.href,
        title: document.title,
        time: new Date().toString(),
        userAgent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        screen: { w: screen.width, h: screen.height },
        window: { innerWidth: innerWidth, innerHeight: innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
        visualViewport: vv ? { w: r1(vv.width), h: r1(vv.height), scale: r1(vv.scale), offsetTop: r1(vv.offsetTop), offsetLeft: r1(vv.offsetLeft) } : null,
        devicePixelRatio: window.devicePixelRatio,
        orientation: (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? "landscape" : "portrait"),
        safeArea: safeArea(),
        standalone: navigator.standalone === true || mm("(display-mode: standalone)") === true,
        reducedMotion: mm("(prefers-reduced-motion: reduce)"),
        darkMode: mm("(prefers-color-scheme: dark)"),
        audio: typeof AudioContext !== "undefined" ? "AudioContext" : typeof webkitAudioContext !== "undefined" ? "webkitAudioContext" : "なし",
        localStorage: keys,
        appVersion: null,
        serviceWorker: null,
      };
      return Promise.all([appVersion(), swInfo()]).then(function (r) { out.appVersion = r[0]; out.serviceWorker = r[1]; return out; });
    }
    // 版：メニューでは YUBI_VERSION、ゲームでは common/version.js の文字を読む（実行はしない）
    function appVersion() {
      if (window.YUBI_VERSION) return Promise.resolve({ version: window.YUBI_VERSION.version, date: window.YUBI_VERSION.date, from: "YUBI_VERSION" });
      if (!D.scriptURL || typeof fetch !== "function") return Promise.resolve(null);
      return fetch(new URL("version.js", D.scriptURL).href).then(function (res) { return res.ok ? res.text() : ""; }).then(function (t) {
        var v = /version:\s*"([^"]*)"/.exec(t), d = /date:\s*"([^"]*)"/.exec(t);
        return v ? { version: v[1], date: d ? d[1] : null, from: "version.js" } : null;
      }).catch(function (e) { return { error: String(e && e.message || e) }; });
    }
    function swInfo() {
      var sw = navigator.serviceWorker;
      if (!sw) return Promise.resolve({ supported: false, note: window.isSecureContext ? "" : "https でないので Service Worker は動かない" });
      var c = sw.controller;
      var res = { supported: true, controlled: !!c, controller: c ? { scriptURL: c.scriptURL, state: c.state } : null };
      var regP = sw.getRegistration ? sw.getRegistration().then(function (r) {
        res.registration = r ? { scope: r.scope, active: r.active && r.active.state, waiting: r.waiting && r.waiting.state, installing: r.installing && r.installing.state } : null;
      }).catch(function (e) { res.registration = "読めない: " + e.message; }) : Promise.resolve();
      var cacheP = window.caches ? caches.keys().then(function (ks) {
        res.caches = ks;
        var app = ks.filter(function (k) { return k.indexOf("yubiasobi-app-") === 0; });
        res.cacheVersion = app.length ? app.map(function (k) { return k.slice("yubiasobi-app-".length); }).join(",") : null;
      }).catch(function (e) { res.caches = "読めない: " + e.message; }) : Promise.resolve();
      return Promise.all([regP, cacheP]).then(function () { return res; });
    }

    // ---- layout ----
    var PRESSABLE = "button, a[href], input, select, textarea, [role=button], [data-cmd], [data-action]";
    function visible(el) {
      if (typeof el.checkVisibility === "function") { if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false; }
      else if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    D.visible = visible;
    function layout(a) {
      if (typeof a === "string") a = { selector: a };
      a = a || {};
      var sel = a.selector || PRESSABLE;
      var limit = Math.max(1, Math.min(500, Number(a.limit) || 60));
      var els;
      try { els = Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { throw new Error("セレクタが正しくない: " + sel); }
      els = els.filter(function (el) { return !el.closest("#yubi-debug"); });
      var sa = safeArea(), W = innerWidth, H = innerHeight;
      var items = els.slice(0, limit).map(function (el) {
        var q = el.getBoundingClientRect(), cs = getComputedStyle(el);
        var vis = visible(el);
        var it = {
          el: describe(el), visible: vis,
          x: r1(q.left), y: r1(q.top), w: r1(q.width), h: r1(q.height),
          fontSize: parseFloat(cs.fontSize) || null,
          pointerEvents: cs.pointerEvents,
          offscreen: vis && (q.left < -0.5 || q.top < -0.5 || q.right > W + 0.5 || q.bottom > H + 0.5),
          inUnsafe: vis && (q.left < sa.left - 0.5 || q.top < sa.top - 0.5 || q.right > W - sa.right + 0.5 || q.bottom > H - sa.bottom + 0.5),
          clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
          under44: vis && el.matches(PRESSABLE) && (q.width < 43.5 || q.height < 43.5),
          overlaps: [],
        };
        // 中心の上に別の要素が乗っていないか（ふさがれていると押せない）
        if (vis) {
          var top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          it.coveredBy = top && top !== el && !el.contains(top) && !top.contains(el) ? describe(top) : null;
        }
        it._r = q;
        return it;
      });
      for (var i = 0; i < items.length; i++) for (var j = i + 1; j < items.length; j++) {
        var A = items[i], B = items[j];
        if (!A.visible || !B.visible) continue;
        var ea = els[i], eb = els[j];
        if (ea.contains(eb) || eb.contains(ea)) continue;
        if (A._r.left < B._r.right - 0.5 && B._r.left < A._r.right - 0.5 && A._r.top < B._r.bottom - 0.5 && B._r.top < A._r.bottom - 0.5) { A.overlaps.push(j); B.overlaps.push(i); }
      }
      items.forEach(function (it) { delete it._r; });
      return {
        selector: sel, count: els.length, shown: items.length,
        viewport: { w: W, h: H }, safeArea: sa,
        scroll: { x: scrollX, y: scrollY, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, hscroll: document.documentElement.scrollWidth > W },
        items: items,
      };
    }

    // ---- state：window.〇〇Game の getState() / snapshot() を読む（読むだけ） ----
    function state() {
      var found = [];
      Object.getOwnPropertyNames(window).forEach(function (k) {
        if (!/^[A-Z][A-Za-z0-9]*Game$/.test(k)) return;
        var g; try { g = window[k]; } catch (e) { return; }
        if (!g || typeof g !== "object") return;
        var fn = typeof g.getState === "function" ? "getState" : typeof g.snapshot === "function" ? "snapshot" : null;
        var item = { name: k, via: fn, methods: Object.keys(g).filter(function (m) { return typeof g[m] === "function"; }) };
        if (fn) { try { item.state = g[fn](); } catch (e) { item.error = String(e && e.message || e); } }
        found.push(item);
      });
      return { games: found, note: found.length ? "" : "このページはゲームの窓口（window.〇〇Game）を公開していない" };
    }

    // ---- storage ----
    function storage(a) {
      var op = a.op || "keys";
      if (op === "keys") { var ks = []; for (var i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); return ks.sort(); }
      if (typeof a.key !== "string" || !a.key) throw new Error("key（文字列）が必要");
      if (op === "get") return { key: a.key, value: localStorage.getItem(a.key) };
      if (op === "set") {
        if (a.value === undefined) throw new Error("value が必要");
        var v = typeof a.value === "string" ? a.value : JSON.stringify(a.value);
        localStorage.setItem(a.key, v);
        return { key: a.key, value: v, note: "ゲームは多くの場合、開き直したときに読み直す" };
      }
      if (op === "remove") { localStorage.removeItem(a.key); return { key: a.key, removed: true }; }
      throw new Error("op は keys・get・set・remove のどれか");
    }

    // ---- tap：合成のポインタイベント ----
    // 注意：ここで送るイベントは isTrusted が false（スクリプトが作ったもの）。
    //   ・ブラウザは「人の操作」とみなさないので、効果音の開始（AudioContext の resume）・全画面・クリップボードなどは動かない。
    //   ・ダブルタップ拡大・スクロール・:active の見た目など、ブラウザ自身の動きは起きない（抑止できているかも確かめられない）。
    //   ・ページの pointer / mouse / click の処理を呼ぶことはできる（画面のどこに何があり、押すと何が起きるかの確認に使う）。
    function tap(a) {
      var x = a.x, y = a.y, el = null;
      if (a.selector) {
        var list = Array.prototype.slice.call(document.querySelectorAll(a.selector)).filter(function (e) { return !e.closest("#yubi-debug"); });
        el = list[Number(a.index) || 0];
        if (!el) throw new Error("要素が見つからない: " + a.selector);
        var q = el.getBoundingClientRect();
        x = q.left + q.width / 2; y = q.top + q.height / 2;
      }
      if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) throw new Error("{x, y} か {selector} が必要");
      var target = document.elementFromPoint(x, y);
      if (!target) throw new Error("その座標には何もない（画面外）: " + x + "," + y);
      if (target.closest("#yubi-debug")) throw new Error("デバッグ表示の上なので送らない");
      var base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
      var pbase = Object.assign({ pointerId: 9001, pointerType: "touch", isPrimary: true, width: 20, height: 20, pressure: 0.5 }, base);
      var sent = [];
      var fire = function (Ctor, type, init) {
        if (typeof Ctor !== "function") return;
        var ev; try { ev = new Ctor(type, init); } catch (e) { return; }
        var ok = target.dispatchEvent(ev);
        sent.push(type + (ok ? "" : "(preventDefault)"));
      };
      fire(window.PointerEvent, "pointerdown", Object.assign({ buttons: 1 }, pbase));
      fire(window.MouseEvent, "mousedown", Object.assign({ buttons: 1 }, base));
      fire(window.PointerEvent, "pointerup", Object.assign({ buttons: 0 }, pbase));
      fire(window.MouseEvent, "mouseup", base);
      fire(window.MouseEvent, "click", base);
      return { x: r1(x), y: r1(y), target: describe(target), requested: el ? describe(el) : null, sent: sent, trusted: false };
    }

    // ---- report：コピー用の文字 ----
    function report() {
      return info().then(function (inf) {
        var L = [];
        L.push("ゆびあそび デバッグ報告");
        L.push("ページ: " + location.href);
        L.push("時刻: " + new Date().toString());
        if (inf.appVersion && inf.appVersion.version) L.push("版: " + inf.appVersion.version + "・" + inf.appVersion.date);
        L.push("エラー: " + D.errorCount() + " 件" + (D.dropped() ? "（古いログ " + D.dropped() + " 件は上限のため捨てた）" : ""));
        L.push("");
        L.push("--- ログ（古い順） ---");
        var es = D.logs();
        if (!es.length) L.push("（なし）");
        es.forEach(function (e) { L.push(fmtEntry(e)); });
        L.push("");
        L.push("--- 環境（info） ---");
        L.push(JSON.stringify(inf, null, 1));
        var st = state();
        if (st.games.length) { L.push(""); L.push("--- ゲームの状態（state） ---"); L.push(JSON.stringify(st.games, null, 1).slice(0, 6000)); }
        return L.join("\n");
      });
    }
  }

  function fmtEntry(e) {
    return "[+" + (e.t / 1000).toFixed(2) + "s] " + e.level.toUpperCase() + " (" + e.source + ") " + e.msg;
  }

  // ================================================================
  // 2. 表示（オーバーレイ）。コアの公開関数（subscribe・run・logs など）だけを使う
  // ================================================================
  function startOverlay(D) {
    var host, root, btn, panel, countEl, bodyEl, statusEl, timer = 0, open = false, placed = null;
    var CSS =
      ":host{all:initial}" +
      "*{box-sizing:border-box;font-family:-apple-system,system-ui,'Hiragino Sans',sans-serif;-webkit-tap-highlight-color:transparent}" +
      "button{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none}" +
      ".bug{position:fixed;z-index:2147483647;min-width:44px;height:44px;padding:0 6px;border-radius:22px;border:2px solid rgba(255,255,255,.7);" +
      "background:rgba(30,34,48,.82);color:#fff;font-size:13px;font-weight:700;line-height:40px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)}" +
      ".bug.err{background:rgba(200,40,40,.9)}" +
      ".panel{position:fixed;z-index:2147483647;display:flex;flex-direction:column;background:#141824;color:#e9ecf5;border:1px solid #4a5270;border-radius:12px;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:13px;overflow:hidden;" +
      "left:calc(env(safe-area-inset-left) + 8px);right:calc(env(safe-area-inset-right) + 8px);top:calc(env(safe-area-inset-top) + 8px);bottom:calc(env(safe-area-inset-bottom) + 8px)}" +
      ".panel[hidden]{display:none}" +
      ".bar{display:flex;flex-wrap:wrap;gap:6px;padding:8px;border-bottom:1px solid #2c3350;align-items:center}" +
      ".bar h2{margin:0 auto 0 4px;font-size:15px}" +
      ".bar button{min-height:44px;min-width:44px;padding:0 12px;border-radius:10px;border:1px solid #59618a;background:#262c42;font-size:14px}" +
      ".bar button.danger{border-color:#a04848;background:#3a2026}" +
      ".status{padding:4px 12px;font-size:12px;color:#9fe0a8;min-height:20px}" +
      ".body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-x pan-y;padding:4px 12px 12px}" +
      ".body h3{font-size:14px;margin:12px 0 4px}" +
      ".row{font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;padding:3px 0;border-bottom:1px solid #222842}" +
      ".row.error{color:#ff9a9a}.row.warn{color:#ffd27a}" +
      "pre{font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0}" +
      "textarea{width:100%;height:160px;font-size:12px;font-family:ui-monospace,Menlo,monospace}";

    function mount() {
      if (host || !document.documentElement) return;
      host = document.createElement("div");
      host.id = "yubi-debug";
      // 外側は大きさ 0 の固定位置（ページの並びに影響しない）。中身は Shadow DOM でゲームの CSS と混ざらない
      host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483647;";
      root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      var st = document.createElement("style"); st.textContent = CSS; root.appendChild(st);
      btn = document.createElement("button");
      btn.className = "bug"; btn.type = "button"; btn.setAttribute("data-debug", "toggle");
      btn.style.left = "-200px"; btn.style.top = "-200px";       // 置き場所が決まるまでは画面外
      root.appendChild(btn);
      panel = document.createElement("div");
      panel.className = "panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "デバッグ");
      panel.innerHTML =
        '<div class="bar"><h2>デバッグ</h2>' +
        '<button type="button" data-debug="copy">コピー</button>' +
        '<button type="button" data-debug="close">閉じる</button>' +
        '<button type="button" class="danger" data-debug="stop">デバッグを終わる</button></div>' +
        '<div class="status" aria-live="polite"></div><div class="body"></div>';
      root.appendChild(panel);
      statusEl = panel.querySelector(".status"); bodyEl = panel.querySelector(".body");
      // パネルの中の操作は、ゲームの document / window の処理へ伝えない（ゲームが反応したり、スクロールを止めたりしないように）
      ["pointerdown", "pointerup", "pointermove", "touchstart", "touchmove", "touchend", "mousedown", "mouseup", "click", "dblclick", "keydown", "wheel", "contextmenu"]
        .forEach(function (t) { host.addEventListener(t, function (e) { e.stopPropagation(); }, false); });
      btn.addEventListener("click", function () { setOpen(true); });
      panel.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-debug]");
        if (!b) return;
        var k = b.getAttribute("data-debug");
        if (k === "close") setOpen(false);
        else if (k === "stop") D.stop();
        else if (k === "copy") copy();
      });
      document.documentElement.appendChild(host);
      update();
      place();
      // 置き場所の見直し：画面の大きさが変わったとき・1秒ごと（今の場所がボタンと重なったときだけ動かす）
      ["resize", "orientationchange", "load"].forEach(function (t) { window.addEventListener(t, re); });
      timer = setInterval(function () { if (!open) place(); }, 1000);
    }

    D.subscribe(function (ev) {
      if (ev.type === "stop") { teardown(); return; }
      if (ev.type === "log" || ev.type === "clear") { update(); if (open) renderLogs(); }
    });

    function re() { placed = null; place(); }
    function teardown() {
      clearInterval(timer);
      ["resize", "orientationchange", "load"].forEach(function (t) { window.removeEventListener(t, re); });
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null; btn = null; open = false;
    }

    function update() {
      if (!btn) return;
      var n = D.errorCount();
      btn.textContent = "🐞 " + (n > 99 ? "99+" : n);
      btn.className = "bug" + (n ? " err" : "");
      btn.setAttribute("aria-label", "デバッグ表示を開く（エラー " + n + " 件）");
    }

    function setOpen(v) {
      open = v;
      panel.hidden = !v;
      btn.hidden = v;
      if (v) { statusEl.textContent = ""; render(); }
      else { placed = null; place(); }
    }

    function render() {
      bodyEl.textContent = "";
      var h = document.createElement("h3"); h.className = "logs-h"; bodyEl.appendChild(h);
      var box = document.createElement("div"); box.className = "logs"; bodyEl.appendChild(box);
      var h2 = document.createElement("h3"); h2.textContent = "環境"; bodyEl.appendChild(h2);
      var pre = document.createElement("pre"); pre.className = "info"; pre.textContent = "読み込み中…"; bodyEl.appendChild(pre);
      renderLogs();
      D.run("info").then(function (r) { pre.textContent = r.ok ? JSON.stringify(r.result, null, 1) : "取れなかった: " + r.error; });
    }
    function renderLogs() {
      var h = bodyEl.querySelector(".logs-h"), box = bodyEl.querySelector(".logs");
      if (!h || !box) return;
      var es = D.logs();
      h.textContent = "エラー " + D.errorCount() + " 件・ログ " + es.length + " 件（新しい順）";
      box.textContent = "";
      if (!es.length) { var n = document.createElement("div"); n.className = "row"; n.textContent = "（まだ何もない）"; box.appendChild(n); }
      for (var i = es.length - 1; i >= 0; i--) {
        var d = document.createElement("div");
        d.className = "row " + es[i].level;
        d.textContent = fmtEntry(es[i]);
        box.appendChild(d);
      }
    }

    function copy() {
      statusEl.textContent = "まとめています…";
      D.run("report").then(function (r) {
        var text = r.ok ? r.result : "報告を作れなかった: " + r.error;
        var done = function () { statusEl.textContent = "コピーしました。Claude へのメッセージに貼り付けて送ってください。"; };
        var manual = function () {
          statusEl.textContent = "自動でコピーできませんでした。下の枠を長押しして「すべてを選択」→「コピー」してください。";
          var old = bodyEl.querySelector("textarea"); if (old) old.parentNode.removeChild(old);
          var ta = document.createElement("textarea"); ta.readOnly = true; ta.value = text;
          bodyEl.insertBefore(ta, bodyEl.firstChild); ta.focus(); ta.select();
        };
        var legacy = function () {
          try {
            var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;left:0;top:0;opacity:0;font-size:16px"; root.appendChild(ta);
            ta.select(); ta.setSelectionRange(0, text.length);
            var ok = document.execCommand && document.execCommand("copy");
            root.removeChild(ta);
            if (ok) done(); else manual();
          } catch (e) { manual(); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
        else legacy();
      });
    }

    // ---- 置き場所：押せる要素（44px のボタンなど）と重ならない所を探す ----
    // 画面を 4px 刻みで調べ、重なりの「重さ」が一番小さい所に置く。
    //   押せる要素（button・a・input・[role=button] など）… 4px 広げて重さ 1000（必ず避ける）
    //   canvas・img・svg（盤面・絵）                        … 重さ 3
    //   文字（点数・見出し・説明。行ごと）                    … 重さ 2
    // 同じ重さなら画面の端に近い所。今の場所が重なっていなければ動かさない（ちらつかせない）。
    function obstacles() {
      var hard = [], soft = [];
      var all = document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [data-cmd], [data-action], label, canvas, img, svg");
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (host && host.contains(el)) continue;
        var q = el.getBoundingClientRect();
        if (!onScreen(q) || !D.visible(el)) continue;
        var tg = el.tagName.toUpperCase();
        if (tg === "CANVAS" || tg === "IMG" || tg === "SVG") {
          if (getComputedStyle(el).pointerEvents === "none" && q.width * q.height > innerWidth * innerHeight * 0.5) continue;   // 飾りの全面 canvas（演出用）は避けなくてよい
          soft.push({ l: q.left, t: q.top, r: q.right, b: q.bottom, w: 3 });
        } else hard.push({ l: q.left - 4, t: q.top - 4, r: q.right + 4, b: q.bottom + 4, w: 1000 });
      }
      // 文字は行ごとの四角（Range）で調べる（大きな説明カードでも、文字のない余白なら置ける）
      if (document.body && document.createRange) {
        var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), rg = document.createRange(), n = 0;
        for (var t = tw.nextNode(); t && n < 600; t = tw.nextNode()) {
          if (!t.nodeValue.trim()) continue;
          var pe = t.parentElement;
          if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName)) continue;
          n++;
          rg.selectNodeContents(t);
          var rs = rg.getClientRects();
          for (var k = 0; k < rs.length; k++) if (onScreen(rs[k])) soft.push({ l: rs[k].left - 2, t: rs[k].top - 2, r: rs[k].right + 2, b: rs[k].bottom + 2, w: 2 });
        }
      }
      return hard.concat(soft);
    }
    function onScreen(q) { return q.width > 0 && q.height > 0 && q.bottom > 0 && q.right > 0 && q.top < innerHeight && q.left < innerWidth; }
    function cost(obs, x, y, w, h) {
      var c = 0;
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        var ow = Math.min(x + w, o.r) - Math.max(x, o.l), oh = Math.min(y + h, o.b) - Math.max(y, o.t);
        if (ow > 0 && oh > 0) c += ow * oh * o.w;
      }
      return c;
    }
    function place() {
      if (!btn || !host || open) return;
      var w = btn.offsetWidth || 44, h = btn.offsetHeight || 44;
      var obs = obstacles();
      if (placed && placed.w === w && cost(obs, placed.x, placed.y, w, h) === 0) return;
      var sa = D.safeArea(), m = 4;
      var x0 = sa.left + m, y0 = sa.top + m, x1 = innerWidth - sa.right - m - w, y1 = innerHeight - sa.bottom - m - h;
      if (x1 < x0) x1 = x0;
      if (y1 < y0) y1 = y0;
      var best = null;
      for (var y = y0; y <= y1 + 0.01; y += 4) {
        for (var x = x0; x <= x1 + 0.01; x += 4) {
          var c = cost(obs, x, y, w, h);
          var edge = Math.min(x - x0, x1 - x, y - y0, y1 - y);
          var score = c * 100 + edge;
          if (!best || score < best.s) best = { s: score, x: x, y: y, c: c };
        }
        // 端（右下の角）も必ず候補に入れる
        if ((x1 - x0) % 4) { var cx = cost(obs, x1, y, w, h); var sx = cx * 100 + Math.min(x1 - x0, y - y0, y1 - y); if (sx < best.s) best = { s: sx, x: x1, y: y, c: cx }; }
      }
      if (!best) return;
      placed = { x: best.x, y: best.y, w: w, c: best.c };
      btn.style.left = Math.round(best.x) + "px";
      btn.style.top = Math.round(best.y) + "px";
      host.setAttribute("data-cost", String(Math.round(best.c)));
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  }
})();
