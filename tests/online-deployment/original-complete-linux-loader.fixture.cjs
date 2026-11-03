/** Actual generated binding -> actual physical factory/callback graph. Only
 * platform/root and transport boundaries are modeled; no native acceptance. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),Module=require('node:module');
(async()=>{
 const root=process.argv[2],B=JSON.parse(fs.readFileSync(path.join(root,'binding-input.json'))),actualCwd=process.cwd,actualGetuid=process.getuid,descriptor=Object.getOwnPropertyDescriptor(process,'platform'),originalLoad=Module._load;
 const map=file=>{if(typeof file==='string'&&(file.startsWith('/app/')||file.startsWith('\\app\\')))file=file.replaceAll('\\','/');return typeof file==='string'&&file.startsWith(B.stage+'/')?path.join(root,'stage',file.slice(B.stage.length+1)):typeof file==='string'&&file===B.workingRoot+'/recovery-coordination/complete-client-closures.json'?path.join(root,'client-closure.json'):file;};
 const proxy=new Proxy(fs,{get(t,key){if(['realpathSync','openSync','lstatSync','fstatSync','readFileSync'].includes(key))return(file,...args)=>{const result=t[key](map(file),...args);if(key==='lstatSync'||key==='fstatSync')Object.defineProperty(result,'dev',{value:0n});return key==='realpathSync'&&typeof file==='string'&&file.startsWith(B.stage+'/')?file:result;};return t[key];}});
 let owner=true;globalThis.testClosureCalls=[];
 Module._load=function(name,parent,...args){if(name==='./inquiry-current-client.cjs'&&parent?.filename.endsWith(path.join('restored-qa','create-complete-work.mjs')))return{createOriginalInquiryCurrentClient(){return{close(){globalThis.testClosureCalls.push('inquiry');return{closed:true,failed:false};}}}};return originalLoad.call(this,name,parent,...args);};
 // createRequire's CJS parent is the actual factory path. This override affects
 // only this finite test child; the packaged artifact contains no hook.
 Object.defineProperty(process,'platform',{value:'linux'});process.getuid=()=>0;process.cwd=()=>B.workingRoot;
 const originalOpen=fs.openSync,originalRead=fs.readFileSync;fs.openSync=(file,...args)=>originalOpen(map(file),...args);fs.readFileSync=(file,...args)=>originalRead(map(file),...args);
 try{
  const module={exports:{}};const source=originalRead(path.join(root,'linux-binding.cjs'),'utf8');
  vm.runInNewContext(source,{module,require:name=>name==='node:fs'?proxy:name==='node:path'?path.posix:require(name),process,Buffer},{importModuleDynamically:specifier=>import(require('node:url').pathToFileURL(map(new URL(specifier).pathname.replace(/^\/([A-Z]:)/,'$1'))).href)});
  const qa=await module.exports.loadPinnedQaWork({secret:{applicationKeys:{testOnly:true},passphrase:'Z'.repeat(64)},session:'b'.repeat(64),runtime:{assertRuntimeControlOwnership(){assert.ok(owner,'TEST_OWNER_LOST');}}});
  assert.equal(typeof qa.qualifyOriginalCompleteCallback,'function');assert.equal(typeof qa.prepare,'function');
  if(process.env.COMPLETE_LINUX_TEST_MODE==='owner')owner=false;
  let failure;try{await qa.close();}catch(error){failure=error;}
  assert.deepEqual(globalThis.testClosureCalls,['issuer','inquiry']);const row=JSON.parse(originalRead(path.join(root,'client-closure.json')));
  if(process.env.COMPLETE_LINUX_TEST_MODE==='positive'){assert.equal(failure,undefined);assert.equal(row.pass,true);}else{assert.ok(failure instanceof AggregateError);assert.equal(row.pass,false);}
  console.log(JSON.stringify({pass:true,mode:process.env.COMPLETE_LINUX_TEST_MODE,nativeAcceptance:false,actualFactoryLoaded:true,actualCallbackGraphLoaded:true,closure:row.pass}));
 }finally{Object.defineProperty(process,'platform',descriptor);process.cwd=actualCwd;process.getuid=actualGetuid;Module._load=originalLoad;fs.openSync=originalOpen;fs.readFileSync=originalRead;}
})().catch(error=>{console.error(error);process.exitCode=1;});
