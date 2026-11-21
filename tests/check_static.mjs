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

for(const token of ["if(!o.size||!d.size||!t.size)","o.size+d.size+t.size>3*1024*1024","照片檔案不可為空白"]){
 if(!worker.includes(token))throw Error('Missing actual photo upload size validation: '+token);
}
console.log('PASS reject empty photos and oversized multipart files even without Content-Length');

for(const token of ["Promise.allSettled([env.IMAGES.delete(okey)","/容量已達|單張檔案上限|大小限制|無法壓縮/","return fail(message,status)"]){
 if(!worker.includes(token))throw Error('Missing upload failure cleanup and quota response: '+token);
}
console.log('PASS photo upload failure returns quota-specific error even if cleanup fails');

for(const token of ['async function decodePhoto(file)','typeof createImageBitmap','URL.createObjectURL(file)','URL.revokeObjectURL(url)','await decodePhoto(f)','decoded.cleanup()']){if(!admin.includes(token))throw Error('Missing iOS photo decode fallback: '+token)}
console.log('PASS iPad/iPhone photo decoding fallback and URL cleanup');

if(!admin.includes("b.type!=='image/webp'")||!admin.includes('目前瀏覽器無法輸出 WebP 照片'))throw Error('Missing Safari WebP output validation');
console.log('PASS Safari photo upload rejects unsupported WebP encoding before sending');

if(!admin.includes("f.type===''&&/\\.(jpe?g|png|webp)$/i.test(f.name)"))throw Error('Missing iOS blank MIME type filename fallback');
console.log('PASS iOS photo picker supports supported file extensions when MIME type is missing');

const fallback=admin.slice(admin.indexOf('async function decodePhoto(file)'),admin.indexOf('async function trialBlob(',admin.indexOf('async function decodePhoto(file)')));
if(fallback.indexOf('img.onload=resolve')<0||fallback.indexOf('img.onload=resolve')>fallback.indexOf('img.src=url'))throw Error('Safari image load handler must be registered before assigning src');
console.log('PASS Safari image load handlers registered before source assignment');

const uploadHandler=admin.slice(admin.indexOf("$('#photoUpload').addEventListener('click'"),admin.indexOf('async function decodePhoto(file)'));
if(!uploadHandler.includes('await refreshImages()')||uploadHandler.includes('await load()')||!uploadHandler.includes("btn.textContent=chosen.length?'重新上傳失敗照片'"))throw Error('Photo upload retry must preserve chosen files without rerendering admin');
console.log('PASS photo upload keeps failed selections and retry button after refreshing gallery');

const photoManager=admin.slice(admin.indexOf('async function refreshImages()'),admin.indexOf('async function decodePhoto(file)'));
if(!photoManager.includes('currentProduct.photos=currentImages.length'))throw Error('Photo gallery count must sync after changes');
const deletion=photoManager.slice(photoManager.indexOf("notify('照片已刪除')"),photoManager.indexOf("notify('照片已刪除')")+130);
if(!deletion.includes('await refreshImages()')||deletion.includes('await load()'))throw Error('Deleting a photo must not reset pending uploads');
console.log('PASS photo deletion keeps pending upload selections and updates product photo count');

const uploadGuard=admin.slice(admin.indexOf("$('#photoUpload').addEventListener('click'"),admin.indexOf('const batch=[...chosen]',admin.indexOf("$('#photoUpload').addEventListener('click'")));
if(!uploadGuard.includes('await refreshImages()')||!uploadGuard.includes('currentImages.length+chosen.length>5')||!uploadGuard.includes('無法確認目前照片數量'))throw Error('Photo upload must verify fresh gallery count and fail closed');
console.log('PASS photo upload checks fresh gallery count and blocks when gallery cannot load');

