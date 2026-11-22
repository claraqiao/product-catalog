const COOKIE = 'catalog_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const fail = (message,status=400) => json({error:message},status);
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function hmac(secret, value){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));}
async function issueSession(env,username){const payload=b64url(new TextEncoder().encode(JSON.stringify({u:username,e:Math.floor(Date.now()/1000)+SESSION_SECONDS})));return payload+'.'+b64url(await hmac(env.SESSION_SECRET,payload));}
async function verifyPassword(password,encoded){try{const [saltPart,hashPart]=encoded.split('.');const salt=fromB64url(saltPart),expected=fromB64url(hashPart);const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,256);const actual=new Uint8Array(bits);if(actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];return diff===0}catch{return false}}
async function getSession(request,env){const raw=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!raw||!env.SESSION_SECRET)return null;const [payload,sig]=raw.split('.');if(!payload||!sig)return null;const expected=await hmac(env.SESSION_SECRET,payload);let supplied;try{supplied=fromB64url(sig)}catch{return null}if(expected.length!==supplied.length)return null;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('HMAC',key,supplied,new TextEncoder().encode(payload)))return null;try{const data=JSON.parse(new TextDecoder().decode(fromB64url(payload)));return data.e>Math.floor(Date.now()/1000)?data:null}catch{return null}}
function cookie(value,maxAge=SESSION_SECONDS){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`}
function sameOrigin(request){const origin=request.headers.get('Origin');if(!origin)return true;try{return new URL(origin).origin===new URL(request.url).origin}catch{return false}}
async function body(request){try{return await request.json()}catch{return null}}
function parseCSV(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"'){quoted=true}else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field);rows.push(row);row=[];field=''}else if(c!=='\r'){field+=c}}if(quoted)throw Error('CSV 引號未正確結束');if(field.length||row.length){row.push(field);rows.push(row)}return rows.filter(r=>r.some(v=>v.trim()!==''))}
function csvCell(value){const raw=String(value??'');const s=/^[\s\uFEFF]*[=+@\-\t\r]/u.test(raw)?"'"+raw:raw;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
async function validImage(file,kind){const b=new Uint8Array(await file.slice(0,12).arrayBuffer());if(kind==='image/jpeg')return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;if(kind==='image/png')return b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47;if(kind==='image/webp')return b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50;return false}
async function inspectImport(env,csv){if(typeof csv!=='string'||csv.length>5*1024*1024)throw Error('CSV 檔案不可超過 5 MiB');const rows=parseCSV(csv.replace(/^\uFEFF/,''));if(!rows.length)throw Error('CSV 沒有資料');const headers=rows.shift().map(x=>x.trim());if(new Set(headers).size!==headers.length)throw Error('CSV 欄位名稱不可重複');const required=['sku','name','category'];for(const h of required)if(!headers.includes(h))throw Error('缺少必要欄位：'+h);if(rows.length>2000)throw Error('單次最多匯入 2,000 筆');const existing=await env.DB.prepare('SELECT sku FROM products').all();if((existing.results||[]).length+rows.length>2000)throw Error('產品總數不可超過 2,000 筆，請先整理既有產品');const known=new Set((existing.results||[]).map(x=>x.sku)),seen=new Set(),cats=await env.DB.prepare('SELECT name FROM categories').all(),catNames=new Set((cats.results||[]).map(x=>x.name));const ix=Object.fromEntries(headers.map((h,i)=>[h,i])),issues=[],valid=[];rows.forEach((r,n)=>{const line=n+2,obj={};for(const h of headers)obj[h]=r[ix[h]]??'';const sku=(obj.sku||'').trim(),name=(obj.name||'').trim(),category=(obj.category||'未分類').trim();if(!sku||!name)issues.push(`第 ${line} 列：SKU 與產品名稱必填`);if(known.has(sku))issues.push(`第 ${line} 列：SKU ${sku} 已存在，不可覆寫`);if(seen.has(sku))issues.push(`第 ${line} 列：CSV 內 SKU ${sku} 重複`);if(!catNames.has(category))issues.push(`第 ${line} 列：分類「${category}」不存在`);seen.add(sku);valid.push({sku,name,category,series:obj.series||'',keywords:obj.keywords||'',specification:obj.specification||'',internal_note:obj.internal_note||''})});const badLines=new Set(issues.map(x=>Number(x.match(/第 (\d+) 列/)?.[1])).filter(Number.isFinite));return {rows:valid,issues,count:rows.length,valid:rows.length-badLines.size}}
async function requireAdmin(request,env){if(!sameOrigin(request))return null;if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!request.headers.get('Origin'))return null;return await getSession(request,env)}
async function bootstrap(env){const [products,categories,pub,images]=await Promise.all([env.DB.prepare(`SELECT p.id,p.sku,p.name,p.series,p.specification,p.keywords,p.status,p.internal_note,c.name AS category,(SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) AS photos FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.updated_at DESC,p.sku LIMIT 2000`).all(),env.DB.prepare('SELECT id,name,parent_id,sort_order FROM categories ORDER BY sort_order,name').all(),env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first(),env.DB.prepare('SELECT product_id,display_key,thumb_key FROM product_images ORDER BY sort_order').all()]);let published=[];try{published=JSON.parse(pub?.payload_json||'{"products":[]}').products||[]}catch{}const live=new Map(published.map(p=>[p.sku,p])),imageMap=new Map();for(const im of images.results||[]){if(!imageMap.has(im.product_id))imageMap.set(im.product_id,[]);imageMap.get(im.product_id).push([im.display_key,im.thumb_key])}const pendingSkus=[];for(const p of products.results||[]){const old=live.get(p.sku);if(p.status!=='active'&&old){pendingSkus.push(p.sku);continue}if(p.status==='active'){const oldImages=(old?.images||[]).map(x=>[x.display_key,x.thumb_key]);const newImages=imageMap.get(p.id)||[];if(!old||old.name!==p.name||old.series!==(p.series||'')||old.category!==p.category||old.keywords!==(p.keywords||'')||old.specification!==(p.specification||'')||JSON.stringify(oldImages)!==JSON.stringify(newImages))pendingSkus.push(p.sku)}}for(const sku of live.keys())if(!(products.results||[]).some(p=>p.sku===sku))pendingSkus.push(sku);let liveSettings={};try{liveSettings=JSON.parse(pub?.payload_json||'{}').settings||{}}catch{}const settingsRows=await env.DB.prepare('SELECT key,value FROM app_settings').all();const publicKeys=['site_name','site_description','brand_color','contact_text','contact_url','logo_url','noindex'];const draftSettings=Object.fromEntries((settingsRows.results||[]).filter(x=>publicKeys.includes(x.key)).map(x=>[x.key,x.value]));const settingsPending=publicKeys.some(k=>(draftSettings[k]||'')!==(liveSettings[k]||''));return {products:products.results||[],categories:categories.results||[],publishedSkus:published.map(p=>p.sku),publishedCount:published.length,pendingCount:pendingSkus.length+(settingsPending?1:0),pendingSkus,settingsPending}}
function bytesToBase64(bytes){let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(out)}
function base64ToBytes(value){const raw=atob(value);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
async function buildBackup(env){
 if(!env.IMAGES)throw Error('照片儲存服務尚未設定');
 if(env.IMAGES_R2){const legacy=await env.DB.prepare('SELECT COUNT(*) AS n FROM trial_image_objects').first();if(Number(legacy?.n||0)>0)throw Error('R2 已啟用但 D1 尚有舊照片；目前備份只會列出 R2 檔案，為避免不完整備份，請先完成舊照片複製及核對，並在正式版備份合併功能完成前保留 D1 資料');}
 const names=['categories','products','product_images','publish_revisions','published_catalog','published_media','audit_log','app_settings','photo_upload_requests'];
 const tables={};for(const name of names){const r=await env.DB.prepare(`SELECT * FROM ${name}`).all();tables[name]=r.results||[]}
 const images=[];let cursor;let total=0;
 for(const prefix of ['private/originals/','public/display/','public/thumb/']){cursor=undefined;do{const page=await env.IMAGES.list({prefix,cursor,limit:500});for(const item of page.objects||[]){const obj=await env.IMAGES.get(item.key);if(!obj)throw Error('備份期間照片不存在：'+item.key);const bytes=new Uint8Array(await obj.arrayBuffer());total+=bytes.length;if(total>18*1024*1024)throw Error('照片原始檔總量超過目前備份下載安全上限 18 MiB；請先分批備份功能完成後再操作');images.push({key:item.key,type:obj.httpMetadata?.contentType||'application/octet-stream',data:bytesToBase64(bytes)})}cursor=page.truncated?page.cursor:undefined}while(cursor)}
 return {format:'catalog-v12-backup',version:1,created_at:new Date().toISOString(),tables,images,summary:{products:tables.products.length,categories:tables.categories.length,photos:tables.product_images.length,image_bytes:total,published_revisions:tables.publish_revisions.length}};
}
function validateBackup(data){
 if(!data||data.format!=='catalog-v12-backup'||data.version!==1||!data.tables||!Array.isArray(data.images))throw Error('備份檔格式不正確或版本不支援');
 const allowed=['categories','products','product_images','publish_revisions','published_catalog','published_media','audit_log','app_settings','photo_upload_requests'];
 for(const n of allowed)if(!Array.isArray(data.tables[n]))throw Error('備份缺少資料表：'+n);
 const keys=new Set();let decodedImageBytes=0;
 for(const im of data.images){
  if(!im||typeof im.key!=='string'||!/^((private\/originals\/\d+\/)|(public\/(display|thumb)\/\d+\/))[A-Za-z0-9._-]+$/.test(im.key)||typeof im.data!=='string'||!['image/jpeg','image/png','image/webp'].includes(im.type))throw Error('備份含有不允許的照片項目');
  if(keys.has(im.key))throw Error('備份含有重複的照片檔案：'+im.key);
  keys.add(im.key);
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(im.data))throw Error('照片資料不是有效的 Base64：'+im.key);
  const bytes=base64ToBytes(im.data);
  if(!bytes.length||bytes.length>512*1024)throw Error('免費測試版備份中的單張照片不可超過 512 KiB：'+im.key);decodedImageBytes+=bytes.length;if(decodedImageBytes>18*1024*1024)throw Error('備份照片總量超過 18 MiB 安全檢查上限');
  if(im.type==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('備份照片 JPEG 格式錯誤：'+im.key);
  if(im.type==='image/png'&&!(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71))throw Error('備份照片 PNG 格式錯誤：'+im.key);
  if(im.type==='image/webp'&&!(bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80))throw Error('備份照片 WebP 格式錯誤：'+im.key);
  if(im.key.startsWith('public/')&&im.type!=='image/webp')throw Error('展示照片必須為 WebP：'+im.key)
 }
 for(const row of data.tables.published_media){
  if(typeof row?.image_key!=='string'||!keys.has(row.image_key))throw Error('備份缺少已發布照片檔案');
  if(!row.image_key.startsWith('public/'))throw Error('已發布照片不可指向私人原圖');
 }
 const categoryIds=new Set(),categoryNames=new Set();for(const row of data.tables.categories){if(!Number.isInteger(row?.id)||categoryIds.has(row.id))throw Error('備份分類編號不正確或重複');if(typeof row.name!=='string'||!row.name.trim()||categoryNames.has(row.name))throw Error('備份分類名稱不可空白或重複');categoryIds.add(row.id);categoryNames.add(row.name)}
 const categoryParents=new Map(data.tables.categories.map(row=>[row.id,row.parent_id]));
 for(const row of data.tables.categories){if(row.parent_id!=null&&!categoryIds.has(row.parent_id))throw Error('備份分類的上層分類不存在');const visited=new Set();let current=row.id;while(current!=null){if(visited.has(current))throw Error('備份分類存在循環的上層關係：'+row.id);visited.add(current);current=categoryParents.get(current)}}
 const productIds=new Set(),productSkus=new Set();for(const row of data.tables.products){if(!Number.isInteger(row?.id)||productIds.has(row.id))throw Error('備份產品編號不正確或重複');if(typeof row.sku!=='string'||!row.sku.trim()||productSkus.has(row.sku))throw Error('備份產品 SKU 不可空白或重複');if(typeof row.name!=='string'||!row.name.trim())throw Error('備份產品名稱不可空白');if(!categoryIds.has(row.category_id))throw Error('備份產品所屬分類不存在：'+row?.id);productIds.add(row.id);productSkus.add(row.sku)}
 const imageIds=new Set(),assignedKeys=new Set();
 for(const row of data.tables.product_images){
  if(!Number.isInteger(row?.id)||imageIds.has(row.id))throw Error('備份照片編號不正確或重複');imageIds.add(row.id);
  if(!productIds.has(row?.product_id))throw Error('備份照片對應的產品不存在：'+row?.product_id);
  for(const [field,prefix] of [['original_key','private/originals/'],['display_key','public/display/'],['thumb_key','public/thumb/']]){
   const key=row?.[field];if(typeof key!=='string'||!keys.has(key))throw Error('備份缺少照片資料對應的檔案：'+field);
   if(!key.startsWith(prefix+row.product_id+'/'))throw Error('備份照片所屬產品或照片類型不一致：'+field);
   if(assignedKeys.has(key))throw Error('備份照片檔案被重複指定給不同照片：'+key);assignedKeys.add(key);
  }
 }
 return {products:data.tables.products.length,categories:data.tables.categories.length,photos:data.tables.product_images.length,imageFiles:data.images.length,image_bytes:decodedImageBytes,published_revisions:data.tables.publish_revisions.length};
}
async function makeSnapshot(env){const {results=[]}=await env.DB.prepare(`SELECT p.id,p.sku,p.name,p.series,p.specification,p.keywords,c.name AS category,i.display_key,i.thumb_key,i.alt_text FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN product_images i ON i.product_id=p.id WHERE p.status='active' ORDER BY p.sort_order,p.sku,i.sort_order`).all();const map=new Map();for(const r of results){if(!map.has(r.id))map.set(r.id,{sku:r.sku,name:r.name,series:r.series,keywords:r.keywords,category:r.category,specification:r.specification,images:[]});if(r.display_key){if(!r.thumb_key)throw Error('產品 '+r.sku+' 有照片缺少縮圖，請重新處理');map.get(r.id).images.push({src:'/media/'+r.display_key,thumb:'/media/'+r.thumb_key,alt:r.alt_text||r.name,display_key:r.display_key,thumb_key:r.thumb_key})}}const products=[...map.values()];const missing=products.filter(p=>!p.images.length).map(p=>p.sku);if(missing.length)throw Error('以下上架產品尚未加入照片：'+missing.slice(0,30).join('、'));if(products.length&&!env.IMAGES)throw Error('照片儲存服務尚未設定');const keys=products.flatMap(p=>p.images.flatMap(i=>[i.display_key,i.thumb_key]));for(let i=0;i<keys.length;i+=20){const chunk=keys.slice(i,i+20),objects=await Promise.all(chunk.map(k=>env.IMAGES.head(k)));if(objects.some(x=>!x))throw Error('有展示圖或縮圖在儲存服務中不存在，請先修復照片資料')}const settingsRows=await env.DB.prepare('SELECT key,value FROM app_settings').all();const settings=Object.fromEntries((settingsRows.results||[]).filter(x=>['site_name','site_description','brand_color','contact_text','contact_url','logo_url','noindex'].includes(x.key)).map(x=>[x.key,x.value]));return {products,settings,published_at:new Date().toISOString()}}
// Bounded D1 storage adapter for the no-billing trial.
function trialImages(db) {
 const lookup=key=>db.prepare('SELECT content_type,size_bytes,data FROM trial_image_objects WHERE object_key=?').bind(key).first();
 return {
  async put(key,stream,options={}) {
   const bytes=await new Response(stream).arrayBuffer();
   if(!bytes.byteLength||bytes.byteLength>524288) throw Error('免費測試版單張檔案上限 512 KiB，請先壓縮照片');
   // Reserve headroom in the free D1 database for product metadata and migrations.
   const inserted=await db.prepare('INSERT INTO trial_image_objects(object_key,content_type,size_bytes,data) SELECT ?,?,?,? WHERE (SELECT COALESCE(SUM(size_bytes),0) FROM trial_image_objects)+?<=?').bind(key,options.httpMetadata?.contentType||'application/octet-stream',bytes.byteLength,bytes,bytes.byteLength,200*1024*1024).run();
   if(Number(inserted.meta?.changes||0)!==1)throw Error('免費照片容量已達 200 MiB 安全上限；沒有儲存這張照片，也不會自動啟用付費儲存');
  },
  async get(key) {
   const row=await lookup(key); if(!row)return null;
   const bytes=new Uint8Array(row.data);
   return {body:bytes,httpMetadata:{contentType:row.content_type},arrayBuffer:async()=>bytes.buffer};
  },
  async head(key){return db.prepare('SELECT object_key FROM trial_image_objects WHERE object_key=?').bind(key).first();},
  async delete(key){await db.prepare('DELETE FROM trial_image_objects WHERE object_key=?').bind(key).run();},
  async list({prefix='',cursor='',limit=500}={}){
   const n=Math.min(500,Math.max(1,limit));
   const {results=[]}=await db.prepare('SELECT object_key FROM trial_image_objects WHERE substr(object_key,1,length(?))=? AND object_key>? ORDER BY object_key LIMIT ?').bind(prefix,prefix,cursor,n+1).all();
   const objects=results.slice(0,n).map(r=>({key:r.object_key}));
   return {objects,truncated:results.length>n,cursor:objects.at(-1)?.key};
  }
 };
}
// One-time, idempotent initialization for the no-computer trial deployment.
// This creates missing tables without deleting or changing existing product data.
async function ensureTrialSchema(db) {
 const required=['categories','products','product_images','publish_revisions','audit_log','app_settings','admin_rate_limits','published_catalog','published_media','photo_upload_requests','trial_image_objects'];
 const schema=await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
 const existing=new Set((schema.results||[]).map(row=>row.name));
 if(required.every(name=>existing.has(name)))return;
 const statements=[
  "CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,sort_order INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,category_id INTEGER NOT NULL REFERENCES categories(id),series TEXT NOT NULL DEFAULT '',specification TEXT NOT NULL DEFAULT '',keywords TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),sort_order INTEGER NOT NULL DEFAULT 0,internal_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,published_at TEXT)",
  "CREATE TABLE IF NOT EXISTS product_images(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,original_key TEXT NOT NULL,display_key TEXT NOT NULL DEFAULT '',thumb_key TEXT NOT NULL DEFAULT '',image_hash TEXT NOT NULL DEFAULT '',alt_text TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,is_cover INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS publish_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,revision TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL,deployment_url TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',payload_json TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL DEFAULT '',details TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS admin_rate_limits(username TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,window_started INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS published_catalog(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS published_media(image_key TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS photo_upload_requests(token TEXT PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS trial_image_objects(object_key TEXT PRIMARY KEY,content_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,data BLOB NOT NULL)",
  "INSERT OR IGNORE INTO categories(name,sort_order) VALUES('未分類',0)"
 ];
 for(const sql of statements)await db.prepare(sql).run();
}
function imageStoreWithLegacyFallback(r2,db,allowWrites=false){
 const legacy=trialImages(db);
 return {
  ...r2,
  put:(...args)=>{if(!allowWrites)throw Error('R2 寫入未啟用；免費優先模式禁止未經同意的 R2 上傳');return r2.put(...args)},
  async delete(key){if(!allowWrites)throw Error('R2 寫入未啟用；為避免遺失照片，禁止在唯讀模式刪除 R2 或 D1 照片');await r2.delete(key);await legacy.delete(key)},
  list:(...args)=>r2.list(...args),
  async get(key){return await r2.get(key)||await legacy.get(key)},
  async head(key){return await r2.head(key)||await legacy.head(key)}
 };
}
export default {async fetch(request,env){if(!env.IMAGES&&env.DB)env={...env,IMAGES:trialImages(env.DB),IMAGES_IS_TRIAL:true};else if(env.IMAGES&&env.DB)env={...env,IMAGES_R2:env.IMAGES,IMAGES:imageStoreWithLegacyFallback(env.IMAGES,env.DB,env.ALLOW_R2_WRITES==='true')};const url=new URL(request.url),path=url.pathname,method=request.method;
 try{
  if(path==='/api/health'&&method==='GET'){if(!env.DB)return json({ok:false,service:'catalog-api',error:'D1 database binding missing'},503);await ensureTrialSchema(env.DB);const required=['categories','products','product_images','publish_revisions','audit_log','app_settings','admin_rate_limits','published_catalog','published_media','photo_upload_requests','trial_image_objects'];const schema=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();const existing=new Set((schema.results||[]).map(row=>row.name));if(required.some(name=>!existing.has(name)))return json({ok:false,service:'catalog-api',error:'D1 schema not ready'},503);return json({ok:true,service:'catalog-api'});}
  if(env.DB)await ensureTrialSchema(env.DB);
  if(path==='/api/login'&&method==='POST'){if(!sameOrigin(request)||!request.headers.get('Origin'))return fail('來源驗證失敗',403);const b=await body(request);if(!b||typeof b.username!=='string'||typeof b.password!=='string')return fail('請輸入帳號與密碼');if(!env.SESSION_SECRET||!env.ADMIN_PASSWORD_HASH)return fail('管理者安全設定尚未完成',503);const username=env.ADMIN_USERNAME||'admin',now=Math.floor(Date.now()/1000);let limit=await env.DB.prepare('SELECT attempts,window_started,locked_until FROM admin_rate_limits WHERE username=?').bind(username).first();if(limit&&limit.locked_until>now)return fail('登入嘗試過多，請稍後再試',429);if(limit&&now-limit.window_started>900){await env.DB.prepare('DELETE FROM admin_rate_limits WHERE username=?').bind(username).run();limit=null}const valid=b.username===username&&await verifyPassword(b.password,env.ADMIN_PASSWORD_HASH);if(!valid){const attempts=(limit?.attempts||0)+1,windowStarted=limit?.window_started||now,lockedUntil=attempts>=5?now+900:0;await env.DB.prepare(`INSERT INTO admin_rate_limits(username,attempts,window_started,locked_until) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET attempts=excluded.attempts,window_started=excluded.window_started,locked_until=excluded.locked_until`).bind(username,attempts,windowStarted,lockedUntil).run();return fail('帳號或密碼不正確',401)}await env.DB.prepare('DELETE FROM admin_rate_limits WHERE username=?').bind(username).run();const token=await issueSession(env,username);return json({ok:true},200,{'set-cookie':cookie(token)})}
  if(path==='/api/logout'&&method==='POST'){if(!sameOrigin(request))return fail('來源驗證失敗',403);return json({ok:true},200,{'set-cookie':cookie('',0)});}
  if(path==='/api/admin/settings'&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const r=await env.DB.prepare('SELECT key,value FROM app_settings').all();return json({settings:Object.fromEntries((r.results||[]).map(x=>[x.key,x.value]))});}
  if(path==='/api/admin/settings'&&method==='PUT'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);if(!b||typeof b!=='object'||Array.isArray(b))return fail('設定格式不正確');const allowed={site_name:100,site_description:300,brand_color:7,contact_text:200,contact_url:500,logo_url:500,project_name:100,noindex:5,warning_percent:3};const keys=Object.keys(b);if(keys.some(k=>!(k in allowed)))return fail('包含不支援的設定欄位');const entries=[];for(const key of keys){const value=b[key];if(typeof value!=='string'||value.length>allowed[key])return fail('設定值長度或格式不正確：'+key);if(key==='brand_color'&&value&&!/^#[0-9a-fA-F]{6}$/.test(value))return fail('主色須為六位十六進位色碼');if(['contact_url','logo_url'].includes(key)&&value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||(key==='logo_url'&&u.protocol!=='https:'))throw Error()}catch{return fail('網址格式不正確：'+key)}}if(key==='noindex'&&!['true','false'].includes(value))return fail('搜尋引擎設定不正確');if(key==='warning_percent'&&(!/^\d{1,3}$/.test(value)||Number(value)<50||Number(value)>95))return fail('警告門檻須介於 50 至 95');entries.push(env.DB.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value))}if(entries.length){entries.push(env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('update_settings','settings','','管理者修改網站設定')"));await env.DB.batch(entries)}return json({ok:true,saved:keys.length});}
  if(path==='/api/admin/storage'&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const usingR2=!!env.IMAGES?.list&&!env.IMAGES_IS_TRIAL;let used=0,objects=0;if(usingR2){let cursor;do{const page=await env.IMAGES.list({cursor,limit:500});for(const item of page.objects||[]){used+=Number(item.size||0);objects++;}cursor=page.truncated?page.cursor:undefined;}while(cursor)}else{const r=await env.DB.prepare('SELECT COALESCE(SUM(size_bytes),0) AS bytes,COUNT(*) AS objects FROM trial_image_objects').first();used=Number(r?.bytes||0);objects=Number(r?.objects||0)}const trialRow=usingR2?await env.DB.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes FROM trial_image_objects').first():null;const legacyTrialObjects=Number(trialRow?.count||0),legacyTrialBytes=Number(trialRow?.bytes||0);const limit=usingR2?null:200*1024*1024;const settings=await env.DB.prepare("SELECT value FROM app_settings WHERE key='warning_percent'").first();const threshold=Number(settings?.value||80);return json({bytes:used,objects,limitBytes:limit,percent:usingR2?null:Math.round(1000*used/limit)/10,warning:usingR2?false:used/limit*100>=threshold,warningPercent:threshold,storageMode:usingR2?'r2':'d1-trial',legacyTrialObjects,legacyTrialBytes,paidStorageEnabled:usingR2,freeOnlyRequested:true,r2MigrationEnabled:env.ALLOW_R2_MIGRATION==='true',r2WritesEnabled:env.ALLOW_R2_WRITES==='true',remainingBytes:usingR2?null:Math.max(0,limit-used),estimatedFilesAtCurrentAverage:usingR2||objects===0?null:Math.floor(Math.max(0,limit-used)/(used/objects)),catalogTargetPhotos:800,estimatedTotalBytesFor800:usingR2||objects===0?null:Math.ceil(800*3*(used/objects)),estimated800Fits:usingR2||objects===0?null:800*3*(used/objects)<=limit,averageStoredFileBytes:objects?Math.round(used/objects):null,note:usingR2?'R2 不代表免費，請確認 Cloudflare 帳務；不應在未獲同意下啟用':'D1 試用版設有 200 MiB 應用上限，容量預估不保證 800 張照片可放入'});}
  if(path==='/api/admin/storage/migrate'&&method==='POST'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   if(!env.IMAGES_R2||env.IMAGES_IS_TRIAL)return fail('尚未配置 R2，不能搬移照片',409);
   if(env.ALLOW_R2_MIGRATION!=='true')return fail('依照不付費原則，R2 搬移預設關閉；未明確同意及設定前不會啟動',403);
   const b=await body(request);
   if(b?.confirm!=='COPY_TO_R2')return fail('必須明確確認 COPY_TO_R2 才能開始複製',422);
   if(b?.cursor!==undefined&&(typeof b.cursor!=='string'||b.cursor.length>512))return fail('搬移游標格式不正確',422);
   const cursor=b?.cursor||'';
   const {results=[]}=await env.DB.prepare('SELECT object_key,content_type,size_bytes,data FROM trial_image_objects WHERE object_key>? ORDER BY object_key LIMIT 11').bind(cursor).all();
   const batch=results.slice(0,10);let copied=0,already=0;const failures=[];
   for(const row of batch){
    try{
     const bytes=new Uint8Array(row.data);
     if(bytes.byteLength!==Number(row.size_bytes))throw Error('D1 照片資料大小不符');
     const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
     const sourceHash=await digest(bytes);
     const existing=await env.IMAGES_R2.head(row.object_key);
     if(existing&&Number(existing.size)!==bytes.byteLength)throw Error('R2 同名檔案大小不同，拒絕覆寫');
     if(!existing)await env.IMAGES_R2.put(row.object_key,bytes,{httpMetadata:{contentType:row.content_type}});
     const saved=await env.IMAGES_R2.get(row.object_key);
     if(!saved)throw Error('R2 複製後無法讀回照片');
     const targetBytes=new Uint8Array(await saved.arrayBuffer());
     if(targetBytes.byteLength!==bytes.byteLength||await digest(targetBytes)!==sourceHash)throw Error('R2 照片內容 SHA-256 核對失敗，保留 D1 原檔');
     if(existing)already++;else copied++;
    }catch(e){failures.push({key:row.object_key,error:String(e.message||e)})}
   }
   const nextCursor=failures.length?cursor:(batch.at(-1)?.object_key||cursor);
   return json({ok:failures.length===0,copied,already,failures,nextCursor,hasMore:failures.length>0||results.length>10,sourcePreserved:true,note:'僅複製至 R2，沒有刪除 D1 原檔；需逐批完成並核對。'});
  }
  if(path==='/api/admin/storage/migration-status'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   if(!env.IMAGES_R2||env.IMAGES_IS_TRIAL)return fail('尚未配置 R2',409);
   const cursor=url.searchParams.get('cursor')||'';
   if(cursor.length>512||/[\x00-\x1f\x7f]/.test(cursor))return fail('游標長度或內容不正確',422);
   const total=await env.DB.prepare('SELECT COUNT(*) AS count FROM trial_image_objects').first();
   const {results=[]}=await env.DB.prepare('SELECT object_key,size_bytes,data FROM trial_image_objects WHERE object_key>? ORDER BY object_key LIMIT 21').bind(cursor).all();
   const batch=results.slice(0,20),mismatches=[];let verified=0;
   const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   for(const row of batch){
    const source=new Uint8Array(row.data),target=await env.IMAGES_R2.get(row.object_key);
    if(!target){mismatches.push({key:row.object_key,reason:'R2 缺少檔案'});continue}
    const targetBytes=new Uint8Array(await target.arrayBuffer());
    if(source.byteLength!==Number(row.size_bytes)||source.byteLength!==targetBytes.byteLength||await digest(source)!==await digest(targetBytes))mismatches.push({key:row.object_key,reason:'照片內容不一致'});
    else verified++;
   }
   return json({checked:batch.length,verified,total:Number(total?.count||0),mismatches,hasMore:results.length>20,nextCursor:batch.at(-1)?.object_key||cursor,note:'逐批核對照片內容，不會刪除原檔；必須檢查全部批次才能確認完整'});
  }
  if(path==='/api/admin/bootstrap'&&method==='GET'){const s=await getSession(request,env);if(!s)return fail('Unauthorized',401);return json(await bootstrap(env));}
  if(path==='/api/admin/products'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);if(!b?.sku?.trim()||!b?.name?.trim())return fail('產品編號與名稱必填');const capacity=await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first();if(Number(capacity?.n||0)>=2000)return fail('產品已達 2,000 筆上限，請先整理舊產品',409);const cat=await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(b.category||'未分類').first();if(!cat)return fail('找不到指定分類');try{const r=await env.DB.prepare(`INSERT INTO products(sku,name,category_id,series,keywords,specification,internal_note,status) VALUES(?,?,?,?,?,?,?,?)`).bind(b.sku.trim(),b.name.trim(),cat.id,b.series||'',b.keywords||'',b.specification||'',b.internal_note||'',b.status==='active'?'active':(b.status==='archived'?'archived':'draft')).run();await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('create','product',?,'新增產品草稿')`).bind(String(r.meta.last_row_id)).run();return json({ok:true,id:r.meta.last_row_id},201)}catch(e){return fail(e.message.includes('UNIQUE')?'此 SKU 已存在': '產品新增失敗',409)}}
  const productMatch=path.match(/^\/api\/admin\/products\/(\d+)$/);if(productMatch&&method==='PUT'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request),id=Number(productMatch[1]);if(!b?.name?.trim())return fail('產品名稱必填');const cat=await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(b.category||'未分類').first();if(!cat)return fail('找不到指定分類');const r=await env.DB.prepare(`UPDATE products SET name=?,category_id=?,series=?,keywords=?,specification=?,internal_note=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(b.name.trim(),cat.id,b.series||'',b.keywords||'',b.specification||'',b.internal_note||'',b.status==='active'?'active':(b.status==='archived'?'archived':'draft'),id).run();if(!r.meta.changes)return fail('找不到產品',404);await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('update','product',?,'更新產品草稿')`).bind(String(id)).run();return json({ok:true})}
  if(path==='/api/admin/photos/audit'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const raw=url.searchParams.get('after')||'0';
   if(!/^(0|[1-9][0-9]{0,12})$/.test(raw)||!Number.isSafeInteger(Number(raw)))return fail('檢查進度格式不正確',422);
   const after=Number(raw);
   const {results=[]}=await env.DB.prepare('SELECT id,product_id,original_key,display_key,thumb_key FROM product_images WHERE id>? ORDER BY id LIMIT 21').bind(after).all();
   const batch=results.slice(0,20),missing=[];let checked=0;
   for(const photo of batch){
    for(const role of ['original_key','display_key','thumb_key']){
     const key=photo[role];if(!key){missing.push({photoId:photo.id,productId:photo.product_id,role,key:null,reason:'照片欄位缺少檔案路徑'});continue}checked++;
     if(!env.IMAGES||!await env.IMAGES.head(key))missing.push({photoId:photo.id,productId:photo.product_id,role,key});
    }
   }
   return json({photosChecked:batch.length,filesChecked:checked,missing,hasMore:results.length>20,nextAfter:batch.at(-1)?.id||after,note:'逐批檢查商品照片檔案是否存在；只讀取、不刪除任何資料。需核對全部批次。'});
  }
  if(path==='/api/admin/backup/image-index'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const cursor=url.searchParams.get('cursor')||'';
   if(cursor.length>512||/[\x00-\x1f\x7f]/.test(cursor))return fail('游標過長或內容不正確',422);
   const pageSize=100;
   const {results=[]}=await env.DB.prepare('SELECT object_key,content_type,size_bytes FROM trial_image_objects WHERE object_key>? ORDER BY object_key LIMIT 101').bind(cursor).all();
   const batch=results.slice(0,pageSize);
   return json({format:'catalog-v12-d1-image-index',version:1,images:batch.map(r=>({key:r.object_key,type:r.content_type,size:Number(r.size_bytes)})),hasMore:results.length>pageSize,nextCursor:batch.at(-1)?.object_key||cursor,includesR2:false,note:'這是 D1 照片檔案清單，不是備份檔；每張照片的內容須另外下載'});
  }
  if(path==='/api/admin/backup/tables'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const names=['categories','products','product_images','publish_revisions','published_catalog','published_media','audit_log','app_settings','photo_upload_requests'];
   const tables={};for(const name of names){const {results=[]}=await env.DB.prepare('SELECT * FROM '+name).all();tables[name]=results}
   return new Response(JSON.stringify({format:'catalog-v12-tables-only',version:1,created_at:new Date().toISOString(),tables,includesPhotos:false,restorable:false,note:'僅商品與網站資料，不包含照片檔案，不能視為完整備份或直接還原'}),{headers:{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="catalog-tables-only.json"','cache-control':'private, no-store'}});
  }
  if(path==='/api/admin/backup/images'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const cursor=url.searchParams.get('cursor')||'';
   if(cursor.length>512||/[\x00-\x1f\x7f]/.test(cursor))return fail('游標長度或內容不正確',422);
   if(cursor&&!/^((private\/originals\/\d+\/)|(public\/(display|thumb)\/\d+\/))[A-Za-z0-9._-]+$/.test(cursor))return fail('照片備份游標不是有效的檔案名稱',422);
   const {results=[]}=await env.DB.prepare('SELECT object_key,content_type,size_bytes,data FROM trial_image_objects WHERE object_key>? ORDER BY object_key LIMIT 11').bind(cursor).all();
   const batch=results.slice(0,10),images=[];
   for(const row of batch){if(!/^((private\/originals\/\d+\/)|(public\/(display|thumb)\/\d+\/))[A-Za-z0-9._-]+$/.test(row.object_key))return fail('照片備份遇到不支援的檔案路徑：'+row.object_key,409);if(!['image/jpeg','image/png','image/webp'].includes(row.content_type))return fail('照片備份遇到不支援的檔案格式：'+row.object_key,409);const bytes=new Uint8Array(row.data);if(bytes.byteLength!==Number(row.size_bytes))return fail('備份照片資料不完整：'+row.object_key,409);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');images.push({key:row.object_key,type:row.content_type,size:bytes.byteLength,sha256:hash,data:bytesToBase64(bytes)})}
   return json({format:'catalog-v12-d1-photo-batch',version:1,startCursor:cursor,images,exportedCount:images.length,hasMore:results.length>10,nextCursor:batch.at(-1)?.object_key||cursor,includesR2:false,restorable:false,note:'D1 舊照片分批匯出資料；不包含 R2 照片，需保存全部批次與商品資料才能進行未來還原'});
  }
  if(path==='/api/admin/catalog/issues'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const raw=url.searchParams.get('after')||'0';
   if(!/^(0|[1-9][0-9]{0,12})$/.test(raw)||!Number.isSafeInteger(Number(raw)))return fail('檢查進度格式不正確',422);
   const after=Number(raw);
   const {results=[]}=await env.DB.prepare("SELECT p.id,p.sku,p.name,p.status,COUNT(i.id) AS photos,SUM(CASE WHEN i.id IS NOT NULL AND (i.original_key IS NULL OR i.original_key='' OR i.display_key IS NULL OR i.display_key='' OR i.thumb_key IS NULL OR i.thumb_key='') THEN 1 ELSE 0 END) AS incomplete FROM products p LEFT JOIN product_images i ON i.product_id=p.id WHERE p.id>? GROUP BY p.id ORDER BY p.id LIMIT 101").bind(after).all();
   const batch=results.slice(0,100),issues=[];
   for(const row of batch){if(row.status==='active'&&Number(row.photos)===0)issues.push({id:row.id,sku:row.sku,name:row.name,problem:'上架商品沒有照片'});if(Number(row.incomplete)>0)issues.push({id:row.id,sku:row.sku,name:row.name,problem:'照片缺少原圖、展示圖或縮圖',count:Number(row.incomplete)})}
   return json({scanned:batch.length,issues,hasMore:results.length>100,nextAfter:batch.at(-1)?.id||after,note:'只讀取資料，不更改商品。此檢查不能取代照片實際檔案存在性檢查。'});
  }
  if(path==='/api/admin/catalog/audit'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const counts={};
   for(const [label,sql] of [
    ['products','SELECT COUNT(*) AS n FROM products'],
    ['activeProducts','SELECT COUNT(*) AS n FROM products WHERE status=\'active\''],
    ['productsWithoutPhotos',"SELECT COUNT(*) AS n FROM products p WHERE p.status='active' AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id)"],
    ['photos','SELECT COUNT(*) AS n FROM product_images'],
    ['photosWithoutDisplay','SELECT COUNT(*) AS n FROM product_images WHERE display_key IS NULL OR display_key=\'\''],
    ['photosWithoutThumb','SELECT COUNT(*) AS n FROM product_images WHERE thumb_key IS NULL OR thumb_key=\'\''],
    ['photosWithoutOriginal','SELECT COUNT(*) AS n FROM product_images WHERE original_key IS NULL OR original_key=\'\''],
    ['duplicateSkus','SELECT COUNT(*) AS n FROM (SELECT sku FROM products GROUP BY sku HAVING COUNT(*)>1)'],
    ['publishedMedia','SELECT COUNT(*) AS n FROM published_media'],
    ['d1Files','SELECT COUNT(*) AS n FROM trial_image_objects']
   ]){const row=await env.DB.prepare(sql).first();counts[label]=Number(row?.n||0)}
   return json({checkedAt:new Date().toISOString(),counts,readyForPublish:counts.productsWithoutPhotos===0&&counts.photosWithoutDisplay===0&&counts.photosWithoutThumb===0&&counts.duplicateSkus===0,note:'僅檢查資料表與照片欄位；照片檔案實際存在與否，請另外執行照片完整性檢查。'});
  }
  if(path==='/api/admin/photos/orphans'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const cursor=url.searchParams.get('cursor')||'';
   if(cursor.length>512||/[\x00-\x1f\x7f]/.test(cursor))return fail('游標不正確',422);
   const {results=[]}=await env.DB.prepare("SELECT t.object_key,t.size_bytes FROM trial_image_objects t WHERE t.object_key>? AND NOT EXISTS(SELECT 1 FROM product_images p WHERE p.original_key=t.object_key OR p.display_key=t.object_key OR p.thumb_key=t.object_key) AND NOT EXISTS(SELECT 1 FROM published_media m WHERE m.image_key=t.object_key) ORDER BY t.object_key LIMIT 101").bind(cursor).all();
   const batch=results.slice(0,100);
   return json({files:batch.map(x=>({key:x.object_key,size:Number(x.size_bytes)})),hasMore:results.length>100,nextCursor:batch.at(-1)?.object_key||cursor,readOnly:true,note:'疑似未被商品或已發布頁面使用的 D1 檔案；不會自動刪除。其他用途仍可能需要這些檔案，請人工確認。'});
  }
  if(path==='/api/admin/backup/preflight'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const names=['categories','products','product_images','publish_revisions','published_catalog','published_media','audit_log','app_settings','photo_upload_requests'],counts={};
   for(const name of names){const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM '+name).first();counts[name]=Number(row?.n||0)}
   const storage=await env.DB.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size_bytes),0) AS bytes,COALESCE(MAX(size_bytes),0) AS max_bytes FROM trial_image_objects').first();
   const references=await env.DB.prepare("SELECT COUNT(*) AS n FROM (SELECT original_key AS k FROM product_images UNION ALL SELECT display_key FROM product_images UNION ALL SELECT thumb_key FROM product_images)").first();
   const total=Number(storage?.bytes||0),objects=Number(storage?.n||0),r2=!!env.IMAGES_R2;
   const warnings=[];
   if(r2)warnings.push('已設定 R2：目前 D1 分批匯出不包含 R2 照片，不能當成完整備份');
   if(total>18*1024*1024)warnings.push('照片超過 18 MiB，單一完整備份下載功能無法使用');
   if(total>200*1024*1024)warnings.push('D1 照片超過應用程式設定的 200 MiB 安全上限');
   if(Number(storage?.max_bytes||0)>524288)warnings.push('有照片超過 512 KiB 的單檔上限');
   // A reference count can exceed object count when multiple records reuse one photo key; rely on the exact missing-reference query below.
   const missingRefs=await env.DB.prepare("SELECT COUNT(*) AS n FROM (SELECT original_key AS k FROM product_images UNION ALL SELECT display_key FROM product_images UNION ALL SELECT thumb_key FROM product_images UNION ALL SELECT image_key FROM published_media) refs WHERE refs.k IS NULL OR refs.k='' OR (NOT EXISTS (SELECT 1 FROM trial_image_objects t WHERE t.object_key=refs.k))").first();
   const missingD1References=Number(missingRefs?.n||0);
   if(!r2&&missingD1References)warnings.push('有 '+missingD1References+' 筆照片參照找不到 D1 檔案；請先檢查照片完整性');
   return json({checkedAt:new Date().toISOString(),tables:counts,d1Images:objects,d1Bytes:total,largestImageBytes:Number(storage?.max_bytes||0),productPhotoReferences:Number(references?.n||0),missingD1References:r2?null:missingD1References,storageMode:r2?'r2-with-d1-fallback':'d1-trial',singleBackupPossible:!r2&&total<=18*1024*1024,fullRestoreAvailable:false,photoBatchPages:Math.ceil(objects/10),warnings,note:'唯讀備份準備檢查，不會修改資料。分批照片與商品資料必須全部保存；目前尚不能自動還原。'});
  }
  if(path==='/api/admin/backup/manifest'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const tables=['categories','products','product_images','publish_revisions','published_catalog','published_media','audit_log','app_settings','photo_upload_requests'];
   const counts={};for(const name of tables){const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM '+name).first();counts[name]=Number(row?.n||0)}
   const legacy=await env.DB.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size_bytes),0) AS bytes FROM trial_image_objects').first();
   const mode=env.IMAGES_R2?'r2-with-d1-fallback':'d1-trial';
   return json({format:'catalog-v12-backup-manifest',version:1,created_at:new Date().toISOString(),tables:counts,legacyImages:Number(legacy?.n||0),legacyBytes:Number(legacy?.bytes||0),storageMode:mode,fullBackupAvailable:!env.IMAGES_R2&&Number(legacy?.bytes||0)<=18*1024*1024,restoreAvailable:false,note:'這是資料清單與容量報告，不是完整備份，不能用來還原照片。'});
  }
  if(path==='/api/admin/backup/export'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   try{const backup=await buildBackup(env);validateBackup(backup);const text=JSON.stringify(backup);return new Response(text,{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="catalog-backup-${new Date().toISOString().slice(0,10)}.json"`,'cache-control':'private, no-store','x-backup-products':String(backup.summary.products),'x-backup-photos':String(backup.summary.photos)}})}catch(e){return fail('備份未完成：'+e.message,413)}
  }
  if(path==='/api/admin/backup/inspect'&&method==='POST'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const length=Number(request.headers.get('Content-Length')||0);if(length>32*1024*1024)return fail('備份檔超過 32 MiB 檢查上限',413);
   let b;try{const raw=await request.text();if(new TextEncoder().encode(raw).length>32*1024*1024)return fail('備份檔超過 32 MiB 檢查上限',413);b=JSON.parse(raw)}catch{return fail('備份檔不是有效的 JSON',422)}
   try{const summary=validateBackup(b?.backup);return json({valid:true,summary,created_at:b.backup.created_at,restoreEnabled:false,note:'目前可檢查備份完整性；正式覆蓋還原尚未啟用，避免在未完成原子回復驗證前破壞現有資料。'})}catch(e){return fail('備份檢查失敗：'+e.message,422)}
  }
  if(path==='/api/admin/export.csv'&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const {results=[]}=await env.DB.prepare(`SELECT p.sku,p.name,c.name AS category,p.series,p.keywords,p.specification,p.status,p.internal_note FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.sku`).all();const header=['sku','name','category','series','keywords','specification','status','internal_note'];const lines=[header.join(','),...results.map(r=>header.map(k=>csvCell(r[k])).join(','))];return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="catalog-products.csv"','cache-control':'no-store'}})}
  if(path==='/api/admin/import/preview'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);try{const result=await inspectImport(env,b?.csv);return json({total:result.count,valid:result.valid,issues:result.issues.slice(0,100),canImport:result.issues.length===0})}catch(e){return fail(e.message)}}
  if(path==='/api/admin/import'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);try{const result=await inspectImport(env,b?.csv);if(!result.count)return fail('CSV 沒有可匯入的產品資料');if(result.issues.length)return json({error:'乾跑檢查未通過',issues:result.issues.slice(0,100)},422);const catRows=await env.DB.prepare('SELECT id,name FROM categories').all(),catMap=new Map((catRows.results||[]).map(x=>[x.name,x.id]));const statements=result.rows.map(r=>env.DB.prepare(`INSERT INTO products(sku,name,category_id,series,keywords,specification,internal_note,status) VALUES(?,?,?,?,?,?,?,'draft')`).bind(r.sku,r.name,catMap.get(r.category),r.series||'',r.keywords,r.specification,r.internal_note));if(statements.length)await env.DB.batch(statements);return json({ok:true,imported:statements.length},201)}catch(e){return fail(e.message,422)}}
  if(path==='/api/admin/publish/prepare'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);try{const snapshot=await makeSnapshot(env),revision=crypto.randomUUID(),old=await env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first();let oldSkus=[];try{oldSkus=JSON.parse(old?.payload_json||'{}').products?.map(p=>p.sku)||[]}catch{}const newSkus=snapshot.products.map(p=>p.sku),oldSet=new Set(oldSkus),newSet=new Set(newSkus),added=newSkus.filter(x=>!oldSet.has(x)),removed=oldSkus.filter(x=>!newSet.has(x));await env.DB.prepare(`INSERT INTO publish_revisions(revision,status,notes,payload_json) VALUES(?,'pending','等待管理者人工確認',?)`).bind(revision,JSON.stringify(snapshot)).run();await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('prepare_publish','catalog',?,'建立待確認發布快照')`).bind(revision).run();return json({revision,total:newSkus.length,added,removed,preview:snapshot})}catch(e){return fail('發布檢查未通過：'+e.message,422)}}
  if(path==='/api/admin/publish/confirm'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);if(b?.confirm!==true||typeof b.revision!=='string'||!/^[0-9a-f-]{36}$/i.test(b.revision))return fail('必須明確確認有效的發布版本');const pending=await env.DB.prepare(`SELECT payload_json FROM publish_revisions WHERE revision=? AND status='pending'`).bind(b.revision).first();if(!pending)return fail('找不到待確認的發布版本',404);
   // A draft may have changed after preview. Reject stale approvals rather than
   // silently publishing an outdated snapshot or references to removed images.
   let current;try{current=await makeSnapshot(env)}catch(e){return fail('確認前重新檢查失敗：'+e.message,409)}
   let prepared;try{prepared=JSON.parse(pending.payload_json)}catch{return fail('待發布快照已損毀',409)}
   const sameProducts=JSON.stringify(prepared.products)===JSON.stringify(current.products);
   const sameSettings=JSON.stringify(prepared.settings||{})===JSON.stringify(current.settings||{});
   if(!sameProducts||!sameSettings)return fail('預覽後產品、照片或網站設定已變更，請重新預覽再確認發布',409);
   const publishedRow=await env.DB.prepare('SELECT created_at FROM published_catalog WHERE id=1').first();
   const preparedRow=await env.DB.prepare("SELECT created_at FROM publish_revisions WHERE revision=?").bind(b.revision).first();
   if(publishedRow?.created_at&&preparedRow?.created_at&&publishedRow.created_at>preparedRow.created_at)return fail('已有較新的公開版本，請重新預覽後發布',409);
   const statements=[env.DB.prepare(`INSERT INTO published_catalog(id,revision,payload_json,created_at) VALUES(1,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,created_at=CURRENT_TIMESTAMP`).bind(b.revision,pending.payload_json),env.DB.prepare('DELETE FROM published_media'),env.DB.prepare(`INSERT OR IGNORE INTO published_media(image_key) SELECT json_extract(img.value,'$.display_key') FROM json_each(?,'$.products') AS prod, json_each(prod.value,'$.images') AS img WHERE json_extract(img.value,'$.display_key') IS NOT NULL`).bind(pending.payload_json),env.DB.prepare(`INSERT OR IGNORE INTO published_media(image_key) SELECT json_extract(img.value,'$.thumb_key') FROM json_each(?,'$.products') AS prod, json_each(prod.value,'$.images') AS img WHERE json_extract(img.value,'$.thumb_key') IS NOT NULL`).bind(pending.payload_json),env.DB.prepare(`UPDATE publish_revisions SET status='superseded',notes='已有較新版本發布，請重新預覽' WHERE status='pending' AND revision<>?`).bind(b.revision),env.DB.prepare(`UPDATE publish_revisions SET status='published',notes='已人工確認並發布' WHERE revision=?`).bind(b.revision),env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('publish','catalog',?,'管理者人工確認發布')`).bind(b.revision)];await env.DB.batch(statements);return json({ok:true,revision:b.revision,published:true})}
  if(path==='/api/admin/publish/history'&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const {results=[]}=await env.DB.prepare('SELECT revision,status,created_at,notes FROM publish_revisions ORDER BY created_at DESC LIMIT 30').all();return json({revisions:results})}
  if(path==='/api/admin/photos/upload'&&method==='POST'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);if(!env.IMAGES)return fail('照片儲存服務尚未設定',503);
   const declaredSize=Number(request.headers.get('content-length')||0);if(declaredSize>3*1024*1024)return fail('免費測試版單次照片上傳不可超過 3 MiB',413);const fd=await request.formData(),pid=Number(fd.get('productId')),o=fd.get('original'),d=fd.get('display'),t=fd.get('thumb'),token=String(fd.get('uploadToken')||'');
   if(!Number.isInteger(pid)||!pid||!(o instanceof File)||!(d instanceof File)||!(t instanceof File)||!/^[0-9a-f-]{36}$/i.test(token))return fail('照片資料不完整');
   const prior=await env.DB.prepare('SELECT product_id FROM photo_upload_requests WHERE token=?').bind(token).first();if(prior)return prior.product_id===pid?json({ok:true,uploaded:1,duplicateRequest:true}):fail('上傳識別碼已被其他產品使用',409);
   const product=await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(pid).first();if(!product)return fail('找不到產品',404);
   const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id=?').bind(pid).first();if((count?.n||0)>=5)return fail('每款產品最多 5 張展示照片，請先移除舊照片',409);
   if(!['image/jpeg','image/png','image/webp'].includes(o.type)||d.type!=='image/webp'||t.type!=='image/webp')return fail('僅支援 JPG、PNG、WebP，展示圖必須為 WebP');
   if(!o.size||!d.size||!t.size)return fail('照片檔案不可為空白',400);if(o.size+d.size+t.size>3*1024*1024)return fail('免費測試版單次照片總量不可超過 3 MiB',413);if(o.size>512*1024||d.size>512*1024||t.size>512*1024)return fail('免費測試版每張原圖、展示圖及縮圖都不可超過 512 KiB，請先壓縮照片',413);
   if(!await validImage(o,o.type)||!await validImage(d,'image/webp')||!await validImage(t,'image/webp'))return fail('照片內容與檔案格式不符或檔案已損毀');
   const id=crypto.randomUUID(),ext=o.type==='image/png'?'png':(o.type==='image/webp'?'webp':'jpg'),okey=`private/originals/${pid}/${id}.${ext}`,dkey=`public/display/${pid}/${id}.webp`,tkey=`public/thumb/${pid}/${id}.webp`;
   try{
    await env.IMAGES.put(okey,o.stream(),{httpMetadata:{contentType:o.type}});await env.IMAGES.put(dkey,d.stream(),{httpMetadata:{contentType:'image/webp',cacheControl:'public, max-age=31536000, immutable'}});await env.IMAGES.put(tkey,t.stream(),{httpMetadata:{contentType:'image/webp',cacheControl:'public, max-age=31536000, immutable'}});
    const current=await env.DB.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id=?').bind(pid).first();if((current?.n||0)>=5)throw Error('照片數量已達上限，請重新整理後再試');
    await env.DB.batch([
     env.DB.prepare('INSERT INTO product_images(product_id,original_key,display_key,thumb_key,image_hash,sort_order,is_cover) VALUES(?,?,?,?,?,?,?)').bind(pid,okey,dkey,tkey,'',current?.n||0,(current?.n||0)===0?1:0),
     env.DB.prepare('INSERT INTO photo_upload_requests(token,product_id,created_at) VALUES(?,?,CURRENT_TIMESTAMP)').bind(token,pid),
     env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('upload','product',?,'新增產品照片')").bind(String(pid))
    ]);
    return json({ok:true,uploaded:1});
   }catch(e){await Promise.allSettled([env.IMAGES.delete(okey),env.IMAGES.delete(dkey),env.IMAGES.delete(tkey)]);const message=String(e?.message||'照片上傳失敗');const status=/容量已達|單張檔案上限|大小限制|無法壓縮/.test(message)?413:(/照片數量已達上限/.test(message)?409:500);return fail(message,status)}
  }
  const imageListMatch=path.match(/^\/api\/admin\/products\/(\d+)\/images$/);
  if(imageListMatch&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const pid=Number(imageListMatch[1]);const product=await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(pid).first();if(!product)return fail('找不到產品',404);
   const {results=[]}=await env.DB.prepare('SELECT id,sort_order,is_cover,alt_text,original_key,display_key,thumb_key FROM product_images WHERE product_id=? ORDER BY sort_order,id').bind(pid).all();
   return json({images:results.map(x=>({id:x.id,sort_order:x.sort_order,is_cover:!!x.is_cover,alt_text:x.alt_text,preview:`/api/admin/images/${x.id}/preview`,original:`/api/admin/images/${x.id}/original`}))});
  }
  const previewMatch=path.match(/^\/api\/admin\/images\/(\d+)\/preview$/);
  if(previewMatch&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const row=await env.DB.prepare('SELECT thumb_key FROM product_images WHERE id=?').bind(Number(previewMatch[1])).first();if(!row)return fail('找不到照片',404);
   const obj=await env.IMAGES.get(row.thumb_key);if(!obj)return fail('照片檔案不存在',404);
   return new Response(obj.body,{headers:{'content-type':'image/webp','cache-control':'private, no-store'}});
  }
  const reorderMatch=path.match(/^\/api\/admin\/products\/(\d+)\/images\/reorder$/);
  if(reorderMatch&&method==='POST'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   const pid=Number(reorderMatch[1]),b=await body(request),ids=b?.ids;if(!Array.isArray(ids)||ids.length>5||ids.some(x=>!Number.isInteger(x)))return fail('照片排序資料不正確');
   const {results=[]}=await env.DB.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY id').bind(pid).all();
   const actual=results.map(x=>x.id).sort((a,b)=>a-b),given=[...ids].sort((a,b)=>a-b);if(actual.length!==given.length||actual.some((x,i)=>x!==given[i]))return fail('照片清單已變更，請重新整理後再排序',409);
   const statements=ids.map((id,i)=>env.DB.prepare('UPDATE product_images SET sort_order=?,is_cover=? WHERE id=? AND product_id=?').bind(i,i===0?1:0,id,pid));if(statements.length)await env.DB.batch(statements);
   await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('reorder_images','product',?,'調整產品照片順序')`).bind(String(pid)).run();return json({ok:true});
  }
  const deleteImageMatch=path.match(/^\/api\/admin\/images\/(\d+)$/);
  if(deleteImageMatch&&method==='DELETE'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   if(env.IMAGES_R2&&env.ALLOW_R2_WRITES!=='true')return fail('R2 目前為唯讀模式，為避免照片與商品紀錄不一致，禁止刪除照片',409);
   const id=Number(deleteImageMatch[1]),row=await env.DB.prepare('SELECT product_id,original_key,display_key,thumb_key FROM product_images WHERE id=?').bind(id).first();if(!row)return fail('找不到照片',404);
   await env.DB.prepare('DELETE FROM product_images WHERE id=?').bind(id).run();
   // Keep immutable media referenced by the currently published catalog.
    const referenced=await env.DB.prepare('SELECT image_key FROM published_media WHERE image_key IN (?,?)').bind(row.display_key,row.thumb_key).all();
    const keep=new Set((referenced.results||[]).map(x=>x.image_key));
    // The source original belongs to a published photo too; retain it for recovery.
    if(keep.has(row.display_key)||keep.has(row.thumb_key))keep.add(row.original_key);
    await Promise.all([row.original_key,row.display_key,row.thumb_key].filter(k=>k&&!keep.has(k)).map(k=>env.IMAGES.delete(k)));
   const {results=[]}=await env.DB.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY sort_order,id').bind(row.product_id).all();
   const statements=results.map((x,i)=>env.DB.prepare('UPDATE product_images SET sort_order=?,is_cover=? WHERE id=?').bind(i,i===0?1:0,x.id));if(statements.length)await env.DB.batch(statements);
   await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('delete_image','product',?,'刪除產品照片')`).bind(String(row.product_id)).run();return json({ok:true});
  }
  const originalMatch=path.match(/^\/api\/admin\/images\/(\d+)\/original$/);if(originalMatch&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const row=await env.DB.prepare('SELECT original_key FROM product_images WHERE id=?').bind(Number(originalMatch[1])).first();if(!row)return fail('找不到原始照片',404);const obj=await env.IMAGES.get(row.original_key);if(!obj)return fail('原始照片不存在',404);return new Response(obj.body,{headers:{'content-type':obj.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, no-store','content-disposition':'attachment'}})}
  const mediaMatch=path.match(/^\/media\/(public\/(?:display|thumb)\/[A-Za-z0-9/_-]+\.webp)$/);if(mediaMatch&&method==='GET'){const key=mediaMatch[1];const row=await env.DB.prepare(`SELECT image_key FROM published_media WHERE image_key=? LIMIT 1`).bind(key).first();if(!row)return new Response('Not found',{status:404});const obj=await env.IMAGES.get(key);if(!obj)return new Response('Not found',{status:404});return new Response(obj.body,{headers:{'content-type':'image/webp','cache-control':'public, max-age=31536000, immutable','etag':obj.httpEtag||''}})}
  if(path==='/api/admin/categories'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request),name=b?.name?.trim();if(!name)return fail('分類名稱必填');try{await env.DB.prepare('INSERT INTO categories(name) VALUES(?)').bind(name).run();return json({ok:true},201)}catch{return fail('分類名稱已存在',409)}}
  if(path==='/catalog/settings.json'&&method==='GET'){const row=await env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first();let settings={};try{settings=JSON.parse(row?.payload_json||'{}').settings||{}}catch{}const safe={};for(const k of ['site_name','site_description','brand_color','contact_text','contact_url','logo_url','noindex'])if(typeof settings[k]==='string')safe[k]=settings[k];return json(safe,200,{'cache-control':'public, max-age=60','x-robots-tag':'noindex'});}
  if(path==='/catalog/products.json'&&method==='GET'){const row=await env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first();let products=[];try{products=JSON.parse(row?.payload_json||'{"products":[]}').products||[]}catch{}products=products.map(p=>({sku:p.sku,name:p.name,series:p.series,keywords:p.keywords,category:p.category,specification:p.specification,images:(p.images||[]).map(im=>({src:im.src,thumb:im.thumb,alt:im.alt}))}));return json(products,200,{'cache-control':'public, max-age=60','x-robots-tag':'noindex'});}
  if(path.startsWith('/api/admin/'))return fail('Not found',404);
  if(env.ASSETS){
    if(path==='/admin'||path==='/admin/')return env.ASSETS.fetch(new Request(new URL('/admin/index.html',request.url),request));
    const response=await env.ASSETS.fetch(request);
    if((path==='/'||path==='/index.html')&&response.ok){
     const row=await env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first();
     let allowIndex=false;try{allowIndex=JSON.parse(row?.payload_json||'{}').settings?.noindex==='false'}catch{}
     const headers=new Headers(response.headers);headers.set('x-robots-tag',allowIndex?'index, follow':'noindex, nofollow');
     return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
   }
  return new Response('Not found',{status:404});
 }catch(e){return fail('伺服器處理失敗：'+e.message,500)}
}};
