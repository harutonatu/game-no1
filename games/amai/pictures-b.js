// あまいものあつめ：季節の絵（担当 B2）。文字の地図は docs/ari-contract.md §2.6。
// AmaiPictures は、先に読んだ方のファイル（pictures-a.js / pictures-b.js）が作り、あとのファイルはそれに足す。
(function (root, factory) {
  var P = factory(root && root.AmaiPictures);
  if (typeof module === "object" && module.exports) module.exports = P;
  if (root) root.AmaiPictures = P;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function (existing) {
  "use strict";
  var AmaiPictures = existing;
  if (!AmaiPictures || typeof AmaiPictures.add !== "function") {
    var byId = {};
    AmaiPictures = {
      byId: byId,
      add: function (list) {
        for (var i = 0; i < list.length; i++) byId[list[i].id] = list[i];
      },
    };
  }

  AmaiPictures.add([
    // 3 春 さくら（S 段。12×12・P Y C。花びら 5 枚の先に切れこみ、まん中は黄色、下に茶色の茎）
    { id: "sakura", name: "さくら", season: "haru", map: [
      "....P..P....",
      "...PPPPPP...",
      "P..PPPPPP..P",
      "PP..PPPP..PP",
      ".PP.PYYP.PP.",
      "PPPPYYYYPPPP",
      ".PPPPYYPPPP.",
      "...PPPPPP...",
      ".PPP.CC.PPP.",
      "PPPP.CC.PPPP",
      "P.P..CC..P.P",
      ".....CC.....",
    ] },
  ]);

  return AmaiPictures;
});
