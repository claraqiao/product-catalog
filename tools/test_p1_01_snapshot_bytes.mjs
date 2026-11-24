// Isolated P1-01 payload-size regression. No cloud credentials or deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const LIMIT=1_900_000;
assert(source.includes('if(snapshotBytes>1900000)'), 'prepare must guard oversize snapshot');
assert(source.includes('if(currentBytes>1900000)'), 'confirm must guard oversize snapshot');
function snapshot(count,photos){
 const products=Array.from({length:count},(_,i)=>({
  sku:'SKU'+String(i).padStart(6,'0'),name:'服飾商品'+String(i).padStart(6,'0'),
  series:'',keywords:'',category:'服飾',specification:'',images:Array.from({length:photos},(_,j)=>{
   const display_key='public/display/'+i+'/'+j+'/'.padEnd(16,'x');
   const thumb_key='public/thumb/'+i+'/'+j+'/'.padEnd(16,'x');
   return {src:'/media/'+display_key,thumb:'/media/'+thumb_key,alt:'服飾商品'+i,display_key,thumb_key};
  })
 }));
 return {products,settings:{site_name:'服飾型錄'}};
}
const encoder=new TextEncoder();
for(const count of [50,800,2000]){
 for(const photos of [1,3,5]){
  const bytes=encoder.encode(JSON.stringify(snapshot(count,photos))).byteLength;
  assert(bytes>0);
  console.log(JSON.stringify({products:count,photosPerProduct:photos,bytes,guardWouldReject:bytes>LIMIT}));
 }
}
console.log('PASS: UTF-8 snapshot byte measurement; guard exists at prepare and confirm');
