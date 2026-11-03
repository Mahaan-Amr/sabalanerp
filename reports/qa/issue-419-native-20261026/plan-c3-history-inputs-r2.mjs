/** File-only dependency plan. Historical bytes remain data, never owner authority. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const source='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp',target='C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp';
const sha=b=>createHash('sha256').update(b).digest('hex'),queue=[
 'application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json',
 'current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json','current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json',
 'application-prisma-ebcfd40fff0a28e39d983c6616893b50.json','inquiry-coherent-61138945df5c6dfceba7b55726201e9c.json','inquiry-restored-continuation-f86e6b783a3fb12f5079750e1b66d85e.json',
 'current-frontend-image-f1d2f35620e97112f093e3f2e8815027.json','current-frontend-bundle-fa93e6481b00ee2bb70b1034030bce2d.json',
 'current-frontend-image-792da52dca314b79ba0f2cde7d38c36d.json','current-frontend-bundle-cb97dee63c3d8b1c1243100530c33fb7.json',
 'inquiry-native-next-image-20261018.json','current-frontend-image-a0d91677d0bb07955be5541f74b9caee.json'];
const git=(...a)=>execFileSync('git',['-C',target,...a],{encoding:'utf8'}).trim();assert.equal(git('rev-parse','HEAD'),'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14');assert.equal(git('diff','--name-only'),'');assert.equal(git('diff','--cached','--name-only'),'');
const rows=[],seen=new Set(),missing=[];
const refKeys=new Set(['receipt','imageReceipt','bundleReceipt','transferReceipt','exportReceipt','originalFailedImportReceipt']);
function visit(v){if(Array.isArray(v)){for(const x of v)visit(x);return;}if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){
 if(refKeys.has(k)&&typeof x==='string'&&path.basename(x)===x&&x.endsWith('.json')&&fs.existsSync(path.join(source,'reports/qa',x)))queue.push(x);
 if(k==='runtimeBase'&&x&&typeof x.receipt==='string'&&path.basename(x.receipt)===x.receipt)queue.push(x.receipt);
 visit(x);
}}
while(queue.length){const name=queue.shift();if(seen.has(name))continue;seen.add(name);assert.equal(path.basename(name),name);const file=path.join(source,'reports/qa',name),destination=path.join(target,'reports/qa',name);
 if(!fs.existsSync(file)){missing.push(name);continue;}const s=fs.lstatSync(file);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<=16*1024**2);const raw=fs.readFileSync(file),value=JSON.parse(raw);visit(value);
 const sensitive=/("Env"\s*:\s*\[|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/.test(raw.toString('utf8'));
 rows.push({source:file,target:destination,bytes:raw.length,sha256:sha(raw),exists:fs.existsSync(destination),...(fs.existsSync(destination)?{existingExact:sha(fs.readFileSync(destination))===sha(raw)}:{}),sensitivePattern:sensitive,historicalOnly:true,activeCapability:false});
}
const esbuild='C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp/backend/node_modules';
const file=path.join(import.meta.dirname,'C3-HISTORY-INPUTS-PLAN-R2.json');fs.writeFileSync(file,JSON.stringify({format:'sabalan-419-c3-history-input-plan/v1',sourceCommit:git('rev-parse','HEAD'),pass:missing.length===0&&rows.every(r=>!r.sensitivePattern&&(!r.exists||r.existingExact)),runtimeStarted:false,masterStarted:false,files:rows,missing,dependencyReuse:{target:path.join(target,'backend/node_modules'),existingTarget:esbuild,exists:fs.existsSync(esbuild),esbuildPackageSha256:sha(fs.readFileSync(path.join(esbuild,'esbuild/package.json')))}},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({file,files:rows.length,missing,sensitiveFiles:rows.filter(r=>r.sensitivePattern).map(r=>path.basename(r.source)),totalBytes:rows.reduce((n,r)=>n+r.bytes,0)}));
