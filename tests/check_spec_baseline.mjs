// V1.1 specification baseline checks; read-only and safe for GitHub Actions.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = p => fs.readFileSync(new URL('../'+p, import.meta.url),'utf8');
const html=read('index.html');
const css=read('public/assets/site.css');
const js=read('public/assets/site.js');
const admin=read('admin/index.html');
const worker=read('worker/index.js');
const checks=[
 ['公開型錄不要求登入',()=>assert(!/loginForm|type="password"/.test(html))],
 ['產品搜尋',()=>assert(js.includes("q.addEventListener('input',filter)"))],
 ['分類篩選',()=>assert(js.includes("cat.addEventListener('change',filter)"))],
 ['圖片燈箱',()=>assert(html.includes('id="viewer"')&&js.includes('openViewer('))],
 ['照片前後切換',()=>assert(js.includes('prev.addEventListener')&&js.includes('next.addEventListener'))],
 ['手機滑動切換',()=>assert(js.includes("'touchstart'")&&js.includes("'touchend'"))],
 ['鍵盤 Esc 與方向鍵',()=>assert(js.includes("'Escape'")&&js.includes("'ArrowLeft'")&&js.includes("'ArrowRight'"))],
 ['產品連結分享',()=>assert(html.includes('id="share-product"')&&js.includes('shareProduct()'))],
 ['延遲載入縮圖',()=>assert(js.includes("img.loading='lazy'"))],
 ['相鄰圖片預載',()=>assert(js.includes('new Image()'))],
 ['大量商品分批顯示',()=>assert(js.includes('visibleCount=80')&&js.includes('visibleCount+=80'))],
 ['管理端包含備份與發布',()=>assert(admin.includes('備份與還原')&&admin.includes('預覽與發布'))],
 ['公開網站不包含管理員登入表單',()=>assert(!html.includes('id="username"'))],
 ['公開商品資料由獨立索引取得',()=>assert(js.includes('/catalog/products.json'))],
 ['網站樣式存在',()=>assert(css.length>100)],
 ['後端管理權限檢查程式存在',()=>assert(worker.includes('SESSION_SECRET'))],
];
let failed=0;
for(const [name,check] of checks){try{check();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e.message)}}
if(failed)process.exitCode=1;
console.log('注意：這是程式結構檢查，不代表已完成瀏覽器、容量、資安、部署或實機驗收。');
