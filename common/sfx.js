/*
 * ゆびあそび 共通効果音 — 案A「木のおもちゃ箱」（やわらかい木琴・マリンバ系）
 *
 * 使い方（今の sfx と同じ呼び出し方のまま差し替えられる）
 *   const sfx = YubiSfx.create("blocks");   // ブロックパズル
 *   const sfx = YubiSfx.create("tiles");    // ばいばいタイル（"2048" でも可）
 *   const sfx = YubiSfx.create("kiritori"); // キリトリ道場
 *   const sfx = YubiSfx.create("irocode");  // いろコード（place/remove/submit/hint(hit)/win/lose。start/best/toggle は共通）
 *   const sfx = YubiSfx.create("zenmai");   // ゼンマイさんぽ
 *   const sfx = YubiSfx.create("pikatto");  // ピカッと早押し
 *   const sfx = YubiSfx.create("hashi");    // ハシわたり（grow(ratio)/tip/land/perfect(n)/walk/splash/peek）
 *   const sfx = YubiSfx.create("irobin");   // いろびん（pick/drop/pour(count)/reveal/seal(colorId)/cork/deliver(n)/arrive/clear/deny/undo/stuck）
 *   const sfx = YubiSfx.create("matomete"); // まとめてポン（select(n)/pop(n)/fall/allclear/over/deny/undo）
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
  // 同じ処理の中で続けて鳴らすとき、鳴らす時刻をこの秒数ずつずらす（currentTime は1つの処理の中では進まないため、間引かずに順に鳴らす）
  const STAGGER = { slice: 0.03 };
  const STAGGER_MAX = 0.24;
  const GAP = { move: 0.03, rotate: 0.03, hold: 0.05, merge: 0.03, tap: 0.04, undo: 0.06, launch: 0.07, miss: 0.08, tick: 0.045, unwind: 0.045, limit: 0.25, step: 0.08, grow: 0.05, walk: 0.08, pour: 0.05, pick: 0.03, arrive: 0.08, select: 0.03, pop: 0.03 };

  function create(game, opts) {
    opts = opts || {};
    let ctx = null, out = null, noiseBuf = null, failed = false;
    let on = true;
    if (!opts.ignoreSetting) { try { on = localStorage.getItem(KEY) !== "off"; } catch (e) { /* 読めなければオン */ } }
    const last = {}, nextAt = {};
    let voices = [];

    function ensure() {
      if (!ctx) {
        if (failed) return null;
        if (opts.context) ctx = opts.context;
        else {
          const AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) return null;
          // iPhone の消音スイッチに従い、ほかのアプリの音楽も止めない
          try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (e) { /* 未対応 */ }
          try { ctx = new AC(); } catch (e) { failed = true; return null; } // 作れなければ音なしで続ける
        }
        build();
      }
      if (ctx.state !== "running" && ctx.resume) { try { ctx.resume().catch(() => {}); } catch (e) { /* 無視 */ } }
      return ctx;
    }

    // 電話・Siri などで止められている間（interrupted）は鳴らさない（戻った瞬間にまとめて鳴るのを防ぐ）。
    // suspended は最初の unlock 直後もこの状態なので止めない（resume 後に鳴る）
    const ready = () => !!ensure() && ctx.state !== "interrupted";

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

    // 切った数 n → 五音音階の高さ（1つ目がド、切るほど上がる。重なっても濁らない）
    function sliceFreq(n) {
      const i = Math.max(0, Math.min(9, (n || 1) - 1));
      return C5 * Math.pow(2, (12 * Math.floor(i / 5) + PENTA[i % 5]) / 12);
    }
    const KIRI = {
      // 刃が空を切る「シュッ」と、木琴の小さな「コン」。1回のスワイプで切るほど高くなる
      slice: (n, off) => {
        const t = N() + (off || 0), f = sliceFreq(n);
        noise(t, 0.06, { freq: 3400 * jit(80), to: 1300, q: 0.9, vol: 0.055, a: 0.005 });
        mallet(f, t + 0.012, { vol: 0.11, decay: 0.13, bright: 0.5, jit: 4 });
        wood(f / 2, t + 0.01, { vol: 0.035, dur: 0.03, jit: 20 });
      },
      // コンボ：切った数ぶんのかけ上がり（3〜8音）をベルで締める
      combo: (n) => {
        n = Math.max(3, Math.min(8, n || 3));
        const t = N() + 0.04;
        for (let i = 0; i < n; i++) mallet(sliceFreq(i + 1) * 1.0, t + i * 0.045, { vol: 0.08 + i * 0.008, decay: i === n - 1 ? 0.3 : 0.12, bright: 0.45 });
        bell(sliceFreq(n) * 2, t + n * 0.045, { vol: 0.045, decay: 0.4 });
      },
      // 爆弾：おどかさない「ぽふっ」。低い木の音と、こもった煙の音
      bomb: () => {
        const t = N();
        wood(130, t, { vol: 0.16, dur: 0.11, jit: 15 });
        noise(t, 0.22, { type: "lowpass", freq: 900, to: 220, vol: 0.09, a: 0.01 });
        mallet(E5, t + 0.08, { vol: 0.06, decay: 0.12, bright: 0.2 });
        mallet(C5, t + 0.16, { vol: 0.06, decay: 0.18, bright: 0.2 });
      },
      // 的を落とした：小さく下がる2音（責める感じにしない）
      miss: () => { const t = N(); mallet(G5 / 2, t, { vol: 0.07, decay: 0.1, bright: 0.2 }); mallet(E5 / 2, t + 0.07, { vol: 0.065, decay: 0.16, bright: 0.2 }); },
      // 的を投げ上げる：ごく小さい「ヒュッ」
      launch: () => noise(N(), 0.09, { freq: 700, to: 1500, q: 0.7, vol: 0.018, a: 0.03 })
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


    // ゼンマイさんぽ：start・best・toggle は共通の音を使う
    const ZENMAI = {
      // 巻く1/8回転ごと。極小の「カチ」。高さを少しずつ変えて、続いても単調で耳障りにならない
      tick: () => wood(1500 * jit(90), N(), { vol: 0.022, dur: 0.02, jit: 60 }),
      // 戻す：少し低く、さらに小さい「コト」
      unwind: () => wood(1050 * jit(90), N(), { vol: 0.02, dur: 0.022, jit: 60 }),
      // そろそろ限界：低めの木の音を2つ。控えめで、責めない
      limit: () => { const t = N(); mallet(E5, t, { vol: 0.07, decay: 0.09, bright: 0.2 }); mallet(392, t + 0.12, { vol: 0.07, decay: 0.12, bright: 0.2 }); },
      // 手を離す：ゼンマイが解ける「ジー」＋小さな木の音
      release: () => { const t = N(); noise(t, 0.12, { freq: 1800, to: 2600, q: 1.6, vol: 0.035, a: 0.02 }); wood(660, t + 0.01, { vol: 0.06, dur: 0.04 }); },
      // 歩く1歩：小さなトコッ
      step: () => wood(430 * jit(60), N(), { vol: 0.05, dur: 0.035, jit: 40 }),
      // ぴたっと止まる：やさしい2音
      stop: () => { const t = N(); wood(330, t, { vol: 0.09, dur: 0.06 }); mallet(C5, t + 0.05, { vol: 0.1, decay: 0.18, bright: 0.3 }); },
      // 崖から落ちる：すべり落ちる音（最後は小さくポトン）
      fall: () => { const t = N(); partial(520, t, 0.4, { vol: 0.06, type: "triangle", from: 760, fromT: 0.02, to: 150, toT: 0.38 }); wood(150, t + 0.42, { vol: 0.09, dur: 0.07, jit: 20 }); },
      // バネが切れる：ビヨンと伸びる音
      break: () => { const t = N(); wood(300, t, { vol: 0.1, dur: 0.05 }); partial(900, t + 0.02, 0.3, { vol: 0.05, type: "triangle", from: 400, fromT: 0.12, to: 220, toT: 0.28 }); noise(t, 0.05, { freq: 3000, q: 1, vol: 0.04 }); },
      // 星が1つずつ灯る（n=1〜3）。下がる前に明るく
      star: (n) => { n = Math.max(1, Math.min(3, n || 1)); const f = [C5, E5, G5][n - 1]; const t = N(); mallet(f, t, { vol: 0.11, decay: 0.2 }); bell(f * 2, t + 0.03, { vol: 0.035, decay: 0.3 }); },
      clear: () => { const t = N(); [C5, E5, G5, C6].forEach((f, i) => mallet(f, t + i * 0.07, { vol: 0.1, decay: i === 3 ? 0.4 : 0.16 })); bell(G6, t + 0.3, { vol: 0.04, decay: 0.4 }); }
    };

    // ピカッと早押し：合図は短く明るく、フライングは責めない、勝ちは2〜3音の上昇
    const PIKATTO = {
      // 合図：高めのマリンバ＋小さなベル。遅れが気にならないよう decay は短め（0.08〜0.12秒）
      signal: () => { const t = N(); mallet(C6, t, { vol: 0.14, decay: 0.1, bright: 0.7 }); bell(E6 * 2, t + 0.005, { vol: 0.04, decay: 0.12 }); },
      // 合図前のカウント：極小の木の音。心を落ち着かせる
      ready: () => wood(520, N(), { vol: 0.03, dur: 0.025, jit: 30 }),
      // フライング：責めない「こつん」。低音の木＋ごく小さい noise
      foul: () => { const t = N(); wood(180, t, { vol: 0.1, dur: 0.08, jit: 20 }); noise(t, 0.05, { type: "lowpass", freq: 500, vol: 0.04, a: 0.004 }); },
      // 自分が勝ったラウンド：C5 → G5 → C6 の明るい上昇
      win: () => { const t = N(); mallet(C5, t, { vol: 0.11, decay: 0.14 }); mallet(G5, t + 0.06, { vol: 0.12, decay: 0.14 }); mallet(C6, t + 0.12, { vol: 0.13, decay: 0.22, bright: 0.5 }); },
      // 引き分け：やさしい2音（中音域、同じ高さを少しずらして）
      tie: () => { const t = N(); mallet(E5, t, { vol: 0.09, decay: 0.12, bright: 0.3 }); mallet(E5, t + 0.09, { vol: 0.09, decay: 0.14, bright: 0.3 }); },
      // 最終勝利：4音の上昇＋ベルで締める（タイルの win より少し短め）
      finish: () => {
        const t = N();
        [C5, E5, G5, C6].forEach((f, i) => mallet(f, t + i * 0.055, { vol: 0.11, decay: i === 3 ? 0.35 : 0.16 }));
        bell(G6, t + 0.24, { vol: 0.05, decay: 0.45 });
      }
    };

    // ハシわたり：夜の池。伸びる音は極小、ぴったりは連続で少しずつ高く、落ちる音はやさしく
    const HASHI = {
      // 茎が伸びる間の極小の「ぷつ」。ratio（0..1）が大きいほど少し高く（vol 0.02〜0.04）
      grow: (ratio) => {
        const r = Math.max(0, Math.min(1, Number(ratio) || 0));
        wood((700 + 900 * r) * jit(40), N(), { vol: 0.02 + 0.02 * r, dur: 0.018, jit: 30 });
      },
      // 茎が倒れて「ことん」：低めの木の音とこもった音
      tip: () => { const t = N(); wood(240, t, { vol: 0.11, dur: 0.07, jit: 20 }); noise(t, 0.05, { type: "lowpass", freq: 650, vol: 0.05, a: 0.003 }); },
      // 葉に乗った「ぽん」：少し持ち上がる柔らかい音
      land: () => { const t = N(); partial(G5 / 2, t, 0.12, { vol: 0.08, from: 300, fromT: 0.03 }); mallet(G5, t + 0.01, { vol: 0.1, decay: 0.16, bright: 0.4 }); },
      // ぴったり：n=連続回数（1〜5 で頭打ち）。五音音階で少しずつ高くなり、ベルで締める
      perfect: (n) => {
        const k = Math.max(1, Math.min(5, Math.floor(Number(n)) || 1));
        const f = C5 * Math.pow(2, PENTA[k - 1] / 12), t = N();
        mallet(f, t, { vol: 0.11, decay: 0.16, bright: 0.5, jit: 4 });
        mallet(f * 1.5, t + 0.05, { vol: 0.11 + k * 0.006, decay: 0.24, bright: 0.5, jit: 4 });
        bell(f * 2, t + 0.09, { vol: 0.035 + k * 0.004, decay: 0.35 + k * 0.03 });
      },
      // 歩く1歩「ぺた」：小さく湿った音
      walk: () => { const t = N(); wood(360 * jit(60), t, { vol: 0.04, dur: 0.03, jit: 40 }); noise(t, 0.025, { type: "lowpass", freq: 900, vol: 0.02, a: 0.002 }); },
      // 水に落ちる「ぽちゃん」：下がる水滴の音と、やさしい水の音（責めない）
      splash: () => {
        const t = N();
        partial(420, t, 0.16, { vol: 0.07, from: 900, fromT: 0.01, to: 380, toT: 0.14 });
        noise(t + 0.02, 0.3, { type: "lowpass", freq: 1400, to: 300, vol: 0.06, a: 0.01 });
        partial(700, t + 0.12, 0.1, { vol: 0.03, from: 500, fromT: 0.05 });
      },
      // 水から顔を出す「ぴょこ」：軽く上がる2音
      peek: () => { const t = N(); partial(A5, t, 0.08, { vol: 0.06, from: 520, fromT: 0.04 }); mallet(C6, t + 0.06, { vol: 0.07, decay: 0.12, bright: 0.5 }); }
    };

    // いろびん：ガラスの瓶と水の音。「そろう（seal）」が一番気持ちいい瞬間なので、上がる和音＋きらきらを厚めにする
    const IROBIN = {
      // 瓶を持ち上げる「こっ」：軽いガラス
      pick: () => { const t = N(); wood(980, t, { vol: 0.05, dur: 0.03, jit: 25 }); partial(C6 * jit(8), t + 0.012, 0.07, { vol: 0.045 }); },
      // 置く「ことっ」：pick より低く
      drop: () => { const t = N(); wood(540, t, { vol: 0.06, dur: 0.04, jit: 25 }); partial(G5 * jit(8), t + 0.012, 0.06, { vol: 0.04 }); },
      // 注ぐ「とくとく」：count（1〜4）が多いほど長く。小さな水滴を重ねる
      pour: (count) => {
        const n = Math.max(1, Math.min(4, Math.floor(Number(count)) || 1)), t = N();
        noise(t, 0.1 + n * 0.06, { type: "lowpass", freq: 1500, to: 900, q: 0.7, vol: 0.035, a: 0.02 });
        for (let i = 0; i < n + 1; i++) partial(520 + i * 70, t + i * 0.07, 0.07, { vol: 0.04, from: 380 + i * 50, fromT: 0.03 });
      },
      // 隠れていた色が見える「ぽわん」
      reveal: () => { const t = N(); partial(C5, t, 0.2, { vol: 0.07, from: 330, fromT: 0.07 }); mallet(G5, t + 0.05, { vol: 0.07, decay: 0.16, bright: 0.3 }); },
      // そろった！ 根音から長三和音がかけ上がり、長い和音とベルのきらきらが重なる。colorId で根音を五音音階の中で少し変える
      // （同時発音の上限 36 を使い切らないよう、部品は 20 個ほどに抑える。直後の栓・届ける音が落ちないように）
      seal: (colorId) => {
        const k = Math.max(0, Math.floor(Number(colorId)) || 0) % 5;
        const r = C5 * Math.pow(2, PENTA[k] / 12), t = N();
        [1, 1.26, 1.5].forEach((m, i) => mallet(r * m, t + i * 0.055, { vol: 0.12 + i * 0.01, decay: 0.2, bright: 0.55, jit: 3 }));
        mallet(r * 2, t + 0.165, { vol: 0.13, decay: 0.42, bright: 0.6, jit: 3 });
        [1, 1.26, 1.5].forEach((m) => partial(r * m, t + 0.2, 0.55, { vol: 0.04, a: 0.01 }));
        bell(r * 4, t + 0.13, { vol: 0.045, decay: 0.5 });
        bell(r * 6, t + 0.27, { vol: 0.032, decay: 0.55 });
      },
      // 栓の「ぽん」：弾む木の音
      cork: () => { const t = N(); partial(330, t, 0.1, { vol: 0.12, from: 210, fromT: 0.03 }); wood(300, t + 0.005, { vol: 0.09, dur: 0.05, jit: 15 }); },
      // お客さんに届ける「ちりん」：高い2音のベル
      // n：連鎖の何本目か（0 が1本目）。続くほど五音音階で1段ずつ上がり、「続けて決まった」が耳で分かる
      deliver: (n) => {
        const k = Math.max(0, Math.min(PENTA.length - 1, Math.floor(Number(n)) || 0));
        const m = Math.pow(2, PENTA[k] / 12), t = N();
        bell(E6 * m, t, { vol: 0.07, decay: 0.4 }); bell(G6 * m, t + 0.09, { vol: 0.06, decay: 0.5 });
        if (k > 0) bell(E6 * m * 2, t + 0.17, { vol: 0.035, decay: 0.35 });
      },
      // 次のお客さんが来る：軽い足音2つ
      arrive: () => { const t = N(); wood(430, t, { vol: 0.045, dur: 0.03, jit: 40 }); wood(510, t + 0.07, { vol: 0.045, dur: 0.03, jit: 40 }); },
      // 面クリア：短いファンファーレ（1.2秒以内）
      clear: () => {
        const t = N();
        [C5, E5, G5, C6].forEach((f, i) => mallet(f, t + i * 0.09, { vol: 0.1, decay: i === 3 ? 0.4 : 0.16 }));
        [C5, E5, G5].forEach((f) => partial(f, t + 0.4, 0.6, { vol: 0.04, a: 0.01 }));
        bell(G6, t + 0.46, { vol: 0.05, decay: 0.5 });
      },
      // 注げない：小さく低い「こつ」（責めない）
      deny: () => wood(210, N(), { vol: 0.07, dur: 0.05, jit: 20 }),
      // 1手もどす：逆回しの短い音
      undo: () => { const t = N(); noise(t, 0.08, { freq: 700, to: 1800, q: 0.7, vol: 0.035, a: 0.05 }); mallet(A5, t + 0.02, { vol: 0.07, decay: 0.06, bright: 0.3 }); mallet(E5, t + 0.07, { vol: 0.07, decay: 0.09, bright: 0.3 }); },
      // 詰み：下がる2音をやさしい和音で止める
      stuck: () => { const t = N(); mallet(G5, t, { vol: 0.08, decay: 0.16, bright: 0.25 }); mallet(E5, t + 0.14, { vol: 0.08, decay: 0.3, bright: 0.2 }); mallet(C5, t + 0.14, { vol: 0.04, decay: 0.4, bright: 0.2 }); }
    };

    // まとめてポン：「ポン」とはじける音が気持ちよさの中心。消した数 n が多いほど五音音階で高く・音が重なって明るくなる。
    // 一番高い基音でも A6（1760Hz）までにして、耳に痛くしない（高い倍音はマスターの lowpass で丸める）
    const POP_STEPS = [2, 3, 4, 5, 6, 8, 10, 13, 16, 20];   // この数以上で 1 段上がる（2個＝ド … 20個以上＝2オクターブ目のラ）
    const popStep = (n) => { const k = Math.floor(Number(n)) || 2; let i = 0; while (i < POP_STEPS.length - 1 && k >= POP_STEPS[i + 1]) i++; return i; };
    const popFreq = (i) => C5 * Math.pow(2, (12 * Math.floor(i / 5) + PENTA[i % 5]) / 12);
    const MATOMETE = {
      // 選ぶ「こつ」：軽い木の音。大きなかたまりほど少しだけ高い
      select: (n) => {
        const i = popStep(n), t = N();
        wood(560 + i * 40, t, { vol: 0.06, dur: 0.035, jit: 20 });
        partial(popFreq(i) * 2 > 1900 ? popFreq(i) : popFreq(i) * 2, t + 0.01, 0.06, { vol: 0.025 });
      },
      // はじける「ポン」：下から持ち上がる泡の音＋マリンバ。3段目から5度上、5段目からベル、7段目から和音のきらきら、
      // 9段目（16個以上）は低い支えも足す。部品は最大 20 個ほど（同時発音の上限 36 の中に収める）
      pop: (n) => {
        const i = popStep(n), f = popFreq(i), t = N();
        partial(f, t, 0.08, { vol: 0.07, from: f * 0.55, fromT: 0.025, a: 0.002 });
        mallet(f, t + 0.012, { vol: 0.1 + i * 0.006, decay: 0.12 + i * 0.02, bright: 0.35 + i * 0.03, jit: 4 });
        if (i >= 3) mallet(f * 1.5, t + 0.05, { vol: 0.07, decay: 0.16, bright: 0.3, jit: 4 });
        if (i >= 5) bell(Math.min(f * 2, 2100), t + 0.08, { vol: 0.03 + (i - 5) * 0.004, decay: 0.35 });
        if (i >= 7) [1, 1.26, 1.5].forEach((m, k) => partial(Math.min(f, 1050) * m, t + 0.11 + k * 0.04, 0.3, { vol: 0.03, a: 0.006 }));
        if (i >= 9) mallet(f / 4, t + 0.02, { vol: 0.07, decay: 0.35, bright: 0.15 });
      },
      // 上のマスが落ちて着く「とん」：低く小さく（何度も鳴るので控えめ）
      fall: () => { const t = N(); wood(190, t, { vol: 0.05, dur: 0.055, jit: 20 }); noise(t, 0.04, { type: "lowpass", freq: 600, vol: 0.025, a: 0.003 }); },
      // 全部消し：かけ上がり＋長い和音＋ベル（1.3 秒ほど）
      allclear: () => {
        const t = N();
        [C5, E5, G5, C6, E6].forEach((f, i) => mallet(f, t + i * 0.07, { vol: 0.1, decay: i === 4 ? 0.45 : 0.16 }));
        [C5, E5, G5].forEach((f) => partial(f, t + 0.38, 0.75, { vol: 0.04, a: 0.01 }));
        bell(G6, t + 0.42, { vol: 0.05, decay: 0.55 });
        bell(C6 * 2, t + 0.6, { vol: 0.04, decay: 0.6 });
      },
      // 終わり：ゆっくり下がって、やさしい和音で止まる（責めない）
      over: () => {
        const t = N();
        [G5, E5, C5].forEach((f, i) => mallet(f, t + i * 0.14, { vol: 0.09, decay: 0.25, bright: 0.3 }));
        [C5, G5].forEach((f) => mallet(f / 2, t + 0.42, { vol: 0.06, decay: 0.45, bright: 0.2 }));
      },
      // 1個だけで消せない：小さく低い「こつ」
      deny: () => wood(210, N(), { vol: 0.07, dur: 0.05, jit: 20 }),
      // 1手もどす：逆回しの短い音
      undo: () => { const t = N(); noise(t, 0.08, { freq: 700, to: 1800, q: 0.7, vol: 0.035, a: 0.05 }); mallet(A5, t + 0.02, { vol: 0.07, decay: 0.06, bright: 0.3 }); mallet(E5, t + 0.07, { vol: 0.07, decay: 0.09, bright: 0.3 }); }
    };

    const table = Object.assign({}, COMMON,
      game === "blocks" ? BLOCKS : (game === "tiles" || game === "2048") ? TILES : game === "kiritori" ? KIRI : game === "irocode" ? IROCODE : game === "pikatto" ? PIKATTO : game === "zenmai" ? ZENMAI : game === "hashi" ? HASHI : game === "irobin" ? IROBIN : game === "matomete" ? MATOMETE : {});

    return {
      get on() { return on; },
      // iPhone は画面に触れた瞬間でないと音を出す準備ができないため、操作のたびに呼ぶ
      unlock() { if (on) ensure(); },
      toggle() {
        on = !on;
        try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* 保存できなくても動作は続ける */ }
        if (on && ready()) table.toggle();
        return on;
      },
      play(name, arg) {
        if (!on || !ready()) return;
        try {
          const now = ctx.currentTime;
          if (GAP[name] && last[name] != null && now - last[name] < GAP[name]) return; // 連打の間引き
          last[name] = now;
          let off = 0;
          if (STAGGER[name]) {
            const base = now + 0.005;
            off = Math.min(STAGGER_MAX, Math.max(0, (nextAt[name] || 0) - base));
            nextAt[name] = base + off + STAGGER[name];
          }
          table[name](arg, off);
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
