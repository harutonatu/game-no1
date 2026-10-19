/*
 * いろびん — ロジック（DOM・時計・Math.random・localStorage に触れない純粋な計算だけ）
 * 契約：docs/irobin-contract.md §1.1（ルール）・§3（定数・色・面の表）・§4（API）
 * 担当A（ロジック）だけが編集する。
 *
 * UMD: ブラウザでは window.IrobinLogic、Node では module.exports と globalThis.IrobinLogic。
 * 土台：関数の枠だけ。中身は担当A が書く。
 */
(function (root) {
  "use strict";

  const NAME = "いろびん";          // 表示名（仮名。ここだけ変えれば画面の名前が変わる）
  const CAP = 4;
  const ORDER_SLOTS = 2;
  const MAX_COLORS = 9;
  const MAX_MOVES_SAVED = 2000;
  const SOLVE_NODE_LIMIT = 40000;
  const GEN_NODE_BUDGET = 200000;
  const GEN_TRIES = 40;
  const SAVE_KEY_BEST = "irobin.best";
  const SAVE_KEY_SAVE = "irobin.save";
  const SAVE_KEY_HELP = "irobin.help";

  // 色（契約 §3.1）。Okabe-Ito を土台に、記号つき
  const COLORS = Object.freeze([
    { id: 0, key: "orange", name: "オレンジ", hex: "#E69F00", mark: "circle" },
    { id: 1, key: "sky",    name: "みずいろ", hex: "#56B4E9", mark: "triangle" },
    { id: 2, key: "green",  name: "みどり",   hex: "#009E73", mark: "square" },
    { id: 3, key: "yellow", name: "きいろ",   hex: "#F0E442", mark: "diamond" },
    { id: 4, key: "blue",   name: "あお",     hex: "#0072B2", mark: "star" },
    { id: 5, key: "red",    name: "あか",     hex: "#D55E00", mark: "cross" },
    { id: 6, key: "pink",   name: "ピンク",   hex: "#CC79A7", mark: "heart" },
    { id: 7, key: "white",  name: "しろ",     hex: "#EEEEEE", mark: "ring" },
    { id: 8, key: "brown",  name: "ちゃいろ", hex: "#9A6A3A", mark: "wave" }
  ].map((c) => Object.freeze(c)));

  // 面の難しさの表（契約 §3.2）。形は担当A が決めてよい
  const LEVELS = Object.freeze([]);

  const TODO = (name) => { throw new Error(`IrobinLogic.${name} は未実装（土台）`); };

  // ---- 乱数と面 ----
  function makeRng(seed) { return TODO("makeRng"); }
  function seedFor(level) { return TODO("seedFor"); }
  function paramsFor(level) { return TODO("paramsFor"); }
  function createLevel(level, opts) { return TODO("createLevel"); }

  // ---- 手 ----
  function pourCheck(state, from, to) { return TODO("pourCheck"); }
  function applyMove(state, from, to) { return TODO("applyMove"); }
  function legalMoves(state) { return TODO("legalMoves"); }
  function isStuck(state) { return TODO("isStuck"); }

  // ---- ソルバー ----
  function solve(state, opts) { return TODO("solve"); }

  // ---- 再生と保存 ----
  function replay(level, moves) { return TODO("replay"); }
  function hud(state) { return TODO("hud"); }
  function validateBest(raw) { return TODO("validateBest"); }
  function validateSave(raw) { return TODO("validateSave"); }
  function makeSave(level, moves) { return TODO("makeSave"); }
  function recordBest(prevBest, clearedLevel) { return TODO("recordBest"); }
  function validateFlag(raw) { return TODO("validateFlag"); }

  // ---- 見た目に使う純粋な値 ----
  function animalFor(level, orderIndex) { return TODO("animalFor"); }
  function colorName(id) { return TODO("colorName"); }

  const api = Object.freeze({
    NAME, CAP, ORDER_SLOTS, MAX_COLORS, MAX_MOVES_SAVED, SOLVE_NODE_LIMIT, GEN_NODE_BUDGET, GEN_TRIES,
    SAVE_KEY_BEST, SAVE_KEY_SAVE, SAVE_KEY_HELP, COLORS, LEVELS,
    makeRng, seedFor, paramsFor, createLevel,
    pourCheck, applyMove, legalMoves, isStuck,
    solve,
    replay, hud, validateBest, validateSave, makeSave, recordBest, validateFlag,
    animalFor, colorName
  });
  root.IrobinLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
