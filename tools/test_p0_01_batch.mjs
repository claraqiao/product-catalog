// Executable, isolated P0-01 regression: node tools/test_p0_01_batch.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const start=source.indexOf('async function makeSnapshot(');
const end=source.indexOf('// Bounded D1 storage adapter',start);
assert(start>=0&&end>start,'makeSnapshot source boundary');
const healthStart=source.indexOf("if(path==='/api/health'&&method==='GET')");
const healthEnd=source.indexOf("if(path==='/api/login'",healthStart);
assert(healthStart>=0&&healthEnd>healthStart,'health route boundary');
const healthRoute=source.slice(healthStart,healthEnd);
assert(!healthRoute.includes('ensureTrialSchema('),'health and ordinary request must not initialize schema');
const context=vm.createContext({Map,Set,Date,Error,Object,Promise});
const makeSnapshot=vm.runInContext(source.slice(start,end)+'\nmakeSnapshot',context);
for(const count of [50,800,2000]){
 const keys=new Set();
 const rows=[];
 for(let i=0;i<count;i++){
  const id=i+1,sku='SKU'+id;
  for(let j=0;j<3;j++){
   const display_key='display/'+id+'/'+j,thumb_key='thumb/'+id+'/'+j;
   keys.add(display_key);keys.add(thumb_key);
   rows.push({id,sku,name:sku,series:'',specification:'',keywords:'',category:'Clothes',display_key,thumb_key,alt_text:sku});
  }
 }
 let queries=0,heads=0;
 const env={IMAGES_IS_TRIAL:true,IMAGES:{head:async()=>{heads++;return true}},DB:{prepare(sql){
  return {async all(){queries++;if(sql.includes('FROM products p')&&!sql.includes('trial_image_objects'))return {results:rows};if(sql.includes('FROM app_settings'))return {results:[]};if(sql.includes('trial_image_objects')){const missing=rows.flatMap(r=>[r.display_key,r.thumb_key]).filter(k=>!keys.has(k));return {results:missing.length?[{object_key:missing[0]}]:[]}}throw Error('unexpected SQL: '+sql)}}}}};
 const snap=await makeSnapshot(env);
 assert.equal(snap.products.length,count);
 assert.equal(heads,0,'D1 trial must not do per-image head');
 assert.equal(queries,3);
 assert(queries<=50,'D1 Free per-invocation query budget');
 assert.equal(snap.products[0].images.length,3);
 console.log(JSON.stringify({products:count,images:count*3,keys:keys.size,queries,status:'PASS'}));
 keys.delete('thumb/1/0');
 await assert.rejects(makeSnapshot(env),/不存在/,'missing thumbnail must reject publication');
 keys.add('thumb/1/0');
 const first=rows.find(r=>r.id===1);
 const savedThumb=first.thumb_key;first.thumb_key='';
 await assert.rejects(makeSnapshot(env),/缺少縮圖/,'blank thumbnail must reject publication');
 first.thumb_key=savedThumb;
 const savedDisplay=first.display_key;first.display_key='';
 await assert.rejects(makeSnapshot(env),/不存在/,'blank display reference must reject publication');
 first.display_key=savedDisplay;
}
