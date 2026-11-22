import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/assets/site.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/assets/site.css',import.meta.url),'utf8');
for(const [label,source,token] of [
 ['24/48 choices',js,'for(const n of [24,48])'],
 ['page size change',js,"pageSize.addEventListener('change'"],
 ['incremental load',js,'visibleCount+=Number(pageSize.value)'],
 ['error retry',js,"retry.addEventListener('click',()=>location.reload())"],
 ['error feedback',js,'請檢查網路後重試'],
 ['async thumbnail decode',js,"img.decoding='async'"],
 ['mobile page size style',css,'.page-size-label select'],
 ['photo busy indicator',css,'img[aria-busy="true"]'],
]){assert(source.includes(token),label);console.log('PASS',label)}
