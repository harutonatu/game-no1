// 数える：node count.js <.txt>…  parsePicture が OK か（logic.js の写しで MAX_SUGAR を 3072 に、COLORS に D・V を足して）・角砂糖・色の数
const fs=require('fs'),path=require('path'),os=require('os');
const src=fs.readFileSync(path.resolve(__dirname,'../../../games/amai/logic.js'),'utf8').replace('const MAX_SUGAR = 2800;','const MAX_SUGAR = 3072;')
  .replace(`[9, "K", "black", "くろ", "#2B2B33", "stripes", [".#.#.", ".#.#.", ".#.#.", ".#.#.", ".#.#."]],`,
    `[9, "K", "black", "くろ", "#2B2B33", "stripes", [".#.#.", ".#.#.", ".#.#.", ".#.#.", ".#.#."]],
    [10, "D", "dkgreen", "こいみどり", "#1F5E35", "moon", [".###.", "##...", "#....", "##...", ".###."]],
    [11, "V", "violet", "むらさき", "#8A5CC8", "drop", ["..#..", ".###.", "#####", "#####", ".###."]],`);
if(!/"D", "dkgreen"/.test(src))throw new Error('COLORS に D・V を足せなかった');
const tmp=path.join(os.tmpdir(),'amai-logic-12c.js');fs.writeFileSync(tmp,src);const L=require(tmp);
for(const f of process.argv.slice(2)){const map=fs.readFileSync(f,'utf8').split('\n').map(s=>s.trimEnd()).filter(s=>s.length);
const p=L.parsePicture({id:'x',name:'え',season:'',map},false);const cnt={};let n=0;for(const r of map)for(const c of r)if(c!='.'){cnt[c]=(cnt[c]||0)+1;n++;}
console.log(path.basename(f),'parse',p?'OK':'NG','角砂糖',n,'色',Object.keys(cnt).length,JSON.stringify(cnt));}
