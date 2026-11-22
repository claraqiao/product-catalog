// Regression checks for image switching. Static checks do not replace real-device timing tests.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const js=readFileSync(new URL('../public/assets/site.js',import.meta.url),'utf8');
const must=[
 ['request version guard', 'request!==imageRequest'],
 ['ignore stale product', 'active!==p'],
 ['ignore stale photo index', 'index!==requestedIndex'],
 ['show matching thumbnail while loading', "large.src=thumb;large.alt=im.alt||p.name"],
 ['decode before display', 'await im.decode()'],
 ['image cache', 'const imageCache=new Map()'],
 ['bounded cache', 'imageCache.size>12'],
 ['cancel pending display on close', 'imageRequest++;viewer.hidden=true'],
 ['loading indication', "large.setAttribute('aria-busy','true')"],
 ['failure message', 'status.hidden=false'],
 ['only neighbor preloads', '[requestedIndex-1,requestedIndex+1]'],
 ['vertical scroll is not treated as swipe', 'Math.abs(dx)>Math.abs(dy)*1.3'],
 ['page size matches spec', 'for(const n of [24,48])'],
 ['no duplicate prefetch objects', 'loadPhoto(imageSource(p.images[i])).catch(()=>{})'],
];
for(const [name,token] of must){assert(js.includes(token),name+' missing');console.log('PASS',name)}
console.log('Note: browser P95 and white-screen performance still require device testing.');
