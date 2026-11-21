const COOKIE = 'catalog_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const fail = (message,status=400) => json({error:message},status);
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function hmac(secret, value){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));}
async function issueSession(env,username){const payload=b64url(new TextEncoder().encode(JSON.stringify({u:username,e:Math.floor(Date.now()/1000)+SESSION_SECONDS})));return payload+'.'+b64url(await hmac(env.SESSION_SECRET,payload));}
async function verifyPassword(password,encoded){try{const [saltPart,hashPart]=encoded.split('.');const salt=fromB64url(saltPart),expected=fromB64url(hashPart);const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,256);const actual=new Uint8Array(bits);if(actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];return diff===0}catch{return false}}
async function getSession(request,env){const raw=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!raw)return null;const [payload,sig]=raw.split('.');if(!payload||!sig)return null;const expected=await hmac(env.SESSION_SECRET,payload);let supplied;try{supplied=fromB64url(sig)}catch{return null}if(expected.length!==supplied.length)return null;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('HMAC',key,supplied,new TextEncoder().encode(payload)))return null;try{const data=JSON.parse(new TextDecoder().decode(fromB64url(payload)));return data.e>Math.floor(Date.now()/1000)?data:null}catch{return null}}
function cookie(value,maxAge=SESSION_SECONDS){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`}
function sameOrigin(request){const origin=request.headers.get('Origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host}catch{return false}}
async function body(request){try{return await request.json()}catch{return null}}
function parseCSV(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"'){quoted=true}else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field);rows.push(row);row=[];field=''}else if(c!=='\r'){field+=c}}if(quoted)throw Error('CSV 引號未正確結束');if(field.length||row.length){row.push(field);rows.push(row)}return rows.filter(r=>r.some(v=>v.trim()!==''))}
function csvCell(value){const s=String(value??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
async function validImage(file,kind){const b=new Uint8Array(await file.slice(0,12).arrayBuffer());if(kind==='image/jpeg')return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;if(kind==='image/png')return b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47;if(kind==='image/webp')return b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50;return false}
async function inspectImport(env,csv){if(typeof csv!=='string'||csv.length>5*1024*1024)throw Error('CSV 檔案不可超過 5 MiB');const rows=parseCSV(csv.replace(/^\uFEFF/,''));if(!rows.length)throw Error('CSV 沒有資料');const headers=rows.shift().map(x=>x.trim());const required=['sku','name','category'];for(const h of required)if(!headers.includes(h))throw Error('缺少必要欄位：'+h);if(rows.length>2000)throw Error('單次最多匯入 2,000 筆');const existing=await env.DB.prepare('SELECT sku FROM products').all(),known=new Set((existing.results||[]).map(x=>x.sku)),seen=new Set(),cats=await env.DB.prepare('SELECT name FROM categories').all(),catNames=new Set((cats.results||[]).map(x=>x.name));const ix=Object.fromEntries(headers.map((h,i)=>[h,i])),issues=[],valid=[];rows.forEach((r,n)=>{const line=n+2,obj={};for(const h of headers)obj[h]=r[ix[h]]??'';const sku=(obj.sku||'').trim(),name=(obj.name||'').trim(),category=(obj.category||'未分類').trim();if(!sku||!name)issues.push(`第 ${line} 列：SKU 與產品名稱必填`);if(known.has(sku))issues.push(`第 ${line} 列：SKU ${sku} 已存在，不可覆寫`);if(seen.has(sku))issues.push(`第 ${line} 列：CSV 內 SKU ${sku} 重複`);if(!catNames.has(category))issues.push(`第 ${line} 列：分類「${category}」不存在`);seen.add(sku);valid.push({sku,name,category,keywords:obj.keywords||'',specification:obj.specification||'',internal_note:obj.internal_note||''})});const badLines=new Set(issues.map(x=>Number(x.match(/第 (\d+) 列/)?.[1])).filter(Number.isFinite));return {rows:valid,issues,count:rows.length,valid:rows.length-badLines.size}}
async function requireAdmin(request,env){if(!sameOrigin(request))return null;return await getSession(request,env)}
async function bootstrap(env){const [products,categories,pub,images]=await Promise.all([env.DB.prepare(`SELECT p.id,p.sku,p.name,p.series,p.specification,p.keywords,p.status,p.internal_note,c.name AS category,(SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) AS photos FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.updated_at DESC,p.sku LIMIT 2000`).all(),env.DB.prepare('SELECT id,name,parent_id,sort_order FROM categories ORDER BY sort_order,name').all(),env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first(),env.DB.prepare('SELECT product_id,display_key,thumb_key FROM product_images ORDER BY sort_order').all()]);let published=[];try{published=JSON.parse(pub?.payload_json||'{"products":[]}').products||[]}catch{}const live=new Map(published.map(p=>[p.sku,p])),imageMap=new Map();for(const im of images.results||[]){if(!imageMap.has(im.product_id))imageMap.set(im.product_id,[]);imageMap.get(im.product_id).push([im.display_key,im.thumb_key])}const pendingSkus=[];for(const p of products.results||[]){const old=live.get(p.sku);if(p.status!=='active'&&old){pendingSkus.push(p.sku);continue}if(p.status==='active'){const oldImages=(old?.images||[]).map(x=>[x.display_key,x.thumb_key]);const newImages=imageMap.get(p.id)||[];if(!old||old.name!==p.name||old.series!==(p.series||'')||old.category!==p.category||old.keywords!==(p.keywords||'')||old.specification!==(p.specification||'')||JSON.stringify(oldImages)!==JSON.stringify(newImages))pendingSkus.push(p.sku)}}for(const sku of live.keys())if(!(products.results||[]).some(p=>p.sku===sku))pendingSkus.push(sku);return {products:products.results||[],categories:categories.results||[],publishedSkus:published.map(p=>p.sku),publishedCount:published.length,pendingCount:pendingSkus.length,pendingSkus}}
function bytesToBase64(bytes){let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(out)}
function base64ToBytes(value){const raw=atob(value);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
async function buildBackup(env){
 if(!env.IMAGES)throw Error('照片儲存服務尚未設定');
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
 const keys=new Set();
 for(const im of data.images){
  if(!im||typeof im.key!=='string'||!/^((private\/originals\/\d+\/)|(public\/(display|thumb)\/\d+\/))[A-Za-z0-9._-]+$/.test(im.key)||typeof im.data!=='string'||!['image/jpeg','image/png','image/webp'].includes(im.type))throw Error('備份含有不允許的照片項目');
  if(keys.has(im.key))throw Error('備份含有重複的照片檔案：'+im.key);
  keys.add(im.key);
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(im.data))throw Error('照片資料不是有效的 Base64：'+im.key);
  const bytes=base64ToBytes(im.data);
  if(!bytes.length||bytes.length>15*1024*1024)throw Error('單張照片大小不正確：'+im.key);
  if(im.type==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('備份照片 JPEG 格式錯誤：'+im.key);
  if(im.type==='image/png'&&!(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71))throw Error('備份照片 PNG 格式錯誤：'+im.key);
  if(im.type==='image/webp'&&!(bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80))throw Error('備份照片 WebP 格式錯誤：'+im.key);
  if(im.key.startsWith('public/')&&im.type!=='image/webp')throw Error('展示照片必須為 WebP：'+im.key)
 }
 for(const row of data.tables.published_media){
  if(typeof row?.image_key!=='string'||!keys.has(row.image_key))throw Error('備份缺少已發布照片檔案');
 }
 for(const row of data.tables.product_images){
  for(const field of ['original_key','display_key','thumb_key']){
   const key=row?.[field];if(typeof key!=='string'||!keys.has(key))throw Error('備份缺少照片資料對應的檔案：'+field);
  }
 }
 return data.summary||{products:data.tables.products.length,categories:data.tables.categories.length,photos:data.tables.product_images.length,imageFiles:data.images.length};
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
   const usage=await db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS used FROM trial_image_objects').first();
   if(Number(usage?.used||0)+bytes.byteLength>200*1024*1024)throw Error('免費測試版照片容量已達 200 MiB 安全上限，請先整理照片；系統不會自動啟用付費儲存');
   await db.prepare('INSERT INTO trial_image_objects(object_key,content_type,size_bytes,data) VALUES(?,?,?,?)').bind(key,options.httpMetadata?.contentType||'application/octet-stream',bytes.byteLength,bytes).run();
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
 const ready=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trial_image_objects'").first();
 const core=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'").first();
 const uploads=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_upload_requests'").first();
 if(core&&ready&&uploads)return;
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
export default {async fetch(request,env){if(!env.IMAGES&&env.DB)env={...env,IMAGES:trialImages(env.DB)};const url=new URL(request.url),path=url.pathname,method=request.method;
 try{
  if(env.DB)await ensureTrialSchema(env.DB);
  if(path==='/api/health'&&method==='GET')return json({ok:true,service:'catalog-api'});
  if(path==='/api/login'&&method==='POST'){if(!sameOrigin(request)||!request.headers.get('Origin'))return fail('來源驗證失敗',403);const b=await body(request);if(!b||typeof b.username!=='string'||typeof b.password!=='string')return fail('請輸入帳號與密碼');if(!env.SESSION_SECRET||!env.ADMIN_PASSWORD_HASH)return fail('管理者安全設定尚未完成',503);const username=env.ADMIN_USERNAME||'admin',now=Math.floor(Date.now()/1000);let limit=await env.DB.prepare('SELECT attempts,window_started,locked_until FROM admin_rate_limits WHERE username=?').bind(username).first();if(limit&&limit.locked_until>now)return fail('登入嘗試過多，請稍後再試',429);if(limit&&now-limit.window_started>900){await env.DB.prepare('DELETE FROM admin_rate_limits WHERE username=?').bind(username).run();limit=null}const valid=b.username===username&&await verifyPassword(b.password,env.ADMIN_PASSWORD_HASH);if(!valid){const attempts=(limit?.attempts||0)+1,windowStarted=limit?.window_started||now,lockedUntil=attempts>=5?now+900:0;await env.DB.prepare(`INSERT INTO admin_rate_limits(username,attempts,window_started,locked_until) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET attempts=excluded.attempts,window_started=excluded.window_started,locked_until=excluded.locked_until`).bind(username,attempts,windowStarted,lockedUntil).run();return fail('帳號或密碼不正確',401)}await env.DB.prepare('DELETE FROM admin_rate_limits WHERE username=?').bind(username).run();const token=await issueSession(env,username);return json({ok:true},200,{'set-cookie':cookie(token)})}
  if(path==='/api/logout'&&method==='POST'){if(!sameOrigin(request))return fail('來源驗證失敗',403);return json({ok:true},200,{'set-cookie':cookie('',0)});}
  if(path==='/api/admin/settings'&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const r=await env.DB.prepare('SELECT key,value FROM app_settings').all();return json({settings:Object.fromEntries((r.results||[]).map(x=>[x.key,x.value]))});}
  if(path==='/api/admin/settings'&&method==='PUT'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);if(!b||typeof b!=='object'||Array.isArray(b))return fail('設定格式不正確');const allowed={site_name:100,site_description:300,brand_color:7,contact_text:200,contact_url:500,logo_url:500,project_name:100,noindex:5,warning_percent:3};const keys=Object.keys(b);if(keys.some(k=>!(k in allowed)))return fail('包含不支援的設定欄位');const entries=[];for(const key of keys){const value=b[key];if(typeof value!=='string'||value.length>allowed[key])return fail('設定值長度或格式不正確：'+key);if(key==='brand_color'&&value&&!/^#[0-9a-fA-F]{6}$/.test(value))return fail('主色須為六位十六進位色碼');if(['contact_url','logo_url'].includes(key)&&value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol))throw Error()}catch{return fail('網址格式不正確：'+key)}}if(key==='noindex'&&!['true','false'].includes(value))return fail('搜尋引擎設定不正確');if(key==='warning_percent'&&(!/^\d{1,3}$/.test(value)||Number(value)<50||Number(value)>95))return fail('警告門檻須介於 50 至 95');entries.push(env.DB.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value))}if(entries.length){entries.push(env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('update_settings','settings','','管理者修改網站設定')"));await env.DB.batch(entries)}return json({ok:true,saved:keys.length});}
  if(path==='/api/admin/bootstrap'&&method==='GET'){const s=await getSession(request,env);if(!s)return fail('Unauthorized',401);return json(await bootstrap(env));}
  if(path==='/api/admin/products'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);if(!b?.sku?.trim()||!b?.name?.trim())return fail('產品編號與名稱必填');const cat=await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(b.category||'未分類').first();if(!cat)return fail('找不到指定分類');try{const r=await env.DB.prepare(`INSERT INTO products(sku,name,category_id,series,keywords,specification,internal_note,status) VALUES(?,?,?,?,?,?,?,?)`).bind(b.sku.trim(),b.name.trim(),cat.id,b.series||'',b.keywords||'',b.specification||'',b.internal_note||'',b.status==='active'?'active':(b.status==='archived'?'archived':'draft')).run();await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('create','product',?,'新增產品草稿')`).bind(String(r.meta.last_row_id)).run();return json({ok:true,id:r.meta.last_row_id},201)}catch(e){return fail(e.message.includes('UNIQUE')?'此 SKU 已存在': '產品新增失敗',409)}}
  const productMatch=path.match(/^\/api\/admin\/products\/(\d+)$/);if(productMatch&&method==='PUT'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request),id=Number(productMatch[1]);if(!b?.name?.trim())return fail('產品名稱必填');const cat=await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(b.category||'未分類').first();if(!cat)return fail('找不到指定分類');const r=await env.DB.prepare(`UPDATE products SET name=?,category_id=?,series=?,keywords=?,specification=?,internal_note=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(b.name.trim(),cat.id,b.series||'',b.keywords||'',b.specification||'',b.internal_note||'',b.status==='active'?'active':(b.status==='archived'?'archived':'draft'),id).run();if(!r.meta.changes)return fail('找不到產品',404);await env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('update','product',?,'更新產品草稿')`).bind(String(id)).run();return json({ok:true})}
  if(path==='/api/admin/backup/export'&&method==='GET'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);
   try{const backup=await buildBackup(env),text=JSON.stringify(backup);return new Response(text,{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="catalog-backup-${new Date().toISOString().slice(0,10)}.json"`,'cache-control':'private, no-store','x-backup-products':String(backup.summary.products),'x-backup-photos':String(backup.summary.photos)}})}catch(e){return fail('備份未完成：'+e.message,413)}
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
  if(path==='/api/admin/publish/confirm'&&method==='POST'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const b=await body(request);if(b?.confirm!==true||typeof b.revision!=='string')return fail('必須明確確認發布');const pending=await env.DB.prepare(`SELECT payload_json FROM publish_revisions WHERE revision=? AND status='pending'`).bind(b.revision).first();if(!pending)return fail('找不到待確認的發布版本',404);const statements=[env.DB.prepare(`INSERT INTO published_catalog(id,revision,payload_json,created_at) VALUES(1,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,created_at=CURRENT_TIMESTAMP`).bind(b.revision,pending.payload_json),env.DB.prepare('DELETE FROM published_media'),env.DB.prepare(`INSERT OR IGNORE INTO published_media(image_key) SELECT json_extract(img.value,'$.display_key') FROM json_each(?,'$.products') AS prod, json_each(prod.value,'$.images') AS img WHERE json_extract(img.value,'$.display_key') IS NOT NULL`).bind(pending.payload_json),env.DB.prepare(`INSERT OR IGNORE INTO published_media(image_key) SELECT json_extract(img.value,'$.thumb_key') FROM json_each(?,'$.products') AS prod, json_each(prod.value,'$.images') AS img WHERE json_extract(img.value,'$.thumb_key') IS NOT NULL`).bind(pending.payload_json),env.DB.prepare(`UPDATE publish_revisions SET status='published',notes='已人工確認並發布' WHERE revision=?`).bind(b.revision),env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('publish','catalog',?,'管理者人工確認發布')`).bind(b.revision)];await env.DB.batch(statements);return json({ok:true,revision:b.revision,published:true})}
  if(path==='/api/admin/publish/history'&&method==='GET'){if(!await requireAdmin(request,env))return fail('Unauthorized',401);const {results=[]}=await env.DB.prepare('SELECT revision,status,created_at,notes FROM publish_revisions ORDER BY created_at DESC LIMIT 30').all();return json({revisions:results})}
  if(path==='/api/admin/photos/upload'&&method==='POST'){
   if(!await requireAdmin(request,env))return fail('Unauthorized',401);if(!env.IMAGES)return fail('照片儲存服務尚未設定',503);
   const fd=await request.formData(),pid=Number(fd.get('productId')),o=fd.get('original'),d=fd.get('display'),t=fd.get('thumb'),token=String(fd.get('uploadToken')||'');
   if(!Number.isInteger(pid)||!pid||!(o instanceof File)||!(d instanceof File)||!(t instanceof File)||!/^[0-9a-f-]{36}$/i.test(token))return fail('照片資料不完整');
   const prior=await env.DB.prepare('SELECT product_id FROM photo_upload_requests WHERE token=?').bind(token).first();if(prior)return prior.product_id===pid?json({ok:true,uploaded:1,duplicateRequest:true}):fail('上傳識別碼已被其他產品使用',409);
   const product=await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(pid).first();if(!product)return fail('找不到產品',404);
   const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id=?').bind(pid).first();if((count?.n||0)>=5)return fail('每款產品最多 5 張展示照片，請先移除舊照片',409);
   if(!['image/jpeg','image/png','image/webp'].includes(o.type)||d.type!=='image/webp'||t.type!=='image/webp')return fail('僅支援 JPG、PNG、WebP，展示圖必須為 WebP');
   if(o.size>15*1024*1024||d.size>3*1024*1024||t.size>500*1024)return fail('照片大小超出限制');
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
   }catch(e){await Promise.all([env.IMAGES.delete(okey),env.IMAGES.delete(dkey),env.IMAGES.delete(tkey)]);return fail(e.message||'照片上傳失敗',500)}
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
  if(path==='/catalog/settings.json'&&method==='GET'){const row=await env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first();let settings={};try{settings=JSON.parse(row?.payload_json||'{}').settings||{}}catch{}return json(settings,200,{'cache-control':'public, max-age=60'});}
  if(path==='/catalog/products.json'&&method==='GET'){const row=await env.DB.prepare('SELECT payload_json FROM published_catalog WHERE id=1').first();let products=[];try{products=JSON.parse(row?.payload_json||'{"products":[]}').products||[]}catch{}products=products.map(p=>({...p,images:(p.images||[]).map(im=>({src:im.src,thumb:im.thumb,alt:im.alt}))}));return json(products,200,{'cache-control':'public, max-age=60','x-robots-tag':'noindex'});}
  if(path.startsWith('/api/admin/'))return fail('Not found',404);
  if(env.ASSETS){if(path==='/admin'||path==='/admin/')return env.ASSETS.fetch(new Request(new URL('/admin/index.html',request.url),request));return env.ASSETS.fetch(request);}
  return new Response('Not found',{status:404});
 }catch(e){return fail('伺服器處理失敗：'+e.message,500)}
}};
