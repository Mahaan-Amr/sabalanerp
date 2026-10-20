import test from 'node:test';
import assert from 'node:assert/strict';
import {compileOnlineCarrierPlan,bindTargetBrowserImage,consumeOriginalCarrierDockerCommand,consumeOriginalCarrierFailure,provisionOriginalOnlineReleaseCarriers,readOriginalOnlineCarrier,acquireOriginalBootstrapLegacyBrowserSource,readOriginalBootstrapLegacyBrowserSource,provisionOriginalBootstrapLegacyFrontend} from '../../deploy/scripts/online-release-carriers.mjs';
import {consumeOriginalInquiryCarrierDockerCommand,consumeOriginalInquiryCarrierFailure,provisionOriginalInquiryCarrier,readProvisionedInquiryCarrier} from '../../deploy/scripts/online-inquiry-carrier.mjs';
import {OriginalOnlineReleaseController} from '../../deploy/scripts/online-release-controller.mjs';

const id='a'.repeat(64),image='sha256:'+'b'.repeat(64),project='sabalanerp';
function fixture(kind='backend'){
 const service={read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],restart:'unless-stopped',networks:{app_network:null},mem_limit:'768m',cpus:1,pids_limit:256,tmpfs:['/tmp:rw,nosuid,nodev,size=256m'],environment:{NODE_ENV:'production'},healthcheck:{test:['CMD','node','/app/health.js'],interval:'15s',timeout:'8s',retries:8},stop_grace_period:'5m'};
 if(kind==='backend')Object.assign(service,{entrypoint:['node','/app/dist/scripts/online-runtime-hold.js'],command:[],environment:{NODE_ENV:'production',BACKEND_RUNTIME_ROLE:'control',DATABASE_URL:'postgresql://private:secret@postgres/db?connection_limit=1&pool_timeout=10'},volumes:[{type:'volume',source:'contracts',target:'/app/storage/contracts',volume:{nocopy:true}},{type:'bind',source:'/srv/app/.deploy-state/online-trust',target:'/run/sabalan-online',read_only:true}]});
 const configuration={services:{[kind]:service},networks:{app_network:{name:'sabalanerp_app_network'}},volumes:{contracts:{name:'sabalanerp_contracts'}}};
 return {configuration,serviceName:kind,project,kind,runtimeId:id,image,releaseId:'release_123456',network:{Id:'c'.repeat(64),Name:'sabalanerp_app_network',Driver:'bridge',Scope:'local',Labels:{'com.docker.compose.project':project}},volumeNames:['sabalanerp_contracts'],...(kind==='frontend'?{build:{id:'erp_12345678',image,manifestSha256:'d'.repeat(64),actionIds:[],assets:[]}}:{})};
}
function inquiryFixture(){
 const f=fixture('inquiry'),s=f.configuration.services.inquiry;
 Object.assign(s,{entrypoint:['node','-e','setInterval(()=>{},1000)'],command:[],environment:{NODE_ENV:'production',DATABASE_URL:'file:/data/inquiry.db?connection_limit=1&pool_timeout=10'},volumes:[
  {type:'volume',source:'data',target:'/data'},
  {type:'volume',source:'coordination',target:'/app/recovery-coordination'},
  {type:'bind',source:'/srv/app/.deploy-state/online-trust',target:'/run/sabalan-online',read_only:true}
 ],tmpfs:['/tmp:rw,nosuid,nodev,size=128m','/app/.next/cache:rw,nosuid,nodev,size=128m']});
 f.configuration.volumes={data:{name:'sabalanerp_inquiry_data'},coordination:{name:'sabalanerp_recovery_coordination'}};
 f.volumeNames=['sabalanerp_inquiry_data','sabalanerp_recovery_coordination'];return f;
}
test('Inquiry keeper reuses exact owned SQLite/coordination with private trust and no Postgres authority',()=>{
 const p=compileOnlineCarrierPlan(inquiryFixture());assert.deepEqual(p.args.slice(-3),[image,'-e','setInterval(()=>{},1000)']);assert.equal(p.mounts.length,3);
 const mutations=[s=>s.environment.PGPASSWORD='secret',s=>s.environment.BACKEND_RUNTIME_ROLE='http',s=>s.environment.DATABASE_URL='postgresql://other/db',s=>s.environment.DATABASE_URL='file:/data/inquiry.db?connection_limit=100&pool_timeout=10',s=>s.entrypoint=['npm','start'],s=>s.volumes.pop(),s=>s.volumes[0].read_only=true];
 for(const mutate of mutations){const f=inquiryFixture();mutate(f.configuration.services.inquiry);assert.throws(()=>compileOnlineCarrierPlan(f),/ONLINE_/);}
});
test('browser archive index translates to target config only through exact full graph, preserving source identity',()=>{
 const source={id:'inquiry_12345678',image:'sha256:'+'1'.repeat(64),assets:[]},graph={index:source.image,platform:'sha256:'+'2'.repeat(64),config:image,rootfsDiffIds:['sha256:'+'3'.repeat(64)]};
 const binding=bindTargetBrowserImage(source,'inquiry',graph,image);assert.equal(binding.sourceBuild.image,source.image);assert.equal(binding.build.image,image);assert.equal(source.image,graph.index);
 for(const bad of [{...graph,index:image},{...graph,config:source.image},{...graph,rootfsDiffIds:[]},{...graph,platform:'mutable:tag'}])assert.throws(()=>bindTargetBrowserImage(source,'inquiry',bad,image),/GRAPH_REQUIRED/);
});
test('Inquiry JSON or overridden controller cannot acquire original Docker/native capability',async()=>{
 const controller=Object.create(OriginalOnlineReleaseController.prototype);let invoked=false;
 for(const key of ['assertOwned','readInquiryReleaseEvidence','executeOriginalInquiryCarrierDockerCommand'])controller[key]=()=>{invoked=true;return {};};
 assert.throws(()=>consumeOriginalInquiryCarrierDockerCommand(controller,{}),/REQUIRED/);assert.throws(()=>consumeOriginalInquiryCarrierFailure(controller,{}),/REQUIRED/);
 await assert.rejects(provisionOriginalInquiryCarrier(controller,{}),/private|brand|member/i);await assert.rejects(readProvisionedInquiryCarrier(controller,{}),/private|brand|member/i);assert.equal(invoked,false);
});
test('new immutable carriers preserve project, unique service/alias and preexisting named volumes; no old service mutation',()=>{
 const plan=compileOnlineCarrierPlan(fixture());
 assert.equal(plan.name,'backend-'+id);assert.equal(plan.slotId,'backend_'+id);assert.equal(plan.args[0],'create');
 assert.ok(plan.args.includes('com.docker.compose.oneoff=True'));
 assert.ok(plan.args.includes('type=volume,source=sabalanerp_contracts,target=/app/storage/contracts,volume-nocopy'));
 assert.ok(plan.args.includes('type=bind,source=/srv/app/.deploy-state/online-trust,target=/run/sabalan-online,readonly'));
 assert.deepEqual(plan.args.slice(-2),[image,'/app/dist/scripts/online-runtime-hold.js']);
 assert.ok(!plan.args.some(value=>['up','rm','prune','pull','build','--publish','--privileged'].includes(value)));
 assert.equal(Object.isFrozen(plan),true);assert.equal(Object.isFrozen(plan.args),true);
});
test('frontend uses independent actual incarnation, accepted image and inherited immutable CMD',()=>{
 const plan=compileOnlineCarrierPlan(fixture('frontend'));assert.equal(plan.args.at(-1),image);assert.equal(plan.dnsAlias,'frontend-'+id.slice(0,48));assert.ok(plan.dnsAlias.length<=63);assert.equal(plan.build.id,'erp_12345678');assert.deepEqual(plan.mounts,[]);
});
test('unknown fields, host exposure, security relaxation, undeclared volumes and mutable images refuse',()=>{
 const changes=[f=>f.configuration.services.backend.ports=['5000:5000'],f=>f.configuration.services.backend.privileged=true,f=>f.configuration.services.backend.read_only=false,f=>f.configuration.services.backend.security_opt=[],f=>f.configuration.services.backend.networks={host:null},f=>f.volumeNames=[],f=>f.image='app:current',f=>f.configuration.services.backend.volumes[1].read_only=false,f=>f.configuration.services.backend.mem_limit='8g',f=>f.configuration.services.backend.entrypoint=['node','/app/dist/index.js']];
 for(const change of changes){const f=fixture();change(f);assert.throws(()=>compileOnlineCarrierPlan(f),/ONLINE_CARRIER_/);}
});
test('exec health arguments with quotes preserve exact argument meaning in Docker shell healthcheck',()=>{
 const f=fixture();f.configuration.services.backend.healthcheck.test=['CMD','node','-e',"console.log('literal')"];
 const args=compileOnlineCarrierPlan(f).args;assert.equal(args[args.indexOf('--health-cmd')+1],"'node' '-e' 'console.log('\\''literal'\\'')'");
});
test('forged controller/command/carrier/failure cannot mint authority or reach Docker',async()=>{
 const forged=Object.create(OriginalOnlineReleaseController.prototype);
 assert.throws(()=>consumeOriginalCarrierDockerCommand(forged,{}),/NOT_ORIGINAL/);
 assert.throws(()=>consumeOriginalCarrierFailure(forged,{}),/NOT_ORIGINAL/);
 await assert.rejects(readOriginalOnlineCarrier(forged,{}),/NOT_ORIGINAL/);
 await assert.rejects(provisionOriginalOnlineReleaseCarriers(forged,{releaseId:'release_123456',backendRuntimeIds:[id],buildId:'erp_12345678'}),/private|brand|member/i);
 // Instance-level overrides never substitute a fake accepted chain or runner.
 let invoked=false;for(const name of ['assertOwned','readCarrierProvisioningTarget','readCarrierReleaseEvidence','executeOriginalCarrierDockerCommand'])forged[name]=()=>{invoked=true;return {};};
 await assert.rejects(provisionOriginalOnlineReleaseCarriers(forged,{}),/private|brand|member/i);assert.equal(invoked,false);
});

