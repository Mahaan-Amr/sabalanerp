"""Pure finite port of the existing private issuer; no key/runtime actions."""
from pathlib import Path
import hashlib
R=Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp');D=Path(__file__).parent
def once(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
def build():
 source=(R/'scripts/lib/independent-private-qualification-controller.mjs').read_text()
 source=once(source,"import {compileIndependentPrivateQualificationMaterial,qualificationBytes} from './independent-private-qualification-material.mjs';","import {compileRestoredQaPrivateQualificationMaterial,qualificationBytes} from './independent-private-qualification-material.mjs';\nimport fs from 'node:fs';import path from 'node:path';import {createRequire}from'node:module';const require=createRequire(import.meta.url);")
 source=once(source,'export function createOriginalIndependentQualificationController({root,index,config,sourcePins,beforeDocker,onHeld=()=>{}}){','export function createRestoredQaOriginalBroker({proof,scope,root,index,config,sourcePins,python,onHeld=()=>{}}){\n  const {assertActiveStrictRestoreProof}=require(\'/app/dist/services/systemRecoveryEngine.js\');\n  const {assertRestoredQaPrivateNormal}=require(\'/app/dist/services/restoredQaMigrationBaseline.js\');\n  const context=assertActiveStrictRestoreProof(proof),normal=assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);\n  assert.equal(root,path.join(normal.root,\'coherent-private\'));assert.deepEqual(index.restoredQaLineage.targetDatabase,normal.database);assert.equal(context.proof,proof);\n  const beforeDocker=async()=>{assert.equal(assertActiveStrictRestoreProof(proof),context);};\n  assert.equal(python.file,\'/usr/bin/python3.11\');const pythonRaw=fs.readFileSync(python.file);assert.equal(hash(pythonRaw),python.sha256);assert.equal(pythonRaw.subarray(0,4).toString(\'hex\'),\'7f454c46\');')
 source=once(source,"assert.match(root,/^\\/app\\/online-runtime-acceptance\\/application-native-[a-f0-9]{32}$/);","assert.match(root,/^\\/app\\/runtime-authority\\/application-native-[a-f0-9]{32}\\/restored-complete-app\\/coherent-private$/);")
 source=once(source,"let phase='NEW',held=null,container=null,baseline=null", "let phase='ENROLLED',held=null,container=Object.freeze({id:config.existingContainerId,image:config.image}),baseline=null")
 source=once(source,"const child=spawn('docker',['exec','-i',container.id,'/usr/bin/python3','-I','-B','-c',bootstrap,\n      root+'/'+name,sourcePins[name],...args],{stdio:['pipe','pipe','pipe']});", "const environment=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('BACKEND_CONTROL_')&&!name.startsWith('BACKEND_CAPTURE_')&&!name.startsWith('BACKEND_NATIVE_')&&!name.startsWith('BACKEND_ONLINE_')&&!name.startsWith('BACKEND_WORKER_')&&!name.startsWith('INQUIRY_NATIVE_')));\n    const child=spawn(python.file,['-I','-B','-c',bootstrap,root+'/'+name,sourcePins[name],...args],{env:environment,stdio:['pipe','pipe','pipe']});")
 # Finite existing callback branch never consumes CREATE/START reports or adopts a container child.
 a=source.index('    enrollOriginalContainer(value){');b=source.index('    async runBaseline(',a);source=source[:a]+source[b:]
 source=once(source,"same(child.spawnfile,'docker');same(child.spawnargs.slice(1,4),['exec','-i',container.id]);", "same(child.spawnfile,python.file);same(child.spawnargs.slice(1,4),['-I','-B','-c']);")
 source=once(source,"same(facts.sourceSql,{visible:true,sessions:0,prepared:0,databaseOid:String(index.oid)});", "same(facts.restoredQaLineage,index.restoredQaLineage);")
 source=once(source,"material=compileIndependentPrivateQualificationMaterial({index,config,baselineCompletion:baseline.closed.result,facts,now:new Date()});", "material=compileRestoredQaPrivateQualificationMaterial({index,config,baselineCompletion:baseline.closed.result,facts,restoredQaLineage:index.restoredQaLineage,now:new Date()});")
 # Immediate revocation; a queued HELD must never remain a valid LIVE endpoint.
 source=once(source,"owner.lines.push(owner.buffer.slice(0,newline));owner.buffer=owner.buffer.slice(newline+1);", "const line=owner.buffer.slice(0,newline);owner.lines.push(line);owner.buffer=owner.buffer.slice(newline+1);try{if(JSON.parse(line).event==='HELD')hold(Error('INDEPENDENT_ORIGINAL_NATIVE_HELD'));}catch(error){hold(error);}")
 # The enclosing engine must not begin B cleanup while any original descendant is live.
 source=once(source,"    inspect(){return Object.freeze", "    async awaitRetainedClosure(){for(const owner of children)await owner.done;assert.ok(children.every(v=>v.closed));clearInterval(keeper);if(held)throw held;},\n    inspect(){return Object.freeze")
 # Preserve the actual child when drain/listener/input setup throws.
 source=once(source,"    child.on('error',error=>hold(error));child.stdin.on('error',error=>hold(error));", "    try{child.on('error',error=>hold(error));child.stdin.on('error',error=>hold(error));child.stdout.on('error',error=>hold(error));child.stderr.on('error',error=>hold(error));")
 source=once(source,"    if(input!==undefined)child.stdin.end(JSON.stringify(input));\n    return owner;", "    if(input!==undefined)child.stdin.end(JSON.stringify(input));\n    }catch(error){hold(error);try{child.stdin.end();}catch{}for(const stream of[child.stdout,child.stderr]){try{stream.on('error',error=>hold(error));stream.resume();}catch{}}}\n    return owner;")
 (D/'restored-private-broker.mjs').write_text(source,newline='\n')
 (D/'independent-private-qualification-material.mjs').write_bytes((R/'scripts/lib/independent-private-qualification-material.mjs').read_bytes())
 return source
if __name__=='__main__':print(hashlib.sha256(build().encode()).hexdigest())
