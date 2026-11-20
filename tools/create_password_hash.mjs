import {randomBytes, pbkdf2Sync} from 'node:crypto';
const password=process.argv[2];
if(!password||password.length<14){console.error('請提供至少 14 個字元的管理密碼');process.exit(1)}
const salt=randomBytes(16),hash=pbkdf2Sync(password,salt,310000,32,'sha256');
const enc=b=>b.toString('base64url');
console.log(`${enc(salt)}.${enc(hash)}`);
