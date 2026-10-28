// あまいものあつめ：季節でない絵（担当 B1）。文字の地図は docs/ari-contract.md §2.6。
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
    // 1 りんご（S 段。12×11・R G C）
    { id: "ringo", name: "りんご", season: "", map: [
      "......C..GG.",
      "......CGGG..",
      "..CCC.CCCC..",
      ".CRRRCCRRRC.",
      "CRRRRRRRRRRC",
      "CRRRRRRRRRRC",
      "CRRRRRRRRRRC",
      "CRRRRRRRRRRC",
      ".CRRRRRRRRC.",
      "..CRRRRRRC..",
      "...CCCCCC...",
    ] },
  ]);

  return AmaiPictures;
});
