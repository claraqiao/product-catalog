// Executable, isolated P0-01 regression: node tools/test_p0_01_batch.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const start=source.indexOf('async function makeSnapshot(');
const end=source.indexOf('// Bounded D1 storage adapter',start);
assert(start>=0&&end>start,'makeSnapshot source boundary');
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
  return {bind(...args){return {async all(){queries++;assert.match(sql,/trial_image_objects/);return {results:args.filter(k=>keys.has(k)).map(object_key=>({object_key}))}}}},async all(){queries++;if(sql.includes('FROM products p'))return {results:rows};if(sql.includes('FROM app_settings'))return {results:[]};throw Error('unexpected SQL: '+sql)}}}}};
 const snap=await makeSnapshot(env);
 assert.equal(snap.products.length,count);
 assert.equal(heads,0,'D1 trial must not do per-image head');
 assert.equal(queries,2+Math.ceil(keys.size/200));
 assert(queries<=50,'D1 Free per-invocation query budget');
 console.log(JSON.stringify({products:count,images:count*3,keys:keys.size,queries,status:'PASS'}));
 keys.delete('thumb/1/0');
 await assert.rejects(makeSnapshot(env),/不存在/,'missing thumbnail must reject publication');
}
