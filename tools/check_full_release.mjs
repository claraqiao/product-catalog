// Full-release gate: fail closed until the complete iPad catalog is ready.
// This is intentionally stricter than the trial deployment checks.
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const config=read('wrangler.toml');
const worker=read('worker/index.js');
const errors=[];
if(!/\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*["']IMAGES["']/.test(config))
 errors.push('正式版尚未配置 R2 照片儲存 IMAGES binding；目前 D1 試用容量不適合每季約 800 張照片');
if(!worker.includes("'/api/admin/backup/restore'")&&!worker.includes('"/api/admin/backup/restore"'))
 errors.push('正式版尚未提供備份還原 API');
if(worker.includes('restoreEnabled:false'))
 errors.push('備份檢查仍宣告還原功能未啟用');
if(worker.includes('18*1024*1024'))
 errors.push('完整照片備份仍有 18 MiB 試用上限');
if(errors.length){console.error('正式版尚未達到完整交付標準：');for(const e of errors)console.error('- '+e);process.exitCode=1}
else console.log('靜態正式版條件已滿足；仍須通過部署、還原演練與 iPad 實測，不能直接視為驗收完成。');
