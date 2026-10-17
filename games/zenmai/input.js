/*
 * ゼンマイさんぽ — 入力（ネジ＝ダイヤルを指で円を描くように回す）
 *
 * ZenmaiInput.attach(dialEl, { onWind(deltaTurns), onRelease(info), onStart() }) → { detach(), reset() }
 *   - dialEl 上の pointer イベントで、ダイヤル中心からの角度の変化を積算する。
 *     画面座標は y が下向きなので、atan2 の増加 = 見た目の時計回り = 巻く（正）。反時計回りは負（戻す）。
 *   - 1/8 回転たまるごとに onWind(+0.125) / onWind(-0.125) を呼ぶ（効果音のカチカチ用）。
 *     1回の move で大きく回っても、1/8 ずつ複数回に分けて呼ぶ。1/8 未満の端数は指を離すと捨てる。
 *   - 中心付近（半径の 22%、最小 10px）では角度が暴れるので数えない。外へ出たらそこから数え直す。
 *   - 速い回転: getCoalescedEvents で間の点も拾う。それでも半周近く飛んだときは、
 *     直前までの回る向きと逆に解釈しない（向きが逆に見える大きな飛びは、同じ向きの続きとみなす）。
 *   - マルチタッチ: 最初の1本だけを数える。その指が離れたとき、別の指がまだダイヤルに触れていれば
 *     その指に引き継ぎ（指の持ち替え）、onRelease は呼ばない。最後の指が離れたら onRelease。
 *   - pointercancel（OS のジェスチャなど）でも操作が止まったままにならないよう onRelease({ cancelled: true })。
 *   - touch-action: none を設定し、ダイヤル上の touchstart/touchmove/touchend・dblclick・contextmenu・
 *     selectstart を止める（既存ゲームの「pointer だけで動く領域は touchend を止める」方式）。
 *
 * テスト用に、DOM に依存しない核 ZenmaiInput.createCore(cbs) と angleDelta / TICK も公開する。
 * UMD: ブラウザでは window.ZenmaiInput、Node では module.exports と globalThis.ZenmaiInput。
 */
