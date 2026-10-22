// ゆびあそび デバッグの運び役（遠隔操作・中継）。docs/debug.md の 5 章（5.3）が約束。
//
// ・debug.js が ?debug=1&relay=1&key=合言葉 のとき（または sessionStorage の yubi.relay を覚えているとき）だけ読み込む。
//   sw.js の事前キャッシュには入れない（PC の中継サーバーから http で配信したときだけ使う）。
// ・ページを配信している中継サーバー（tests/relay/relay.mjs）の /relay に WebSocket でつなぎ、
//   届いた命令を YubiDebug.run(命令, 引数) に渡して結果を返す。ログは YubiDebug.subscribe で受け取って送る。
//   命令の中身は知らない（命令は debug.js の YubiDebug.command に登録されたものだけ。文字列を eval しない）。
// ・切れたら 1・2・4・8・10・10…秒の間隔でつなぎ直す。合言葉違い（4001）・別の端末に追い出された（4002）ときはつなぎ直さない。
// ・例外を外へ出さない。WebSocket が無い・つながらなくても、ゲームとデバッグ表示は動く。
(function () {
  "use strict";
  try { main(); } catch (e) { /* 運び役が壊れても、ゲームは止めない */ }

  function main() {
    var D = window.YubiDebug;
    if (!D || window.YubiDebugRelay) return;
    var key = null;
    try { key = sessionStorage.getItem("yubi.relay"); } catch (e) { key = null; }
    if (!key || !/^[A-Za-z0-9]{1,16}$/.test(key)) return;

    var MAX_BACKLOG = 100;           // つながる前（切れている間）のログは、hello の直後に最大この件数だけまとめて送る
    var CONNECT_TIMEOUT = 8000;      // つなぎ始めてから開くまで待つ時間（過ぎたら閉じてつなぎ直す）
    var INFO_TIMEOUT = 3000;         // hello に入れる info を待つ時間（過ぎたら info なしで送る）
    var SILENT_LIMIT = 50000;        // 中継は 20 秒ごとに ping を送る。これより長く何も届かなければ、切れたものとしてつなぎ直す
    var state = "closed";            // "connecting" | "open" | "closed" | "rejected"
    var ws = null, retryTimer = 0, connTimer = 0, watchTimer = 0, tries = 0;
    var stopped = false, ready = false, lastSent = 0, lastRecv = 0;
    var WS = window.WebSocket;

    function url() {
      return (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/relay";
    }
    function send(sock, obj) {
      if (!sock || sock !== ws || sock.readyState !== 1) return false;
      try { sock.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    // まだ送っていないログ（id が lastSent より大きいもの）を送る。切れている間に溜まったものは新しい 100 件まで
    function flushLogs(sock) {
      var es;
      try { es = D.logs({ since: lastSent }); } catch (e) { return; }
      if (es.length > MAX_BACKLOG) es = es.slice(es.length - MAX_BACKLOG);
      for (var i = 0; i < es.length; i++) {
        if (!send(sock, { type: "log", entry: es[i] })) return;
        lastSent = es[i].id;
      }
    }
    function withTimeout(p, ms) {
      return new Promise(function (resolve) {
        var t = setTimeout(function () { resolve(null); }, ms);
        p.then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
      });
    }

    function connect() {
      clearTimeout(retryTimer); retryTimer = 0;
      if (stopped || state === "rejected" || state === "connecting" || state === "open") return;
      if (typeof WS !== "function") { state = "closed"; return; }      // WebSocket が無いブラウザ：つながない（ゲームは動く）
      var sock;
      try { sock = new WS(url()); } catch (e) { sock = null; }
      if (!sock) { state = "closed"; schedule(); return; }
      ws = sock; state = "connecting"; ready = false;
      connTimer = setTimeout(function () { if (sock === ws && sock.readyState !== 1) { try { sock.close(); } catch (e) { /* 無視 */ } closed(sock, 0); } }, CONNECT_TIMEOUT);
      sock.onopen = function () {
        if (sock !== ws) return;
        clearTimeout(connTimer);
        lastRecv = Date.now();
        // つないだらすぐ hello（info は時間がかかることがあるので、待つのは INFO_TIMEOUT まで）
        withTimeout(D.run("info"), INFO_TIMEOUT).then(function (r) {
          if (sock !== ws) return;
          if (!send(sock, { type: "hello", key: key, page: location.pathname + location.search, info: r && r.ok ? r.result : null })) return;
          ready = true;
          flushLogs(sock);
        });
      };
      sock.onmessage = function (ev) {
        if (sock !== ws) return;
        lastRecv = Date.now();
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || typeof m !== "object") return;
        if (m.type === "welcome") { state = "open"; tries = 0; }
        else if (m.type === "ping") send(sock, { type: "pong" });
        else if (m.type === "run") {
          var id = m.id;
          D.run(m.command, m.args).then(function (r) {
            var out = { type: "result", id: id };
            for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k) && k !== "type" && k !== "id") out[k] = r[k];
            send(sock, out);
          });
        }
      };
      sock.onerror = function () { /* onclose が続けて来る */ };
      sock.onclose = function (ev) { closed(sock, ev && ev.code); };
    }

    function closed(sock, code) {
      if (sock !== ws) return;
      clearTimeout(connTimer);
      ws = null; ready = false;
      if (stopped) { state = "closed"; return; }
      if (code === 4001) {
        state = "rejected";
        try { D.log("warn", "中継：合言葉が ちがいます"); } catch (e) { /* 無視 */ }
        return;
      }
      state = "closed";
      if (code === 4002) {
        try { D.log("warn", "中継：別の端末が つないだので 切れました"); } catch (e) { /* 無視 */ }
        return;
      }
      schedule();
    }
    // つなぎ直し：1・2・4・8・10・10…秒
    function schedule() {
      if (stopped || retryTimer) return;
      var sec = Math.min(10, Math.pow(2, tries));
      tries++;
      retryTimer = setTimeout(function () { retryTimer = 0; connect(); }, sec * 1000);
    }
    // 画面が見えたら（スリープから戻った・別のアプリから戻った）すぐつなぎ直す
    function wake() {
      if (stopped || state === "rejected") return;
      if (document.visibilityState && document.visibilityState !== "visible") return;
      if (ws && state === "open" && Date.now() - lastRecv > SILENT_LIMIT / 2) { drop(); return; }   // 開いたまま止まっている接続は捨てる
      if (!ws && retryTimer) { tries = 0; connect(); }                 // つなぎ直しを待っている間だけ（4002 のあとは待っていない）
    }
    // 開いているはずなのに長く何も届かない接続は、閉じてつなぎ直す（iPhone で画面を消したあとなど）
    function drop() {
      var sock = ws;
      if (!sock) return;
      try { sock.close(); } catch (e) { /* 無視 */ }
      closed(sock, 0);
      tries = 0;
      clearTimeout(retryTimer); retryTimer = 0;
      connect();
    }

    var unsub = D.subscribe(function (ev) {
      if (ev.type === "stop") { stop(); return; }
      if (ev.type === "log" && ready && ws && ev.entry && ev.entry.id > lastSent) flushLogs(ws);
    });

    function stop() {
      stopped = true;
      clearTimeout(retryTimer); clearTimeout(connTimer); clearInterval(watchTimer);
      retryTimer = 0;
      try { unsub(); } catch (e) { /* 無視 */ }
      var sock = ws; ws = null; ready = false; state = "closed";
      if (sock) { try { sock.close(1000); } catch (e) { /* 無視 */ } }
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
    }

    // ---- 運び役だけの命令 ----
    // open：同じサイトのページへ移る。path は "/" で始まり "//" で始まらないものだけ（"?" 以降も可）
    D.command("open", function (a) {
      var p = typeof a === "string" ? a : a && a.path;
      if (typeof p !== "string" || p.charAt(0) !== "/" || p.charAt(1) === "/" || /[\\\s\u0000-\u001f]/.test(p)) throw new Error("path は / で始まる同じサイトの道（例 /games/hashi/）");
      var href = new URL(p, location.href).href;
      if (new URL(href).origin !== location.origin) throw new Error("同じサイトの中だけ移れる: " + p);
      setTimeout(function () { location.assign(href); }, 100);     // 結果を返してから移る
      return { path: p, href: href, note: "100ms 後に移る。中継の /wait でつなぎ直しを待つ" };
    }, { desc: "同じサイトのページへ移る（運び役）", args: "{ path: '/games/hashi/' など }" });
    D.command("reload", function () {
      setTimeout(function () { location.reload(); }, 100);           // 結果を返してから読み直す
      return { href: location.href, note: "100ms 後に読み直す。中継の /wait でつなぎ直しを待つ" };
    }, { desc: "ページを読み直す（運び役）", args: "なし" });

    window.YubiDebugRelay = {
      status: function () { return state; },
      stop: stop,
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("online", wake);
    watchTimer = setInterval(function () { if (ws && state === "open" && Date.now() - lastRecv > SILENT_LIMIT) drop(); }, 10000);
    connect();
  }
})();
