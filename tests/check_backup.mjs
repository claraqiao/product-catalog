import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const start=source.indexOf('function validateBackup(data){');
const end=source.indexOf('\nasync function makeSnapshot',start);
if(start<0||end<0)throw Error('validateBackup function not found');
const helper=source.slice(start,end);
const context={base64ToBytes:value=>Uint8Array.from(Buffer.from(value,'base64'))};
vm.createContext(context);
vm.runInContext(helper+'; this.validateBackup=validateBackup;',context);
const keys=['private/originals/7/a.jpg','public/display/7/a.webp','public/thumb/7/a.webp'];
const make=()=>({format:'catalog-v12-backup',version:1,tables:{categories:[],products:[{id:7}],product_images:[{id:11,product_id:7,original_key:keys[0],display_key:keys[1],thumb_key:keys[2]}],publish_revisions:[],published_catalog:[],published_media:[],audit_log:[],app_settings:[],photo_upload_requests:[]},images:keys.map((key,i)=>({key,type:i===0?'image/jpeg':'image/webp',data:Buffer.from(i===0?[255,216,255,217]:[82,73,70,70,0,0,0,0,87,69,66,80]).toString('base64')}))});
const good=make();
const result=context.validateBackup(good);
if(result.photos!==1)throw Error('valid backup photo count mismatch');
const missing=make();missing.images.pop();
let rejected=false;try{context.validateBackup(missing)}catch{rejected=true}if(!rejected)throw Error('missing thumbnail was not rejected');
const duplicate=make();duplicate.images.push({...duplicate.images[0]});
rejected=false;try{context.validateBackup(duplicate)}catch{rejected=true}if(!rejected)throw Error('duplicate object key was not rejected');
const bad64=make();bad64.images[0].data='%%%';
rejected=false;try{context.validateBackup(bad64)}catch{rejected=true}if(!rejected)throw Error('invalid base64 was not rejected');
console.log('PASS backup validation: all 3 photo objects required');
console.log('PASS backup validation: duplicate keys rejected');
console.log('PASS backup validation: invalid Base64 rejected');

const corrupted=make();corrupted.images[1].data=Buffer.from('not-webp').toString('base64');
rejected=false;try{context.validateBackup(corrupted)}catch{rejected=true}if(!rejected)throw Error('corrupted WebP was not rejected');
const missingPublished=make();missingPublished.tables.published_media.push({image_key:'public/display/7/missing.webp'});
rejected=false;try{context.validateBackup(missingPublished)}catch{rejected=true}if(!rejected)throw Error('missing published photo was not rejected');
console.log('PASS backup validation: image signatures and published media references checked');

const oversized=make();oversized.images[0].data=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(512*1024)]).toString('base64');
rejected=false;try{context.validateBackup(oversized)}catch{rejected=true}if(!rejected)throw Error('oversized trial photo was not rejected');
const tooMany=make();tooMany.tables.product_images=[];tooMany.images=Array.from({length:37},(_,i)=>({key:'private/originals/7/photo'+i+'.jpg',type:'image/jpeg',data:Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(512*1024-3)]).toString('base64')}));
rejected=false;try{context.validateBackup(tooMany)}catch{rejected=true}if(!rejected)throw Error('backup exceeding 18 MiB was not rejected');
console.log('PASS backup validation: trial per-photo and aggregate size limits');

const wrongOwner=make();wrongOwner.tables.product_images[0].product_id=8;
rejected=false;try{context.validateBackup(wrongOwner)}catch{rejected=true}if(!rejected)throw Error('photo belonging to wrong product was accepted');
const wrongRole=make();wrongRole.tables.product_images[0].display_key=keys[2];
rejected=false;try{context.validateBackup(wrongRole)}catch{rejected=true}if(!rejected)throw Error('thumbnail accepted as display photo');
const forged=make();forged.summary={products:999,photos:999,image_bytes:0};
const checked=context.validateBackup(forged);
if(checked.products!==1||checked.photos!==1||checked.image_bytes<=0)throw Error('untrusted backup summary was accepted');
console.log('PASS backup validation: photo ownership, role and computed totals');

const orphan=make();orphan.tables.products=[];
rejected=false;try{context.validateBackup(orphan)}catch{rejected=true}if(!rejected)throw Error('orphaned photo was accepted');
const duplicateProduct=make();duplicateProduct.tables.products.push({id:7});
rejected=false;try{context.validateBackup(duplicateProduct)}catch{rejected=true}if(!rejected)throw Error('duplicate product ID was accepted');
console.log('PASS backup validation: orphaned photo and duplicate product IDs rejected');

const duplicateImage=make();duplicateImage.tables.product_images.push({...duplicateImage.tables.product_images[0]});
rejected=false;try{context.validateBackup(duplicateImage)}catch{rejected=true}if(!rejected)throw Error('duplicate image ID was accepted');
const sharedImage=make();sharedImage.tables.product_images.push({...sharedImage.tables.product_images[0],id:12});
rejected=false;try{context.validateBackup(sharedImage)}catch{rejected=true}if(!rejected)throw Error('shared image object keys were accepted');
console.log('PASS backup validation: duplicate image IDs and reused photo keys rejected');