(function (root) {
  "use strict";

  const TAU = Math.PI * 2;
  const TICK = 1 / 8;              // onWind を呼ぶ単位（回転）
  const TICK_RAD = TAU * TICK;
  const DEAD_RATIO = 0.22;         // 中心付近の無視する半径（ダイヤル半径に対する割合）
  const DEAD_MIN = 10;             // 無視する半径の最小（px）
  const JUMP = Math.PI * 0.7;      // これより大きい飛びは、向きを直前の流れに合わせる
  const EPS = 1e-9;                // 浮動小数の誤差で 1/8 を取りこぼさないための余裕

  function angleDelta(prevRad, curRad) {
    const L = root.ZenmaiLogic;
    if (L && typeof L.angleDelta === "function") return L.angleDelta(prevRad, curRad);
    let d = (curRad - prevRad) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d <= -Math.PI) d += TAU;
    return d;
  }

  function safe(fn, arg) {
    if (typeof fn !== "function") return;
    try { fn(arg); } catch (e) { if (typeof console !== "undefined") console.error(e); }
  }

  /*
   * DOM に依存しない核。座標はダイヤル中心からの相対 (dx, dy)、radius はダイヤルの半径（px）。
   *   begin() … ジェスチャ開始（onStart）
   *   point(dx, dy, radius) … 位置の更新（角度を積算して onWind）
   *   reanchor() … 次の点から数え直す（指の持ち替え時）
   *   end(info) … 指を離した（端数を捨てて onRelease）
   *   reset() … 状態を初期化（コールバックは呼ばない）
   */
  function createCore(cbs) {
    cbs = cbs || {};
    let last = null;        // 直前の角度（null = 次の点から数える）
    let pending = 0;        // 1/8 回転に満たない端数（ラジアン）
    let dir = 0;            // 直前の回る向き（+1 / -1 / 0）
    let total = 0;          // このジェスチャで onWind した合計（回転）

    function point(dx, dy, radius) {
      const r = Math.hypot(dx, dy);
      const dead = Math.max(DEAD_MIN, (Number(radius) > 0 ? radius : 0) * DEAD_RATIO);
      if (!(r >= dead)) { last = null; return; }   // 中心付近（NaN もここ）
      const a = Math.atan2(dy, dx);
      if (last === null) { last = a; return; }
      let d = angleDelta(last, a);
      last = a;
      if (Math.abs(d) > JUMP && dir !== 0 && Math.sign(d) !== dir) d += dir * TAU; // 逆向きに見える大きな飛び
      if (d === 0) return;
      dir = d > 0 ? 1 : -1;
      pending += d;
      while (pending >= TICK_RAD - EPS) { pending -= TICK_RAD; total += TICK; safe(cbs.onWind, TICK); }
      while (pending <= -TICK_RAD + EPS) { pending += TICK_RAD; total -= TICK; safe(cbs.onWind, -TICK); }
    }

    function reset() { last = null; pending = 0; dir = 0; total = 0; }

    return {
      begin() { reset(); safe(cbs.onStart); },
      point,
      reanchor() { last = null; },
      end(info) { const t = total; reset(); safe(cbs.onRelease, Object.assign({ turns: t, cancelled: false }, info || {})); },
      reset,
      get total() { return total; }
    };
  }

  function attach(dialEl, cbs) {
    if (!dialEl || typeof dialEl.addEventListener !== "function") throw new Error("ZenmaiInput.attach: dialEl が必要です");
    const core = createCore(cbs);
    let active = null;                 // 数えている指の pointerId
    const others = new Map();          // ダイヤルに触れている他の指 pointerId → 最後の位置
    let geo = null;                    // ジェスチャ開始時のダイヤル中心と半径

    const prevTouchAction = dialEl.style.touchAction;
    dialEl.style.touchAction = "none";
    dialEl.style.webkitUserSelect = "none";
    dialEl.style.userSelect = "none";
    dialEl.style.webkitTouchCallout = "none";

    function measure() {
      const b = dialEl.getBoundingClientRect();
      geo = { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 };
    }
    function feed(x, y) { core.point(x - geo.cx, y - geo.cy, geo.r); }

    function capture(id) { try { dialEl.setPointerCapture(id); } catch (e) { /* 無視 */ } }

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      if (active !== null) {           // 2本目以降は数えない（持ち替え用に覚えておくだけ）
        if (e.pointerId !== active) { others.set(e.pointerId, { x: e.clientX, y: e.clientY }); capture(e.pointerId); }
        return;
      }
      active = e.pointerId;
      capture(active);
      measure();
      core.begin();
      feed(e.clientX, e.clientY);
    }

    function onMove(e) {
      if (e.pointerId !== active) {
        if (others.has(e.pointerId)) others.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      if (e.cancelable) e.preventDefault();
      let list = null;
      try { list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null; } catch (err) { list = null; }
      if (list && list.length) { for (const c of list) feed(c.clientX, c.clientY); }
      else feed(e.clientX, e.clientY);
    }

    function onEnd(e) {
      if (e.pointerId !== active) { others.delete(e.pointerId); return; }
      if (e.type === "pointerup") feed(e.clientX, e.clientY);
      const cancelled = e.type !== "pointerup";
      // 持ち替え: 他の指がまだ触れていれば、その指に引き継ぐ（キャンセル時は引き継がない）
      if (!cancelled && others.size) {
        const [id, pos] = others.entries().next().value;
        others.delete(id);
        active = id;
        core.reanchor();
        feed(pos.x, pos.y);
        return;
      }
      active = null;
      others.clear();
      core.end({ cancelled });
    }

    function stopTouch(e) { if (e.cancelable) e.preventDefault(); }

    const handlers = [
      ["pointerdown", onDown],
      ["pointermove", onMove],
      ["pointerup", onEnd],
      ["pointercancel", onEnd],
      ["lostpointercapture", (e) => { if (e.pointerId === active) onEnd({ type: "pointercancel", pointerId: e.pointerId }); else others.delete(e.pointerId); }],
      ["touchstart", stopTouch],
      ["touchmove", stopTouch],
      ["touchend", stopTouch],
      ["dblclick", stopTouch],
      ["contextmenu", stopTouch],
      ["selectstart", stopTouch],
      ["dragstart", stopTouch]
    ];
    for (const [t, h] of handlers) dialEl.addEventListener(t, h, { passive: false });

    return {
      detach() {
        for (const [t, h] of handlers) dialEl.removeEventListener(t, h, { passive: false });
        if (active !== null) { try { dialEl.releasePointerCapture(active); } catch (e) { /* 無視 */ } }
        active = null; others.clear(); core.reset();
        dialEl.style.touchAction = prevTouchAction;
      },
      // 状態を初期化する（ステージ開始・中断時など）。押しっぱなしの指も以後は数えない。コールバックは呼ばない
      reset() {
        if (active !== null) { try { dialEl.releasePointerCapture(active); } catch (e) { /* 無視 */ } }
        active = null; others.clear(); core.reset();
      }
    };
  }

  const api = { attach, createCore, angleDelta, TICK, DEAD_RATIO, DEAD_MIN };
  root.ZenmaiInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
