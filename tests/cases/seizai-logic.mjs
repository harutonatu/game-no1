// WL: もくもくこうば の計算ロジック（Node で games/seizai/logic.js を直接読む。ブラウザ不要）
//   契約は docs/seizai-contract.md（§3 経済と節目、§4 API・閉じた間、§8 保存、§11.2 WL の項目）。
//   局面は loadSave（v:1 の保存の形）か newGame の写しを手で直して組む。ロジックの中身には触れず、公開された関数の結果だけを確かめる。
//   無いときに合格にしない：logic.js が無い・SeizaiLogic を公開していなければ例外で不合格にする。
//   単体でも流せる：node tests/cases/seizai-logic.mjs [ID...]（最後の「単体で流す」を参照）
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 重さを測る CPU 時間（このスレッドだけ。GC・JIT の裏のスレッドと、CPU が混んで待たされた時間を数えない。古い Node は process.cpuUsage。T-21）
const cpuOf = (prev) => (process.threadCpuUsage ? process.threadCpuUsage(prev) : process.cpuUsage(prev));

function load(root) {
  const f = path.join(root, 'games/seizai/logic.js');
  if (!fs.existsSync(f)) throw new Error('games/seizai/logic.js が無い（ロジックのテストができない）');
  const L = createRequire(f)(f);
  if (!L || typeof L.newGame !== 'function' || typeof L.step !== 'function' || typeof L.catchUp !== 'function') throw new Error('logic.js が SeizaiLogic を module.exports していない');
  return L;
}
const J = (x) => JSON.stringify(x);
const IDS = ['cut', 'plant', 'carry', 'peel', 'beam', 'dry', 'plank', 'plane', 'shop'];
const LINE = { peel: 1, beam: 1, dry: 1, plank: 1, plane: 1 };

// 段・お金・部署を指定して局面を作る（loadSave を通す＝保存の形のまま）。o.depts は { cut: { staff, level, mgr } ... } の一部
function mk(L, stage, o = {}) {
  const depts = {};
  for (const id of IDS) {
    const d = { level: 1, mgr: null };
    if (LINE[id]) d.lines = 1; else d.staff = id === 'plant' ? 0 : 1;
    depts[id] = { ...d, ...(o.depts && o.depts[id]) };
  }
  const raw = { v: 1, savedAt: 0, stage, cleared: false, money: 0, t: 0, forest: { trees: 10, saplings: 0 }, buf: {}, goal: { done: 0 }, order: null, orderSeq: 0, soldSinceOrder: 0, ships: 0, ship: { got: 0 }, totals: {}, seed: 7, rng: 12345, ...o, depts };
  const r = L.loadSave(JSON.stringify(raw));
  if (!r) throw new Error('mk: loadSave が null');
  return r.state;
}
// 1つの部署の速さを最大にした局面（全部の部署を上限・Lv50）
function maxed(L, stage) {
  const depts = {};
  for (const id of IDS) { const cap = L.CAPS[stage - 1][id]; depts[id] = LINE[id] ? { lines: Math.max(1, cap), level: 50, mgr: stage >= 2 ? 'gain' : null } : { staff: cap, level: 50, mgr: stage >= 2 ? 'gain' : null }; }
  return mk(L, stage, { depts });
}
function run(L, s, sec, dt = 0.1) {
  const evs = [];
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) { const r = L.step(s, dt); s = r.state; for (const e of r.events) evs.push(e); }
  return { s, evs };
}
const ofKind = (evs, k) => evs.filter((e) => e.kind === k);
const intIn = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

// 別プロセスで TZ を指定して、ローカル時刻の 23:59:30 → 翌 0:01:00 を awaySeconds に渡す（このプロセスの TZ に左右されない）
function awayInTZ(root, tz) {
  const code = 'const L=require(process.argv[1]);const a=new Date(2026,9,20,23,59,30).getTime(),b=new Date(2026,9,21,0,1,0).getTime();'
    + 'console.log(JSON.stringify({offset:new Date(a).getTimezoneOffset(),sec:L.awaySeconds(a,b),d1:new Date(a).getDate(),d2:new Date(b).getDate()}));';
  const r = spawnSync(process.execPath, ['-e', code, path.join(root, 'games/seizai/logic.js')], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return { err: r.stderr }; }
}

