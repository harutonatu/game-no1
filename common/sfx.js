/*
 * ゆびあそび 共通効果音 — 案A「木のおもちゃ箱」（やわらかい木琴・マリンバ系）
 *
 * 使い方（今の sfx と同じ呼び出し方のまま差し替えられる）
 *   const sfx = YubiSfx.create("blocks");   // ブロックパズル
 *   const sfx = YubiSfx.create("tiles");    // ばいばいタイル（"2048" でも可）
 *   const sfx = YubiSfx.create("irocode");  // いろコード（place/remove/submit/hint(hit)/win/lose。start/best/toggle は共通）
 *   const sfx = YubiSfx.create("menu");     // メニュー（共通の音だけ）
 *   sfx.play(name, arg) / sfx.unlock() / sfx.toggle() / sfx.on / sfx.buzz(pattern)
 *
 * 音声ファイルは使わず Web Audio で合成する（オフラインでも鳴る）。
 * create の第2引数（任意）: { context: 既存の AudioContext, ignoreSetting: true で設定を無視して常に鳴らす }
 */
(function (root) {
  "use strict";
  const KEY = "blockpuzzle.sound";      // ゲーム集で共通の効果音設定
  const PENTA = [0, 2, 4, 7, 9];        // ド・レ・ミ・ソ・ラ（どの順に鳴っても濁らない音階）
  const MAX_VOICES = 36;                // 同時に鳴らす部品の上限（連打で濁らないように）
  // 同じ音を続けて鳴らす最短の間隔（秒）。長押しの連続移動（45ms 間隔）は通す
  const GAP = { move: 0.03, rotate: 0.03, hold: 0.05, merge: 0.03, tap: 0.04, undo: 0.06 };

  function create(game, opts) {
    opts = opts || {};
    let ctx = null, out = null, noiseBuf = null;
    let on = true;
    if (!opts.ignoreSetting) { try { on = localStorage.getItem(KEY) !== "off"; } catch (e) { /* 読めなければオン */ } }
    const last = {};
    let voices = [];

    function ensure() {
      if (!ctx) {
        if (opts.context) ctx = opts.context;
        else {
          const AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) return null;
          // iPhone の消音スイッチに従い、ほかのアプリの音楽も止めない
          try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (e) { /* 未対応 */ }
          ctx = new AC();
        }
        build();
      }
      if (ctx.state !== "running" && ctx.resume) { try { ctx.resume().catch(() => {}); } catch (e) { /* 無視 */ } }
      return ctx;
    }

    // マスター：音量 → 高音を丸める → コンプレッサー（大小の差をそろえる）
    function build() {
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const soft = ctx.createBiquadFilter();
      soft.type = "lowpass"; soft.frequency.value = 5200; soft.Q.value = 0.4;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.15;
      master.connect(soft).connect(comp).connect(ctx.destination);
      out = master;
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    // 鳴っている部品の数を数え、上限を超えたら新しい部品を足さない
    function slot(end) {
      const now = ctx.currentTime;
      if (voices.length > 8) voices = voices.filter((e) => e > now);
      if (voices.length >= MAX_VOICES) return false;
      voices.push(end);
      return true;
    }
    const jit = (cents) => Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200);

    // 発振器1つ＋打楽器型の包絡線（すぐ立ち上がり、なめらかに消える）
    function partial(freq, t, dur, o) {
      o = o || {};
      if (!slot(t + dur)) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(o.from || freq, t);
      if (o.from) osc.frequency.exponentialRampToValueAtTime(freq, t + (o.fromT || 0.01));
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.toT || dur));
      const vol = Math.max(0.0002, o.vol || 0.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (o.a || 0.003));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    // ノイズ（ばちが当たる「コッ」、こすれる「スッ」）
    function noise(t, dur, o) {
      o = o || {};
      if (!slot(t + dur)) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = o.type || "bandpass";
      f.frequency.setValueAtTime(o.freq || 2000, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      f.Q.value = o.q || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.05), t + (o.a || 0.002));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random() * 0.4);   // 毎回ちがう場所から読んで、同じ手ざわりにならないように
      src.stop(t + dur + 0.02);
    }

    // マリンバの1音：基音＋4倍音（マリンバ特有）＋ばちの当たる音
    function mallet(f, t, o) {
      o = o || {};
      const vol = o.vol || 0.16, decay = o.decay || 0.25, bright = o.bright == null ? 0.6 : o.bright;
      f *= jit(o.jit == null ? 6 : o.jit);
      partial(f, t, decay, { vol, a: 0.003 });
      if (f < 1700) partial(f * 2, t, decay * 0.5, { vol: vol * 0.12 }); // 小さなスピーカーでも低い音が聞こえるように
      if (f * 3.93 < 6500) partial(f * 3.93, t, decay * 0.28, { vol: vol * 0.22 * bright, a: 0.001 });
      noise(t, 0.014, { vol: vol * 0.3 * bright, freq: Math.min(3200, f * 2.5), q: 1.4, a: 0.001 });
    }
    // 木をたたく短い「コッ」：音程が少し下がりながら鳴る
    function wood(f, t, o) {
      o = o || {};
      const vol = o.vol || 0.1, dur = o.dur || 0.05;
      f *= jit(o.jit == null ? 30 : o.jit);
      partial(f, t, dur, { vol, from: f * 1.18, fromT: 0.008, a: 0.001 });
      partial(f * 2.4, t, dur * 0.4, { vol: vol * 0.25, a: 0.001 });
      noise(t, 0.012, { vol: vol * 0.35, freq: Math.min(3000, f * 3), q: 1.2, a: 0.001 });
    }
    // 小さなベル（ご褒美の「キラッ」）
    function bell(f, t, o) {
      o = o || {};
      const vol = o.vol || 0.05, decay = o.decay || 0.45;
      partial(f, t, decay, { vol, a: 0.002 });
      partial(f * 2.76, t, decay * 0.5, { vol: vol * 0.3, a: 0.001 });
      if (f * 5.4 < 6500) partial(f * 5.4, t, decay * 0.25, { vol: vol * 0.1, a: 0.001 });
    }
    // タイルの値 → 音の高さ（4 が ソ、2048 で 2オクターブ上のミ。五音音階なので重なっても濁らない）
    function tileFreq(v) {
      const i = Math.max(0, Math.round(Math.log2(v || 4)) - 2);
      const semi = 12 * Math.floor(i / 5) + PENTA[i % 5];
      return 392 * Math.pow(2, semi / 12);
    }

    const N = () => ctx.currentTime + 0.005;
    const C5 = 523.25, E5 = 659.26, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5, G6 = 1568;

    const COMMON = {
      start: () => { const t = N(); mallet(392, t, { vol: 0.13, decay: 0.2 }); mallet(523.25, t + 0.09, { vol: 0.15, decay: 0.32 }); },
      // 下がっていくが、最後は明るい和音で終える（責められている感じにしない）
      over: () => {
        const t = N();
        [G5, E5, C5, 392].forEach((f, i) => mallet(f, t + i * 0.15, { vol: 0.12, decay: 0.3, bright: 0.4 }));
        mallet(261.6, t + 0.45, { vol: 0.08, decay: 0.45, bright: 0.2 });
      },
      best: () => { const t = N(); bell(G6, t, { vol: 0.045, decay: 0.3 }); bell(C6 * 2, t + 0.08, { vol: 0.05, decay: 0.45 }); },
      toggle: () => mallet(G5, N(), { vol: 0.12, decay: 0.12 }),
      tap: () => wood(740, N(), { vol: 0.08, dur: 0.045, jit: 20 })
    };
    COMMON.on = COMMON.toggle;

    const BLOCKS = {
      move: () => wood(620, N(), { vol: 0.06, dur: 0.035, jit: 40 }),
      rotate: () => { const t = N(); mallet(G5, t, { vol: 0.08, decay: 0.05, bright: 0.4, jit: 15 }); mallet(1174.7, t + 0.022, { vol: 0.065, decay: 0.06, bright: 0.3, jit: 15 }); },
      lock: () => { const t = N(); wood(196, t, { vol: 0.17, dur: 0.09, jit: 25 }); noise(t, 0.05, { type: "lowpass", freq: 700, vol: 0.08 }); },
      drop: () => {
        const t = N();
        noise(t, 0.05, { freq: 2600, to: 500, q: 0.8, vol: 0.07, a: 0.01 });          // 風を切る「シュッ」
        wood(147, t + 0.045, { vol: 0.15, dur: 0.08, jit: 20 });                      // 着地の「ゴトン」
        noise(t + 0.045, 0.05, { type: "lowpass", freq: 600, vol: 0.08 });
      },
      hold: () => { const t = N(); mallet(E5, t, { vol: 0.09, decay: 0.07, bright: 0.3 }); mallet(A5, t + 0.05, { vol: 0.09, decay: 0.08, bright: 0.3 }); },
      // 段数ぶん音が増えるかけ上がり。4段は和音とベルで締める
      clear: (n) => {
        n = Math.max(1, Math.min(4, n || 1));
        const t = N();
        const runs = [null, [C5, G5], [C5, E5, G5], [C5, E5, G5, C6], [C5, E5, G5, A5, C6]][n];
        runs.forEach((f, i) => mallet(f, t + i * 0.045, { vol: 0.1 + i * 0.012, decay: i === runs.length - 1 ? 0.35 : 0.18 }));
        if (n === 4) {
          const e = t + runs.length * 0.045;
          [C5, E5, G5].forEach((f) => mallet(f, e, { vol: 0.06, decay: 0.45, bright: 0.2 }));
          bell(G6, e + 0.04, { vol: 0.05, decay: 0.45 });
        }
      },
      level: () => { const t = N() + 0.28; mallet(G5, t, { vol: 0.1, decay: 0.15 }); mallet(C6, t + 0.06, { vol: 0.11, decay: 0.2 }); bell(E6, t + 0.12, { vol: 0.05, decay: 0.45 }); }
    };

    const TILES = {
      // 「スッ」とすべる音に、ごく小さい木の音
      move: () => { const t = N(); noise(t, 0.06, { freq: 1300 * jit(150), to: 700, q: 0.7, vol: 0.06, a: 0.012 }); wood(523, t + 0.012, { vol: 0.035, dur: 0.035, jit: 40 }); },
      // 値が大きいほど高く、豊かに（32 から低い音の支え、128 から5度上、512 からベル）
      merge: (v) => {
        const t = N(), f = tileFreq(v), k = Math.log2(v || 4);
        mallet(f, t, { vol: 0.14, decay: Math.min(0.4, 0.14 + 0.025 * k), jit: 4 });
        if (k >= 5) mallet(f / 2, t, { vol: 0.06, decay: 0.25, bright: 0.2, jit: 4 });
        if (k >= 7) mallet(f * 1.5, t + 0.03, { vol: 0.055, decay: 0.2, bright: 0.3, jit: 4 });
        if (k >= 9) bell(f * 2, t + 0.05, { vol: 0.03, decay: 0.35 });
      },
      milestone: (v) => {
        const t = N(), f = tileFreq(v);
        [1, 1.26, 1.5, 2].forEach((m, i) => mallet(f * m, t + i * 0.05, { vol: 0.1 + i * 0.01, decay: i === 3 ? 0.4 : 0.15 }));
        bell(f * 2, t + 0.17, { vol: 0.04, decay: 0.4 });
      },
      win: () => {
        const t = N();
        [C5, E5, G5, C6, E6].forEach((f, i) => mallet(f, t + i * 0.06, { vol: 0.1, decay: 0.18 }));
        [C5, E5, G5, C6].forEach((f) => mallet(f, t + 0.33, { vol: 0.07, decay: 0.55, bright: 0.3 }));
        bell(G6, t + 0.36, { vol: 0.05, decay: 0.5 });
      },
      // 1手戻す：高→低の2音と、逆向きの「スッ」
      undo: () => { const t = N(); noise(t, 0.07, { freq: 700, to: 1800, q: 0.7, vol: 0.04, a: 0.04 }); mallet(A5, t + 0.02, { vol: 0.08, decay: 0.06, bright: 0.3 }); mallet(E5, t + 0.065, { vol: 0.08, decay: 0.08, bright: 0.3 }); }
    };

    // いろコード：操作音は小（place/remove）、手応えは中（submit/hint）、ご褒美は大（win）
    const IROCODE = {
      place: () => wood(660, N(), { vol: 0.07, dur: 0.04, jit: 25 }),
      remove: () => wood(470, N(), { vol: 0.05, dur: 0.035, jit: 25 }),
      submit: () => { const t = N(); wood(330, t, { vol: 0.1, dur: 0.06, jit: 15 }); mallet(G5, t + 0.04, { vol: 0.09, decay: 0.12, bright: 0.4 }); },
      // ヒント：●(hit) の数だけ明るく。0 は低めの1音、4 は和音とベルまで
      hint: (hit) => {
        const h = Math.max(0, Math.min(4, Math.floor(Number(hit)) || 0));
        const t = N() + 0.12;
        const base = [C5, E5, G5, A5, C6][h];
        mallet(base, t, { vol: 0.09 + h * 0.01, decay: 0.16 + h * 0.03, bright: 0.3 + h * 0.12 });
        if (h >= 2) mallet(base * 1.5, t + 0.05, { vol: 0.06 + h * 0.008, decay: 0.2, bright: 0.4 });
        if (h >= 3) bell(base * 2, t + 0.09, { vol: 0.02 + h * 0.008, decay: 0.3 });
      },
      win: () => {
        const t = N();
        [C5, E5, G5, C6].forEach((f, i) => mallet(f, t + i * 0.07, { vol: 0.11, decay: 0.2 }));
        [C5, E5, G5, C6].forEach((f) => mallet(f, t + 0.3, { vol: 0.07, decay: 0.45, bright: 0.3 }));
        bell(G6, t + 0.32, { vol: 0.05, decay: 0.5 });
      },
      // 責めない終わり方：ゆっくり下がって、やさしい和音で止まる
      lose: () => {
        const t = N();
        [G5, E5, C5].forEach((f, i) => mallet(f, t + i * 0.14, { vol: 0.1, decay: 0.25, bright: 0.3 }));
        [C5, E5].forEach((f) => mallet(f / 2, t + 0.42, { vol: 0.06, decay: 0.4, bright: 0.2 }));
      }
    };

    const table = Object.assign({}, COMMON,
      game === "blocks" ? BLOCKS : (game === "tiles" || game === "2048") ? TILES : game === "irocode" ? IROCODE : {});

    return {
      get on() { return on; },
      // iPhone は画面に触れた瞬間でないと音を出す準備ができないため、操作のたびに呼ぶ
      unlock() { if (on) ensure(); },
      toggle() {
        on = !on;
        try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* 保存できなくても動作は続ける */ }
        if (on && ensure()) table.toggle();
        return on;
      },
      play(name, arg) {
        if (!on || !ensure()) return;
        try {
          const now = ctx.currentTime;
          if (GAP[name] && last[name] != null && now - last[name] < GAP[name]) return; // 連打の間引き
          last[name] = now;
          table[name](arg);
        } catch (e) { /* 音が出なくてもゲームは続ける */ }
      },
      // 振動は Android のみ（iPhone の Safari には振動の機能がない）
      buzz(pattern) {
        if (on && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* 未対応 */ } }
      },
      names: Object.keys(table)
    };
  }

  root.YubiSfx = { create, plan: "A" };
})(typeof window !== "undefined" ? window : globalThis);
