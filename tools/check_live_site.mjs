// Read-only smoke checks. No admin credentials, writes or deployment.
const base=process.argv[2];
if(!base)throw Error('Usage: node tools/check_live_site.mjs https://your-worker.workers.dev');
const url=new URL(base);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use a plain HTTPS site URL without credentials or query parameters');
const root=url.origin;
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
for(const route of ['/assets/site.js','/assets/site.css','/admin/assets/admin.js','/admin/assets/admin.css']){
 const response=await check(route,[200]);
 const body=await response.text();
 if(body.length<100)throw Error(route+': static asset appears empty');
 if(/<html[\\s>]/i.test(body.slice(0,200)))throw Error(route+': received HTML instead of expected asset');
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
for(const route of ['/api/admin/settings','/api/admin/storage','/api/admin/backup/export']){
 const response=await check(route,[401,403],'json');
 const payload=await response.json();
 if(!payload||typeof payload.error!=='string')throw Error(route+': missing access-denied error');
}
console.log('Read-only live checks passed. Photo uploads, login, publication, D1 storage and iPad usability still require separate testing.');
