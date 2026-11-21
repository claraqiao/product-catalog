import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'site_dist');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(path.join(out,'admin','assets'),{recursive:true});
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
fs.mkdirSync(path.join(out,'password-setup'),{recursive:true});
for(const [src,dst] of [['index.html','index.html'],['password-setup/index.html','password-setup/index.html'],['admin/index.html','admin/index.html'],['admin/assets/admin.css','admin/assets/admin.css'],['admin/assets/admin.js','admin/assets/admin.js'],['public/assets/site.css','assets/site.css'],['public/assets/site.js','assets/site.js']])fs.copyFileSync(path.join(root,src),path.join(out,dst));
console.log('Static assets built:',out);
