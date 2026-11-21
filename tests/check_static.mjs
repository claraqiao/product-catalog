import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
for(const f of ['admin/assets/admin.js','worker/index.js','public/assets/site.js']){const src=fs.readFileSync(new URL(f,root),'utf8');new vm.Script(src.replace('export default','const __worker ='),{filename:f});console.log('PASS syntax:',f)}
for(const f of ['admin/index.html','admin/assets/admin.css','migrations/0001_initial.sql','migrations/0002_photo_upload_requests.sql','wrangler.toml.example','tools/create_password_hash.mjs','tools/build_assets.mjs']){if(!fs.existsSync(new URL(f,root)))throw Error('Missing '+f);console.log('PASS exists:',f)}

const worker=fs.readFileSync(new URL('worker/index.js',root),'utf8');
for(const token of ['/api/admin/backup/export','/api/admin/backup/inspect','imageListMatch','reorderMatch','deleteImageMatch','photo_upload_requests','uploadToken','備份檔超過 32 MiB','original_key','display_key','thumb_key']){if(!worker.includes(token))throw Error('Missing API route '+token);console.log('PASS API route:',token)}
const admin=fs.readFileSync(new URL('admin/assets/admin.js',root),'utf8');
for(const token of ['backupPage()','refreshImages()','data-move','data-delete-image','uploadTokens','重新上傳失敗照片','original','display','thumb']){if(!admin.includes(token))throw Error('Missing admin feature '+token);console.log('PASS admin feature:',token)}

for(const token of ['200*1024*1024','COALESCE(SUM(size_bytes),0)','keep.add(row.original_key)','published_media WHERE image_key IN (?,?)']){
 if(!worker.includes(token))throw Error('Missing free-tier or published-image safety guard: '+token);
 console.log('PASS storage safety:',token);
}

for(const token of ["series:obj.series||''","CSV 欄位名稱不可重複","產品總數不可超過 2,000 筆","產品已達 2,000 筆上限"]){
 if(!worker.includes(token))throw Error('Missing catalog import safety: '+token);
 console.log('PASS CSV and product limits:',token);
}

for(const token of ["const sameProducts=JSON.stringify(prepared.products)===JSON.stringify(current.products)","const sameSettings=JSON.stringify(prepared.settings||{})===JSON.stringify(current.settings||{})","預覽後產品、照片或網站設定已變更","已有較新的公開版本"]){
 if(!worker.includes(token))throw Error('Missing publish safety: '+token);
 console.log('PASS publish confirmation guard:',token);
}

for(const token of ["status='superseded'","WHERE status='pending' AND revision<>?","必須明確確認有效的發布版本"]){
 if(!worker.includes(token))throw Error('Missing publish revision safety: '+token);
 console.log('PASS publish revision safety:',token);
}

for(const token of ["if(!raw||!env.SESSION_SECRET)return null","declaredSize>3*1024*1024","免費測試版單次照片上傳不可超過 3 MiB"]){
 if(!worker.includes(token))throw Error('Missing session or upload safety: '+token);
 console.log('PASS session and upload safety:',token);
}

const catalog=fs.readFileSync(new URL('public/assets/site.js',root),'utf8');
const catalogCss=fs.readFileSync(new URL('public/assets/site.css',root),'utf8');
for(const token of ['visibleCount=80','shown.slice(start,visibleCount)','visibleCount+=80','more.hidden=shown.length<=visibleCount']){
 if(!catalog.includes(token))throw Error('Missing catalog incremental rendering: '+token);
}
if(!catalogCss.includes('.load-more[hidden]'))throw Error('Missing catalog pagination styling');
console.log('PASS catalog batches limit initial product DOM to 80');

for(const token of ["'#product='+encodeURIComponent(p.sku)","decodeURIComponent(location.hash.slice(9))","window.addEventListener('popstate',syncProductLink)","window.addEventListener('hashchange',syncProductLink)","filter();syncProductLink();"]){
 if(!catalog.includes(token))throw Error('Missing shareable product link: '+token);
}
console.log('PASS shareable product SKU links and browser navigation');

const homepage=fs.readFileSync(new URL('index.html',root),'utf8');
for(const token of ['id="share-product"','id="share-status"'])if(!homepage.includes(token))throw Error('Missing sharing UI '+token);
for(const token of ['navigator.share({title:active.name||active.sku,url})','navigator.clipboard.writeText(url)',"addEventListener('click',()=>closeViewer())"])if(!catalog.includes(token))throw Error('Missing sharing or close behavior '+token);
console.log('PASS product sharing UI, native share, clipboard fallback and close event');

if(!worker.includes("o.size>512*1024||d.size>512*1024||t.size>512*1024"))throw Error('Trial upload size check missing');
const trialAdmin=fs.readFileSync(new URL('admin/assets/admin.js',root),'utf8');
if(!trialAdmin.includes('不是手機裡的原始檔，請自行保留原始照片'))throw Error('Original photo retention warning missing');
console.log('PASS trial image limits and accurate original-photo warning');

for(const token of ['document.createDocumentFragment()','render(true)','const start=append?grid.children.length:0']){
 if(!catalog.includes(token))throw Error('Missing append-only catalog batches: '+token);
}
console.log('PASS show-more preserves existing cards and appends only new products');

if(!catalog.includes('找不到這款已公開的商品，可能已下架或連結有誤'))throw Error('Missing unavailable product link notice');
for(const label of ['aria-label="商品照片檢視"','aria-label="關閉照片"','aria-label="上一張照片"','aria-label="下一張照片"']){
 if(!homepage.includes(label))throw Error('Missing viewer accessibility label '+label);
}
console.log('PASS unavailable product links and accessible photo viewer labels');

for(const token of ["const hasProductHash=location.hash.startsWith('#product=')","if(hasProductHash)count.textContent=","document.querySelector('#share-status').textContent=''"]){
 if(!catalog.includes(token))throw Error('Missing malformed-link or share-status handling '+token);
}
console.log('PASS malformed product hash and stale share status handling');

for(const token of ["if(e.key==='Tab')","e.shiftKey&&document.activeElement===first","document.activeElement===last","last.focus()","first.focus()"]){
 if(!catalog.includes(token))throw Error('Missing keyboard focus containment: '+token);
}
console.log('PASS photo dialog keyboard focus containment');

if(!homepage.includes('id="image-error" role="status" hidden'))throw Error('Missing photo load error notice');
for(const token of ["large.addEventListener('error'","large.hidden=true","document.querySelector('#image-error').hidden=false","document.querySelector('#image-error').hidden=true"]){
 if(!catalog.includes(token))throw Error('Missing photo load error handling '+token);
}
console.log('PASS published photo load failure has an accessible fallback message');
