/** REVIEW REQUIRED BEFORE ONE INVOCATION. Test DB only; no production,
 * release, restore, deletion or service mutation. Unknown is never retried. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pins={
 "backend/src/services/__tests__/protectedCandidatePrismaProjectionRehearsal.ts":"a7ba3929491489e3aad57dc8b42c73991d3702f5aaecdfe60f3aa786978d2a3e",
 "backend/src/services/__tests__/protectedLocalClusterIdentity.ts":"3fa7cee6776470ba12fc8a07dabcd07ce2be567fa0d0ed256e8c1e920185f894",
 "backend/src/services/__tests__/protectedPrismaBootstrap.ts":"dc7bc31fec691d31b81d8954a0e78d72fddbfa87602ca4e36c027a1353d08e6c",
 "backend/src/services/__tests__/protectedTemporaryDatabase.ts":"c452fd0c829eb962f7f80fb133912be813c74c5a12db4398a2be83b7d8ac9a90",
 "backend/src/services/__tests__/protectedTemporaryPostgresRunner.ts":"8a538bc5b2ef99cff34ba8e9dba83fe8e7b01d490f5eb80563e73d7aedcadfdd",
 "backend/src/services/protectedCandidateCatalogContract.ts":"b747e458ee19d7d07e379a40bed89620b5ea77b5797e49f763b44010f35fac98",
 "backend/src/services/protectedCandidateExplicitDimensions.ts":"6ed3e7c5fe145aa3a36b2d1ba190e1c0d7ac77c8a129878a2b0bbab3feb18ccc",
 "backend/src/services/protectedCandidateInitialColumns.ts":"020d84de59dcbef2b4878b399ddcf8f82842d8829f01c591124691baf3392b77",
 "backend/src/services/protectedCandidateInitialWitness.ts":"b76399e7746607135fbb874523e68044943a557cfe95954cdc47579182e6861c",
 "backend/src/services/protectedCandidateInvoiceWitness.ts":"d68071a276cf1a471706343c08305fa9635b160b198a0f53681dde6e49f97081",
 "backend/src/services/protectedCandidateLaterProjection.ts":"97eddc0d68ed3c8c9d3e17c1c68c1bfc0192d5b08bcc79d62e7a79962ffe1e1d",
 "backend/src/services/protectedCandidateMigrationInventory.ts":"c6d9e46b355b7b79ef4e34bd4bd8387c4abbd98a0fd706c4e743c6b2ef060fd9",
 "backend/src/services/protectedCandidateNativeEvidence.ts":"d99278ab1d256d754a11239123d74a79d9045e2592b838a0c9251db7e3f58639",
 "backend/src/services/protectedCandidateProjection.ts":"3e8a3219e9907f04fb7ec15f7437c92dbaa1299fe80e88948ad1871982f33b63",
 "backend/src/services/protectedCandidateRelationSecurity.ts":"7bc9f97ada00057cd1863836130f10b448ea78c84f9b19327b1a834459ba893c",
 "backend/src/services/protectedCandidateSourceCoverage.ts":"2297eb3fff1f14ea17070e312d0bc7494624e6f2930f93c8045c788f7d4fbab9",
 "backend/src/services/protectedCandidateStageComparison.ts":"c2d08db5e259d9da918fee2bcf61ad83da9e71307d35141760a7819cef77e70b",
 "backend/src/services/protectedCandidateStageProjection.ts":"9a2fb8645e03b8a6a278ada78a144b3cd6507c33c1328190212e8ca4f2162256",
 "backend/src/services/protectedCandidateStageWitness.ts":"fdeb520f6d594d7768a03af262ce0e7d2a7957c8d9f133d44cef7542fd2367c9",
 "backend/src/services/protectedCandidateTransactionObservation.ts":"73db11d700bec96887058f5494bf14d264ddd53ee43000b088e4d782125ccd46",
 "backend/src/services/protectedMigrationHistory.ts":"afc3f082f59d80eee539c453529f1a1073faf73d75ae847fc1f078fe2111db03",
 "deploy/scripts/prebuilt-migration-inventory.mjs":"2507729ba5a66efc66be30811ab934724e4556940e5eb3047028b334189ecc7c",
 "tests/online-deployment/protected-predecessor-bootstrap.mjs":"c51b29c1779c17b0a9f32c140f30d2d33c5ace47f234eb59eeac9bd346c1bfef",
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const requireLocal=createRequire(path.join(root,'backend/package.json'));
const aclPowerShell='C:/Users/mahan/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const aclPowerShellSha256='362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139';
const dependencyPins={'@prisma/client':'0cfff057c91fcb7559bd1a3bb4891404e455829ced5b18a87c9393ee1721ace4','@prisma/client/package.json':'2efa3f7c0f05cf2bd4b681b71dd0e7a197006a3c29f2acdb5f88d5e7bc9bb2e3','.prisma/client/default':'61419abcd0ff0f9127dd52fee7bd236d49917050317e1cc87067c1f18f86e412','.prisma/client/index.js':'7a845efeec76dfbec36982ed55eb9a7e083dd128b55cb18f8d30c790a495e174','pg/package.json':'f7b678a8055c234669e8dd272dd624771e29d9f0e3a3353f15c3005ab1a5fd29',pg:'a012ecbe7fdefed8d2b36c3658e33dc4c291d0bb60df18d382300061211052b7',
 'tsx/package.json':'7796ac8394b9396964e407d013972e7c4a68943b21c1744e2207bbcba92b2b20','tsx/cli':'719ba9eac360e4d9b8e363ff98f5500a29042f2b6494483d816415b976ad52e5',
 'prisma/package.json':'01c1aa746e5b0aebf01b38ec1aaffaebc098bacfe93b2f413fd4112de9251ae3','prisma/build/index.js':'ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388'};
function checkPins(){
 for(const [name,pin] of Object.entries(pins))if(sha(fs.readFileSync(path.join(root,name)))!==pin)throw Error('SOURCE_SNAPSHOT_CHANGED');
 for(const [name,pin] of Object.entries(dependencyPins))if(sha(fs.readFileSync(requireLocal.resolve(name)))!==pin)throw Error('DEPENDENCY_ENTRYPOINT_CHANGED');
 if(process.version!=='v22.13.0'||sha(fs.readFileSync(process.execPath))!=='364dbc8442f8d5c04fd4226bcfcf8e60d3268627eb1d7be214a91bb7d74cdbb9')throw Error('NODE_IDENTITY_CHANGED');
 if(sha(fs.readFileSync(aclPowerShell))!==aclPowerShellSha256)throw Error('ACL_POWERSHELL_IDENTITY_CHANGED');
}
function run(file,args,env=process.env){const r=spawnSync(file,args,{cwd:root,encoding:'utf8',env,stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});if(r.error||r.signal||r.status!==0)throw Error('PRIVATE_PRECHECK_UNPROVEN');return r.stdout;}
function privateDirectory(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-prisma-rehearsal-'));
 if(run(aclPowerShell,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()']).trim()!=='7.6.5')throw Error('ACL_POWERSHELL_VERSION_CHANGED');
 const sid=run(aclPowerShell,['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value']).trim();
 if(!/^S-1-5-21-(?:\d+-){3}\d+$/.test(sid))throw Error('PRIVATE_OWNER_UNPROVEN');
 run('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
 const check=`$a=Get-Acl -LiteralPath $env:SABALAN_PRIVATE_DIR; $allowed=@($env:SABALAN_PRIVATE_SID,'S-1-5-18'); if(-not $a.AreAccessRulesProtected){exit 1}; foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($r.IsInherited -or $s -notin $allowed -or $r.AccessControlType -ne 'Allow'){exit 1}}; if($a.Access.Count -ne 2){exit 1}; 'ACL_OK'`;
 if(run(aclPowerShell,['-NoProfile','-NonInteractive','-Command',check],{...process.env,SABALAN_PRIVATE_DIR:directory,SABALAN_PRIVATE_SID:sid}).trim()!=='ACL_OK')throw Error('PRIVATE_ACL_UNPROVEN');
 return directory;
}
async function main(){
 if(process.platform!=='win32'||process.cwd()!==root)throw Error('WRONG_WORKSPACE');
 checkPins();
 const freeC=fs.statfsSync('C:/',{bigint:true}),freeE=fs.statfsSync('E:/',{bigint:true});
 const c=freeC.bavail*freeC.bsize,e=freeE.bavail*freeE.bsize;
 if(c<512n*1024n**2n||e<2n*1024n**3n||!fs.existsSync('E:/DockerData/disk/docker_data.vhdx'))throw Error('LOCAL_TEST_CAPACITY_UNPROVEN');
 const directory=privateDirectory(),receipt=path.join(directory,'receipt.json');
 const database='sabalanerp_protected_'+randomUUID().replaceAll('-','');
 const intentFd=fs.openSync(path.join(directory,'intent.json'),'wx',0o600);
 try{fs.writeFileSync(intentFd,JSON.stringify({format:'sabalan-prisma-rehearsal-intent/v1',database,sourcePins:pins,dependencyEntrypointPins:dependencyPins})+'\n');fs.fsyncSync(intentFd);}finally{fs.closeSync(intentFd);}
 const fd=fs.openSync(receipt,'wx',0o600);
 let final={format:'sabalan-prisma-rehearsal-receipt/v1',state:'UNKNOWN',phase:'PRECHECK',database,sourcePins:pins,dependencyEntrypointPins:dependencyPins,aclPowerShell:{path:aclPowerShell,version:'7.6.5',sha256:aclPowerShellSha256},freeC:String(c),freeE:String(e),dockerDisk:'E:/DockerData/disk/docker_data.vhdx'};
 try{
  run('docker',['compose','-f',path.join(root,'docker-compose.local.yml'),'ps','--format','json']);
  const [container]=JSON.parse(run('docker',['inspect','sabalanerp-local-postgres-1']));
  if(container.Config?.Labels?.['com.docker.compose.project']!=='sabalanerp-local'||container.Config?.Labels?.['com.docker.compose.service']!=='postgres'||container.State?.Health?.Status!=='healthy')throw Error('LOCAL_POSTGRES_UNPROVEN');
  const env=container.Config.Env;const get=name=>env.find(v=>v.startsWith(name+'='))?.slice(name.length+1);
  const username=get('POSTGRES_USER'),password=get('POSTGRES_PASSWORD');if(!username||!password)throw Error('LOCAL_DATABASE_PROFILE_UNPROVEN');
  const url=new URL('postgresql://localhost:55432/sabalanerp');url.username=username;url.password=password;
  const cli=requireLocal.resolve('tsx/cli');
  const code="import {runPrismaProjectionRehearsal} from './backend/src/services/__tests__/protectedCandidatePrismaProjectionRehearsal'; void runPrismaProjectionRehearsal(process.env.SABALAN_SCHEMA_WITNESS_URL!,process.env.SABALAN_SCHEMA_WITNESS_DATABASE!).then(x=>console.log(JSON.stringify(x))).catch(()=>{process.exitCode=1});";
  const childEnv=Object.fromEntries(['PATH','SYSTEMROOT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','USERNAME','USERDOMAIN'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  childEnv.SABALAN_SCHEMA_WITNESS_URL=url.toString();childEnv.SABALAN_SCHEMA_WITNESS_DATABASE=database;checkPins();
  final={...final,phase:'WITNESS_CHILD'};
  const result=await new Promise(resolve=>{
   const child=spawn(process.execPath,[cli,'-e',code],{cwd:root,env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
   let stdout=[],bytes=0,stderrBytes=0,unknown=false;const timer=setTimeout(()=>{unknown=true;},30*60*1000);
   child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)unknown=true;else stdout.push(chunk);});
   child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>256*1024)unknown=true;});
   child.on('error',()=>{unknown=true;});child.on('close',(code,signal)=>{clearTimeout(timer);let observation;
    try{if(!unknown&&code===0&&!signal)observation=JSON.parse(Buffer.concat(stdout).toString('utf8'));}catch{unknown=true;}
    resolve({exitCode:code,signal,stdoutBytes:bytes,stderrBytes,observation:unknown?undefined:observation});});
  });
  final={...final,child:{exitCode:result.exitCode,signal:result.signal,stdoutBytes:result.stdoutBytes,stderrBytes:result.stderrBytes}};
  checkPins();
  const observation=result.observation;
  if(observation?.state==='MEASURED_ROLLED_BACK' && (observation.prefix!==14 || observation.baselineCount!==439 || !/^\d+:\d+$/.test(observation.identity)))throw Error('REHEARSAL_IDENTITY_UNPROVEN');
  if(!observation||!['MEASURED_ROLLED_BACK','UNKNOWN'].includes(observation.state)||observation.database!==database||typeof observation.phase!=='string')throw Error('WITNESS_OUTCOME_UNPROVEN');
  final={...final,state:observation.state,phase:observation.phase,containerId:container.Id,
   ...(observation.state==='MEASURED_ROLLED_BACK'?{databaseCensus:{sessions:0,prepared:0,source:'owned-lifecycle-post-rollback'}}:{}),observation};
 }catch{final={...final,state:'UNKNOWN'};}
 finally{
  let raw=Buffer.from(JSON.stringify(final)+'\n');
  if(raw.length>4*1024*1024)raw=Buffer.from(JSON.stringify({format:final.format,state:'UNKNOWN',phase:'RECEIPT_BOUND',database})+'\n');
  fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);
 }
 process.stdout.write(JSON.stringify({state:final.state,receipt})+'\n');
}
main().catch(()=>{process.stderr.write('PRISMA_REHEARSAL_WRAPPER_UNKNOWN\n');process.exitCode=1;});
