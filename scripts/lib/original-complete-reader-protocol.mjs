/** Fixed domain-separated read-only transport encoding. */
import assert from 'node:assert/strict';
import{createHmac,hkdfSync,timingSafeEqual}from'node:crypto';
export const format='sabalan-original-complete-reader/v1',route='/original-complete-reader/v1';
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
export const mac=(key,domain,value)=>createHmac('sha256',key).update(format+'\0'+domain+'\0').update(bytes(value)).digest('hex');
export const valid=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function keyFor(operation,passphrase){assert.match(operation,/^[a-f0-9]{32}$/);assert.match(passphrase,/^[A-Za-z0-9_-]{64}$/);return Buffer.from(hkdfSync('sha256',Buffer.from(passphrase),Buffer.from(operation,'hex'),Buffer.from(format),32));}
