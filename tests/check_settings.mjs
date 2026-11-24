import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const worker=fs.readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../admin/assets/admin.js',import.meta.url),'utf8');
const setup=fs.readFileSync(new URL('../password-setup/index.html',import.meta.url),'utf8');
const site=fs.readFileSync(new URL('../public/assets/site.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/site.css',import.meta.url),'utf8');
const build=fs.readFileSync(new URL('../tools/build_assets.mjs',import.meta.url),'utf8');
assert.match(worker,/path==='\/api\/admin\/settings'&&method==='GET'/);
assert.match(worker,/path==='\/api\/admin\/settings'&&method==='PUT'/);
assert.match(worker,/requireAdmin\(request,env\)/);
assert.match(worker,/INSERT INTO app_settings\(key,value\)/);
assert.match(admin,/async function settingsPage\(/);
assert.match(admin,/api\('\/admin\/settings'/);
assert.match(setup,/crypto\.subtle\.digest\('SHA-256'/);
assert.match(setup,/crypto\.getRandomValues/);
assert.match(worker,/path==='\/catalog\/settings.json'/);
assert.match(worker,/return {products,settings,published_at/);
assert.match(site,/fetch\('\/catalog\/settings.json'/);
assert.match(site,/settings.site_name/);
assert.match(css,/var\(--brand\)/);
assert.match(build,/password-setup\/index\.html/);
const scripts=[...setup.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length,'Missing password setup script');
for(const [,source] of scripts)new vm.Script(source);
console.log('PASS settings API, admin editor and password tool smoke checks');

assert.match(worker,/settingsPending=publicKeys.some/);
assert.match(worker,/pendingCount:pendingSkus.length\+\(settingsPending\?1:0\)/);
assert.match(admin,/settingsPending=!!d.settingsPending/);
console.log('PASS draft settings remain pending until explicit publish');

assert.match(worker,/path==='\/api\/admin\/storage'/);
assert.match(worker,/paidStorageEnabled:usingR2/);
assert.match(admin,/async function storageStatus/);
assert.match(admin,/storageStatus\(\)/);
console.log('PASS authenticated quota reporting and dashboard indicator');

assert.match(worker,/headers.set\('x-robots-tag',allowIndex\?'index, follow':'noindex, nofollow'\)/);
assert.match(worker,/settings\?\.noindex==='false'/);
console.log('PASS public homepage indexing controlled by confirmed published settings');

assert.match(site,/settings.logo_url/);
assert.match(site,/logo.referrerPolicy='no-referrer'/);
assert.match(worker,/key==='logo_url'&&u.protocol!=='https:'/);
console.log('PASS published logo with HTTPS and referrer protections');

// Exercise the browser-generated credential against the real Worker login route.
const fields=new Map(['make','pw','hash','result','status','copy','copyPassword'].map(id=>[id,{style:{}}]));
vm.runInNewContext(scripts[0][1],{
 document:{getElementById:id=>fields.get(id)},crypto,TextEncoder,btoa,
});
await fields.get('make').onclick();
const password=fields.get('pw').value;
const hash=fields.get('hash').value;
assert.match(password,/^[A-Za-z0-9_-]{32}$/);
assert.match(hash,/^v2\.[A-Za-z0-9_-]{43}$/);

const handler=(await import('../worker/index.js')).default;
const schema=['categories','products','product_images','publish_revisions','audit_log','app_settings','admin_rate_limits','published_catalog','published_media','photo_upload_requests','trial_image_objects'];
const DB={prepare(sql){return {
 bind(){return this},
 async all(){assert.match(sql,/sqlite_master/);return {results:schema.map(name=>({name}))}},
 async first(){assert.match(sql,/SELECT attempts/);return null},
 async run(){assert.match(sql,/admin_rate_limits/);return {}},
}}};
const origin='https://catalog.example';
const login=pass=>handler.fetch(new Request(origin+'/api/login',{
 method:'POST',headers:{origin,'content-type':'application/json'},
 body:JSON.stringify({username:'admin',password:pass}),
}),{DB,SESSION_SECRET:crypto.randomUUID(),ADMIN_PASSWORD_HASH:hash});
const accepted=await login(password);
assert.equal(accepted.status,200);
assert.match(accepted.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
const wrong=(password[0]==='A'?'B':'A')+password.slice(1);
assert.equal((await login(wrong)).status,401);
console.log('PASS generated password works through the Worker login route');
