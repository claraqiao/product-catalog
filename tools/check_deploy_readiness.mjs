import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const config=read('wrangler.toml');
const expected=[
  [/^name\s*=\s*"product-catalog"\s*$/m,'Worker name'],
  [/^main\s*=\s*"worker\/index\.js"\s*$/m,'Worker entry'],
  [/^directory\s*=\s*"\.\/site_dist"\s*$/m,'Static assets directory'],
  [/^binding\s*=\s*"DB"\s*$/m,'D1 binding'],
  [/^database_name\s*=\s*"product-catalog"\s*$/m,'D1 name'],
  [/^database_id\s*=\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"\s*$/m,'D1 ID'],
];
for(const [pattern,label] of expected){if(!pattern.test(config))throw Error('Deployment config invalid: '+label);console.log('PASS',label)}
for(const file of ['index.html','admin/index.html','admin/assets/admin.js','admin/assets/admin.css','assets/site.js','assets/site.css','password-setup/index.html']){
 const source=path.join(root,'site_dist',file);
 if(!fs.existsSync(source)||fs.statSync(source).size===0)throw Error('Missing/empty built asset: '+file);
 const original=file.startsWith('assets/')?'public/'+file:file;
 if(!fs.readFileSync(source).equals(fs.readFileSync(path.join(root,original))))throw Error('Built asset differs from source: '+file);
 console.log('PASS asset',file);
}
for(const page of ['index.html','admin/index.html','password-setup/index.html']){
 const html=read('site_dist/'+page);
 for(const match of html.matchAll(/(?:src|href)\s*=\s*["'](\/[^"'?#]+\.(?:css|js))["']/g)){
  const asset=path.join(root,'site_dist',match[1].slice(1));
  if(!fs.existsSync(asset)||fs.statSync(asset).size===0)throw Error('Missing linked asset '+match[1]+' in '+page);
  console.log('PASS linked asset',page,match[1]);
 }
}
for(const file of ['wrangler.toml','wrangler.toml.example']){
 const content=read(file);
 if(/^\s*(ADMIN_PASSWORD_HASH|SESSION_SECRET|CLOUDFLARE_API_TOKEN)\s*=/m.test(content))throw Error('Secret must not be stored in '+file);
 console.log('PASS no embedded secrets in',file);
}
const ignore=read('.gitignore');
for(const entry of ['.dev.vars','.env','site_dist/','.wrangler/']){
 if(!ignore.split(/\r?\n/).includes(entry))throw Error('Missing .gitignore protection: '+entry);
 console.log('PASS ignored local file:',entry);
}
const migrations=fs.readdirSync(path.join(root,'migrations')).filter(x=>/^\d+.*\.sql$/.test(x)).sort();
if(!migrations.length)throw Error('No database migrations');
for(const file of migrations){if(!read('migrations/'+file).trim())throw Error('Empty migration: '+file)}
console.log('PASS migrations:',migrations.join(', '));
console.log('Static deployment readiness checks passed; Cloudflare secrets, migrations applied remotely, live deployment and free-tier usage remain UNVERIFIED.');
