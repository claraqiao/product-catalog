import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../admin/assets/admin.js',import.meta.url),'utf8');
const start=source.indexOf('csvCell=v=>{const raw=');
const end=source.indexOf(',lines=[header.join',start);
assert(start>=0&&end>start,'admin issue CSV escaping function exists');
const expression=source.slice(start,end).replace(/^csvCell=/,'');
const csvCell=vm.runInNewContext('('+expression+')');
for(const value of ['=1+1','+SUM(1,2)','-3','@HYPERLINK(1)','  =1+1','\t=1+1']){
 const escaped=csvCell(value);
 assert(escaped.startsWith('"\''),'formula-like values must be prefixed inside CSV cell');
}
assert.equal(csvCell('普通商品'),'"普通商品"');
assert.equal(csvCell('衣服,夏季'),'"衣服,夏季"');
assert.equal(csvCell('A"1'),'"A""1"');
console.log('PASS admin issue CSV formula injection and quote escaping');
