/** Necessary Inquiry-only overlay build. No UP, application compilation or release admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
const directory=import.meta.dirname,repo=path.resolve(directory,'../../..'),nonce=randomBytes(16).toString('hex');
const privateDirectory=path.resolve('D:/sabalanerp-online-qa/inquiry-preservation-carrier-'+nonce),tag='sabalanerp-inquiry-preservation:'+nonce;
const baseTag='sabalanerp-inquiry-startup-refresh:1efae7d9a19b9db75ff2ee8a706fea17',baseIndex='sha256:ff0e0b21d2ea6d036946621085f7a6c90437f07b610e5f7129479cd31e4c2740';
const toolTag='sabalan-online-backend-current:41f7dd679cc93ae31d18380c1c13786c',toolIndex='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';
const commands=originalBackendBaseCommands(),sha=b=>createHash('sha256').update(b).digest('hex');let lease,custody;
const report={format:'sabalan-local-inquiry-preservation-build/v1',operation:nonce,startedAt:new Date().toISOString(),pass:false,
  applicationReady:false,runtimeAccepted:false,productionAdmission:false,composeUp:false,compiledApplicationRebuilt:false,
  backendRebuilt:false,frontendRebuilt:false,hostPackRebuilt:false,cryptoRepeated:false,children:[]};
async function run(executable,args,input){
  const result=await commands.run(executable,args,{input,cwd:repo,maximum:4*1024**2});
  const privateOutput=executable==='docker'&&args[0]==='inspect'||executable==='docker'&&args[0]==='image'&&args[1]==='inspect';
  report.children.push({executable,args,originalPid:result.originalPid,code:result.code,signal:result.signal,naturalChildClosure:result.naturalChildClosure,
    ...(privateOutput?{privateStdoutSha256:sha(result.stdout),privateStdoutBytes:Buffer.byteLength(result.stdout)}:{stdout:result.stdout}),
    stderr:result.stderr});commands.assertSuccessful(result);return result.stdout;
}
async function status(){lease.assertHeld();const rows=(await run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'])).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(rows.length===10&&rows.every(r=>r.Project==='sabalanerp-local'&&r.Health==='healthy'),'LOCAL_SCOPE_CHANGED');return rows;}
async function docker(args,input){await status();return run('docker',args,input);}
function save(name,value){assertOriginalPrivateEvidenceDirectory(custody,privateDirectory);const file=path.join(privateDirectory,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return{file,sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size};}
function capacity(){const result={};for(const[p,reserve]of[['C:/',12n*1024n**3n],['D:/',16n*1024n**3n]]){
  const s=fs.statfsSync(p,{bigint:true}),available=s.bavail*s.bsize,buildWorkspace=2n*1024n**3n;assert.ok(available>=reserve+buildWorkspace,'CAPACITY_RESERVE_REFUSED');
  result[p]={availableBytes:String(available),retainedReserveBytes:String(reserve),additionalBuildWorkspaceBytes:String(buildWorkspace)};}
  assert.ok(os.freemem()>=1024**3,'MEMORY_RESERVE_REFUSED');return{backing:result,availableMemoryBytes:os.freemem(),fullAdmission:false};}
async function image(resolver,index){const [row]=JSON.parse(await docker(['image','inspect',resolver]));assert.equal(row.Id,index);assert.equal(row.Descriptor.digest,index);return row;}
const aliases=async()=>Object.fromEntries((await docker(['image','ls','--no-trunc','--format','{{json .}}'])).trim().split(/\r?\n/).map(JSON.parse).filter(r=>r.Repository!=='<none>'&&r.Tag!=='<none>').map(r=>[r.Repository+':'+r.Tag,r.ID]).sort(([a],[b])=>a.localeCompare(b)));
try{
  lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
  await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
  custody=await prepareOriginalPrivateEvidenceDirectory(privateDirectory);report.privateDirectory=privateDirectory;
  report.sourceCommit=(await run('git',['rev-parse','HEAD'])).trim();report.capacityBefore=capacity();
  const originalRows=await status(),original=JSON.parse(await docker(['inspect',...originalRows.map(r=>r.ID)]));
  const identities=rows=>Object.fromEntries(rows.map(r=>[r.Config.Labels['com.docker.compose.service'],{id:r.Id,image:r.Image,startedAt:r.State.StartedAt}]));
  report.originalIdentities=identities(original);save('private-original-inspections.json',original);
  const base=await image(baseTag,baseIndex),tools=await image(toolTag,toolIndex),beforeAliases=await aliases();assert.ok(!beforeAliases[tag]);
  report.resolvers={base:{tag:baseTag,index:baseIndex,descriptor:base.Descriptor},sqliteCli:{tag:toolTag,index:toolIndex,descriptor:tools.Descriptor}};
  const proposal=JSON.parse(fs.readFileSync(path.join(directory,'EXISTING-INQUIRY-CARRIER-PROPOSAL.json')));
  const baseGraph=inspectPrivateDockerArchive(fs.realpathSync(proposal.archive.file),baseIndex);assert.deepEqual(baseGraph,proposal.graph);
  assert.deepEqual(base.RootFS.Layers,baseGraph.rootfsDiffIds);report.baseArchive={...proposal.archive,graph:baseGraph};
  const behaviorFile=path.join(directory,'CARRIER-REPAIR-BEHAVIOR-22a7a4d49ffed7a22af66cf2508ba246.json');
  const behavior=JSON.parse(fs.readFileSync(behaviorFile));assert.equal(behavior.pass,true);report.behavior={file:behaviorFile,sha256:sha(fs.readFileSync(behaviorFile))};
  const retained=original.find(r=>r.Config.Labels['com.docker.compose.service']==='backend-retained'),inquiry=original.find(r=>r.Config.Labels['com.docker.compose.service']==='inquiry');
  const source=retained.Mounts.find(r=>r.Name===inquiry.Mounts.find(r=>r.Destination==='/data').Name);assert.ok(source&&!source.RW);
  const actual=JSON.parse(await docker(['exec',retained.Id,'/usr/bin/python3','-I','-B',behavior.staged.directory+'/local-inquiry-preservation.py',source.Destination+'/inquiry.db',behavior.staged.directory+'/local-inquiry-original.json',behavior.staged.directory+'/inquiry-baseline.json']));assert.equal(actual.originalUnchanged,true);
  report.actualConservation=actual;const contract=behavior.staged.contract;
  const context=path.join(privateDirectory,'context');fs.mkdirSync(context,{mode:0o700});
  const mappings=[['deploy/scripts/verify-inquiry-database.cjs','app/verify-inquiry-database.cjs',0o644],['backend/src/services/inquiryBaseline.json','app/inquiry-baseline.json',0o644],
    ['deploy/scripts/local-inquiry-preservation.py','app/local-inquiry-preservation.py',0o644],['deploy/scripts/local-inquiry-preservation-carrier.cjs','app/local-inquiry-preservation-carrier.cjs',0o644]];
  const files={},sourcePins={};
  for(const[relative,target,mode]of mappings){
    const frozen=await run('git',['show',report.sourceCommit+':'+relative]);assert.equal(frozen.replaceAll('\r\n','\n'),fs.readFileSync(path.join(repo,relative),'utf8').replaceAll('\r\n','\n'),'UNFROZEN_SOURCE');
    const stagedName=path.posix.basename(target);assert.equal(behavior.sources[stagedName].sha256,sha(frozen),'BEHAVIOR_SOURCE_MISMATCH');
    const file=path.join(context,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,frozen,{flag:'wx'});
    files[target]={sha256:sha(frozen),mode};sourcePins[relative]={sha256:sha(frozen),bytes:Buffer.byteLength(frozen)};
  }
  const contractRaw=JSON.stringify(contract,null,2)+'\n';fs.writeFileSync(path.join(context,'local-inquiry-original.json'),contractRaw,{flag:'wx'});
  files['app/local-inquiry-original.json']={sha256:sha(contractRaw),mode:0o444};files['usr/bin/sqlite3']={sha256:'78fbb4b1bc1fdcb0e3f321ffbcc3628ebff0a961d3c56d4d623f8daef59886c8',mode:0o755};
  const recipeFile='deploy/docker/inquiry-local-carrier.Dockerfile',dockerfile=await run('git',['show',report.sourceCommit+':'+recipeFile]);
  assert.equal(dockerfile.replaceAll('\r\n','\n'),fs.readFileSync(path.join(repo,recipeFile),'utf8').replaceAll('\r\n','\n'));
  assert.ok(!/^\s*RUN\s/mi.test(dockerfile));fs.writeFileSync(path.join(context,'Dockerfile'),dockerfile,{flag:'wx'});
  const recipe={format:'sabalan-local-inquiry-preservation-recipe/v1',sourceCommit:report.sourceCommit,files,baseDiffIds:base.RootFS.Layers,baseConfig:base.Config,
    healthcheck:{Test:['CMD','node','/app/local-inquiry-preservation-carrier.cjs','health'],Interval:5_000_000_000,Timeout:15_000_000_000,StartPeriod:5_000_000_000,Retries:3},
    baseIndex,toolIndex,sourcePins,dockerfileSha256:sha(dockerfile),contractSha256:sha(contractRaw)};
  report.recipe=save('recipe.json',recipe);report.sourcePins=sourcePins;report.contractSha256=sha(contractRaw);
  await image(baseTag,baseIndex);await image(toolTag,toolIndex);report.capacityImmediatelyBeforeBuild=capacity();
  await docker(['build','--pull=false','--tag',tag,'--file',path.join(context,'Dockerfile'),context]);
  await image(baseTag,baseIndex);await image(toolTag,toolIndex);
  const[built]=JSON.parse(await docker(['image','inspect',tag]));assert.equal(built.Id,built.Descriptor.digest);report.tag=tag;
  const archive=path.join(privateDirectory,'native-image.docker.tar');await docker(['image','save','--output',archive,built.Id]);
  report.graph=inspectPrivateDockerArchive(fs.realpathSync(archive),built.Id);report.archive={file:archive,sha256:report.graph.archiveSha256,bytes:report.graph.archiveBytes};
  const verifier='scripts/verify-local-inquiry-carrier-archive.py',rawVerifier=await run('git',['show',report.sourceCommit+':'+verifier]);
  assert.equal(rawVerifier.replaceAll('\r\n','\n'),fs.readFileSync(path.join(repo,verifier),'utf8').replaceAll('\r\n','\n'));
  const verification=JSON.parse(await run('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B',path.join(repo,verifier),archive,built.Id,report.recipe.file]));assert.equal(verification.pass_,true);
  report.verifierSourceSha256=sha(rawVerifier);report.archiveProof=save('archive-proof.json',verification);
  const afterAliases=await aliases();assert.equal(afterAliases[tag],built.Id);delete afterAliases[tag];assert.deepEqual(afterAliases,beforeAliases);
  report.aliasesPreserved=true;report.originalIdentitiesAfter=identities(JSON.parse(await docker(['inspect',...(await status()).map(r=>r.ID)])));assert.deepEqual(report.originalIdentitiesAfter,report.originalIdentities);
  report.capacityAfter=capacity();assert.equal((await run('git',['rev-parse','HEAD'])).trim(),report.sourceCommit);report.pass=true;
}catch{report.error='INQUIRY_PRESERVATION_BUILD_REFUSED';process.exitCode=1;}
finally{
  report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;}
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'CARRIER-REPAIR-BUILD-'+nonce+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({pass:report.pass,operation:nonce,image:report.graph?.index,archiveProof:report.archiveProof,error:report.error??null}));
}