export const tests = [
  {
    id: 'WL1', tier: 'smoke', node: true, title: 'もくもくこうば：定数と表（§3・§4.2）、speedMul、費用の増え方（人 1.55・きかい 1.18・ライン 5・マネージャー1回）、売値（段の倍率・もうかる）、上限で null、formatYen',
    run({ check, root }) {
      const L = load(root);
      const K = { NAME: 'もくもくこうば', LEVEL_MAX: 50, MONEY_MAX: 9e15, GROW_TIME: 30, NATURAL_REGROW: 1 / 60, BOOST_SEC: 5, BOOST_COOLDOWN: 15, CALL_COOLDOWN: 10, ORDER_EVERY: 150,
        SHIP_BASE: 30000, SHIP_GROWTH: 1.2, SHIP_NEED_MAX: 9999900, SHIPS_MAX: 9999, SHIP_REWARD_MUL: 0.5, STEP: 0.1, OFFLINE_CAP_SEC: 7200, OFFLINE_STEP: 1, AWAY_RATE: 0.5, AWAY_CARD_MIN_SEC: 60,
        SAVE_VERSION: 1, SAVE_KEY: 'seizai.save', SAVE_KEY_BAK: 'seizai.save.bak', SAVE_KEY_BEST: 'seizai.best', SAVE_KEY_HELP: 'seizai.help' };
      const bad = Object.entries(K).filter(([k, v]) => L[k] !== v).map(([k, v]) => ({ k, want: v, got: L[k] }));
      check('定数が契約 §4.2 のとおり', bad.length === 0, bad);
      check('DEPTS は流れの順 cut→plant→carry→peel→beam→dry→plank→plane→shop、種類（人／台）と使える段（§19.1）', J(L.DEPTS.map((d) => [d.id, d.kind, d.stage])) === J([['cut', 'staff', 1], ['plant', 'staff', 1], ['carry', 'staff', 1], ['peel', 'line', 1], ['beam', 'line', 2], ['dry', 'line', 3], ['plank', 'line', 3], ['plane', 'line', 4], ['shop', 'staff', 1]]), L.DEPTS);
      check('STAGES は こや・こうば・こうじょう・みなと、売り物は むき丸太・角材・板・つるつるいた（§19.1.2）', J(L.STAGES.map((s) => [s.name, s.product])) === J([['こや', 'peeled'], ['こうば', 'beams'], ['こうじょう', 'planks'], ['みなと', 'smooth']]) && J([1, 2, 3, 4].map(L.productOf)) === J(['peeled', 'beams', 'planks', 'smooth']), L.STAGES);
      check('人数・台数の上限（§3.2 の表）', J(L.CAPS) === J([
        { cut: 3, plant: 1, carry: 3, peel: 2, beam: 0, dry: 0, plank: 0, plane: 0, shop: 1 }, { cut: 5, plant: 2, carry: 5, peel: 3, beam: 3, dry: 0, plank: 0, plane: 0, shop: 2 },
        { cut: 6, plant: 3, carry: 6, peel: 4, beam: 4, dry: 4, plank: 4, plane: 0, shop: 3 }, { cut: 8, plant: 4, carry: 8, peel: 4, beam: 4, dry: 4, plank: 4, plane: 4, shop: 4 }]), L.CAPS);
      check('置き場・売り物・森の上限（段ごと）', J(L.BUF_CAP) === J([20, 30, 40, 60]) && J(L.GOODS_CAP) === J([50, 100, 200, 400]) && J(L.FOREST_CAP) === J([12, 16, 20, 24]), null);
      check('表・API が凍結されている', Object.isFrozen(L) && Object.isFrozen(L.DEPTS) && Object.isFrozen(L.STAGES) && Object.isFrozen(L.CAPS) && Object.isFrozen(L.PRICE), null);
      check('speedMul(L) = 1 + 0.1×(L−1)（Lv1 で 1、Lv50 で 5.9）', L.speedMul(1) === 1 && Math.abs(L.speedMul(50) - 5.9) < 1e-12 && Math.abs(L.speedMul(11) - 2) < 1e-12, null);
      // 費用の増え方
      const s2 = mk(L, 2, { depts: { cut: { staff: 3, level: 5 }, peel: { lines: 2, level: 1 } } });
      const want = { staff: Math.round(L.STAFF_COST.cut * 1.55 ** 2), level: Math.round(L.LEVEL_COST.cut * 1.18 ** 4), line: Math.round(L.LINE_COST.peel * 5), mgr: L.MGR_COST.cut };
      const got = { staff: L.costOf(s2, 'cut', 'staff'), level: L.costOf(s2, 'cut', 'level'), line: L.costOf(s2, 'peel', 'line'), mgr: L.costOf(s2, 'cut', 'mgr') };
      check('費用：人 STAFF_COST×1.55^(人数−1)・きかい LEVEL_COST×1.18^(Lv−1)・ライン LINE_COST×5^(台数−1)・マネージャー MGR_COST', J(want) === J(got), { want, got });
      const s1 = L.newGame(1);
      check('なえぎの1人目（0人から）は STAFF_COST.plant、2人目からは ×1.55', L.costOf(s1, 'plant', 'staff') === L.STAFF_COST.plant && L.costOf(mk(L, 2, { depts: { plant: { staff: 1 } } }), 'plant', 'staff') === Math.round(L.STAFF_COST.plant * 1.55), null);
      const cut1 = L.costOf(s1, 'cut', 'staff'), cutAfter = (() => { let s = { ...s1, money: 1e6 }; s = L.buy(s, 'cut', 'staff').state; return L.costOf(s, 'cut', 'staff'); })();
      check('人を1人買うと次の値段が 1.55 倍（丸め）', cutAfter === Math.round(L.STAFF_COST.cut * 1.55) && cut1 === L.STAFF_COST.cut, { cut1, cutAfter });
      // 上限・まだ使えない
      const nulls = [L.costOf(s1, 'beam', 'line'), L.costOf(s1, 'beam', 'level'), L.costOf(s1, 'cut', 'mgr'), L.costOf(s1, 'cut', 'line'), L.costOf(s1, 'peel', 'staff'),
        L.costOf(mk(L, 1, { depts: { cut: { staff: 3 } } }), 'cut', 'staff'), L.costOf(mk(L, 2, { depts: { cut: { level: 50 } } }), 'cut', 'level'), L.costOf(mk(L, 2, { depts: { cut: { mgr: 'fast' } } }), 'cut', 'mgr'), L.costOf(s1, 'nope', 'staff'), L.costOf(s1, 'cut', 'nope')];
      check('上限・まだ使えない部署・こやのマネージャー・おかしな引数は null', nulls.every((x) => x === null), nulls);
      const rb = [L.buy(s1, 'beam', 'line').reason, L.buy(s1, 'cut', 'mgr').reason, L.buy(mk(L, 1, { money: 1e6, depts: { cut: { staff: 3 } } }), 'cut', 'staff').reason, L.buy(s1, 'cut', 'staff').reason];
      check("buy の理由：使えない 'locked'・上限 'max'・お金 'money'。失敗では state を変えない", J(rb) === J(['locked', 'locked', 'max', 'money']) && L.buy(s1, 'cut', 'staff').state === s1, rb);
      const bought = L.buy({ ...s1, money: 100 }, 'cut', 'staff');
      check('買うとお金が値段ぶん減り、人が1人増える', bought.ok && bought.state.money === 100 - cut1 && bought.state.depts.cut.staff === 2, bought.state && bought.state.depts.cut);
      // 売値
      const P = (st, gains, extra = {}) => { const d = {}; IDS.slice(0, gains).forEach((id) => { d[id] = { mgr: 'gain' }; }); return L.priceOf(mk(L, st, { depts: { ...d, ...extra } })); };
      const pw = [1, 2, 3, 4].map((st) => Math.max(1, Math.floor(L.PRICE[L.productOf(st)] * L.STAGE_MUL[st - 1] + 1e-9)));
      check('売値 = PRICE×STAGE_MUL（マネージャーなし）', J([1, 2, 3, 4].map((st) => P(st, 0))) === J(pw), { got: [1, 2, 3, 4].map((st) => P(st, 0)), want: pw });
      check('もうかる 1つで +25%・3つで +75%（切り捨て）・はやいは売値に効かない', P(3, 1) === Math.floor(pw[2] * 1.25 + 1e-9) && P(3, 3) === Math.floor(pw[2] * 1.75 + 1e-9) && P(3, 0, { cut: { mgr: 'fast' } }) === pw[2], [P(3, 1), P(3, 3)]);
      check('まだ使えない部署の もうかる は数えない（こうば で いた の gain）', P(2, 0, { plank: { mgr: 'gain' } }) === pw[1], P(2, 0, { plank: { mgr: 'gain' } }));
      check('STAGE_MUL は段ごとに増える', L.STAGE_MUL.every((x, i) => i === 0 || x > L.STAGE_MUL[i - 1]), L.STAGE_MUL);
      // formatYen
      const fy = [[0, '0 えん'], [-5, '0 えん'], [NaN, '0 えん'], [1234, '1,234 えん'], [9999, '9,999 えん'], [12000, '1.2まん えん'], [10000, '1まん えん'], [1234567, '123まん えん'], [340000000, '3.4おく えん'], [5.6e12, '5.6ちょう えん'], [9e15, '9000ちょう えん']];
      const fyBad = fy.filter(([n, w]) => L.formatYen(n) !== w).map(([n, w]) => ({ n, want: w, got: L.formatYen(n) }));
      check('formatYen の例（えん・まん・おく・ちょう、桁区切り、負と NaN は 0）', fyBad.length === 0, fyBad);
      let longest = '';
      for (let e = 0; e <= 16; e++) for (const m of [1, 1.99, 9.99, 99.99, 999.9, 9999.9]) { const t = L.formatYen(m * 10 ** e); if (t.length > longest.length) longest = t; }
      check('formatYen は最大でも 10 文字以内', longest.length <= 10 && L.formatYen(1e300).length <= 10, longest);
    },
  },
  {
    id: 'WL2', tier: 'smoke', node: true, title: 'もくもくこうば：流れ（次の置き場がいっぱいで止まる・bottleneck がいちばん遅い部署・売り物が段で変わる・木が尽きても自然に生えて止まり続けない・rates の式・マネージャーの はやい）',
    run({ check, root }) {
      const L = load(root);
      // つまり：かわむきの台 0 → logs がいっぱいで はこぶ が止まり、yard もいっぱいで きこり が止まる
      let s = mk(L, 1, { buf: { logs: 20, yard: 18 }, depts: { peel: { lines: 1 } } });
      s = { ...s, depts: { ...s.depts, peel: { ...s.depts.peel, lines: 0 } } };
      const r = run(L, s, 200);
      check('次の置き場（logs 20）がいっぱいなら はこぶ は止まる（done.carry 0）、yard は上限 20 で きこり も止まる', r.s.done.carry === 0 && r.s.buf.logs === 20 && r.s.buf.yard === 20 && r.s.done.cut === 2, { done: r.s.done, buf: r.s.buf });
      check('止まっている部署の進み prog は 1 を超えない', IDS.every((id) => r.s.prog[id] >= 0 && r.s.prog[id] <= 1), r.s.prog);
      // rates の式
      const s3 = mk(L, 3, { depts: { cut: { staff: 4, level: 11 }, beam: { lines: 2, level: 6, mgr: 'fast' } } });
      const rt = L.rates(s3);
      check('rates：人数×(1/BASE_TIME)×speedMul、はやい ×1.5', Math.abs(rt.cut - 4 / 6 * 2) < 1e-12 && Math.abs(rt.beam - 2 / 8 * 1.5 * 1.5) < 1e-12 && rt.plant === 0, rt);
      check('まだ使えない部署の rates は 0（こや の かくざい・いた）', L.rates(L.newGame(1)).beam === 0 && L.rates(L.newGame(1)).plank === 0, L.rates(L.newGame(1)));
      // bottleneck：なえぎ 0 人なら森（自然に生えるだけ）が いちばん遅い。なえぎ 1 人なら はこぶ（1/8）
      check('なえぎ 0 人のとき bottleneck は plant（自然に生える 1/60 だけ）', L.bottleneck(L.newGame(1)) === 'plant', L.bottleneck(L.newGame(1)));
      const sb = mk(L, 1, { depts: { plant: { staff: 1 } } });
      check('なえぎ 1 人・ほか 1 人ずつ：いちばん遅いのは はこぶ（1/8 本/秒）', L.bottleneck(sb) === 'carry', L.bottleneck(sb));
      const sb2 = mk(L, 1, { depts: { plant: { staff: 1 }, carry: { staff: 3 } } });
      check('はこぶを 3 人にすると、次は きこり（1/6）', L.bottleneck(sb2) === 'cut', L.bottleneck(sb2));
      const sb3 = mk(L, 3, { depts: { plant: { staff: 3 }, cut: { staff: 6 }, carry: { staff: 6 }, peel: { lines: 4 }, beam: { lines: 4 }, dry: { lines: 4 }, shop: { staff: 3, level: 10 } } });
      check('こうじょう で いた が 1 台なら bottleneck は plank', L.bottleneck(sb3) === 'plank', L.bottleneck(sb3));
      // 速くすると遅い所が速くなる（rates が上がる）
      const up = L.buy({ ...sb, money: 1e6 }, 'carry', 'staff').state;
      check('つまっている部署に人を足すと rates が上がる', L.rates(up).carry > L.rates(sb).carry, [L.rates(sb).carry, L.rates(up).carry]);
      // 売り物が段で変わる：売ったときに goods から出る品
      const sold = {};
      for (const st of [1, 2, 3]) {
        const m = maxed(L, st);
        const x = run(L, m, 120);
        sold[st] = { peeled: x.s.totals.peeled, beams: x.s.totals.beams, planks: x.s.totals.planks, sold: x.s.totals.sold };
      }
      check('こや は むき丸太を売る（角材・板は作らない）', sold[1].sold > 0 && sold[1].beams === 0 && sold[1].planks === 0, sold[1]);
      check('こうば は角材を売る（板は作らない）', sold[2].sold > 0 && sold[2].beams > 0 && sold[2].planks === 0, sold[2]);
      check('こうじょう は板を売る（角材1本 → 板 PLANKS_PER_BEAM 枚）', sold[3].sold > 0 && sold[3].planks > 0 && sold[3].planks % L.PLANKS_PER_BEAM === 0, sold[3]);
      // 木が尽きても自然に生える：なえぎ 0 人で 10 時間（catchUp を 10 回 = 開いて 10 時間ぶん）、どの1時間でも売れて、お金が増える
      let w = mk(L, 1, { depts: { cut: { staff: 3, level: 20 }, carry: { staff: 3, level: 20 }, peel: { lines: 2, level: 20 } } });
      const per = [];
      let minTrees = Infinity, forestOk = true;
      for (let h = 0; h < 10; h++) {
        const before = w.totals.sold;
        const c = L.catchUp(w, 7200); w = c.state;
        per.push(w.totals.sold - before);
        minTrees = Math.min(minTrees, w.forest.trees);
        if (w.forest.trees + w.forest.saplings > L.FOREST_CAP[0] + 1e-9 || w.forest.trees < 0 || w.forest.saplings < 0) forestOk = false;
      }
      check('なえぎ 0 人でも、どの1時間でも木が生えて売れ続ける（およそ 60 本/時間）', per.every((n) => n >= 50 && n <= 70), per);
      check('木＋苗木 ≦ FOREST_CAP、どちらも 0 以上', forestOk, minTrees);
      // なえぎを足すと木の流れが速くなる
      let p0 = mk(L, 1, { depts: { cut: { staff: 3, level: 20 }, carry: { staff: 3, level: 20 }, peel: { lines: 2, level: 20 }, shop: { level: 20 } } });
      let p1 = mk(L, 1, { depts: { cut: { staff: 3, level: 20 }, carry: { staff: 3, level: 20 }, peel: { lines: 2, level: 20 }, plant: { staff: 1, level: 20 }, shop: { level: 20 } } });
      const a0 = L.catchUp(p0, 7200).state.totals.sold, a1 = L.catchUp(p1, 7200).state.totals.sold;
      check('なえぎ 1 人（Lv20）がいると、いないときより何倍も売れる', a1 > a0 * 5, { a0, a1 });
      check('made の出来事は dept と n（1 以上の整数）を持ち、done の増え方と一致', (() => { const x = run(L, maxed(L, 3), 30); const sum = {}; for (const e of ofKind(x.evs, 'made')) sum[e.dept] = (sum[e.dept] || 0) + e.n; return ofKind(x.evs, 'made').every((e) => IDS.includes(e.dept) && Number.isInteger(e.n) && e.n >= 1) && IDS.every((id) => (sum[id] || 0) === x.s.done[id]); })(), null);
    },
  },
  {
    id: 'WL3', tier: 'smoke', node: true, title: 'もくもくこうば：応援（5 秒・2 倍・15 秒は使えない）と よびこみ（すぐ1人・10 秒・6 人まで）を state.t で数える',
    run({ check, root }) {
      const L = load(root);
      let s = mk(L, 1, { t: 100 });
      const r0 = L.rates(s).cut;
      const b = L.boost(s, 'cut');
      check('応援すると その部署の rates が 2 倍', b.ok && Math.abs(L.rates(b.state).cut - 2 * r0) < 1e-12 && L.rates(b.state).carry === L.rates(s).carry, [r0, b.ok && L.rates(b.state).cut]);
      check('boostUntil = t + 5、cooldownUntil = t + 15', b.state.depts.cut.boostUntil === 105 && b.state.depts.cut.cooldownUntil === 115, b.state.depts.cut);
      const at = (st, sec) => run(L, st, sec).s;
      const s49 = at(b.state, 4.9), s51 = at(b.state, 5.2);
      check('4.9 秒後はまだ 2 倍、5.2 秒後は元の速さ（state.t で数える）', Math.abs(L.rates(s49).cut - 2 * r0) < 1e-9 && Math.abs(L.rates(s51).cut - r0) < 1e-9, [L.rates(s49).cut, L.rates(s51).cut]);
      const c1 = L.boost(at(b.state, 14.8), 'cut');
      const c2 = L.boost(at(b.state, 15.1), 'cut');
      check("15 秒たつまでは 'cooldown'（state を変えない）、たてば また使える", !c1.ok && c1.reason === 'cooldown' && c2.ok, [c1.reason, c2.ok]);
      check('ほかの部署は別に数える（かわむき は すぐ使える）', L.boost(b.state, 'peel').ok, null);
      check("まだ使えない部署・無い部署は 'locked'", L.boost(s, 'beam').reason === 'locked' && L.boost(s, 'nope').reason === 'locked' && L.boost(s, 'goods').reason === 'locked', null);
      // よびこみ
      const cc = L.callCustomer({ ...s, queue: [] });
      check('よびこみ：すぐ1人並ぶ、callUntil = t + 10', cc.ok && cc.state.queue.length === 1 && cc.state.callUntil === 110, cc.state && { q: cc.state.queue, c: cc.state.callUntil });
      const cc2 = L.callCustomer(cc.state), cc3 = L.callCustomer(at({ ...cc.state, queue: [] }, 10.1));
      check("10 秒たつまでは 'cooldown'、たてば また使える", !cc2.ok && cc2.reason === 'cooldown' && cc3.ok, [cc2.reason, cc3.ok]);
      const full = { ...s, queue: Array.from({ length: 6 }, () => ({ kind: 'neighbor', want: 1 })) };
      check("並びが 6 人なら 'full'", L.callCustomer(full).reason === 'full', L.callCustomer(full).reason);
      // 並びが 6 人の間は来ない（売り物 0 で会計できない）
      const q = run(L, { ...s, queue: [] }, 120).s;
      check('売り物が無ければ お客さんは 6 人まで並んで待つ（帰らない・7 人目は来ない）', q.queue.length === 6, q.queue.length);
      // catchUp では応援は切れる
      const cu = L.catchUp(b.state, 120).state;
      check('閉じた間（catchUp）では応援は使われない（切れる）', cu.depts.cut.boostUntil <= cu.t && Math.abs(L.rates(cu).cut - r0) < 1e-12, cu.depts.cut);
    },
  },
  {
    id: 'WL4', tier: 'smoke', node: true, title: 'もくもくこうば：節目（目標は段ごとに 0 から・expand の条件と費用・引き継ぎ・古い売り物は売れる・新しい台が1台・みなとでは広げない）と goalOf',
    run({ check, root }) {
      const L = load(root);
      const g1 = L.goalOf(L.newGame(1));
      check('こや の目標：むき丸太を 100こ うろう（0/100）', g1.kind === 'sell' && g1.need === L.STAGES[0].goal && g1.done === 0 && g1.text === `むきまるたを ${L.STAGES[0].goal.toLocaleString('en-US')}こ うろう（0/${L.STAGES[0].goal.toLocaleString('en-US')}）`, g1);
      // 目標の数え方：売った数
      let s = mk(L, 1, { depts: { plant: { staff: 1, level: 30 }, cut: { staff: 3, level: 30 }, carry: { staff: 3, level: 30 }, peel: { lines: 2, level: 30 }, shop: { level: 30 } } });
      const x = run(L, s, 300);
      check('goal.done は この段で売った数（totals.sold と同じ）', x.s.goal.done === x.s.totals.sold && x.s.goal.done > 0, [x.s.goal.done, x.s.totals.sold]);
      check("目標に届いた step で { kind:'goal' } が1回", ofKind(x.evs, 'goal').length === (x.s.goal.done >= L.STAGES[0].goal ? 1 : 0), ofKind(x.evs, 'goal').length);
      const need = L.STAGES[0].goal, cost = L.STAGES[0].cost;
      const notYet = mk(L, 1, { money: cost * 10, goal: { done: need - 1 } });
      const noMoney = mk(L, 1, { money: cost - 1, goal: { done: need } });
      check("expand：目標が足りない 'goal'・お金が足りない 'money'（state を変えない）、canExpand は false", L.expand(notYet).reason === 'goal' && L.expand(noMoney).reason === 'money' && !L.canExpand(notYet) && !L.canExpand(noMoney) && L.expand(noMoney).state === noMoney, null);
      const ready = mk(L, 1, { money: cost + 500, goal: { done: need + 5 }, buf: { goods: 7, logs: 3, yard: 2 }, depts: { cut: { staff: 3, level: 9 }, peel: { lines: 2, level: 4 } } });
      const price1 = L.priceOf(ready);
      const e = L.expand(ready);
      check('canExpand が true、expand で段が 2 に', L.canExpand(ready) && e.ok && e.state.stage === 2, e.reason);
      check('費用を払い、古い売り物の山（むき丸太 7）は今の値段で売れて、売り物の山は 0', e.state.money === cost + 500 - cost + 7 * price1 && e.state.buf.goods === 0, { money: e.state.money, goods: e.state.buf.goods });
      check('目標の数は 0 から（goal.done 0）・goalOf は角材の文', e.state.goal.done === 0 && L.goalOf(e.state).need === L.STAGES[1].goal && L.goalOf(e.state).text.startsWith('かくざいを'), L.goalOf(e.state));
      check('人・台・きかい・置き場は引き継ぐ', e.state.depts.cut.staff === 3 && e.state.depts.cut.level === 9 && e.state.depts.peel.lines === 2 && e.state.depts.peel.level === 4 && e.state.buf.logs === 3 && e.state.buf.yard === 2, e.state.depts.cut);
      check('こうば で かくざい の台が1台来る（いた はまだ 0）', e.state.depts.beam.lines === 1 && e.state.depts.plank.lines === 0, [e.state.depts.beam, e.state.depts.plank]);
      check('こうば から マネージャーを雇える', L.costOf(e.state, 'cut', 'mgr') === L.MGR_COST.cut, L.costOf(e.state, 'cut', 'mgr'));
      const r3 = L.expand(mk(L, 2, { money: L.STAGES[1].cost, goal: { done: L.STAGES[1].goal } }));
      check('こうば → こうじょう：いた の台が1台、売り物は板', r3.ok && r3.state.stage === 3 && r3.state.depts.plank.lines === 1 && L.productOf(3) === 'planks', r3.state && r3.state.depts.plank);
      const r4s = mk(L, 3, { money: L.STAGES[2].cost, goal: { done: L.STAGES[2].goal }, buf: { goods: 30 } });
      const r4 = L.expand(r4s);
      check('こうじょう → みなと：売り物が つるつるいた に変わり、古い板の山 30 は今の値段で売れる、ship.got 0、かんな が 1台（§19.1）', r4.ok && r4.state.stage === 4 && r4.state.buf.goods === 0 && r4.state.ship.got === 0 && r4.state.money === 30 * L.priceOf(r4s) && r4.state.depts.plane.lines === 1 && r4.state.depts.plane.level === L.START_LEVEL.plane, r4.state && { goods: r4.state.buf.goods, money: r4.state.money, plane: r4.state.depts.plane });
      const m4 = mk(L, 4, { money: 9e15 });
      check("みなと では広げない（canExpand false・reason 'max'）", !L.canExpand(m4) && L.expand(m4).reason === 'max', null);
      // 目標を前の段から数え続けない（こうば で売っても、こや の数は持ち越さない）
      const y = run(L, maxed(L, 2), 60).s;
      check('こうば で売った数は こうば の goal.done（こや の分は入っていない）', y.goal.done === y.totals.sold, [y.goal.done, y.totals.sold]);
      check('goalOf の done は need で頭打ち、こうじょう は いた', L.goalOf(mk(L, 3, { goal: { done: 99999999 } })).done === L.STAGES[2].goal && L.goalOf(mk(L, 3)).text.startsWith('いたを'), L.goalOf(mk(L, 3, { goal: { done: 99999999 } })));
    },
  },
  {
    id: 'WL5', tier: 'smoke', node: true, title: 'もくもくこうば：大きな船の注文（§3.10）shipNeed・売れた板だけ積む・届くと ships +1 であまりを引き継ぐ・1せき目だけエンディング・2せき目からお礼を1回・SHIPS_MAX で止まる',
    run({ check, root }) {
      const L = load(root);
      check('shipNeed(0..3) = 30,000・36,000・43,200・51,800', J([0, 1, 2, 3].map(L.shipNeed)) === J([30000, 36000, 43200, 51800]), [0, 1, 2, 3].map(L.shipNeed));
      const seq = Array.from({ length: 80 }, (_, i) => L.shipNeed(i));
      check('増え続ける（減らない）、SHIP_NEED_MAX で頭打ち、n=32 から最大', seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq[32] === L.SHIP_NEED_MAX && seq[31] < L.SHIP_NEED_MAX && seq.every((v) => v <= L.SHIP_NEED_MAX), seq.slice(28, 34));
      const odd = [1e9, -1, NaN, Infinity, -Infinity, '5', null, undefined, 2.7, 61, 1e308].map((n) => L.shipNeed(n));
      check('おかしな n（1e9・−1・NaN・Infinity・文字・null・小数）でも有限の整数（負・NaN は 0 と同じ、小数は切り捨て）', odd.every((v) => Number.isInteger(v) && v > 0 && v <= L.SHIP_NEED_MAX) && odd[1] === 30000 && odd[2] === 30000 && odd[5] === 30000 && odd[8] === L.shipNeed(2) && odd[0] === L.SHIP_NEED_MAX, odd);
      // 売れた板だけ積む
      const base = maxed(L, 4);
      const merchant = (want) => ({ kind: 'merchant', want });
      const withQ = (s, q, extra = {}) => ({ ...s, queue: q, prog: { ...s.prog, shop: 1 }, ...extra });
      let s = withQ({ ...base, buf: { ...base.buf, goods: 20 } }, [merchant(20)]);
      let r = L.step(s, 0.1);
      check('みなとで売れた板の数だけ ship.got が増える（売り物の山は減る＝売れる、お金も入る）', r.state.ship.got === r.state.totals.sold && r.state.totals.sold >= 20 && r.state.money > 0, { got: r.state.ship.got, sold: r.state.totals.sold });
      check('goalOf は kind ship、「おおきな ふねに つるつるいたを つもう（20/30,000）」', L.goalOf(r.state).kind === 'ship' && L.goalOf(r.state).text === `おおきな ふねに つるつるいたを つもう（${r.state.ship.got}/30,000）` && L.goalOf(r.state).need === 30000, L.goalOf(r.state));
      // 大口の注文へ入った板は数えない
      const ord = { id: 1, who: 'x', need: 1000, got: 0, reward: 5, accepted: true };
      r = L.step(withQ({ ...base, buf: { ...base.buf, goods: 20 }, order: ord }, [merchant(20)]), 0.1);
      check('受けた大口の注文へ入った板は船に数えない（ship.got 0）', r.state.ship.got === 0 && r.state.order.got === 20 && r.state.totals.sold === 0, { ship: r.state.ship, order: r.state.order });
      // こうじょう で売っても数えない
      r = L.step(withQ({ ...maxed(L, 3), buf: { ...maxed(L, 3).buf, goods: 20 } }, [{ kind: 'furniture', want: 5 }]), 0.1);
      check('みなと以前（こうじょう）で売れた板は数えない', r.state.ship.got === 0 && r.state.totals.sold > 0, r.state.ship);
      // 1せき目：エンディング
      const p = L.priceOf(base);
      r = L.step(withQ({ ...base, buf: { ...base.buf, goods: 20 }, ship: { got: 30000 - 5 } }, [merchant(20)]), 0.1);
      const sh = ofKind(r.events, 'ship');
      check("1せき目：ships 0→1、cleared、{ kind:'ship', n:1, yen:0, ending:true }、あまり 15 を引き継ぐ", r.state.ships === 1 && r.state.cleared === true && sh.length === 1 && sh[0].n === 1 && sh[0].yen === 0 && sh[0].ending === true && r.state.ship.got === r.state.totals.sold - 5, { ships: r.state.ships, got: r.state.ship.got, sh });
      const moneyNoReward = r.state.totals.earned;
      check('1せき目はお礼なし（入ったお金は売ったぶんだけ）', moneyNoReward === r.state.totals.sold * p && r.state.money === moneyNoReward, { earned: moneyNoReward, sold: r.state.totals.sold, p });
      check('エンディング後の goalOf：「つぎの ふね：つるつるいたを つもう（…/36,000）」', L.goalOf(r.state).text === `つぎの ふね：つるつるいたを つもう（${r.state.ship.got}/36,000）` && L.goalOf(r.state).need === 36000, L.goalOf(r.state));
      // 2せき目：お礼 floor(0.5 × need × price) を1回だけ
      s = withQ({ ...base, buf: { ...base.buf, goods: 20 }, ships: 1, cleared: true, ship: { got: 36000 - 5 } }, [merchant(20)]);
      r = L.step(s, 0.1);
      const sh2 = ofKind(r.events, 'ship');
      const reward = Math.floor(0.5 * 36000 * p);
      check("2せき目：ships 1→2、{ ending:false, yen: floor(0.5×36,000×売値) }、お金は 売ったぶん＋お礼", r.state.ships === 2 && sh2.length === 1 && sh2[0].ending === false && sh2[0].yen === reward && r.state.money === r.state.totals.sold * p + reward, { sh2, reward, money: r.state.money });
      const after = run(L, r.state, 2).evs;
      check('お礼は1回だけ（続けて進めても ship の出来事は出ない）', ofKind(after, 'ship').length === 0, ofKind(after, 'ship'));
      // 1回の step で届くのは 1 せきまで
      r = L.step(withQ({ ...base, buf: { ...base.buf, goods: 20 }, ships: 1, cleared: true, ship: { got: 36000 * 3 } }, []), 0.1);
      check('1回の step で届くのは 1 せきまで', r.state.ships === 2 && ofKind(r.events, 'ship').length === 1, r.state.ships);
      // SHIPS_MAX
      s = withQ({ ...base, buf: { ...base.buf, goods: 20 }, ships: L.SHIPS_MAX, cleared: true, ship: { got: L.SHIP_NEED_MAX - 3 } }, [merchant(20)]);
      r = L.step(s, 0.1);
      check('SHIPS_MAX で止まる：ships は 9999 のまま、ship.got は need − 1 で止まる、お金は入り続ける', r.state.ships === L.SHIPS_MAX && r.state.ship.got === L.SHIP_NEED_MAX - 1 && r.state.money > 0 && ofKind(r.events, 'ship').length === 0, { ships: r.state.ships, got: r.state.ship.got });
      // 保存で引き継ぐ・壊れた値を丸める
      const sv = L.loadSave(L.makeSave({ ...base, ships: 3, cleared: true, ship: { got: 1234 } }, 1));
      check('ships・ship.got・cleared が保存で引き継がれる', sv.state.ships === 3 && sv.state.ship.got === 1234 && sv.state.cleared === true, sv.state.ships);
      const raw = (o) => L.loadSave(JSON.stringify({ v: 1, stage: 4, ...o })).state;
      const rp = [raw({ ships: -3 }), raw({ ships: 1e9 }), raw({ ships: 2.7 }), raw({ ships: 'x', cleared: true }), raw({ ships: 0, cleared: true }), raw({ ships: 5, cleared: false }), raw({ ships: 2, ship: { got: 1e12 } }), raw({ ships: 1, ship: { got: -5 } })];
      check('壊れた ships は 0〜SHIPS_MAX の整数に、cleared と食い違わない、ship.got は 0〜shipNeed(ships)−1', rp[0].ships === 0 && !rp[0].cleared && rp[1].ships === L.SHIPS_MAX && rp[1].cleared && rp[2].ships === 2 && rp[3].ships === 1 && rp[3].cleared && rp[4].ships === 1 && rp[5].cleared === true && rp[6].ship.got === L.shipNeed(2) - 1 && rp[7].ship.got === 0,
        rp.map((x) => [x.ships, x.cleared, x.ship.got]));
      const r3 = L.loadSave(JSON.stringify({ v: 1, stage: 3, ships: 4, cleared: true, ship: { got: 50 } })).state;
      check('みなと でなければ ships 0・cleared false・ship.got 0', r3.ships === 0 && r3.cleared === false && r3.ship.got === 0, [r3.ships, r3.cleared, r3.ship.got]);
    },
  },
  {
    id: 'WL6', tier: 'smoke', node: true, title: 'もくもくこうば：大口の注文（こうば から（§17.2）・売った数で来る・同時に1つ・受けた後は先に入る・お礼は1回・あとでも罰なし・とくべつな注文 5 回に 1 回くらい・相手は段ごとに 3 種類以上）',
    run({ check, root }) {
      const L = load(root);
      const lo = run(L, maxed(L, 1), 900);
      check('こや では注文は来ない（ORDER_FROM_STAGE 2）', L.ORDER_FROM_STAGE === 2 && ofKind(lo.evs, 'order').length === 0 && lo.s.order === null, lo.s.order);
      const k2 = run(L, maxed(L, 2), 900);
      const o2 = ofKind(k2.evs, 'order')[0];
      check('こうば でも売るうちに注文が来る（品は角材＝productOf(2)、相手は こうば の ORDER_BOSSES）', !!o2 && L.productOf(2) === 'beams' && L.ORDER_BOSSES[1].includes(o2.order.who), o2 && o2.order);
      check('相手の名前は こうば・こうじょう・みなと で 3 種類以上（こや は 0）、40 文字以内', L.ORDER_BOSSES[0].length === 0 && [1, 2, 3].every((i) => new Set(L.ORDER_BOSSES[i]).size >= 3 && L.ORDER_BOSSES[i].every((w) => typeof w === 'string' && w.length > 0 && w.length <= 40)), L.ORDER_BOSSES);
      // とくべつな注文：注文をたくさん作って割合・数・お礼を見る（forceOrder は newOrder と同じ式）
      {
        let st = maxed(L, 3);
        const os = [];
        for (let i = 0; i < 400; i++) { const f = L.forceOrder({ ...st, rng: (i * 2654435761) >>> 0 }); if (f.ok) os.push(f.state.order); }
        const big = os.filter((o) => o.big === true), nor = os.filter((o) => o.big === false);
        const p = L.priceOf(st);
        const okNor = nor.every((o) => o.reward === Math.floor(o.need * p * 3 + 1e-6) && o.need % 10 === 0);
        const okBig = big.every((o) => o.reward === Math.floor(o.need * p * 3 * 4 / 1.5 + 1e-6) && o.need % 10 === 0);
        const maxNor = Math.max(...nor.map((o) => o.need)), maxBig = Math.max(...big.map((o) => o.need));
        check(`とくべつな注文（big: true）は 400 回中 ${big.length} 回（5 回に 1 回くらい＝50〜110 回）、ほかは big: false`, os.length === 400 && big.length >= 50 && big.length <= 110 && big.length + nor.length === 400 && L.ORDER_BIG_RATE === 0.2, big.length);
        check('ふつうの注文のお礼は need×売値×3、とくべつは need×売値×3×4÷1.5（ふつうの 4 倍）、数は 10 の倍数', okNor && okBig && L.ORDER_BIG_NEED === 1.5 && L.ORDER_BIG_REWARD === 4, { p, nor: nor.slice(0, 2), big: big.slice(0, 2) });
        check(`とくべつな注文の数はふつうより大きい（最大 ${maxBig} ＞ ${maxNor}）`, maxBig > maxNor, [maxBig, maxNor]);
      }
      const x = run(L, maxed(L, 3), 900);
      const os = ofKind(x.evs, 'order');
      check("こうじょう では売るうちに注文が来る（{ kind:'order', order }）", os.length === 1 && x.s.order && x.s.order.accepted === false, os.length);
      const o = os[0] && os[0].order;
      check('注文の形 { id, who, need, got:0, reward, accepted:false, big }、need は 10 の倍数、reward = need×売値×3（とくべつは ×4÷1.5）', o && Number.isInteger(o.id) && typeof o.who === 'string' && o.who && o.need % 10 === 0 && o.need >= 10 && o.got === 0 && o.reward === Math.floor(o.need * L.priceOf(x.s) * 3 * (o.big ? 4 / 1.5 : 1) + 1e-6) && o.accepted === false && typeof o.big === 'boolean', o);
      check('受けないままでも次の注文は来ない（同時に1つ）、お客さんには売れ続ける（あとでも罰なし）', x.s.totals.sold > L.ORDER_EVERY * 2 && ofKind(x.evs, 'order').length === 1, x.s.totals.sold);
      const s1 = x.s;
      const before = { sold: s1.totals.sold, money: s1.money };
      const a = L.acceptOrder(s1);
      check('acceptOrder で accepted true（2回目は ok false）', a.ok && a.state.order.accepted === true && !L.acceptOrder(a.state).ok && !L.acceptOrder(L.newGame(1)).ok, null);
      const y = run(L, a.state, 600);
      const dv = ofKind(y.evs, 'delivered');
      check("受けた後は売り物が先に注文へ入り、届くと { kind:'delivered', order, yen: reward } が1回、order は null", dv.length >= 1 && dv[0].yen === o.reward && dv[0].order.id === o.id, dv.map((d) => [d.order.id, d.yen]));
      const firstDel = y.evs.findIndex((e) => e.kind === 'delivered');
      const soldBefore = y.evs.slice(0, firstDel).filter((e) => e.kind === 'sold').reduce((t, e) => t + e.n, 0);
      check('注文が届くまで（受けた後）に お客さんへ売れた数は少ない（板は先に注文へ）', soldBefore <= 30, soldBefore);
      const inc = y.evs.filter((e) => e.kind === 'sold' || e.kind === 'delivered').reduce((t, e) => t + e.yen, 0);
      check('お金の増え方 ＝ 売ったぶん＋お礼（お礼を2回払わない）', y.s.money - a.state.money === inc && y.s.totals.earned - a.state.totals.earned === inc, { money: y.s.money - a.state.money, inc });
      check('お礼は1回だけ（同じ id の delivered は1つ）', new Set(dv.map((d) => d.order.id)).size === dv.length, dv.map((d) => d.order.id));
      check('届いた後に 次の注文が来られる（soldSinceOrder は 0 から）', ofKind(y.evs, 'order').length >= 1, ofKind(y.evs, 'order').length);
      const f = L.forceOrder(maxed(L, 3));
      check('forceOrder（デバッグ用）：こうば・こうじょう で注文がすぐ出る、こや・注文があるときは ok false', f.ok && f.state.order && L.forceOrder(maxed(L, 2)).ok && !L.forceOrder(maxed(L, 1)).ok && !L.forceOrder(f.state).ok, f.state && f.state.order);
      void before;
    },
  },
  {
    id: 'WL7', tier: 'smoke', node: true, title: 'もくもくこうば：閉じた間（時計が戻る・0時またぎを Asia/Tokyo と America/Los_Angeles で・壊れた日付・上限 7200・半分の速さ AWAY_RATE）',
    run({ check, root }) {
      const L = load(root);
      const t = 1792000000000;
      // 時計が戻る
      check('awaySeconds(t, t−1)・awaySeconds(未来, いま) が 0', L.awaySeconds(t, t - 1) === 0 && L.awaySeconds(t + 3600e3, t) === 0 && L.awaySeconds(t, t) === 0, [L.awaySeconds(t, t - 1), L.awaySeconds(t + 3600e3, t)]);
      const cb = L.catchUp(L.newGame(1), L.awaySeconds(t + 5e6, t));
      check('時計が戻ったとき catchUp は何も進めない（お金はマイナスにも NaN にもならない）', cb.report.seconds === 0 && cb.report.effective === 0 && cb.state.money === 0 && Number.isFinite(cb.state.money), cb.report);
      // 0時またぎ
      for (const tz of ['Asia/Tokyo', 'America/Los_Angeles']) {
        const r = awayInTZ(root, tz);
        check(`0時またぎ（${tz}）：ローカルの 23:59:30 → 翌 0:01:00 が 90 秒（日付が変わっている）`, r.sec === 90 && r.d1 !== r.d2, r);
      }
      const o1 = awayInTZ(root, 'Asia/Tokyo').offset, o2 = awayInTZ(root, 'America/Los_Angeles').offset;
      check('2つの TZ が本当に違う（空振りしない）', typeof o1 === 'number' && typeof o2 === 'number' && o1 !== o2, [o1, o2]);
      // 壊れた日付
      const broken = ['abc', null, undefined, NaN, Infinity, -Infinity, {}, [], '1792000000000'];
      const bz = broken.flatMap((b) => [L.awaySeconds(b, t), L.awaySeconds(t, b)]);
      check('savedAt・now が 文字・null・NaN・Infinity・オブジェクト → 0', bz.every((x) => x === 0), bz);
      check('savedAt が負（とても古い）・とても大きい（未来）→ 上限 7200 と 0', L.awaySeconds(-1e15, t) === 7200 && L.awaySeconds(1e300, t) === 0 && L.awaySeconds(0, t) === 7200, [L.awaySeconds(-1e15, t), L.awaySeconds(1e300, t)]);
      // 上限
      check('awaySeconds：90 秒 → 90、3 時間・1 年 → 7200、端数は切り捨て', L.awaySeconds(t, t + 90500) === 90 && L.awaySeconds(t, t + 3 * 3600e3) === 7200 && L.awaySeconds(t, t + 365 * 86400e3) === 7200, null);
      const s = mk(L, 2, { depts: { plant: { staff: 2, level: 10 }, cut: { staff: 3, level: 10 }, carry: { staff: 3, level: 10 }, peel: { lines: 2, level: 10 }, beam: { lines: 2, level: 10 }, shop: { staff: 2, level: 10 } } });
      const c72 = L.catchUp(s, 7200), c3h = L.catchUp(s, 10800), c1y = L.catchUp(s, 365 * 86400);
      check('catchUp(3 時間)・catchUp(1 年) は catchUp(7200) と同じ結果、capped true', J(c3h.state) === J(c72.state) && J(c1y.state) === J(c72.state) && c3h.report.capped === true && c72.report.capped === false && c3h.report.seconds === 7200, [c3h.report.capped, c72.report.capped]);
      const two = L.catchUp(L.catchUp(s, 1800).state, 1800).state, one = L.catchUp(s, 3600).state;
      check('catchUp(a) を2回 ＝ catchUp(2a) に近い（上限内。稼ぎの差 5% 以内）', Math.abs(two.money - one.money) <= 0.05 * one.money && one.money > 0, [two.money, one.money]);
      // 半分の速さ
      check('AWAY_RATE === 0.5', L.AWAY_RATE === 0.5, L.AWAY_RATE);
      let manual = s;
      for (let i = 0; i < 3600; i++) manual = L.step(manual, 1).state;
      check('catchUp(s, 7200) は step を 1 秒ずつ 3600 回まわした結果と同じ（effective 3600、t が 3600 進む）', J(c72.state) === J(manual) && c72.report.effective === 3600 && Math.abs(c72.state.t - s.t - 3600) < 1e-6, { eff: c72.report.effective, dt: c72.state.t - s.t });
      const open = run(L, s, 7200, 1).s;
      const earnOpen = open.money - s.money, earnAway = c72.report.earned;
      check('閉じた 7200 秒の稼ぎは、開いたまま 7200 秒より少ない（およそ半分：0.4〜0.6）', earnAway < earnOpen && earnAway / earnOpen > 0.4 && earnAway / earnOpen < 0.6, { earnAway, earnOpen });
      check('report.earned はお金の増え方と同じ、sold・made は数', earnAway === c72.state.money - s.money && c72.report.sold > 0 && typeof c72.report.made.cut === 'number' && Array.isArray(c72.report.delivered), c72.report);
      const c1 = L.catchUp(s, 1), c90 = L.catchUp(s, 90);
      check('catchUp(s, 1) は effective 0 で何も変わらない（端数は切り捨て）、90 秒は effective 45', c1.report.effective === 0 && J(c1.state) === J(s) && c90.report.effective === 45 && c90.report.seconds === 90, [c1.report.effective, c90.report.effective]);
      const bad = [L.catchUp(s, -5), L.catchUp(s, NaN), L.catchUp(s, 'x'), L.catchUp(s, null)];
      check('catchUp の秒が 負・NaN・文字・null → 何も進めない', bad.every((c) => c.report.effective === 0 && c.state.t === s.t), bad.map((c) => c.report));
      check('catchUp は大口の注文・広げる・買うを自動でしない', (() => { const g = mk(L, 1, { money: 1e9, goal: { done: 1000 } }); const c = L.catchUp(g, 7200).state; return c.stage === 1 && J(c.depts) === J(g.depts); })(), null);
      // 重さは CPU 時間で見る（並列のテストで CPU が混んでも、待たされた時間を数えない。T-21・T-20 と同じ）
      const g4 = maxed(L, 4);
      const c0 = cpuOf(), t0 = process.hrtime.bigint();
      L.catchUp(g4, 7200);
      const cu = cpuOf(c0), ms = (cu.user + cu.system) / 1000, wall = Number(process.hrtime.bigint() - t0) / 1e6;
      check(`catchUp(7200)（みなと・全部最大）が Node で CPU 時間 50ms 以内（CPU ${ms.toFixed(1)}ms・壁の時計 ${wall.toFixed(1)}ms）`, ms <= 50, [ms.toFixed(1) + 'ms', wall.toFixed(1) + 'ms']);
    },
  },
  {
    id: 'WL8', tier: 'smoke', node: true, title: 'もくもくこうば：保存（makeSave → loadSave で同じ、壊れた値の一覧で落ちない・丸める、v:2・JSON でない・配列は null）、validateBest・validateFlag',
    run({ check, root }) {
      const L = load(root);
      let s = run(L, maxed(L, 3), 400).s;
      s = { ...s, money: 123456, order: { id: 3, who: 'かぐやの おやかた', need: 120, got: 40, reward: 9999, accepted: true, big: true }, orderSeq: 3 };
      const txt = L.makeSave(s, 1792000000000);
      const back = L.loadSave(txt);
      const strip = (x) => { const { prog, queue, done, arrive, callUntil, ...rest } = x; const depts = {}; for (const id of IDS) { const { boostUntil, cooldownUntil, ...d } = x.depts[id]; depts[id] = d; } return { ...rest, depts }; };
      check('makeSave → loadSave で同じ（prog・queue・done・応援とよびこみの残りを除く）、savedAt も戻る', back && J(strip(back.state)) === J(strip(s)) && back.savedAt === 1792000000000, back && { a: strip(back.state).buf, b: strip(s).buf });
      check('保存の形：v:1、savedAt、depts は staff|lines・level・mgr だけ、prog・queue・done は保存しない、2KB 前後', (() => { const o = JSON.parse(txt); return o.v === 1 && o.savedAt === 1792000000000 && !('prog' in o) && !('queue' in o) && !('done' in o) && J(Object.keys(o.depts.peel)) === J(['lines', 'level', 'mgr']) && J(Object.keys(o.depts.cut)) === J(['staff', 'level', 'mgr']) && txt.length < 2500; })(), txt.length);
      check('読み込んだ後は prog 0・queue 空・done 0', back.state.queue.length === 0 && IDS.every((id) => back.state.prog[id] === 0 && back.state.done[id] === 0), null);
      const nulls = ['', 'abc', '{', 'null', '[]', '[1,2]', '42', '"x"', '{}', '{"v":"1"}', '{"v":2}', '{"v":0}', '{"v":1.5}', '{"v":null}', null, undefined, 5, [], () => 1];
      const nb = nulls.filter((x) => L.loadSave(x) !== null);
      check('JSON でない・オブジェクトでない・配列・v が数でない・v:2・v:0 → null', nb.length === 0, nb.map(String));
      const B = (o) => L.loadSave(JSON.stringify({ v: 1, ...o }));
      const cases = [
        ['stage 文字', { stage: 'x' }, (r) => r.state.stage === 1],
        ['stage 9', { stage: 9 }, (r) => r.state.stage === 1],
        ['stage 2.5', { stage: 2.5 }, (r) => r.state.stage === 1],
        ['money 負', { money: -100 }, (r) => r.state.money === 0],
        ['money NaN 文字', { money: 'NaN' }, (r) => r.state.money === 0],
        ['money 超え', { money: 1e30 }, (r) => r.state.money === L.MONEY_MAX],
        ['money 小数', { money: 12.7 }, (r) => r.state.money === 12],
        ['staff 0', { stage: 2, depts: { cut: { staff: 0 } } }, (r) => r.state.depts.cut.staff === 1],
        ['staff 上限超え', { stage: 2, depts: { cut: { staff: 99 } } }, (r) => r.state.depts.cut.staff === 5],
        ['level 0・99・文字', { stage: 2, depts: { cut: { level: 0 }, peel: { level: 99 }, carry: { level: 'x' } } }, (r) => r.state.depts.cut.level === 1 && r.state.depts.peel.level === 50 && r.state.depts.carry.level === 1],
        ['mgr おかしな文字', { stage: 2, depts: { cut: { mgr: 'boss' } } }, (r) => r.state.depts.cut.mgr === null],
        ['こや の mgr', { stage: 1, depts: { cut: { mgr: 'fast' } } }, (r) => r.state.depts.cut.mgr === null],
        ['こうば の いた の台', { stage: 2, depts: { plank: { lines: 3, mgr: 'gain' } } }, (r) => r.state.depts.plank.lines === 0 && r.state.depts.plank.mgr === null && r.state.depts.beam.lines === 1],
        ['lines 0', { stage: 3, depts: { peel: { lines: 0 } } }, (r) => r.state.depts.peel.lines === 1],
        ['depts 配列', { depts: [1, 2] }, (r) => r.state.depts.cut.staff === 1],
        ['buf 負・超え', { buf: { yard: -4, logs: 1e9, goods: 'x' } }, (r) => r.state.buf.yard === 0 && r.state.buf.logs === L.BUF_CAP[0] && r.state.buf.goods === 0],
        ['forest 超え', { forest: { trees: 100, saplings: 100 } }, (r) => r.state.forest.trees === L.FOREST_CAP[0] && r.state.forest.saplings === 0],
        ['forest 壊れ', { forest: 'x' }, (r) => r.state.forest.trees === 10 && r.state.forest.saplings === 0],
        ['order 壊れ', { stage: 3, order: { need: 'x' } }, (r) => r.state.order === null],
        ['order こや', { stage: 1, order: { id: 1, need: 10, got: 0, reward: 5, accepted: true } }, (r) => r.state.order === null],
        ['order got 超え', { stage: 3, order: { id: 1, who: 'a', need: 10, got: 50, reward: 5, accepted: 'yes' } }, (r) => r.state.order && r.state.order.got === 9 && r.state.order.accepted === false],
        ['order こうば（§17.2 こうば から）', { stage: 2, order: { id: 1, who: 'a', need: 10, got: 0, reward: 5, accepted: true } }, (r) => r.state.order && r.state.order.need === 10 && r.state.order.accepted === true],
        ['order reward 0・負・文字 → need×売値×3 で計算し直す', { stage: 3, order: { id: 1, who: 'a', need: 120, got: 0, reward: 0 } }, (r) => r.state.order && r.state.order.reward === Math.floor(120 * L.priceOf(r.state) * 3 + 1e-6) && r.state.order.reward > 0],
        ['order reward 文字', { stage: 2, order: { id: 1, who: 'a', need: 30, got: 0, reward: 'x' } }, (r) => r.state.order && r.state.order.reward === Math.floor(30 * L.priceOf(r.state) * 3 + 1e-6)],
        ['order reward 負・とくべつ', { stage: 3, order: { id: 1, who: 'a', need: 150, got: 0, reward: -7, big: true } }, (r) => r.state.order && r.state.order.big === true && r.state.order.reward === Math.floor(150 * L.priceOf(r.state) * 3 * 4 / 1.5 + 1e-6)],
        ['order reward 超え', { stage: 3, order: { id: 1, who: 'a', need: 10, got: 0, reward: 1e30 } }, (r) => r.state.order && r.state.order.reward === L.MONEY_MAX],
        ['order big 文字・1 → false', { stage: 3, order: { id: 1, who: 'a', need: 10, got: 0, reward: 5, big: 'yes' } }, (r) => r.state.order && r.state.order.big === false && L.loadSave(JSON.stringify({ v: 1, stage: 3, order: { need: 10, big: 1 } })).state.order.big === false],
        ['goal 負', { goal: { done: -9 } }, (r) => r.state.goal.done === 0],
        ['totals 壊れ', { totals: { sold: -1, earned: 'x', logs: 1e40 } }, (r) => r.state.totals.sold === 0 && r.state.totals.earned === 0 && r.state.totals.logs === L.MONEY_MAX],
        ['seed・rng 壊れ', { seed: 'x', rng: -1 }, (r) => Number.isInteger(r.state.seed) && Number.isInteger(r.state.rng) && r.state.rng >= 0],
        ['savedAt 壊れ', { savedAt: 'x' }, (r) => Number.isNaN(r.savedAt) && L.awaySeconds(r.savedAt, 1792000000000) === 0],
        ['t 負', { t: -50 }, (r) => r.state.t === 0],
        ['フィールドが全部無い', {}, (r) => r.state.stage === 1 && r.state.money === 0 && r.state.depts.cut.staff === 1],
      ];
      const fails = [];
      for (const [name, o, ok] of cases) { let r; try { r = B(o); if (!r || !ok(r)) fails.push(name); } catch (e) { fails.push(name + ' 例外 ' + e.message); } }
      check(`壊れた値 ${cases.length} 通り：フィールドごとに丸めて、ほかは残す（全部は捨てない）`, fails.length === 0, fails);
      const keep = B({ stage: 3, money: 777, depts: { cut: { staff: 'x', level: 12 } } });
      check('1つ壊れていても、ほかの進み（段・お金・きかい）は残る', keep.state.stage === 3 && keep.state.money === 777 && keep.state.depts.cut.level === 12 && keep.state.depts.cut.staff === 1, null);
      const vb = [[null, 0], [undefined, 0], ['', 0], ['x', 0], ['1', 1], ['4', 4], ['5', 5], ['6', 0], ['-1', 0], ['2.5', 0], [3, 3], [9, 0], [NaN, 0]].filter(([r, w]) => L.validateBest(r) !== w);
      check('validateBest は 0〜5 の整数（それ以外 0）', vb.length === 0, vb);
      check("validateFlag は '1' のときだけ true", L.validateFlag('1') === true && [1, true, '0', 'true', null, undefined, ''].every((x) => L.validateFlag(x) === false), null);
      check('makeSave に壊れた state を渡しても例外なし（null）', L.makeSave(null, 1) === null && L.makeSave('x', 1) === null, null);
    },
  },
  {
    id: 'WL9', tier: 'smoke', node: true, title: 'もくもくこうば：決定的（同じ種・同じ操作で同じ）・イミュータブル（渡した state を変えない）・おかしな引数でも例外を出さない',
    run({ check, root }) {
      const L = load(root);
      const play = (seed) => { let s = L.newGame(seed); for (let i = 0; i < 3000; i++) { s = L.step(s, 0.1).state; if (i % 50 === 0) { s = L.buy(s, 'cut', 'level').state; s = L.boost(s, 'peel').state; s = L.callCustomer(s).state; } } return s; };
      check('同じ種・同じ操作 → 同じ state', J(play(5)) === J(play(5)), null);
      const a = run(L, maxed(L, 4), 300).s, b = run(L, maxed(L, 4), 300).s;
      check('同じ局面からは同じ結果（お客さんの種類・数は種つきの乱数）', J(a) === J(b) && J(play(5)) !== J(play(6)), null);
      const s0 = run(L, maxed(L, 3), 50).s;
      const snap = J(s0);
      L.step(s0, 0.5); L.buy({ ...s0, money: 1e9 }, 'cut', 'level'); L.boost(s0, 'cut'); L.callCustomer(s0); L.catchUp(s0, 600); L.expand(s0); L.setMgr(s0, 'cut', 'fast'); L.acceptOrder(s0); L.makeSave(s0, 1); L.goalOf(s0); L.rates(s0); L.forceOrder(s0); L.fastForward(s0, 30);
      check('どの関数も渡した state を書き換えない', J(s0) === snap, null);
      // fastForward（§17.1 A8）：step を STEP ずつ繰り返したのと同じ結果・同じ出来事（order・delivered・goal・ship）
      {
        const keep = (evs) => evs.filter((e) => ['order', 'delivered', 'goal', 'ship'].includes(e.kind));
        const fails = [];
        for (const [name, st0, sec] of [['こや 120 秒', L.newGame(3), 120], ['こうば 600 秒', maxed(L, 2), 600], ['こうじょう 注文を受けて 900 秒', L.acceptOrder(L.forceOrder(maxed(L, 3)).state).state, 900], ['みなと 300 秒', { ...maxed(L, 4), ship: { got: L.shipNeed(0) - 50 } }, 300]]) {
          const a = run(L, st0, sec), f = L.fastForward(st0, sec);
          if (J(a.s) !== J(f.state) || J(keep(a.evs)) !== J(f.events) || f.report.steps !== Math.round(sec / L.STEP)) fails.push({ name, ev: [keep(a.evs).length, f.events.length], t: [a.s.t, f.state.t] });
        }
        check('fastForward(s, sec) は step(0.1) を sec÷0.1 回まわした結果と同じ（state と order・delivered・goal・ship の出来事）', fails.length === 0, fails);
        const z = L.fastForward(s0, -5), n = L.fastForward(s0, NaN), big = L.fastForward(L.newGame(1), 1e12);
        check('fastForward：負・NaN は進めない、とても大きい秒は FF_MAX_SEC（1 日）で止める、おかしな state は例外なし', z.report.steps === 0 && n.report.steps === 0 && J(z.state) === J(L.step(s0, 0).state) && big.report.steps === Math.round(L.FF_MAX_SEC / L.STEP) && (() => { try { L.fastForward(null, 5); L.fastForward('x', 'y'); return true; } catch { return false; } })(), [z.report, n.report, big.report.steps]);
      }
      const st = L.step(s0, 0.1).state;
      check('step は新しいオブジェクトを返す（中の objects も別）', st !== s0 && st.buf !== s0.buf && st.depts !== s0.depts && st.depts.cut !== s0.depts.cut, null);
      const m = L.setMgr(mk(L, 2, { depts: { cut: { mgr: 'fast' } } }), 'cut', 'gain');
      check("setMgr：雇った後だけ 'fast'|'gain' に無料で切り替え、雇う前・おかしな種類は ok false", m.ok && m.state.depts.cut.mgr === 'gain' && m.state.money === 0 && !L.setMgr(mk(L, 2), 'cut', 'gain').ok && !L.setMgr(m.state, 'cut', 'boss').ok, null);
      const hire = L.buy(mk(L, 2, { money: 1000 }), 'cut', 'mgr');
      check("マネージャーを雇うと 'fast' で始まる", hire.ok && hire.state.depts.cut.mgr === 'fast' && hire.state.money === 1000 - L.MGR_COST.cut, hire.state && hire.state.depts.cut);
      const weird = [undefined, null, 0, 'x', [], {}, NaN, { stage: 'x' }, { stage: 2 }];
      const errs = [];
      for (const w of weird) {
        for (const [name, f] of [['step', () => L.step(w, 0.1)], ['step dt', () => L.step(L.newGame(1), w)], ['rates', () => L.rates(w)], ['bottleneck', () => L.bottleneck(w)], ['priceOf', () => L.priceOf(w)], ['productOf', () => L.productOf(w)], ['costOf', () => L.costOf(w, w, w)],
          ['buy', () => L.buy(w, w, w)], ['setMgr', () => L.setMgr(w, w, w)], ['boost', () => L.boost(w, w)], ['callCustomer', () => L.callCustomer(w)], ['acceptOrder', () => L.acceptOrder(w)], ['canExpand', () => L.canExpand(w)], ['expand', () => L.expand(w)],
          ['goalOf', () => L.goalOf(w)], ['shipNeed', () => L.shipNeed(w)], ['awaySeconds', () => L.awaySeconds(w, w)], ['catchUp', () => L.catchUp(w, w)], ['formatYen', () => L.formatYen(w)], ['makeSave', () => L.makeSave(w, w)], ['loadSave', () => L.loadSave(w)],
          ['validateBest', () => L.validateBest(w)], ['validateFlag', () => L.validateFlag(w)], ['newGame', () => L.newGame(w)], ['forceOrder', () => L.forceOrder(w)]]) {
          try { f(); } catch (e) { errs.push(`${name}(${J(w)}): ${e.message}`); }
        }
      }
      check('おかしな引数の一覧で例外を出さない', errs.length === 0, errs.slice(0, 10));
      const big = L.step(L.newGame(1), 50), neg = L.step(L.newGame(1), -3);
      check('step の dt は 0〜1 に丸める（50 → 1 秒、負 → 進まない）', Math.abs(big.state.t - 1) < 1e-12 && neg.state.t === 0, [big.state.t, neg.state.t]);
      check('newGame の形（§4.1）：段 1・お金 0・木 10・苗木 0・きこり/はこぶ/売り子 1 人・なえぎ 0 人・かわむき 1 台', (() => { const g = L.newGame(3); return g.stage === 1 && g.cleared === false && g.money === 0 && g.t === 0 && g.forest.trees === 10 && g.forest.saplings === 0 && g.depts.cut.staff === 1 && g.depts.plant.staff === 0 && g.depts.carry.staff === 1 && g.depts.shop.staff === 1 && g.depts.peel.lines === 1 && g.depts.beam.lines === 0 && g.order === null && g.ships === 0 && g.ship.got === 0 && Array.isArray(g.queue) && Number.isInteger(g.seed) && Number.isInteger(g.rng); })(), L.newGame(3));
    },
  },
  {
    id: 'WL10', tier: 'smoke', node: true, title: 'もくもくこうば：1000 回の乱数の操作（買う・応援・よびこみ・注文・広げる・step の大きさ・閉じた間）で不変条件（お金は 0〜上限の整数、置き場は 0〜上限、木＋苗木 ≦ 上限、totals は減らない、ships と cleared が食い違わない）',
    run({ check, root }) {
      const L = load(root);
      let r = 99;
      const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
      const bad = [];
      for (const start of [L.newGame(11), maxed(L, 2), maxed(L, 3), { ...maxed(L, 4), money: 9e15 - 1000 }]) {
        let s = { ...start, money: Math.max(start.money, 5000) };
        for (let i = 0; i < 250; i++) {
          const prev = s;
          const k = rnd();
          const d = IDS[Math.floor(rnd() * IDS.length)];
          if (k < 0.25) s = L.buy({ ...s, money: Math.min(9e15, s.money + Math.floor(rnd() * 1e7)) }, d, ['staff', 'line', 'level', 'mgr'][Math.floor(rnd() * 4)]).state;
          else if (k < 0.35) s = L.boost(s, d).state;
          else if (k < 0.42) s = L.callCustomer(s).state;
          else if (k < 0.47) s = L.acceptOrder(s).state;
          else if (k < 0.52) s = L.expand({ ...s, goal: { done: 1e7 }, money: Math.min(9e15, s.money + 5e6) }).state;
          else if (k < 0.55) s = L.setMgr(s, d, rnd() < 0.5 ? 'fast' : 'gain').state;
          else if (k < 0.58) s = L.catchUp(s, Math.floor(rnd() * 400)).state;
          else s = L.step(s, [0.1, 0.016, 0.25, 1, 0.5][Math.floor(rnd() * 5)]).state;
          const si = s.stage - 1;
          if (!Number.isInteger(s.money) || s.money < 0 || s.money > L.MONEY_MAX) bad.push(['money', s.money]);
          for (const b of ['yard', 'logs', 'peeled', 'beams', 'dried', 'planks']) if (!(s.buf[b] >= 0 && s.buf[b] <= L.BUF_CAP[si])) bad.push([b, s.buf[b]]);
          if (!(s.buf.goods >= 0 && s.buf.goods <= L.GOODS_CAP[si])) bad.push(['goods', s.buf.goods]);
          if (!(s.forest.trees >= 0 && s.forest.saplings >= 0 && s.forest.trees + s.forest.saplings <= L.FOREST_CAP[si] + 1e-9)) bad.push(['forest', s.forest]);
          for (const t of ['logs', 'peeled', 'beams', 'dried', 'planks', 'smooth', 'sold', 'earned']) if (s.totals[t] < prev.totals[t]) bad.push(['totals', t]);
          if (s.queue.length > 6) bad.push(['queue', s.queue.length]);
          if (!intIn(s.ships, 0, L.SHIPS_MAX) || (s.ships >= 1) !== s.cleared) bad.push(['ships', s.ships, s.cleared]);
          for (const id of IDS) { const dd = s.depts[id], c = dd.lines ?? dd.staff; if (!intIn(c, 0, L.CAPS[si][id] || 1) || !intIn(dd.level, 1, 50)) bad.push(['dept', id, dd]); }
          if (s.order && !(s.order.got >= 0 && s.order.got <= s.order.need)) bad.push(['order', s.order]);
          if (bad.length > 5) break;
        }
      }
      check('1000 回の操作のあいだ不変条件が守られる', bad.length === 0, bad.slice(0, 6));
      const mm = L.step({ ...maxed(L, 4), money: 9e15 - 5, buf: { ...maxed(L, 4).buf, goods: 400 }, queue: [{ kind: 'merchant', want: 20 }], prog: { ...maxed(L, 4).prog, shop: 1 } }, 0.1).state;
      check('お金は MONEY_MAX で止まる', mm.money === L.MONEY_MAX, mm.money);
    },
  },
  {
    id: 'WL12', tier: 'smoke', node: true, title: 'もくもくこうば：工程（§19.1）かんそう（こうじょう から）・かんな（みなと から）の並びと使える段・いた は かわいた かくざい を使う・みなと は いた → かんな → つるつるいた・広げると 1台・つまりになりうる・もうかる 最大 9・目標の文・v25 の形の保存を読んで止まらない',
    run({ check, root }) {
      const L = load(root);
      const order = L.DEPTS.map((d) => d.id);
      check('DEPTS の並び：かくざい → かんそう → いた → かんな → おみせ、dry は 3 から・plane は 4 から（台）', J(order) === J(IDS) && L.DEPTS.find((d) => d.id === 'dry').stage === 3 && L.DEPTS.find((d) => d.id === 'plane').stage === 4 && L.DEPTS.filter((d) => d.id === 'dry' || d.id === 'plane').every((d) => d.kind === 'line'), order);
      check('品の表：smooth の値段・名前・単位、dried の名前・単位、productOf(3) は planks・productOf(4) は smooth', L.PRICE.smooth > L.PRICE.planks && L.PRODUCT_NAME.smooth === 'つるつるいた' && L.PRODUCT_UNIT.smooth === 'まい' && L.PRODUCT_NAME.dried === 'かわいた かくざい' && L.PRODUCT_UNIT.dried === 'ぽん' && L.productOf(3) === 'planks' && L.productOf(4) === 'smooth', { price: L.PRICE });
      // 使えない段
      const s2 = mk(L, 2, { money: 1e9 });
      const lk = ['line', 'level', 'mgr'].map((w) => [L.buy(s2, 'dry', w).reason, L.costOf(s2, 'dry', w), L.buy(mk(L, 3, { money: 1e9 }), 'plane', w).reason, L.costOf(mk(L, 3, { money: 1e9 }), 'plane', w)]);
      check("こうば で かんそう、こうじょう で かんな は buy が 'locked'・costOf が null（台・きかい・マネージャー）", lk.every((x) => x[0] === 'locked' && x[1] === null && x[2] === 'locked' && x[3] === null), lk);
      check('こうば・こうじょう の state では かんそう／かんな は 0台（loadSave で欄があっても）', s2.depts.dry.lines === 0 && s2.depts.plane.lines === 0 && mk(L, 3).depts.plane.lines === 0 && mk(L, 3).depts.dry.lines === 1, [s2.depts.dry, s2.depts.plane]);
      // こうじょう：いた は dried を使う
      const fast3 = { cut: { staff: 6, level: 30 }, plant: { staff: 3, level: 30 }, carry: { staff: 6, level: 30 }, peel: { lines: 4, level: 30 }, beam: { lines: 4, level: 30 }, plank: { lines: 4, level: 30 }, shop: { staff: 3, level: 30 } };
      const b3 = mk(L, 3, { buf: { beams: 30 }, depts: fast3 });
      const noDry = { ...b3, depts: { ...b3.depts, dry: { ...b3.depts.dry, lines: 0 } } };
      const xa = run(L, noDry, 60).s, xb = run(L, b3, 60).s;
      check('こうじょう：かんそう が 0台なら いた は角材を使わない（板 0・角材はたまったまま）', xa.totals.planks === 0 && xa.buf.beams >= 30 && xa.totals.dried === 0, { planks: xa.totals.planks, beams: xa.buf.beams });
      check('こうじょう：かんそう が 角材 → かわいた かくざい（totals.dried）、いた が それを 2まいに、売り物は板（つるつるいた は作らない）', xb.totals.dried > 0 && xb.totals.planks > 0 && xb.totals.planks <= xb.totals.dried * L.PLANKS_PER_BEAM && xb.totals.smooth === 0 && xb.totals.sold > 0 && xb.buf.planks === 0, { dried: xb.totals.dried, planks: xb.totals.planks, smooth: xb.totals.smooth });
      // みなと：いた → planks、かんな → goods
      const m4 = maxed(L, 4);
      const noPlane = { ...m4, depts: { ...m4.depts, plane: { ...m4.depts.plane, lines: 0 } } };
      const ya = run(L, noPlane, 60).s, yb = run(L, m4, 60).s;
      check('みなと：かんな が 0台なら いた は売り物の山へ出さない（goods 0・planks がたまる・売れない）', ya.buf.goods === 0 && ya.buf.planks > 0 && ya.totals.sold === 0 && ya.totals.planks > 0, { goods: ya.buf.goods, planks: ya.buf.planks, sold: ya.totals.sold });
      check('みなと：かんな が いた 1まい → つるつるいた 1まい（totals.smooth）、売れて船に積む', yb.totals.smooth > 0 && yb.totals.smooth <= yb.totals.planks && yb.totals.sold > 0 && yb.ship.got === yb.totals.sold, { smooth: yb.totals.smooth, planks: yb.totals.planks, sold: yb.totals.sold });
      check("made の出来事に dry・plane（done と一致）", (() => { const x = run(L, m4, 30); const n = (id) => ofKind(x.evs, 'made').filter((e) => e.dept === id).reduce((t, e) => t + e.n, 0); return n('dry') > 0 && n('plane') > 0 && n('dry') === x.s.done.dry && n('plane') === x.s.done.plane; })(), null);
      // 広げると 1台・START_LEVEL
      const e3 = L.expand(mk(L, 2, { money: L.STAGES[1].cost, goal: { done: L.STAGES[1].goal } })).state;
      const e4 = L.expand(mk(L, 3, { money: L.STAGES[2].cost, goal: { done: L.STAGES[2].goal } })).state;
      check('こうじょう に広げると かんそう 1台（Lv START_LEVEL.dry）、みなと に広げると かんな 1台（Lv START_LEVEL.plane）', e3.depts.dry.lines === 1 && e3.depts.dry.level === L.START_LEVEL.dry && e3.depts.plane.lines === 0 && e4.depts.plane.lines === 1 && e4.depts.plane.level === L.START_LEVEL.plane, [e3.depts.dry, e4.depts.plane]);
      check('START_LEVEL は 1〜LEVEL_MAX の整数', ['dry', 'plane'].every((k) => intIn(L.START_LEVEL[k], 1, L.LEVEL_MAX)), L.START_LEVEL);
      // つまり
      const jam3 = mk(L, 3, { depts: { ...fast3, dry: { lines: 1, level: 1 } } });
      const jam4 = { ...m4, depts: { ...m4.depts, plane: { lines: 1, level: 1, mgr: null, boostUntil: 0, cooldownUntil: 0 } } };
      check('bottleneck が dry（こうじょう・かんそう 1台 Lv1）・plane（みなと・かんな 1台 Lv1）になりうる', L.bottleneck(jam3) === 'dry' && L.bottleneck(jam4) === 'plane', [L.bottleneck(jam3), L.bottleneck(jam4)]);
      // かんな の速さは 板 2まい ＝ 丸太 1本 に直して比べる：板の数では ほかより速いが、丸太に直すと いちばん遅い局面を探す
      {
        let found = null;
        for (let lines = 1; lines <= 4 && !found; lines++) for (let lv = 1; lv <= 50 && !found; lv++) {
          const st = { ...m4, depts: { ...m4.depts, plane: { ...m4.depts.plane, lines, level: lv, mgr: 'gain' } } };
          const r = L.rates(st);
          const others = Math.min(r.cut, r.carry, r.peel, r.beam, r.dry, r.plank);
          if (r.plane / 2 < others * 0.95 && r.plane > others * 1.05) found = { st, lines, lv, plane: r.plane, others };
        }
        check('かんな の流れは板 2まいを丸太 1本に直して比べる（板の数では速くても、丸太に直して いちばん遅ければ bottleneck は plane）', found && L.bottleneck(found.st) === 'plane', found && { lines: found.lines, lv: found.lv, plane: found.plane, others: found.others, bn: L.bottleneck(found.st) });
      }
      // もうかる 最大 9
      const all = {}; for (const id of IDS) all[id] = { mgr: 'gain' };
      const p4 = L.priceOf(mk(L, 4, { depts: all }));
      check('みなと で 9 部署が もうかる：売値 = floor(PRICE.smooth × 6 × 3.25)（新しい部署も数える）', p4 === Math.floor(L.PRICE.smooth * L.STAGE_MUL[3] * (1 + 0.25 * 9) + 1e-9), p4);
      const p3 = L.priceOf(mk(L, 3, { depts: all }));
      check('こうじょう では かんな の もうかる は数えない（8 部署）', p3 === Math.floor(L.PRICE.planks * L.STAGE_MUL[2] * (1 + 0.25 * 8) + 1e-9), p3);
      // 目標の文
      const gl = L.goalOf(mk(L, 4, { ships: 9999, cleared: true, ship: { got: 1e12 } }));
      check('みなと の目標の文：いちばん長い「つぎの ふね：つるつるいたを つもう（9,999,899/9,999,900）」', gl.text === 'つぎの ふね：つるつるいたを つもう（9,999,899/9,999,900）' && L.goalOf(mk(L, 4)).text === 'おおきな ふねに つるつるいたを つもう（0/30,000）', gl.text);
      // v25 の形の保存（dry・plane・dried・smooth が無い）
      const v25 = (stage, extra) => {
        const depts = {}; for (const id of ['cut', 'plant', 'carry', 'peel', 'beam', 'plank', 'shop']) depts[id] = LINE[id] ? { lines: stage >= ({ peel: 1, beam: 2, plank: 3 })[id] ? 2 : 0, level: 12, mgr: stage >= 2 ? 'gain' : null } : { staff: 2, level: 12, mgr: stage >= 2 ? 'gain' : null };
        return JSON.stringify({ v: 1, savedAt: 1792000000000, stage, cleared: false, money: 5000, t: 9000, forest: { trees: 15, saplings: 2 }, buf: { yard: 5, logs: 5, peeled: 5, beams: 30, planks: 0, goods: 0 }, depts, goal: { done: 123 }, order: null, orderSeq: 2, soldSinceOrder: 10, ships: 0, ship: { got: 0 }, totals: { logs: 999, peeled: 999, beams: 999, planks: 999, sold: 999, earned: 99999 }, seed: 3, rng: 4242, ...extra });
      };
      const o3 = L.loadSave(v25(3)), o4 = L.loadSave(v25(4, { buf: { yard: 5, logs: 5, peeled: 5, beams: 30, planks: 0, goods: 120 }, ship: { got: 4567 }, order: { id: 2, who: 'x', need: 200, got: 50, reward: 999, accepted: true } }));
      check('v25 の こうじょう の保存：かんそう 1台・Lv START_LEVEL・mgr null、かんな 0台、dried 0、totals.dried・smooth 0、ほかは残る', o3 && o3.state.depts.dry.lines === 1 && o3.state.depts.dry.level === L.START_LEVEL.dry && o3.state.depts.dry.mgr === null && o3.state.depts.plane.lines === 0 && o3.state.buf.dried === 0 && o3.state.totals.dried === 0 && o3.state.totals.smooth === 0 && o3.state.buf.beams === 30 && o3.state.depts.plank.lines === 2 && o3.state.money === 5000, o3 && [o3.state.depts.dry, o3.state.depts.plane]);
      check('v25 の みなと の保存：かんそう・かんな 1台・START_LEVEL、売り物の山 120・ship.got 4567・受けた注文が残る', o4 && o4.state.depts.dry.lines === 1 && o4.state.depts.plane.lines === 1 && o4.state.depts.plane.level === L.START_LEVEL.plane && o4.state.buf.goods === 120 && o4.state.ship.got === 4567 && o4.state.order && o4.state.order.got === 50 && o4.state.order.accepted === true, o4 && { plane: o4.state.depts.plane, goods: o4.state.buf.goods, ship: o4.state.ship });
      const w3 = run(L, o3.state, 60).s, w4 = run(L, { ...o4.state, order: null }, 60).s;
      check('v25 の保存を読んで 60 秒：こうじょう は かんそう が動いて板が売れる、みなと は つるつるいた ができて売れる（止まらない）', w3.totals.dried > 0 && w3.totals.sold > o3.state.totals.sold && w4.totals.smooth > 0 && w4.totals.sold > o4.state.totals.sold && w4.ship.got > 4567, { d3: w3.totals.dried, s3: w3.totals.sold - 999, sm4: w4.totals.smooth, s4: w4.totals.sold - 999 });
      const ld = L.loadSave(JSON.stringify({ v: 1, stage: 4, depts: { dry: { lines: 'x', level: -3, mgr: 'boss' }, plane: { lines: 99, level: 1e9, mgr: 'gain' } } })).state;
      check('欄はあるが壊れている かんそう・かんな は今までどおり丸める（lines 1〜上限・level 1〜50・mgr）', ld.depts.dry.lines === 1 && ld.depts.dry.level === 1 && ld.depts.dry.mgr === null && ld.depts.plane.lines === 4 && ld.depts.plane.level === 50 && ld.depts.plane.mgr === 'gain', [ld.depts.dry, ld.depts.plane]);
      // 保存に新しい欄
      const sv = run(L, maxed(L, 4), 60).s;
      const txt = L.makeSave(sv, 1), o = JSON.parse(txt), back = L.loadSave(txt).state;
      check('makeSave に depts.dry・depts.plane（lines・level・mgr）・buf.dried・totals.dried・totals.smooth、loadSave で同じ値', J(Object.keys(o.depts.dry)) === J(['lines', 'level', 'mgr']) && J(Object.keys(o.depts.plane)) === J(['lines', 'level', 'mgr']) && 'dried' in o.buf && 'dried' in o.totals && 'smooth' in o.totals && J(back.depts.plane.lines) === J(sv.depts.plane.lines) && back.depts.dry.level === sv.depts.dry.level && back.totals.smooth === sv.totals.smooth && back.totals.dried === sv.totals.dried && back.buf.dried === Math.floor(sv.buf.dried), { buf: o.buf, totals: o.totals });
    },
  },
  {
    id: 'WL13', tier: 'smoke', node: true, title: 'もくもくこうば：道具の段階（§19.2）TOOL_LV・TOOLS の名前・toolTier の境目と壊れた値・toolOf の next・buy の toolUp は段が上がったきかいの買い物だけ',
    run({ check, root }) {
      const L = load(root);
      check('TOOL_LV は [1, 5, 15, 30]、凍結', J(L.TOOL_LV) === J([1, 5, 15, 30]) && Object.isFrozen(L.TOOL_LV) && Object.isFrozen(L.TOOLS), L.TOOL_LV);
      const names = IDS.map((id) => [id, L.TOOLS[id]]);
      check('全部署に 4 つの名前（空でない・12 文字以内・重ならない）', names.every(([, t]) => Array.isArray(t) && t.length === 4 && t.every((n) => typeof n === 'string' && n.length > 0 && n.length <= 12) && new Set(t).size === 4) && Object.keys(L.TOOLS).length === IDS.length, names);
      check('きこりは おの → のこぎり → チェーンソー、はこぶは てで → ておしぐるま → … → トラック（§19.0 の例）', J(L.TOOLS.cut.slice(0, 3)) === J(['おの', 'のこぎり', 'チェーンソー']) && L.TOOLS.carry[0] === 'てで' && L.TOOLS.carry[1] === 'ておしぐるま' && L.TOOLS.carry[3] === 'トラック', [L.TOOLS.cut, L.TOOLS.carry]);
      const tb = [[1, 0], [4, 0], [5, 1], [14, 1], [15, 2], [29, 2], [30, 3], [50, 3], [4.9, 0], [NaN, 0], ['x', 0], [null, 0], [undefined, 0], [-5, 0], [0, 0], [Infinity, 0], ['30', 0], [{}, 0]];
      const tbad = tb.filter(([v, w]) => L.toolTier(v) !== w).map(([v, w]) => ({ v: String(v), want: w, got: L.toolTier(v) }));
      check('toolTier の境目（4→0・5→1・14→1・15→2・29→2・30→3・50→3）、壊れた値は 0', tbad.length === 0, tbad);
      const s1 = L.newGame(1);
      const t1 = L.toolOf(s1, 'cut');
      check("toolOf(Lv1 の きこり) = { tier:0, name:'おの', next:{ name:'のこぎり', lv:5 } }", J(t1) === J({ tier: 0, name: 'おの', next: { name: 'のこぎり', lv: 5 } }), t1);
      const at = (lv) => L.toolOf(mk(L, 2, { depts: { cut: { level: lv } } }), 'cut');
      check('toolOf の next：Lv14 → チェーンソー（Lv15）、Lv15 → きんの チェーンソー（Lv30）、Lv30・Lv50 → null', J(at(14).next) === J({ name: 'チェーンソー', lv: 15 }) && at(15).tier === 2 && J(at(15).next) === J({ name: L.TOOLS.cut[3], lv: 30 }) && at(30).next === null && at(50).next === null && at(30).name === L.TOOLS.cut[3], [at(14), at(15), at(30)]);
      const nulls = [L.toolOf(s1, 'beam'), L.toolOf(s1, 'dry'), L.toolOf(mk(L, 3), 'plane'), L.toolOf(s1, 'nope'), L.toolOf(s1, null), L.toolOf(null, 'cut'), L.toolOf('x', 'cut'), L.toolOf(s1, 'goods')];
      check('まだ使えない部署・無い部署・おかしな引数の toolOf は null', nulls.every((x) => x === null), nulls);
      check('toolOf は全部の使える部署で TOOLS と同じ名前', [4].every((st) => { const m = maxed(L, st); return IDS.every((id) => { const t = L.toolOf(m, id); return t && t.tier === 3 && t.name === L.TOOLS[id][3] && t.next === null; }); }), null);
      // buy の toolUp
      const s4 = mk(L, 2, { money: 1e9, depts: { cut: { level: 4 }, peel: { lines: 1, level: 14 } } });
      const u1 = L.buy(s4, 'cut', 'level');
      check("buy(きこり,'level') で Lv4→5：toolUp = { dept:'cut', tier:1, name:'のこぎり' }", u1.ok && J(u1.toolUp) === J({ dept: 'cut', tier: 1, name: 'のこぎり' }) && u1.state.depts.cut.level === 5, u1.toolUp);
      const u2 = L.buy(u1.state, 'cut', 'level'), u3 = L.buy(s4, 'cut', 'staff'), u4 = L.buy(s4, 'peel', 'line'), u5 = L.buy(s4, 'cut', 'mgr'), u6 = L.buy(s4, 'peel', 'level');
      check('Lv5→6・人を増やす・ラインを増やす・マネージャーでは toolUp は null、Lv14→15 は tier 2', u2.ok && u2.toolUp === null && u3.ok && u3.toolUp === null && u4.ok && u4.toolUp === null && u5.ok && u5.toolUp === null && u6.ok && J(u6.toolUp) === J({ dept: 'peel', tier: 2, name: L.TOOLS.peel[2] }), [u2.toolUp, u3.toolUp, u4.toolUp, u5.toolUp, u6.toolUp]);
      const f1 = L.buy({ ...s4, money: 0 }, 'cut', 'level'), f2 = L.buy(mk(L, 2, { money: 1e9, depts: { cut: { level: 50 } } }), 'cut', 'level');
      check('買えなかったとき（お金・上限）は toolUp なし（null）', !f1.ok && !f1.toolUp && !f2.ok && !f2.toolUp, [f1, f2].map((x) => [x.reason, x.toolUp]));
      const one = L.loadSave(L.makeSave(u1.state, 1)).state;
      check('toolUp は state に残らない（保存・読み込み・step に出ない）', !('toolUp' in u1.state) && !('toolUp' in one) && L.step(u1.state, 0.1).events.every((e) => e.kind !== 'tool'), null);
    },
  },
  {
    id: 'WL14', tier: 'smoke', node: true, title: 'もくもくこうば：かんな の直し（SZ-08・契約 §23）みなと で全部さいだい・はやい でも つまりは かんな でない、かんな の速さ（1ぷんに N まい）の式、もう強くできない部署（maxedOut）の判定、次の段で もっと強くできるか（moreNextStage。S1）',
    run({ check, root }) {
      const L = load(root);
      // ユーザーの録画の形：みなと で全部の部署を 上限・Lv50・はやい
      const allFast = (stage) => { const depts = {}; for (const id of IDS) { const cap = L.CAPS[stage - 1][id]; depts[id] = LINE[id] ? { lines: Math.max(1, cap), level: 50, mgr: stage >= 2 ? 'fast' : null } : { staff: cap, level: 50, mgr: stage >= 2 ? 'fast' : null }; } return mk(L, stage, { depts }); };
      const s4 = allFast(4), r = L.rates(s4), bn = L.bottleneck(s4);
      check(`みなと で全部さいだい・はやい：つまりは かんな でない（${bn}）`, bn && bn !== 'plane', { bn, rates: r });
      // かんな の速さ：台数 × (1 ÷ 2.5 秒) × speedMul(Lv) × はやい 1.5。4台・Lv50・はやい で 1ぷんに 849まい（直す前は 424まい）
      const perMin = (lines, lv, mgr) => { const st = { ...s4, depts: { ...s4.depts, plane: { ...s4.depts.plane, lines, level: lv, mgr } } }; return L.rates(st).plane * 60; };
      const want = (lines, lv, mgr) => lines * (60 / 2.5) * (1 + 0.1 * (lv - 1)) * (mgr === 'fast' ? 1.5 : 1);
      const cases = [[4, 50, 'fast'], [1, 1, null], [2, 10, 'gain'], [3, 30, 'fast']].map(([a, b, c]) => ({ lines: a, lv: b, mgr: c, got: perMin(a, b, c), want: want(a, b, c) }));
      check('かんな の速さ（1ぷんに N まい）＝ 台数 × 60 ÷ 2.5 × speedMul(Lv) × はやい 1.5（BASE_TIME.plane 2.5）', L.BASE_TIME.plane === 2.5 && cases.every((x) => Math.abs(x.got - x.want) < 1e-6), cases);
      check(`4台・Lv50・はやい の かんな は 1ぷんに ${Math.floor(cases[0].got)}まい（849。録画の 424 ではない）`, Math.floor(cases[0].got) === 849, cases[0]);
      check('全部さいだい・はやい の かんな の流れ（丸太に直して）は かくざい より速い', r.plane / L.PLANKS_PER_BEAM > r.beam, { plane: r.plane / 2, beam: r.beam });
      // もう強くできない部署
      check('maxedOut：全部さいだい・はやい の つまりの部署は true、ほかの部署も true（どれも もう買えない）', L.maxedOut(s4, bn) === true && IDS.every((id) => L.maxedOut(s4, id) === true), IDS.map((id) => L.maxedOut(s4, id)));
      const tweak = (id, o) => ({ ...s4, depts: { ...s4.depts, [id]: { ...s4.depts[id], ...o } } });
      const nots = { gain: L.maxedOut(tweak(bn, { mgr: 'gain' }), bn), noMgr: L.maxedOut(tweak(bn, { mgr: null }), bn), lv49: L.maxedOut(tweak(bn, { level: 49 }), bn), line3: L.maxedOut(tweak('beam', { lines: 3 }), 'beam'), staff7: L.maxedOut(tweak('cut', { staff: 7 }), 'cut') };
      check('maxedOut は まだ強くできれば false（もうかる・マネージャー無し・Lv49・台が上限未満・人が上限未満）', Object.values(nots).every((v) => v === false), nots);
      const s3 = allFast(3);
      check('みなと より前の段：こうじょう で かんな（使えない部署）は false、かんそう さいだい・はやい は true', L.maxedOut(s3, 'plane') === false && L.maxedOut(s3, 'dry') === true, [L.maxedOut(s3, 'plane'), L.maxedOut(s3, 'dry')]);
      const s1 = allFast(1);
      const s1lv = { ...s1, depts: { ...s1.depts, cut: { ...s1.depts.cut, level: 49 } } };
      check('こや（マネージャーを雇えない）では 上限・Lv50 なら true、Lv49 なら false', L.maxedOut(s1, 'cut') === true && L.maxedOut(s1lv, 'cut') === false, [L.maxedOut(s1, 'cut'), L.maxedOut(s1lv, 'cut')]);
      check('maxedOut はおかしな引数でも例外を出さず false', [L.maxedOut(null, 'cut'), L.maxedOut({}, 'cut'), L.maxedOut(s4, 'nope'), L.maxedOut(s4)].every((v) => v === false), null);
      check('maxedOut は渡した state を変えない', J(s4) === J(allFast(4)), null);
      // 次の段で もっと強くできるか（S1・契約 §23 K3）：段 4 より前で、上限（CAPS）が増える・こや でマネージャーがまだいない部署は true
      const more = (st) => Object.fromEntries(IDS.map((id) => [id, L.moreNextStage(st, id)]));
      const m3 = more(s3), m4 = more(s4), m1 = more(s1), s2 = allFast(2), m2 = more(s2);
      check(`こうじょう で全部さいだい・はやい：つまり ${L.bottleneck(s3)} は maxedOut だが moreNextStage true（みせ 3→4 人）。きこり・なえぎ・はこび・みせ は true、かわむき・かくざい・かんそう・いた（上限が同じ 4）と 使えない かんな は false`,
        L.bottleneck(s3) === 'shop' && L.maxedOut(s3, 'shop') === true && m3.shop && m3.cut && m3.plant && m3.carry && !m3.peel && !m3.beam && !m3.dry && !m3.plank && !m3.plane, m3);
      check('みなと（段 4）は どの部署も false（これいじょう はやく できない）', IDS.every((id) => m4[id] === false), m4);
      check('こや は 使える部署が全部 true（マネージャーは こうば から雇える）、使えない部署は false。こうば の かわむき（3→4 台）は true', m1.cut && m1.plant && m1.carry && m1.peel && m1.shop && !m1.beam && !m1.plane && m2.peel && m2.beam && !m2.dry, { m1, m2 });
      check('moreNextStage はおかしな引数でも例外を出さず false・渡した state を変えない', [L.moreNextStage(null, 'cut'), L.moreNextStage({}, 'cut'), L.moreNextStage(s3, 'nope'), L.moreNextStage(s3)].every((v) => v === false) && J(s3) === J(allFast(3)), null);
    },
  },
  {
    id: 'WL11', tier: 'full', node: true, title: 'もくもくこうば：自動プレイ（§3.8・§3.9・§19.1.4 の目安）greedy の節目とエンディングの時間・最初の買い物・買い物の間隔・節目の直後の稼ぎ・2時間の るす・tapper との差・エンディング後の船 10 せき・idle 10 時間・daily3',
    run({ check, root }) {
      const L = load(root);
      const h = (x) => (x == null ? null : +(x / 3600).toFixed(2));
      const g = L.simulate('greedy', { seed: 1, away: 'none', ships: 0, maxSec: 14 * 3600 });
      check('simulate がエラーなく報告を返す', g && !g.error && g.reached, g && g.error);
      check('最初の買い物まで 30 秒以内', g.firstBuy !== null && g.firstBuy <= 30, g.firstBuy);
      check('こうば に 8〜15 分', g.reached[2] >= 8 * 60 && g.reached[2] <= 15 * 60, h(g.reached[2]));
      check('こうじょう に 45〜90 分（累計）', g.reached[3] >= 45 * 60 && g.reached[3] <= 90 * 60, h(g.reached[3]));
      check('みなと に 2.5〜4.5 時間（累計。§17.2 C1 で 4 → 4.5 に直した）', g.reached[4] >= 2.5 * 3600 && g.reached[4] <= 4.5 * 3600, h(g.reached[4]));
      check('エンディング 6〜10 時間（ユーザー決定「合計6〜10時間」）', g.reached.end >= 6 * 3600 && g.reached.end <= 10 * 3600, h(g.reached.end));
      // 買い物の間隔：みなと（§3.9 の表は「2 分に 1 回以上」。実測は 2 分 14 秒。§3.9 に書いたとおり みなと は 2.5 分まで）
      const gaps = [1, 2, 3, 4].map((k) => g.avgGapByStage[k]);
      check('買い物の平均の間隔：こや・こうば・こうじょう 2 分以内、みなと 2.5 分以内（§3.9）', gaps[0] <= 120 && gaps[1] <= 120 && gaps[2] <= 120 && gaps[3] <= 150, gaps.map((x) => Math.round(x)));
      // 買い物の最大の間隔（§17.2 C1。広げる費用をためる間も含む）：こや 1 分・こうば 5 分・こうじょう 15 分・みなと 25 分 以内。seed 1〜5 のどれでも
      {
        const MAXGAP = { 1: 60, 2: 5 * 60, 3: 15 * 60, 4: 25 * 60 };
        const over = [], ends = [], dips = [];
        for (const seed of [1, 2, 3, 4, 5]) {
          const r = seed === 1 ? g : L.simulate('greedy', { seed, away: 'none', ships: 0, maxSec: 14 * 3600 });
          ends.push(h(r.reached.end));
          // 節目の直後（§19.1.4）：こうじょう・みなと に広げた直後 10 分の稼ぎ（えん/分）が、広げる直前の 10 分を下回らない
          for (const k of [3, 4]) { const e = r.expandEarn && r.expandEarn[k]; if (!e || !(e.after >= e.before)) dips.push({ seed, stage: k, before: e && Math.round(e.before), after: e && Math.round(e.after) }); }
          for (const k of [1, 2, 3, 4]) if (!(r.maxGapByStage[k] <= MAXGAP[k])) over.push({ seed, stage: k, gap: Math.round(r.maxGapByStage[k]), at: Math.round(r.maxGapAtByStage[k]) });
        }
        check('買い物の最大の間隔：こや 1 分・こうば 5 分・こうじょう 15 分・みなと 25 分 以内（seed 1〜5。§17.2 C1）', over.length === 0, over);
        check(`seed 1〜5 のエンディングがどれも 6〜10 時間（${ends.join('・')} 時間）`, ends.every((x) => x >= 6 && x <= 10), ends);
        check('こうじょう・みなと に広げた直後 10 分の稼ぎが、直前の 10 分を下回らない（seed 1〜5。§19.1.4）', dips.length === 0, dips);
      }
      const aw = [1, 2, 3, 4].map((k) => g.awayCheck[k]);
      check('2時間の るす のあと、どの段でも るすの稼ぎで 1 つ以上・起動後 5 分と合わせて 2 つ以上 買える', aw.every((a) => a && a.buyable >= 1 && a.buyable5 >= 2), aw);
      check('お金の最大が MONEY_MAX 以下', g.moneyMax <= L.MONEY_MAX, g.moneyMax);
      const tp = L.simulate('tapper', { seed: 1, away: 'none', ships: 0, maxSec: 14 * 3600 });
      check('tapper（応援・よびこみを全部使う）でもエンディングまでの時間は 2 割以上は縮まない', tp.reached.end >= 0.8 * g.reached.end, [h(tp.reached.end), h(g.reached.end)]);
      const sh = L.simulate('greedy', { seed: 1, away: 'none', ships: 10, maxSec: 120 * 3600 });
      const ts = sh.ships.map((x) => x.t);
      const d = ts.slice(1).map((t, i) => t - ts[i]);
      check('エンディング後の船：10 せきぶん届いて例外なし、ships は 11', !sh.error && sh.final.ships === 11 && sh.ships.length === 11, sh.error || sh.final.ships);
      check('2せき目まで 1〜3 時間', d[0] >= 3600 && d[0] <= 3 * 3600, d.map((x) => +(x / 3600).toFixed(2)));
      check('そのあとは1せきごとに少しずつ長くなる（前より短くならない・1.4 倍以内）', d.every((x, i) => i === 0 || (x >= d[i - 1] * 0.98 && x <= d[i - 1] * 1.4)), d.map((x) => +(x / 3600).toFixed(2)));
      check('2せき目からはお礼がある（yen > 0）、1せき目は 0・ending', sh.ships[0].ending === true && sh.ships[0].yen === 0 && sh.ships.slice(1).every((x) => x.ending === false && x.yen > 0), sh.ships.slice(0, 3));
      check('お金・ships が上限を超えない', sh.moneyMax <= L.MONEY_MAX && sh.final.ships <= L.SHIPS_MAX, sh.moneyMax);
      const idle = L.simulate('idle', { seed: 1, away: 'none', maxSec: 10 * 3600 });
      check('idle 10 時間：例外なし・何も買わない・売れ続ける（木が尽きて止まらない）', !idle.error && idle.buys === 0 && idle.final.totals.sold > 500 && idle.final.money > 0, idle.error || idle.final);
      const d3 = L.simulate('greedy', { seed: 1, away: 'daily3', ships: 0, maxSec: 80 * 3600 });
      check('daily3（1日3回・各5分）：エンディングまで 10 日以内（§3.9 の 5〜10 日の下限は §3.9 の測った値を参照）', d3.days.end !== null && d3.days.end <= 10 && !d3.error, d3.days);
      check('daily3 は開きっぱなしより遊んだ（ロジックの）時間が長くなる（閉じている間は買わない・半分の速さ）', d3.reached.end > g.reached.end, [h(d3.reached.end), h(g.reached.end)]);
    },
  },
];

// ---- 単体で流す：node tests/cases/seizai-logic.mjs [ID...] ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const only = process.argv.slice(2);
  let ng = 0;
  for (const t of tests) {
    if (only.length && !only.includes(t.id)) continue;
    const fails = [];
    let n = 0;
    const t0 = Date.now();
    try { await t.run({ root, tier: 'full', check: (name, ok, detail) => { n++; if (!ok) fails.push({ name, detail }); return !!ok; } }); } catch (e) { fails.push({ name: '例外', detail: e.stack }); }
    console.log(`${fails.length ? 'NG' : 'OK'} ${t.id}（${n} 件・${Date.now() - t0}ms）`);
    for (const f of fails) console.log('   × ' + f.name + '\n     ' + JSON.stringify(f.detail));
    if (fails.length) ng++;
  }
  process.exit(ng ? 1 : 0);
}
