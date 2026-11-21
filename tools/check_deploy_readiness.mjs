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
 console.log('PASS asset',file);
}
const migrations=fs.readdirSync(path.join(root,'migrations')).filter(x=>/^\d+.*\.sql$/.test(x)).sort();
if(!migrations.length)throw Error('No database migrations');
for(const file of migrations){if(!read('migrations/'+file).trim())throw Error('Empty migration: '+file)}
console.log('PASS migrations:',migrations.join(', '));
console.log('Static deployment readiness checks passed; Cloudflare secrets, migrations applied remotely, live deployment and free-tier usage remain UNVERIFIED.');
