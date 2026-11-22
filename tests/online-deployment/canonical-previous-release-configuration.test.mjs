import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalPreviousReleaseConfiguration as verify,canonicalConfigurationSha256 as hash} from '../../deploy/scripts/canonical-previous-release-configuration.mjs';
function fixture(){
 const image='sha256:'+'a'.repeat(64),id='b'.repeat(64),commit='c'.repeat(40),release='failed-original-release';
 const overrides={APP_COMMIT:commit,DEPLOYMENT_BACKEND_IMAGE:image,DEPLOYMENT_FRONTEND_IMAGE:'sha256:'+'d'.repeat(64),DEPLOYMENT_INQUIRY_IMAGE:'sha256:'+'e'.repeat(64),DEPLOYMENT_RELEASE_ID:release};
 for(const key of ['BACKEND_IMAGE','COMMIT','FRONTEND_IMAGE','INFRASTRUCTURE_HASH','INQUIRY_IMAGE','POLICY_HASH','SCHEMA_HASH','SOURCE_HASH'])overrides['PERFORMANCE_RELEASE_'+key]='original-'+key;
 overrides.PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH='original-runtime';
 const labels={'com.docker.compose.project':'sabalanerp','com.docker.compose.service':'backend'},imageConfig={Env:['PATH=/usr/bin','IMAGE_ONLY=yes'],ExposedPorts:{'5000/tcp':{}},Entrypoint:['docker-entrypoint.sh'],Cmd:['sh','-c','node preflight.js && node dist/index.js'],WorkingDir:'/app',Labels:{'io.sabalan.performance.source-commit':commit},ArgsEscaped:true};
 const service={image,environment:{DATABASE_URL:'secret-never-output',DEPLOYMENT_RELEASE_ID:''},command:imageConfig.Cmd,entrypoint:imageConfig.Entrypoint,healthcheck:{test:['CMD-SHELL','node ready.js'],interval:'15s',timeout:'8s',retries:8},stop_grace_period:'30s'};
 const env={PATH:'/usr/bin',IMAGE_ONLY:'yes',...service.environment,...overrides};
 const config={Hostname:id.slice(0,12),Domainname:'',User:'',AttachStdin:false,AttachStdout:true,AttachStderr:true,ExposedPorts:imageConfig.ExposedPorts,Tty:false,OpenStdin:false,StdinOnce:false,Env:Object.entries(env).map(([k,v])=>`${k}=${v}`).reverse(),Cmd:[...imageConfig.Cmd],Healthcheck:{Test:[...service.healthcheck.test],Interval:15e9,Timeout:8e9,Retries:8},Image:image,Volumes:null,WorkingDir:'/app',Entrypoint:[...imageConfig.Entrypoint],Labels:{...imageConfig.Labels,...labels},StopTimeout:30};
 const originalHost={Binds:['/safe/b:/b:ro','/safe/a:/a:ro'],NetworkMode:'sabalanerp_default',Privileged:false},actualHost={...originalHost,Binds:[...originalHost.Binds].reverse()};
 return {format:'sabalan-canonical-previous-release-config-input/v1',deploymentId:'original',releaseId:release,sourceCommit:commit,snapshotSha256:'f'.repeat(64),service:'backend',expectedIdentity:{containerId:id,imageId:image,startedAt:'2026-10-20T17:00:00Z'},currentInspect:{Id:id,Image:image,State:{StartedAt:'2026-10-20T17:00:00Z'},Config:config,HostConfig:actualHost},immutableImageInspect:{Id:image,Os:'linux',Config:imageConfig},canonicalService:service,originalOverrides:overrides,expectedComposeLabels:labels,hostConfigProof:{actualSha256:hash(actualHost),expectedSha256:hash(originalHost),expectedHostConfig:originalHost,bindsPermutationVerified:true},environmentBindProof:{verified:true,expectedSha256:'1'.repeat(64),actualSha256:'1'.repeat(64)}};
}
test('full canonical configuration accepts Env and Binds permutations, records new actual hash without claiming old guard',()=>{
 const input=fixture(),proof=verify(input);assert.equal(proof.originalCaptureGuardPassed,false);assert.equal(proof.coveredConfigFields.length,19);assert.equal(proof.configSha256,hash(input.currentInspect.Config));assert.ok(!JSON.stringify(proof).includes('secret-never-output'));
 const reordered=structuredClone(input);reordered.currentInspect.Config.Env.reverse();const other=verify(reordered);assert.equal(other.semanticConfigSha256,proof.semanticConfigSha256);assert.notEqual(other.configSha256,proof.configSha256);
});
test('canonical Compose and original operation overrides replace immutable image environment defaults',()=>{
 const x=fixture();x.immutableImageInspect.Config.Env.push('DATABASE_URL=image-default','APP_COMMIT=image-default','DEPLOYMENT_RELEASE_ID=image-default','PERFORMANCE_RELEASE_SOURCE_HASH=image-default');
 x.immutableImageInspect.Config.Env.push('SHARED_DEFAULT=image-default');x.canonicalService.environment.SHARED_DEFAULT='canonical-compose';x.currentInspect.Config.Env.push('SHARED_DEFAULT=canonical-compose');
 assert.equal(verify(x).originalCaptureGuardPassed,false);
 const changed=structuredClone(x);changed.currentInspect.Config.Env=changed.currentInspect.Config.Env.map(value=>value.startsWith('SHARED_DEFAULT=')?'SHARED_DEFAULT=image-default':value);assert.throws(()=>verify(changed));
});
test('rejects duplicate/missing/unknown environment and wrong operational release binding',()=>{
 for(const mutate of [x=>x.currentInspect.Config.Env.push(x.currentInspect.Config.Env[0]),x=>x.currentInspect.Config.Env.pop(),x=>x.currentInspect.Config.Env.push('UNREVIEWED=yes'),x=>x.originalOverrides.DEPLOYMENT_RELEASE_ID='different']){const x=fixture();mutate(x);assert.throws(()=>verify(x));}
});
test('configuration rejection does not put secret values into diagnostic errors',()=>{
 const x=fixture();x.currentInspect.Config.Env.push('UNREVIEWED=private-value');try{verify(x);assert.fail('must reject');}catch(error){assert.ok(!String(error.stack).includes('secret-never-output'));assert.ok(!String(error.stack).includes('private-value'));assert.equal(error.actual,false);assert.equal(error.expected,true);}
});
test('ordered process arguments, all Config fields, image defaults and labels are mandatory',()=>{
 for(const mutate of [x=>x.currentInspect.Config.Cmd.reverse(),x=>x.currentInspect.Config.Entrypoint.push('extra'),x=>x.currentInspect.Config.StopTimeout=300,x=>x.currentInspect.Config.Unreviewed=true,x=>delete x.currentInspect.Config.User,x=>x.immutableImageInspect.Config.Unknown='ignored?',x=>x.currentInspect.Config.Labels['com.docker.compose.unknown']='x',x=>x.currentInspect.Config.Healthcheck.Timeout=9e9]){const x=fixture();mutate(x);assert.throws(()=>verify(x));}
});
test('refuses stale identity, HostConfig privilege change, stale hashes and modified bind bytes',()=>{
 for(const mutate of [x=>x.currentInspect.Id='0'.repeat(64),x=>x.currentInspect.State.StartedAt='later',x=>x.currentInspect.HostConfig.Privileged=true,x=>x.hostConfigProof.expectedSha256='0'.repeat(64),x=>x.environmentBindProof.actualSha256='2'.repeat(64)]){const x=fixture();mutate(x);assert.throws(()=>verify(x));}
});
