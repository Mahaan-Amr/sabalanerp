/** Fixed canonical parser for the Windows original issuer. No database client,
 * runtime application, signing key or caller-selected executable is loaded. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire,builtinModules} from 'node:module';
import Module from 'node:module';

const repository=path.resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url),esbuild=createRequire(path.join(repository,'backend/package.json'))('esbuild');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const sources=new Map();let parser;
const fixedPublicKey=path.resolve('C:/Users/mahan/.ssh/CodexOnlineQualification/public.pem');
const fixedPublicKeySha256='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48';
const financialSourceSha256='4d899cb46945e64da60d28832bf111d46e62426ee4d5add6d017e51e6fe80744';
const emittedLinuxKeyBlockSha256='313a3b970e2130fff05b35dc742059274572b95706601040c193331f982e2857';
/** Only fixed PUBLIC trust bytes. No private key, signer or caller-key API. */
function originalFixedQualificationPublicKey(){
 assert.equal(process.platform,'win32');const raw=read(fixedPublicKey);assert.ok(raw.length>0&&raw.length<=4096);assert.equal(sha(raw),fixedPublicKeySha256);return raw;
}
export function adaptOriginalFinancialPublicTrust(bundle,sourceSha256){
 assert.equal(sourceSha256,financialSourceSha256);const signature='function assertProtectedFinancialQualificationSource(';
 assert.equal(bundle.split(signature).length-1,1);const functionStart=bundle.indexOf(signature),start=bundle.indexOf('  const file = ONLINE_QUALIFICATION_PUBLIC_KEY;',functionStart),end=bundle.indexOf('  return verifyProtectedFinancialQualification(certificate, key, artifacts, b);',start);
 assert.ok(start>functionStart&&end>start);assert.equal(sha(Buffer.from(bundle.slice(start,end))),emittedLinuxKeyBlockSha256);
 return bundle.slice(0,start)+"  const key = require('node:fs').__originalFixedQualificationPublicKey();\n"+bundle.slice(end);
}

function read(file){
 assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size<=8n*1024n**2n);
  const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),namedAfter=fs.lstatSync(file,{bigint:true});
  const keys=['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'];
  for(const key of keys){assert.equal(after[key],before[key]);assert.equal(namedAfter[key],named[key]);}
  // Windows Node exposes zero in one dev domain and the volume serial in the other.
  // Preserve both domains across the read; inode and every other field must
  // still agree between the original descriptor and its exact named file.
  const windowsDeviceDomain=process.platform==='win32'&&((before.dev===0n&&named.dev>0n)||(named.dev===0n&&before.dev>0n));
  for(const key of keys)if(key!=='dev'||!windowsDeviceDomain)assert.equal(named[key],before[key]);
  return raw;
 }finally{fs.closeSync(fd);}
}
function revalidate(){for(const [file,digest]of sources)assert.equal(sha(read(file)),digest,'ORIGINAL_CANONICAL_PARSER_SOURCE_CHANGED');}
export function originalOnlineEvidenceReader(){
 if(!parser){
  const before=new Map();
  const snapshot=directory=>{for(const name of fs.readdirSync(directory).sort()){
   if(name==='__tests__'||name==='__fixtures__')continue;const file=path.join(directory,name),stat=fs.lstatSync(file);
   assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())snapshot(file);else if(/\.(?:ts|json)$/.test(name))before.set(file,sha(read(file)));
  }};snapshot(path.join(repository,'backend/src/services'));
  const result=esbuild.buildSync({absWorkingDir:repository,stdin:{contents:
   "export {readOnlineReleaseEvidence} from './backend/src/services/onlineReleaseEvidence';export {verifyOnlineQualificationOrigin} from './backend/src/services/onlineQualificationProvenance';export {validateProductionExecutionBindings} from './backend/src/services/onlineImageExecutionBinding';",
   resolveDir:repository,sourcefile:'original-canonical-online-reader.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',write:false,metafile:true,logLevel:'silent'});
  for(const name of Object.keys(result.metafile.inputs)){
   if(name==='original-canonical-online-reader.ts')continue;
   const file=path.resolve(repository,name);assert.ok(before.has(file),'ORIGINAL_PARSER_RUNTIME_GRAPH_REFUSED');
   assert.equal(sha(read(file)),before.get(file),'ORIGINAL_PARSER_SOURCE_CHANGED_DURING_BUILD');sources.set(file,before.get(file));
  }
  assert.equal(result.outputFiles.length,1);
  const builtins=new Set(builtinModules.flatMap(name=>[name,'node:'+name]));
  for(const output of Object.values(result.metafile.outputs))for(const imported of output.imports)
   assert.ok(imported.external&&builtins.has(imported.path),'ORIGINAL_PARSER_EXTERNAL_RUNTIME_REFUSED');
  revalidate();const module=new Module(path.join(repository,'scripts/lib/.original-canonical-online-reader.cjs'));
  module.filename=path.join(repository,'scripts/lib/.original-canonical-online-reader.cjs');module.paths=[];
  const publicFs=Object.freeze({...fs,__originalFixedQualificationPublicKey:originalFixedQualificationPublicKey});
  module.require=name=>{assert.ok(builtins.has(name),'ORIGINAL_PARSER_REQUIRE_REFUSED');return name==='node:fs'||name==='fs'?publicFs:require(name);};
  const emitted=result.outputFiles[0].text,financialFile=path.join(repository,'backend/src/services/protectedFinancialQualificationProvenance.ts');
  const adapted=process.platform==='win32'?adaptOriginalFinancialPublicTrust(emitted,sources.get(financialFile)):emitted;
  module._compile(adapted,module.filename);
  assert.equal(typeof module.exports.readOnlineReleaseEvidence,'function');assert.equal(typeof module.exports.verifyOnlineQualificationOrigin,'function');
  parser=Object.freeze({readOnlineReleaseEvidence:(...args)=>{revalidate();const value=module.exports.readOnlineReleaseEvidence(...args);revalidate();return value;},
   verifyOnlineQualificationOrigin:(...args)=>{revalidate();return module.exports.verifyOnlineQualificationOrigin(...args);},revalidate,
   validateProductionExecutionBindings:(...args)=>{revalidate();return module.exports.validateProductionExecutionBindings(...args);},
   sourceHashes:Object.freeze(Object.fromEntries([...sources].map(([file,digest])=>[path.relative(repository,file).replaceAll('\\','/'),digest]))),bundleSha256:sha(Buffer.from(adapted)),platformAdapter:Object.freeze({applied:process.platform==='win32',sourceSha256:financialSourceSha256,emittedLinuxKeyBlockSha256,originalBundleSha256:sha(result.outputFiles[0].contents),fixedPublicKeySha256})});
 }
 revalidate();return parser;
}
