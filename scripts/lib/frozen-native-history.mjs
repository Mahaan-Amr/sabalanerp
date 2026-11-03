/** Original historical JSON bytes and file identities. No runtime/owner admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const resourceSha='4c10b79720212b293aa042b44db13aff9969d8180d8d58a90f7b1e283e56a0a6';
const originalRoot=path.resolve('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp');
const executionRoot=path.resolve('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp');
const identity=s=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(k=>[k,String(s[k])]));
const comparable=s=>Object.fromEntries(Object.entries(s).filter(([k])=>process.platform!=='win32'||k!=='dev'));

/** A bounded file-data validator. Its result is never an owner/capability token. */
export function readPinnedHistoricalJson(reference){
 reference=structuredClone(reference);const file=reference.file;
 assert.equal(path.resolve(file),file);assert.equal(fs.realpathSync(file),file,'HISTORICAL_PATH_ALIAS');
 const named=fs.lstatSync(file,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n&&named.size>0n&&named.size<=16n*1024n**2n);
 const expectedNamed=Object.fromEntries(Object.entries(reference.identity).filter(([k])=>k!=='descriptorDevice'));
 assert.deepEqual(identity(named),expectedNamed,'HISTORICAL_FILE_IDENTITY_CHANGED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});assert.deepEqual(comparable(identity(before)),comparable(identity(named)));assert.equal(String(before.dev),reference.identity.descriptorDevice);
  const raw=fs.readFileSync(fd);assert.equal(raw.length,reference.bytes);assert.equal(sha(raw),reference.sha256,'HISTORICAL_FILE_BYTES_CHANGED');JSON.parse(raw);
  assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(before));assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),identity(named));
  return Object.freeze({raw,reference,historicalOnly:true,activeCapability:false});
 }finally{fs.closeSync(fd);}
}
function entries(){
 const resource=path.join(import.meta.dirname,'frozen-native-history.json');
 assert.equal(fs.realpathSync(resource),resource);const before=fs.lstatSync(resource,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<=65536n);
 const raw=fs.readFileSync(resource);assert.equal(sha(raw),resourceSha,'HISTORICAL_RESOURCE_CHANGED');assert.deepEqual(identity(fs.lstatSync(resource,{bigint:true})),identity(before));
 const value=JSON.parse(raw);assert.equal(value.format,'sabalan-frozen-native-historical-data/v1');assert.equal(value.historicalOnly,true);assert.equal(value.activeCapability,false);assert.equal(path.resolve(value.root),originalRoot);assert.equal(Object.keys(value.files).length,22);
 for(const[name,ref]of Object.entries(value.files)){assert.match(name,/^reports\/qa\/[a-zA-Z0-9_-]+\.json$/);assert.equal(path.resolve(ref.file),path.join(originalRoot,...name.split('/')));}
 return value.files;
}
export function readFrozenNativeHistoricalData(relative){
 const files=entries();assert.ok(Object.hasOwn(files,relative),'HISTORICAL_INPUT_NOT_ALLOWED');return readPinnedHistoricalJson(files[relative]);
}
/** Only the explicitly frozen C3 operations checkout redirects known history.
 * New observations/output names remain local and cannot be supplied as history. */
export function nativeHistoricalFile(repository,relative){
 assert.ok(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.includes('\\')&&!relative.split('/').some(x=>x===''||x==='.'||x==='..'));
 if(path.resolve(repository)===executionRoot&&Object.hasOwn(entries(),relative))return readFrozenNativeHistoricalData(relative).reference.file;
 return path.join(repository,...relative.split('/'));
}
