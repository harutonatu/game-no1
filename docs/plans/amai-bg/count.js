// 数える：node count.js <.txt>…  parsePicture が OK か（MAX_SUGAR を 3072 にした写しで）・角砂糖・色の数
const fs=require('fs'),path=require('path'),os=require('os');
const src=fs.readFileSync(path.resolve(__dirname,'../../../games/amai/logic.js'),'utf8').replace('const MAX_SUGAR = 2800;','const MAX_SUGAR = 3072;');
const tmp=path.join(os.tmpdir(),'amai-logic-3072.js');fs.writeFileSync(tmp,src);const L=require(tmp);
for(const f of process.argv.slice(2)){const map=fs.readFileSync(f,'utf8').split('\n').map(s=>s.trimEnd()).filter(s=>s.length);
const p=L.parsePicture({id:'x',name:'え',season:'',map},false);const cnt={};let n=0;for(const r of map)for(const c of r)if(c!='.'){cnt[c]=(cnt[c]||0)+1;n++;}
console.log(path.basename(f),'parse',p?'OK':'NG','角砂糖',n,'色',Object.keys(cnt).length,JSON.stringify(cnt));}
