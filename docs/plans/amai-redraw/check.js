// 使い方：node check.js <id> <段 S|M|L|XL|XXL> <名前>   （<id>.txt を読み、決まりを確かめて <id>.png を作る）
const fs=require('fs'),path=require('path');
const [id,tier,name]=process.argv.slice(2);
const L=require(path.resolve(__dirname,'../../../games/amai/logic.js'));
const map=fs.readFileSync(path.join(__dirname,id+'.txt'),'utf8').split('\n').map(s=>s.trimEnd()).filter(s=>s.length);
const p=L.parsePicture({id,name,season:'',map},false);
const R={S:[476,692,3,4],M:[856,1128,4,5],L:[1264,1600,5,7],XL:[1688,2240,6,8],XXL:[2096,2576,8,10]}[tier];
const cnt={};let sugar=0;for(const r of map)for(const c of r)if(c!='.'){cnt[c]=(cnt[c]||0)+1;sugar++;}
const nc=Object.keys(cnt).length;
console.log(`parsePicture: ${p?'OK':'NG（はしの行列・各色3個以上・閉じた空き・幅のそろい・文字を確かめる）'}`);
console.log(`大きさ ${map[0].length}x${map.length}（64x48 以下）  角砂糖 ${sugar}（${R[0]}〜${R[1]}）${sugar>=R[0]&&sugar<=R[1]?'OK':'NG'}  色 ${nc}（${R[2]}〜${R[3]}）${nc>=R[2]&&nc<=R[3]?'OK':'NG'}`,cnt);
const cols={R:"#E23B3B",O:"#F28C28",Y:"#F2D13A",G:"#3E9E4F",S:"#78C6EE",B:"#2E5BC9",P:"#F29BC2",C:"#8B5A33",W:"#F5F2EA",K:"#2B2B33"};
const s=10;let svg=`<svg xmlns="http://www.w3.org/2000/svg" width=${map[0].length*s} height=${map.length*s}><rect width="100%" height="100%" fill="#ddd"/>`;
map.forEach((r,y)=>[...r].forEach((c,x)=>{if(c!='.')svg+=`<rect x=${x*s} y=${y*s} width=${s} height=${s} fill="${cols[c]}"/>`}));svg+='</svg>';
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const pg=await b.newPage();await pg.setContent(`<body style="margin:0">${svg}</body>`);await pg.locator('svg').screenshot({path:path.join(__dirname,id+'.png')});await b.close();console.log('画像:',path.join(__dirname,id+'.png'));})();
