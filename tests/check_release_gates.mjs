import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const live=read('tools/check_live_site.mjs');
const release=read('tools/release_status.mjs');
const workflow=read('.github/workflows/trial-check.yml');
for(const route of ['/api/health','/catalog/products.json','/catalog/settings.json','/admin/','/assets/site.js','/assets/site.css','/admin/assets/admin.js']){
 assert(live.includes(route),'live acceptance missing route '+route);
}
assert(live.includes('Published photo unavailable'),'live acceptance must test real photo delivery');
assert(live.includes('redirect:\'manual\''),'live acceptance must not silently accept login redirects');
assert(release.includes('完整備份還原 API'),'release report must show restore blocker');
assert(release.includes('R2 大量照片儲存設定'),'release report must show photo storage blocker');
assert(release.includes('未完成實機驗收'),'release report must not claim device acceptance');
assert(workflow.includes('node tools/release_status.mjs'),'CI must report release blockers');
console.log('PASS launch acceptance contract and honest release status');
