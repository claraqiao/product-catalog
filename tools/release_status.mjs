// Honest release status for each CI run; does not deploy or modify Cloudflare.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const config=read('wrangler.toml'),worker=read('worker/index.js'),site=read('public/assets/site.js');
const checks=[
 {name:'Cloudflare Worker 與 D1 設定',ok:/main\s*=\s*"worker\/index\.js"/.test(config)&&/binding\s*=\s*"DB"/.test(config),kind:'code'},
 {name:'iPad 管理介面程式',ok:existsSync(new URL('../admin/assets/admin.js',import.meta.url)),kind:'code'},
 {name:'公開商品瀏覽程式',ok:site.includes("'/catalog/products.json'"),kind:'code'},
 {name:'R2 大量照片儲存設定',ok:/\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"IMAGES"/.test(config),kind:'production'},
 {name:'完整備份還原 API',ok:worker.includes("'/api/admin/backup/restore'"),kind:'production'},
 {name:'無 18 MiB 備份限制',ok:!worker.includes('18*1024*1024'),kind:'production'},
];
const external=[
 'Cloudflare 正式網址及實際部署成功：未驗證',
 '管理員登入、iPad 上傳、發布流程：未完成實機驗收',
 '公開網址及照片在 iPhone／LINE 顯示：未完成實機驗收',
 '800 張照片容量、完整備份與還原演練：未完成',
];
const lines=['# 產品型錄發布狀態','',...checks.map(c=>'- '+(c.ok?'[x]':'[ ]')+' '+c.name+(c.kind==='production'?'（正式版條件）':'')),'','## 仍需實際驗收',...external.map(x=>'- '+x),'','**注意：程式檢查通過不代表已部署或正式驗收通過。**',''];
const report=lines.join('\n');
console.log(report);
const path=process.env.GITHUB_STEP_SUMMARY;
if(path)writeFileSync(path,report,{flag:'a'});
if(process.argv.includes('--strict')&&checks.some(c=>!c.ok))process.exitCode=1;
