// Read-only storage guards: no database or production bucket is accessed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');
const guard="if(!allowWrites)throw Error('R2 寫入未啟用；為避免遺失照片，禁止在唯讀模式刪除 R2 或 D1 照片')";
assert(worker.includes(guard),'R2 read-only mode must block delete before touching legacy D1');
assert(worker.includes("if(!allowWrites)throw Error('R2 寫入未啟用；免費優先模式禁止未經同意的 R2 上傳')"),'R2 writes must be opt-in');
assert(worker.includes("ALLOW_R2_WRITES==='true'"),'R2 writes must default to disabled');
assert(worker.includes('200*1024*1024'),'D1 trial must enforce a capacity ceiling');
console.log('PASS R2 read-only photo deletion and write guards');
