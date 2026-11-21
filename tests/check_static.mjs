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
