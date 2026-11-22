// Read-only smoke checks. No admin credentials, writes or deployment.
const base=process.argv[2];
if(!base)throw Error('Usage: node tools/check_live_site.mjs https://your-worker.workers.dev');
const url=new URL(base);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use a plain HTTPS site URL without credentials or query parameters');
const root=url.origin;
const expectedSha=(process.env.EXPECTED_DEPLOY_SHA||'').trim();
if(expectedSha&&!/^[0-9a-f]{40}$/.test(expectedSha))throw Error('Invalid EXPECTED_DEPLOY_SHA');
if(url.pathname!=='/'&&url.pathname!=='')throw Error('Use the site origin only, not an admin or product path');

async function check(route,expected,kind){
 const response=await fetch(root+route,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}});
 if(!expected.includes(response.status))throw Error(route+': expected '+expected.join('/')+', got HTTP '+response.status);
 if(kind==='json'){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('application/json'))throw Error(route+': expected JSON response');
 }
 if(kind==='html'){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))throw Error(route+': expected HTML response');
 }
 console.log('PASS',route,'HTTP',response.status);
 return response;
}
await check('/',[200],'html');
await check('/admin/',[200],'html');
await check('/password-setup/',[200],'html');
for(const route of ['/assets/site.js','/assets/site.css','/admin/assets/admin.js','/admin/assets/admin.css']){
 const response=await check(route,[200]);
 const body=await response.text();
 if(body.length<100)throw Error(route+': static asset appears empty');
 if(/<html[\s>]/i.test(body.slice(0,200)))throw Error(route+': received HTML instead of expected asset');
}
for(const route of ['/catalog/products.json','/catalog/settings.json']){
 const response=await check(route,[200],'json');
 const payload=await response.json();
 if(route.endsWith('products.json')&&!Array.isArray(payload))throw Error('Public products must be a JSON array');
 if(route.endsWith('settings.json')&&(!payload||Array.isArray(payload)||typeof payload!=='object'))throw Error('Public settings must be a JSON object');
}
const health=await check('/api/health',[200],'json');
const data=await health.json();
if(data.ok!==true||data.service!=='catalog-api')throw Error('Health response does not identify the catalog API');
console.log('PASS D1 health and Worker identity');
for(const route of ['/api/admin/settings','/api/admin/storage','/api/admin/backup/export']){
 const response=await check(route,[401,403],'json');
 const payload=await response.json();
 if(!payload||typeof payload.error!=='string')throw Error(route+': missing access-denied error');
}
const productsResponse=await fetch(root+'/catalog/products.json',{redirect:'manual',signal:AbortSignal.timeout(15000)});
if(!productsResponse.ok||!(productsResponse.headers.get('content-type')||'').includes('application/json'))throw Error('Public product recheck failed');

const products=await productsResponse.json();
const skuSet=new Set();
for(const p of products){
 if(!p||typeof p.sku!=='string'||!p.sku.trim()||typeof p.name!=='string'||!p.name.trim()||!Array.isArray(p.images))throw Error('Published catalog has an invalid product record');
 if(skuSet.has(p.sku))throw Error('Published catalog has duplicate product SKU: '+p.sku);
 skuSet.add(p.sku);
}
for(const p of products.slice(0,5)){
 if(typeof p.sku!=='string'||typeof p.name!=='string'||!Array.isArray(p.images))throw Error('Published product shape invalid');
 for(const im of p.images.slice(0,2)){
  const src=im.thumb||im.src||im.display;
  if(typeof src!=='string'||!/^\/media\/[A-Za-z0-9._/-]+$/.test(src)||src.includes('..'))throw Error('Published photo path is invalid');
  const response=await fetch(root+src,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok||!(response.headers.get('content-type')||'').startsWith('image/webp'))throw Error('Published photo unavailable or wrong type: '+src+' HTTP '+response.status);
  console.log('PASS published photo',src);
 }
}
if(expectedSha){
 const version=await check('/deployment-version.json',[200],'json');
 const data=await version.json();
 if(data.commit!==expectedSha)throw Error('Production deployment is stale: expected '+expectedSha+' but found '+String(data.commit||'missing'));
 console.log('PASS production commit matches',expectedSha);
}
console.log('Read-only live checks passed. Photo uploads, login, publication, D1 storage and iPad usability still require separate testing.');
