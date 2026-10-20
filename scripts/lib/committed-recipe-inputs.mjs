/** Git's blob bytes, not a checkout's platform line endings, are build inputs. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{createRequire}from'node:module';
const pin=raw=>({bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
export function compareCommittedRecipeBytes(working,committed){
 assert.ok(Buffer.isBuffer(working)&&Buffer.isBuffer(committed));let transform='IDENTICAL';
 if(!working.equals(committed)){
  // Bytewise removal of CR only when immediately followed by LF. No Unicode,
  // BOM, whitespace, standalone-CR or generic newline normalization occurs.
  const normalized=Buffer.allocUnsafe(working.length);let length=0;
  for(let i=0;i<working.length;i++){if(working[i]===13&&working[i+1]===10)continue;normalized[length++]=working[i];}
  assert.ok(normalized.subarray(0,length).equals(committed),'COMMITTED_RECIPE_BYTES_DIFFER');transform='CRLF_TO_LF';
 }
 return{working:pin(working),committed:pin(committed),transform};
}
export function readCommittedRecipeInput({repository,commit,file}){
 assert.match(commit,/^[a-f0-9]{40}$/);assert.ok(typeof file==='string'&&!path.isAbsolute(file)&&!file.includes('\\')&&file.split('/').every(part=>part&&part!=='.'&&part!=='..'));
 const working=fs.readFileSync(path.join(repository,file)),committed=execFileSync('git',['cat-file','blob',commit+':'+file],{cwd:repository,maxBuffer:4*1024**2});
 const proof=compareCommittedRecipeBytes(working,committed);return{...proof,bytes:committed};
}
export function readRecipeCompilerInputs(repository){
 const compiler=fs.realpathSync(createRequire(path.join(repository,'apps/sabalan-inquiry/package.json')).resolve('typescript'));
 const packageFile=fs.realpathSync(path.join(path.dirname(compiler),'../package.json')),metadata=JSON.parse(fs.readFileSync(packageFile));assert.equal(metadata.name,'typescript');
 const files=[fs.realpathSync(process.execPath),compiler,packageFile];return{format:'sabalan-original-recipe-compiler-inputs/v1',typescriptVersion:metadata.version,files:Object.fromEntries(files.map(file=>[file,pin(fs.readFileSync(file))]))};
}
