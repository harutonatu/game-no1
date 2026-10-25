// ゆびあそび 開き直したあとの知らせ（X-24）。X-20 で「ほかの タブの つづき」を読むために開き直したときだけ、
// 開き直したページの上に「ほかの タブの つづきから はじめました」を 1 回だけ出す（4 秒。押す邪魔をしない）。
// 印は sessionStorage（このタブだけ。開き直しても残る）。読めない・書けない環境では何もしない（ゲームは今までどおり）
(function () {
  "use strict";
  const KEY = "yubi.reloadNote";
  const TEXT = "ほかの タブの つづきから はじめました";
  const SHOW_MS = 4000;
  // 開き直す直前に呼ぶ（X-20 の reloadIfStale だけ。さいしょから などの開き直しでは呼ばない）
  function markReload() {
    try { sessionStorage.setItem(KEY, location.pathname); } catch (e) { /* 書けなければ知らせない */ }
  }
  function takeMark() {
    try {
      const v = sessionStorage.getItem(KEY);
      if (v === null) return false;
      sessionStorage.removeItem(KEY);
      return v === location.pathname;
    } catch (e) { return false; }
  }
  function show() {
    const d = document;
    if (!d.body) return;
    const n = d.createElement("div");
    n.id = "yubiNotice";
    n.setAttribute("role", "status");
    n.setAttribute("aria-live", "polite");
    n.style.cssText = [
      "position:fixed", "left:50%", "top:max(12px, env(safe-area-inset-top, 0px))", "transform:translateX(-50%)",
      "z-index:2147483000", "pointer-events:none", "box-sizing:border-box", "width:max-content", "max-width:calc(100vw - 32px)", "text-wrap:balance", "word-break:keep-all",
      "padding:10px 16px", "border-radius:12px", "background:rgba(20,24,30,0.94)", "color:#ffffff",
      "font:600 15px/1.4 \"Hiragino Sans\", system-ui, sans-serif", "text-align:center", "box-shadow:0 4px 16px rgba(0,0,0,0.35)"
    ].join(";");
    d.body.appendChild(n);
    // 読み上げに気づかせるため、箱を置いてから文を入れる
    setTimeout(() => { n.textContent = TEXT; }, 60);
    setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n); }, SHOW_MS);
  }
  self.YubiNotice = Object.freeze({ markReload, TEXT });
  if (takeMark()) show();
})();
