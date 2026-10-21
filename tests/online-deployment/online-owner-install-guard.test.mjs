import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {validatePrebuiltReleasePlan} from '../../deploy/scripts/prebuilt-release-plan.mjs';
import {productionImageStore} from '../../deploy/scripts/production-image-execution-binding.mjs';
const ts=createRequire(import.meta.url)('../../backend/node_modules/typescript');
const source=fs.readFileSync(new URL('../../deploy/scripts/online-owner-install-guard.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('guard.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree).replace(/^export\s+/, '');
const variables=['canonical','bytes','sha','pin','directoryPin','digest'].map(name=>tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)===name)).getText(tree));
const prebuiltSource=fs.readFileSync(new URL('./prebuilt-release-plan.test.mjs',import.meta.url),'utf8'),prebuiltTree=ts.createSourceFile('prebuilt-test.mjs',prebuiltSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fixtureBody=prebuiltTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fixture').getText(prebuiltTree);
const h=c=>c.repeat(64),sha=raw=>createHash('sha256').update(raw).digest('hex'),repository='/opt/sabalanerp',pack=repository+'/.deploy-state/online-host-pack-'+h('a').slice(0,32);
const configurationFile=repository+'/.deploy-state/online-control-'+h('b').slice(0,32)+'/launcher-config.json';
const stat=(directory=false)=>({dev:1n,ino:2n,uid:0n,gid:0n,mode:directory?0o40700n:0o100600n,nlink:1n,size:0n,mtimeNs:3n,ctimeNs:4n,isFile:()=>!directory,isDirectory:()=>directory});
function fixture(options={}){
 const {plan,actual}=new Function('hash','image',fixtureBody+';return fixture();')(h,c=>'sha256:'+h(c));
 const files=new Map(),calls=[],queries=[],listeners=new Map();let disconnects=0,constructed=0;
 const put=(file,value)=>{const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));files.set(file,raw);return{file,sha256:sha(raw)};};
 const outputs={};for(const relative of Object.keys(plan.operations.files)){const raw=Buffer.from('authenticated fixture output '+relative);put(pack+'/'+relative,raw);outputs[relative]={bytes:raw.length,sha256:sha(raw)};plan.operations.files[relative]=sha(raw);}
 const receipt={format:'sabalan-online-controller-host-pack/v1',packagingComplete:true,outputs};const receiptRef=put(pack+'/host-pack-receipt.json',receipt);plan.operations.receiptSha256=receiptRef.sha256;
 for(const role of ['backend','frontend','inquiry']){plan.images[role].buildReceipt=put('/root/private/'+role+'-build.json',actual.buildReceipts[role]);plan.images[role].archiveReceipt=put('/root/private/'+role+'-graph.json',actual.archiveReceipts[role]);}
 const planRef=put('/root/private/prebuilt.json',plan);
 const config={format:'sabalan-online-original-launcher/v1',repositoryRoot:repository,environmentFile:repository+'/deploy/.env.prod',sessionFile:repository+'/reports/deploy/active-deployment-session.json',controllerConfig:{project:'sabalanerp',composeFile:repository+'/docker-compose.prod.yml'},prebuiltReleasePlan:planRef,hostPackReceiptSha256:receiptRef.sha256,databaseUrl:'postgresql://fixture:fixture@127.0.0.1:5432/fixture_database?connection_limit=1&pool_timeout=10'};
 const configRef=put(configurationFile,config),lock=stat(),directory=stat(true);
 const containers=['backend','frontend','inquiry','nginx','postgres','clamav','other-one','other-two'].map((name,i)=>({Id:String(i+1).repeat(64),Image:'sha256:'+String(i+1).repeat(64),RestartCount:0,State:{Running:true,StartedAt:'2026-10-21T00:00:00Z',Health:{Status:'healthy'}},Config:{Labels:{'com.docker.compose.project':i<6?'sabalanerp':'foreign','com.docker.compose.service':name}},Mounts:name==='backend'?[{Type:'volume',Destination:'/app/recovery-coordination',Source:'/var/lib/docker/volumes/coordination/_data'}]:[]}));
 if(options.birthChanged)containers[7].State.StartedAt='2026-10-21T01:00:00Z';
 if(options.healthChanged)containers[0].State.Health.Status='unhealthy';
 const native=(exe,args)=>{
  if(exe==='/usr/bin/git'){
   assert.deepEqual(args.slice(0,2),['-c','core.fsmonitor=false']);args=args.slice(2);
   const key=args.join(' '),values={'rev-parse HEAD':plan.applicationCommit,'rev-parse HEAD^{tree}':plan.applicationTree,'status --porcelain --untracked-files=all':'','rev-parse HEAD:apps/sabalan-inquiry':plan.inquirySourceCommit,'-C apps/sabalan-inquiry rev-parse HEAD':plan.inquirySourceCommit,'-C apps/sabalan-inquiry status --porcelain --untracked-files=all':''};assert.ok(Object.hasOwn(values,key),'unreviewed native git argv');return options.sourceChanged&&key==='rev-parse HEAD'?h('f').slice(0,40):values[key];
  }
  assert.equal(exe,'/usr/bin/docker');assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);args=args.slice(2);
  const compose=['compose','--env-file',config.environmentFile,'-f',config.controllerConfig.composeFile,'-p','sabalanerp','ps','--format','json'];
  if(JSON.stringify(args)===JSON.stringify(compose))return'[]';
  assert.equal(JSON.stringify(calls.at(-2).args),JSON.stringify(['--host','unix:///var/run/docker.sock',...compose]),'compose census must precede each Docker action');
  if(args[0]==='info'){assert.deepEqual(args,['info','--format','{{json .}}']);return JSON.stringify({Driver:'overlay2'});}
  if(args[0]==='image'){assert.deepEqual(args.slice(0,2),['image','inspect']);const role=Object.keys(plan.images).find(role=>plan.images[role].image===args[2]);assert.ok(role);return JSON.stringify([actual.images[role]]);}
  if(args[0]==='ps'){assert.deepEqual(args,['ps','--all','--no-trunc','--format','{{.ID}}']);return containers.map(row=>row.Id).sort().join('\n');}
  assert.deepEqual(args,['inspect',...containers.map(row=>row.Id).sort()]);return JSON.stringify(containers);
 };
 const spawn=(executable,args,opts)=>{
  assert.equal(opts.cwd,repository);assert.equal(opts.shell,false);assert.equal(opts.env.GIT_OPTIONAL_LOCKS,'0');assert.deepEqual(opts.stdio,['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9]);calls.push({executable,args});
  const child=new EventEmitter();child.pid=(options.pidOffset??0)+calls.length+100;child.stdout=new PassThrough();child.stderr=new PassThrough();
  const raw=native(executable,args);setImmediate(()=>{child.stdout.end(raw);child.stderr.end();setImmediate(()=>child.emit('close',0,null));});return child;
 };
 const fakeFs={constants:fs.constants,realpathSync:value=>value,fstatSync:fd=>{assert.equal(fd,9);return lock;},lstatSync:file=>{if(file.endsWith('/deployment.lock'))return lock;if(file==='/var/lib/docker/volumes/coordination/_data')return directory;if(options.marker&&file.endsWith(options.marker))return stat();throw Object.assign(Error('fixture absent'),{code:'ENOENT'});},readFileSync:(file,encoding)=>{assert.ok(['/etc/machine-id','/sys/class/dmi/id/product_uuid','/proc/sys/kernel/random/boot_id'].includes(file));assert.equal(encoding,'utf8');return file.includes('product_uuid')?'FIXTURE-DMI\n':file.includes('boot')?'FIXTURE-BOOT\n':'FIXTURE-MACHINE-ID\n';}};
 class PrismaClient{
  constructor(input){constructed++;assert.equal(input.datasources.db.url,config.databaseUrl);}
  async $queryRaw(strings){const sql=strings.join('?');queries.push(sql);if(options.queryFailure)throw Error('fixture query refused');if(sql.includes('activeKey'))return options.activeLease?[{id:'active'}]:[];if(sql.includes('current_database'))return[{name:'fixture_database',system:'123456'}];assert.ok(sql.includes('_prisma_migrations'));return[{migration_name:'genuine_fixture',checksum:h('c'),finished_at:new Date(options.changedDate?'2026-10-20T00:00:00Z':'2026-10-19T00:00:00Z'),rolled_back_at:null}];}
  async $disconnect(){disconnects++;await new Promise(done=>setImmediate(done));if(options.signalDuringDisconnect)listeners.get('SIGTERM')();if(options.markerDuringDisconnect)options.marker='deployment-maintenance.json';if(options.lockChangedDuringDisconnect)lock.ctimeNs=99n;}
 }
 const read=(file,digest)=>{assert.ok(files.has(file),'unexpected private I/O path');const raw=files.get(file);assert.equal(sha(raw),digest);return raw;};
 const ownerProcess={platform:'linux',getuid:()=>0,env:options.env??{},on:(name,fn)=>listeners.set(name,fn),off:name=>listeners.delete(name)};
 const observe=new Function('assert','fs','path','root','process','spawn','require','read','validatePrebuiltReleasePlan','productionImageStore','createHash','URL',variables.join(';')+';'+declaration('absent')+';return '+declaration('observeOriginalOwnerInstall'))(assert,fakeFs,path.posix,pack,ownerProcess,spawn,()=>({PrismaClient}),read,validatePrebuiltReleasePlan,productionImageStore,createHash,URL);
 return{run:()=>observe(configurationFile,configRef.sha256),calls,queries,containers,listeners,get disconnects(){return disconnects;},get constructed(){return constructed;}};
}
test('actual install guard validates canonical prebuilt content, uses only fixed read-only argv and inherits FD9 in every original child',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.readOnly,true);assert.equal(result.productionAdmission,false);assert.equal(result.baseline.containers.length,8);assert.ok(f.calls.length>10);assert.equal(result.originalChildren.length,f.calls.length);assert.equal(f.disconnects,1);assert.equal(f.listeners.size,0);assert.ok(result.originalChildren.every(row=>row.code===0&&row.signal===null));assert.equal(result.baseline.machineUuidSha256,sha(Buffer.from('fixture-dmi')));
});
test('active lease, maintenance marker, unhealthy census and changed source all refuse before any installation',async()=>{
 for(const options of [{activeLease:true},{marker:'deployment-maintenance.json'},{marker:'active-deployment-session.json'},{healthChanged:true},{sourceChanged:true}]){const f=fixture(options);await assert.rejects(f.run());assert.ok(f.calls.every(row=>!row.args.some(value=>['start','create','run','load','up','rm','checkout','fetch'].includes(value))));assert.equal(f.disconnects,options.activeLease?1:0);assert.equal(f.listeners.size,0);}
});
test('temporary Prisma disconnects after a query failure as well as successful observation',async()=>{const f=fixture({queryFailure:true});await assert.rejects(f.run(),/fixture query refused/);assert.equal(f.constructed,1);assert.equal(f.disconnects,1);assert.equal(f.listeners.size,0);});
test('before/after baseline excludes observer PIDs while binding all container births and complete migration timestamps',async()=>{
 const a=await fixture().run(),b=await fixture({pidOffset:500}).run();assert.equal(a.baselineSha256,b.baselineSha256);assert.notDeepEqual(a.originalChildren,b.originalChildren);
 const changedBirth=await fixture({birthChanged:true}).run();assert.notEqual(a.baselineSha256,changedBirth.baselineSha256);assert.equal(changedBirth.baseline.containers[7].startedAt,'2026-10-21T01:00:00Z');
 const changedDate=await fixture({changedDate:true}).run();assert.notEqual(a.baseline.migrationLedgerSha256,changedDate.baseline.migrationLedgerSha256);assert.notEqual(a.baselineSha256,changedDate.baselineSha256);
});

test('ambient daemon, Git, loader and preload selectors refuse before the first native child or database',async()=>{
 for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','GIT_CONFIG_SYSTEM','GIT_CONFIG_COUNT','LD_PRELOAD','NODE_OPTIONS','NODE_PRELOAD_ANY']){const f=fixture({env:{[key]:'fixture-untrusted'}});await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal(f.constructed,0);assert.equal(f.disconnects,0);}
});

test('cancellation, marker reappearance and changed original FD9 during actual awaited disconnect cannot publish a positive baseline',async()=>{
 for(const option of ['signalDuringDisconnect','markerDuringDisconnect','lockChangedDuringDisconnect']){const f=fixture({[option]:true});await assert.rejects(f.run());assert.equal(f.disconnects,1);assert.equal(f.listeners.size,0);}
});
