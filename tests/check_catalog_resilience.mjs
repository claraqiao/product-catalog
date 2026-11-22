import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/assets/site.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/assets/site.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const [label,source,token] of [
 ['24/48 choices',js,'for(const n of [24,48])'],
 ['page size change',js,"pageSize.addEventListener('change'"],
 ['incremental load',js,'visibleCount+=Number(pageSize.value)'],
 ['error retry',js,"retry.addEventListener('click',()=>location.reload())"],
 ['error feedback',js,'請檢查網路後重試'],
 ['async thumbnail decode',js,"img.decoding='async'"],
 ['mobile page size style',css,'.page-size-label select'],
 ['product category on cards',js,"categoryText.textContent=p.category"],
 ['product category styling',css,'.product-category'],
 ['photo busy indicator',css,'img[aria-busy="true"]'],
 ['sort selector',js,"sort.addEventListener('change',filter)"],
 ['series sort',js,"sort.value==='series'"],
 ['product specification detail',js,"['規格',p.specification]"],
 ['safe detail text',js,'span.textContent=String(value)'],
 ['detail region',html,'id="view-details"'],
 ['photo thumbnail strip',html,'id="viewer-thumbnails"'],
 ['thumbnail navigation',js,'function renderViewerThumbnails()'],
 ['thumbnail selection',js,"b.setAttribute('aria-pressed',String(i===index))"],
 ['thumbnail keyboard focus',js,"...document.querySelectorAll('#viewer-thumbnails button')"],
 ['thumbnail mobile style',css,'.viewer-thumb[aria-pressed="true"]'],
 ['gallery keyboard focus preservation',js,"setImage();b.focus()"],
 ['photo Home keyboard shortcut',js,"e.key==='Home'"],
 ['photo End keyboard shortcut',js,"e.key==='End'"],
 ['search results announced',html,'aria-live="polite"'],
]){assert(source.includes(token),label);console.log('PASS',label)}
