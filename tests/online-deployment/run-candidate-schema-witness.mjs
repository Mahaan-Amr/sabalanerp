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
 'backend/src/services/__tests__/protectedCandidateSchemaWitness.ts':'1ae96f6b53e16aaeffc545e185592d0eff3bba7ad7035a514b2bcd6bf8e0fc94',
 'backend/src/services/__tests__/protectedTemporaryPostgresRunner.ts':'8a538bc5b2ef99cff34ba8e9dba83fe8e7b01d490f5eb80563e73d7aedcadfdd',
 'backend/src/services/__tests__/protectedTemporaryDatabase.ts':'c452fd0c829eb962f7f80fb133912be813c74c5a12db4398a2be83b7d8ac9a90',
 'backend/src/services/__tests__/protectedPrismaBootstrap.ts':'dc7bc31fec691d31b81d8954a0e78d72fddbfa87602ca4e36c027a1353d08e6c',
 'backend/src/services/__tests__/protectedLocalClusterIdentity.ts':'3fa7cee6776470ba12fc8a07dabcd07ce2be567fa0d0ed256e8c1e920185f894',
 'backend/src/services/protectedCandidateMigrationInventory.ts':'126ecac41d27fff3d8bf6580ba4c910657a49ddd0fc72d70098740ff6717c524',
 'backend/src/services/protectedMigrationHistory.ts':'afc3f082f59d80eee539c453529f1a1073faf73d75ae847fc1f078fe2111db03',
 'backend/src/services/protectedCandidateLaterProjection.ts':'d1c66e34c1bd6e3dc91e437910d402020b5d1837b0b7cafd610b60d229ca5770',
 'backend/src/services/protectedCandidateCatalogContract.ts':'b747e458ee19d7d07e379a40bed89620b5ea77b5797e49f763b44010f35fac98',
 'tests/online-deployment/protected-predecessor-bootstrap.mjs':'c51b29c1779c17b0a9f32c140f30d2d33c5ace47f234eb59eeac9bd346c1bfef',
 'deploy/scripts/prebuilt-migration-inventory.mjs':'2507729ba5a66efc66be30811ab934724e4556940e5eb3047028b334189ecc7c',
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const requireLocal=createRequire(path.join(root,'backend/package.json'));
const aclPowerShell='C:/Users/mahan/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const aclPowerShellSha256='362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139';
const dependencyPins={'pg/package.json':'f7b678a8055c234669e8dd272dd624771e29d9f0e3a3353f15c3005ab1a5fd29',pg:'a012ecbe7fdefed8d2b36c3658e33dc4c291d0bb60df18d382300061211052b7',
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
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-schema-witness-'));
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
 try{fs.writeFileSync(intentFd,JSON.stringify({format:'sabalan-schema-witness-intent/v1',database,sourcePins:pins,dependencyEntrypointPins:dependencyPins})+'\n');fs.fsyncSync(intentFd);}finally{fs.closeSync(intentFd);}
 const fd=fs.openSync(receipt,'wx',0o600);
 let final={format:'sabalan-schema-witness-receipt/v1',state:'UNKNOWN',phase:'PRECHECK',database,sourcePins:pins,dependencyEntrypointPins:dependencyPins,aclPowerShell:{path:aclPowerShell,version:'7.6.5',sha256:aclPowerShellSha256},freeC:String(c),freeE:String(e),dockerDisk:'E:/DockerData/disk/docker_data.vhdx'};
 try{
  run('docker',['compose','-f',path.join(root,'docker-compose.local.yml'),'ps','--format','json']);
  const [container]=JSON.parse(run('docker',['inspect','sabalanerp-local-postgres-1']));
  if(container.Config?.Labels?.['com.docker.compose.project']!=='sabalanerp-local'||container.Config?.Labels?.['com.docker.compose.service']!=='postgres'||container.State?.Health?.Status!=='healthy')throw Error('LOCAL_POSTGRES_UNPROVEN');
  const env=container.Config.Env;const get=name=>env.find(v=>v.startsWith(name+'='))?.slice(name.length+1);
  const username=get('POSTGRES_USER'),password=get('POSTGRES_PASSWORD');if(!username||!password)throw Error('LOCAL_DATABASE_PROFILE_UNPROVEN');
  const url=new URL('postgresql://localhost:55432/sabalanerp');url.username=username;url.password=password;
  const cli=requireLocal.resolve('tsx/cli');
  const code="import {runCandidateSchemaWitness} from './backend/src/services/__tests__/protectedCandidateSchemaWitness'; void runCandidateSchemaWitness(process.env.SABALAN_SCHEMA_WITNESS_URL!,process.env.SABALAN_SCHEMA_WITNESS_DATABASE!).then(x=>console.log(JSON.stringify(x))).catch(()=>{process.exitCode=1});";
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
  if(!observation||!['WITNESSED','UNKNOWN'].includes(observation.state)||observation.database!==database||typeof observation.phase!=='string')throw Error('WITNESS_OUTCOME_UNPROVEN');
  final={...final,state:observation.state,phase:observation.phase,containerId:container.Id,
   ...(observation.state==='WITNESSED'?{databaseCensus:{sessions:0,prepared:0,source:'owned-lifecycle-post-rollback'}}:{}),observation};
 }catch{final={...final,state:'UNKNOWN'};}
 finally{
  let raw=Buffer.from(JSON.stringify(final)+'\n');
  if(raw.length>4*1024*1024)raw=Buffer.from(JSON.stringify({format:final.format,state:'UNKNOWN',phase:'RECEIPT_BOUND',database})+'\n');
  fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);
 }
 process.stdout.write(JSON.stringify({state:final.state,receipt})+'\n');
}
main().catch(()=>{process.stderr.write('SCHEMA_WITNESS_WRAPPER_UNKNOWN\n');process.exitCode=1;});