test('legacy UI cache path is permitted only in the explicit UI translation, without changing command, image or adding volumes',()=>{
 const f=fixture('frontend');f.configuration.services.frontend.tmpfs.push('/app/.next-build/cache:rw,nosuid,nodev,size=128m');
 assert.throws(()=>compileOnlineCarrierPlan(f),/TMPFS_INVALID/);
 const legacy=compileOnlineCarrierPlan({...f,legacyBrowser:true});assert.equal(legacy.args.at(-1),image);assert.deepEqual(legacy.mounts,[]);assert.ok(legacy.args.includes('/app/.next-build/cache:rw,nosuid,nodev,size=128m'));
 const wrong=fixture();wrong.configuration.services.backend.tmpfs.push('/app/.next-build/cache:rw,nosuid,nodev,size=128m');assert.throws(()=>compileOnlineCarrierPlan({...wrong,legacyBrowser:true}),/TMPFS_INVALID/);
});
test('caller-owned callbacks and JSON cannot acquire stopped legacy source or a legacy UI carrier',async()=>{
 const forged=Object.create(OriginalOnlineReleaseController.prototype);let called=false;for(const name of ['assertOwned','readCarrierProvisioningTarget','readCarrierReleaseEvidence','executeOriginalCarrierDockerCommand'])forged[name]=()=>{called=true;return {};};
 await assert.rejects(acquireOriginalBootstrapLegacyBrowserSource(forged),/private|brand|member/i);
 await assert.rejects(readOriginalBootstrapLegacyBrowserSource(forged,{}),/SOURCE_REQUIRED/);
 await assert.rejects(provisionOriginalBootstrapLegacyFrontend(forged,{releaseId:'release_123456',descriptor:{}}),/private|brand|member/i);assert.equal(called,false);
});
