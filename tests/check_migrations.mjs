// Execute every migration against a real in-memory SQLite database through Python.
// Detect duplicate numbers and incompatible SQL before deployment.
import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir=new URL('../migrations/',import.meta.url);
const names=readdirSync(dir).filter(name=>name.endsWith('.sql')).sort();
const seen=new Set();
for(const name of names){
 const match=name.match(/^(\d+)_[-\w]+\.sql$/);
 if(!match)throw Error('Invalid migration filename: '+name);
 const id=Number(match[1]);
 if(seen.has(id))throw Error('Duplicate migration number: '+id);
 seen.add(id);
}
const migrations=names.map(name=>({name,sql:readFileSync(new URL(name,dir),'utf8')}));
const python=`import json,sqlite3,sys
items=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for item in items:
 try: db.executescript(item['sql'])
 except Exception as exc: raise RuntimeError(item['name']+': '+str(exc))
db.execute("INSERT INTO trial_image_objects(object_key,content_type,size_bytes,data) VALUES (?,?,?,?)",('smoke','image/webp',3,b'abc'))
assert db.execute("SELECT data FROM trial_image_objects WHERE object_key='smoke'").fetchone()[0]==b'abc'
assert db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trial_image_capacity'").fetchone() is None
required=['categories','products','product_images','publish_revisions','audit_log','app_settings','admin_rate_limits','published_catalog','published_media','photo_upload_requests','trial_image_objects']
tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert set(required)<=tables, 'Missing required tables: '+str(set(required)-tables)
db.execute("INSERT INTO categories(name) VALUES (?)",('test-category',))
category=db.execute("SELECT id FROM categories WHERE name='test-category'").fetchone()[0]
db.execute("INSERT INTO products(sku,name,category_id) VALUES (?,?,?)",('TEST-001','Test product',category))
assert db.execute("SELECT name FROM products WHERE sku='TEST-001'").fetchone()[0]=='Test product'
db.execute("INSERT INTO photo_upload_requests(token,product_id) VALUES (?,(SELECT id FROM products WHERE sku=?))",('smoke-token','TEST-001'))
assert db.execute("SELECT COUNT(*) FROM photo_upload_requests").fetchone()[0]==1
db.execute("PRAGMA foreign_key_check")
assert not db.execute("PRAGMA foreign_key_check").fetchall(), 'Foreign key constraint failed'
print('PASS migration sequence, trial image read/write, and legacy trigger cleanup')
`;
const result=spawnSync('python3',['-c',python],{input:JSON.stringify(migrations),encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr||result.stdout||'Migration test failed');
console.log(result.stdout.trim());
