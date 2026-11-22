import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const start=source.indexOf('function csvCell(');
const end=source.indexOf('async function validImage(',start);
assert(start>=0&&end>start,'CSV exporter function exists');
const csvCell=vm.runInNewContext(source.slice(start,end)+'\ncsvCell');
const cases=[
 ['=1+1',"'=1+1"],['+SUM(1,2)',"'+SUM(1,2)"],['-2',"'-2"],['@SUM(A1:A2)',"'@SUM(A1:A2)"],
 ['  =HYPERLINK(1)',"'  =HYPERLINK(1)"],['\t=1+1',"'\t=1+1"],
 ['一般商品','一般商品'],['A001','A001'],['hello,world','"hello,world"'],['he said "yes"','"he said ""yes"""'],
 ['hello\nworld','"hello\nworld"'],['', '']
];
for(const [input,expected] of cases){assert.equal(csvCell(input),expected,'CSV value: '+JSON.stringify(input));console.log('PASS',JSON.stringify(input))}