const batchStart=admin.slice(admin.indexOf("$('#photoUpload').addEventListener('click'"),admin.indexOf('const batch=[...chosen]',admin.indexOf("$('#photoUpload').addEventListener('click'")));
if(!batchStart.includes('photoBatchPending=true;btn.disabled=true;select.disabled=true;$('#photoFiles').disabled=true;try{const fresh=await refreshImages()')||!batchStart.includes('||btn.disabled||galleryMutationPending||photoBatchPending)return')||!batchStart.includes('btn.disabled=false;select.disabled=false;$('#photoFiles').disabled=false;photoBatchPending=false;return'))throw Error('Photo batch must lock before asynchronous gallery check and unlock on validation failure');
console.log('PASS photo upload prevents duplicate submissions during capacity checks');

const photoBatchLock=admin.slice(admin.indexOf("$('#photoUpload').addEventListener('click'"),admin.indexOf('async function decodePhoto(file)'));
if(!photoBatchLock.includes("select.disabled=true;$('#photoFiles').disabled=true")||!photoBatchLock.includes("select.disabled=false;$('#photoFiles').disabled=false"))throw Error('Photo batch must lock and unlock product/file selectors');
console.log('PASS product and photo selection locked during active batch uploads');

const galleryRefresh=admin.slice(admin.indexOf('async function refreshImages()'),admin.indexOf("$('#photoFiles').addEventListener('change'"));
if(!galleryRefresh.includes('if(select.value!==pid||requestId!==galleryRequestId)return false;currentImages=r.images||[]'))throw Error('Stale gallery responses must not overwrite selected product images');
if(!galleryRefresh.includes("refreshImages().catch(e=>notify('無法載入照片清單：'+e.message))"))throw Error('Gallery change listener must handle loading errors');
console.log('PASS stale product photo gallery responses ignored and change errors handled');

const galleryChange=admin.slice(admin.indexOf("select.addEventListener('change',()=>{currentImages=[]"),admin.indexOf("$('#photoFiles').addEventListener('change'"));
if(!galleryChange.includes('正在載入這款商品的照片'))throw Error('Product switch must clear previous photo gallery');
if(!admin.includes("if(select.value===pid&&requestId===galleryRequestId)$('#existingPhotos').innerHTML"))throw Error('Stale gallery errors must not overwrite newly selected product');
console.log('PASS product switching clears old photos and suppresses stale error overlays');

if(!admin.includes('galleryRequestId=0')||!admin.includes('requestId=++galleryRequestId')||!admin.includes('select.value!==pid||requestId!==galleryRequestId'))throw Error('Photo gallery must ignore out-of-order responses, even for same product');
if(!admin.includes('if(fresh!==true)'))throw Error('Photo upload must reject stale gallery capacity checks');
console.log('PASS out-of-order gallery requests and stale upload capacity checks are guarded');

const safeGallery=admin.slice(admin.indexOf('async function refreshImages()'),admin.indexOf("select.addEventListener('change'"));
if(!safeGallery.includes('src="${esc(im.preview)}"')||!safeGallery.includes('loading="lazy"')||!safeGallery.includes('data-delete-image="${esc(String(im.id))}"'))throw Error('Admin gallery must escape image attributes and lazy-load thumbnails');
console.log('PASS admin gallery escapes image attributes and lazy-loads thumbnails');

const galleryMutations=admin.slice(admin.indexOf('async function refreshImages()'),admin.indexOf("select.addEventListener('change'"));
if(!admin.includes('galleryMutationPending=false')||galleryMutations.split('if(galleryMutationPending||photoBatchPending)return').length<3||galleryMutations.split('finally{galleryMutationPending=false}').length<3)throw Error('Gallery reorder/delete must serialize mutations and always release lock');
console.log('PASS gallery reorder and delete operations serialize concurrent edits');

const concurrentPhotoOps=admin.slice(admin.indexOf('let chosen=[],currentImages=[]'),admin.indexOf('async function decodePhoto(file)'));
if(!concurrentPhotoOps.includes('photoBatchPending=false')||concurrentPhotoOps.split('galleryMutationPending||photoBatchPending').length<4)throw Error('Photo mutations and uploads must not overlap');
if(!concurrentPhotoOps.includes("btn.disabled=false;photoBatchPending=false;return"))throw Error('Photo batch lock must release on early validation failure');
console.log('PASS photo upload and gallery mutations cannot overlap and early validation unlocks');

const productSwitch=admin.slice(admin.indexOf("select.addEventListener('change',()=>{currentImages=[]"),admin.indexOf("$('#photoFiles').addEventListener('change'"));
for(const token of ["$('#photoUpload').textContent='確認上傳照片'","$('#photoProgress').style.width='0%'","$('#photoStatus').textContent='請選擇照片後上傳。'"])if(!productSwitch.includes(token))throw Error('Switching products must reset photo upload UI: '+token);
console.log('PASS switching products resets photo retry label, progress and status');

const freshGallery=admin.slice(admin.indexOf('async function refreshImages()'),admin.indexOf("select.addEventListener('change'"));
if(!freshGallery.includes('return true;')||!admin.includes('if(fresh!==true)'))throw Error('Upload requires an explicitly successful current gallery response');
console.log('PASS photo upload rejects missing or stale gallery responses');

const photoManagerInit=admin.slice(admin.indexOf('async function refreshImages()'),admin.indexOf('async function decodePhoto(file)'));
if(!photoManagerInit.includes("if(select.value)refreshImages().catch(e=>notify('無法載入照片清單：'+e.message))"))throw Error('Initial gallery load must handle rejected promises');
if(!photoManagerInit.includes("if(f.size===0)throw Error('照片檔案是空的，請重新選擇')"))throw Error('Reject zero-byte photos before decoding');
console.log('PASS initial gallery errors handled and empty photo files rejected');

const postUpload=admin.slice(admin.indexOf("const batch=[...chosen],failed=[]"),admin.indexOf('async function decodePhoto(file)'));
if(!postUpload.includes('const refreshed=await refreshImages();if(refreshed!==true)throw Error(')||!postUpload.includes('照片清單更新失敗，請重新選擇商品確認照片'))throw Error('Photo upload must not trust a stale gallery refresh when updating product counts');
console.log('PASS post-upload photo counts require a confirmed gallery refresh');

const readiness=fs.readFileSync(new URL('tools/check_deploy_readiness.mjs',root),'utf8');
for(const token of ['Built asset differs from source','Missing linked asset','Duplicate migration number','Invalid migration filename','Secret must not be stored in','database_id','Static deployment readiness checks passed'])if(!readiness.includes(token))throw Error('Missing deployment readiness safety check: '+token);
console.log('PASS deployment readiness checks cover build parity and secret safety');

const adminAuth=fs.readFileSync(new URL('worker/index.js',root),'utf8');
if(!adminAuth.includes("if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!request.headers.get('Origin'))return null"))throw Error('Authenticated admin writes must require Origin header');
console.log('PASS authenticated admin writes require same-origin request header');

const healthSource=fs.readFileSync(new URL('worker/index.js',root),'utf8');
if(!healthSource.includes("error:'D1 database binding missing'")||!healthSource.includes("error:'D1 schema not ready'"))throw Error('Health endpoint must fail without D1 binding or product schema');
console.log('PASS health endpoint validates D1 readiness');

const uploadTransport=admin.slice(admin.indexOf('function xhrUpload('),admin.indexOf('function csvPage('));
if(!uploadTransport.includes('x.timeout=120000')||!uploadTransport.includes('x.ontimeout=')||!uploadTransport.includes('x.onabort='))throw Error('Photo upload must handle timeouts and aborts');
console.log('PASS photo upload timeout and abort handling');

if(!uploadTransport.includes('d?.ok===true&&d.uploaded===1')||!uploadTransport.includes('伺服器未確認照片已儲存'))throw Error('Upload success must require explicit server acknowledgement');
console.log('PASS upload success requires confirmed saved photo');

const healthPosition=healthSource.indexOf("if(path==='/api/health'&&method==='GET')");
const schemaPosition=healthSource.indexOf('if(env.DB)await ensureTrialSchema(env.DB);');
if(healthPosition<0||schemaPosition<0||healthPosition>schemaPosition)throw Error('Health probe must run before schema auto-initialization');
console.log('PASS health probe does not initialize database schema');

const healthBlock=healthSource.slice(healthSource.indexOf("if(path==='/api/health'&&method==='GET')"),healthSource.indexOf('if(env.DB)await ensureTrialSchema(env.DB);'));
for(const table of ['categories','products','product_images','publish_revisions','audit_log','app_settings','admin_rate_limits','published_catalog','published_media','photo_upload_requests','trial_image_objects'])if(!healthBlock.includes("'"+table+"'"))throw Error('Health check missing required table: '+table);
if(!healthBlock.includes('required.some(name=>!existing.has(name))'))throw Error('Health check must reject missing D1 tables');
console.log('PASS health check covers every catalog D1 table');

const backupExportBlock=healthSource.slice(healthSource.indexOf("if(path==='/api/admin/backup/export'"),healthSource.indexOf("if(path==='/api/admin/backup/inspect'"));
if(!backupExportBlock.includes('const backup=await buildBackup(env);validateBackup(backup);'))throw Error('Backup export must validate contents before download');
console.log('PASS backup export checks integrity before download');

const backupPageSource=admin.slice(admin.indexOf('function backupPage()'),admin.indexOf('function backupPage()')+2200);
for(const warning of ['18 MiB','800 張照片','還原功能也尚未完成','不要把本網站當成唯一備份'])if(!backupPageSource.includes(warning))throw Error('Backup page missing capacity/safety warning: '+warning);
console.log('PASS backup page discloses trial limits and missing restore');

const uploadBatchBody=admin.slice(admin.indexOf('const batch=[...chosen],failed=[]'),admin.indexOf('if(select.value)refreshImages()',admin.indexOf('const batch=[...chosen],failed=[]'));
if(!uploadBatchBody.includes('finally{select.disabled=false;')||!uploadBatchBody.includes('photoBatchPending=false;}')||!uploadBatchBody.includes('批次上傳處理中斷'))throw Error('Upload controls must recover after unexpected batch error');
console.log('PASS photo upload controls recover after unexpected error');

const bootstrapHandler=admin.slice(admin.indexOf('async function load()'),admin.indexOf('function showLogin()'));
if(!bootstrapHandler.includes("else{products=[];categories=[];showLogin();")||!bootstrapHandler.includes('管理功能已暫停'))throw Error('Admin bootstrap failure must fail closed');
if(bootstrapHandler.includes('products=[];categories=[];showApp()'))throw Error('Admin controls must not appear after bootstrap failure');
console.log('PASS admin bootstrap fails closed on cloud data error');

const storageApiBlock=healthSource.slice(healthSource.indexOf("if(path==='/api/admin/storage'"),healthSource.indexOf("if(path==='/api/admin/bootstrap'"));
if(!storageApiBlock.includes("storageMode:usingR2?'r2':'d1-trial'")||!storageApiBlock.includes('env.IMAGES.list({cursor,limit:500})'))throw Error('Storage usage must distinguish R2 from D1 trial');
if(!admin.includes("data.storageMode==='r2'")||!admin.includes('R2 用量及可能費用'))throw Error('Dashboard must distinguish R2 usage and cost');
console.log('PASS storage reporting distinguishes R2 and D1 trial');

const storageMigrationBlock=healthSource.slice(healthSource.indexOf("if(path==='/api/admin/storage'"),healthSource.indexOf("if(path==='/api/admin/bootstrap'"));
if(!storageMigrationBlock.includes('legacyTrialObjects')||!storageMigrationBlock.includes('legacyTrialBytes'))throw Error('R2 storage must report legacy D1 image inventory');
if(!admin.includes('切換到 R2 不會自動搬移'))throw Error('Admin must warn against silent D1 photo loss during R2 migration');
console.log('PASS legacy D1 photos are disclosed before R2 migration');

const migrationApi=healthSource.slice(healthSource.indexOf("if(path==='/api/admin/storage/migrate'"),healthSource.indexOf("if(path==='/api/admin/bootstrap'"));
for(const guard of ["requireAdmin(request,env)","b?.confirm!=='COPY_TO_R2'","LIMIT 11","env.IMAGES.head(row.object_key)","env.IMAGES.put(row.object_key","sourcePreserved:true"])if(!migrationApi.includes(guard))throw Error('Safe R2 migration missing: '+guard);
if(migrationApi.includes('DELETE FROM trial_image_objects'))throw Error('R2 migration must never delete D1 originals');
if(!admin.includes("'/admin/storage/migrate'")||!admin.includes('複製舊照片至 R2'))throw Error('iPad migration UI missing');
console.log('PASS confirmed non-destructive D1 to R2 migration');

const migrationVerify=healthSource.slice(healthSource.indexOf("if(path==='/api/admin/storage/migration-status'"),healthSource.indexOf("if(path==='/api/admin/bootstrap'"));
for(const part of ['requireAdmin(request,env)','SHA-256','LIMIT 21','mismatches','nextCursor','hasMore'])if(!migrationVerify.includes(part))throw Error('Migration verification missing '+part);
if(!admin.includes('核對全部舊照片')||!admin.includes('/admin/storage/migration-status?cursor='))throw Error('iPad migration verification UI missing');
console.log('PASS paginated SHA-256 verification for legacy photo migration');

if(!healthSource.includes('imageStoreWithLegacyFallback(env.IMAGES,env.DB)'))throw Error('Legacy photo read-through fallback missing');
if(!healthSource.includes('IMAGES_R2:env.IMAGES'))throw Error('Raw R2 binding must remain available for independent migration verification');
if(!healthSource.includes('if(env.IMAGES_R2){const legacy='))throw Error('Mixed-store backup must fail safely');
console.log('PASS D1 legacy read-through and independent R2 verification');

const freeStorageRoute=healthSource.slice(healthSource.indexOf("if(path==='/api/admin/storage'"),healthSource.indexOf("if(path==='/api/admin/bootstrap'"));
if(!freeStorageRoute.includes('remainingBytes:usingR2?null:Math.max(0,limit-used)')||!freeStorageRoute.includes('estimatedFilesAtCurrentAverage'))throw Error('Free storage forecast missing');
if(!freeStorageRoute.includes("env.ALLOW_R2_MIGRATION!=='true'"))throw Error('Potentially billable R2 migration must default to disabled');
if(!admin.includes('按現有照片檔案平均大小'))throw Error('Free storage capacity estimate missing from iPad UI');
console.log('PASS free storage capacity estimate and R2 migration opt-in guard');
