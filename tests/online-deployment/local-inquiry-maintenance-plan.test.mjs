import assert from 'node:assert/strict';
import test from 'node:test';
import {inquiryMaintenanceOverride,validateInquiryMaintenanceTransition,preservationHealth} from '../../scripts/lib/local-inquiry-maintenance-plan.mjs';
const digest='sha256:'+'a'.repeat(64),platform='sha256:'+'b'.repeat(64);
function fixture(){
 const before={Id:'1'.repeat(64),Config:{Image:'original-tag',Hostname:'pinned-host',Env:['A=preserved','SESSION_SECRET=fixture-only'],Cmd:['old-start'],Entrypoint:['old-entry'],Healthcheck:{Test:['CMD','old-health']},Labels:{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.service':'inquiry','com.docker.compose.image':'old-platform','com.docker.compose.config-hash':'old','com.docker.compose.project.config_files':'base.yml'}},
  State:{Running:true,Health:{Status:'healthy'},StartedAt:'2026-10-26T10:00:00Z'},HostConfig:{Binds:['data:/data:rw','coord:/coord:rw'],Dns:null,DnsSearch:[],DnsOptions:null,Memory:123},
  Mounts:[{Type:'volume',Name:'data',Destination:'/data',Mode:'rw',RW:true},{Type:'volume',Name:'coord',Destination:'/coord',Mode:'rw',RW:true}],
  NetworkSettings:{Ports:{'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]},Networks:{local:{NetworkID:'preserved-network',Aliases:['inquiry'],DNSNames:['inquiry','pinned-host','1'.repeat(12)],EndpointID:'old',IPAddress:'old',MacAddress:'old',IPAMConfig:null}}}};
 const platformDescriptor={digest:platform,mediaType:'application/vnd.oci.image.manifest.v1+json',size:1234,platform:{architecture:'amd64',os:'linux'}};
 const plan={graph:{index:digest,platform},platformDescriptor,command:['/app/local-inquiry-preservation-carrier.cjs'],healthCommand:['/app/local-inquiry-preservation-carrier.cjs','health'],imageLabels:{'io.sabalan.carrier.role':'local-preservation-only'},configHash:'new',configFiles:['base.yml','new.yml']};
 const after=structuredClone(before);after.Id='2'.repeat(64);after.Image=digest;after.ImageManifestDescriptor=platformDescriptor;after.State.StartedAt='2026-10-26T10:01:00Z';
 Object.assign(after.Config,{Image:digest,Cmd:plan.command,Entrypoint:['/usr/local/bin/node'],Healthcheck:{...preservationHealth,Test:['CMD','/usr/local/bin/node',...plan.healthCommand]}});
 Object.assign(after.Config.Labels,plan.imageLabels,{'com.docker.compose.image':platform,'com.docker.compose.config-hash':'new','com.docker.compose.project.config_files':'base.yml,new.yml'});
 after.HostConfig.Binds[0]='data:/data:ro';after.HostConfig.Dns=[];Object.assign(after.Mounts[0],{Mode:'ro',RW:false});
 Object.assign(after.NetworkSettings.Networks.local,{DNSNames:['inquiry','pinned-host','2'.repeat(12)],EndpointID:'new',IPAddress:'new',MacAddress:'new'});
 return{before,after,plan};
}
test('only the explicit maintenance image/command/health and original-data RO transition is admitted',()=>{
 const{before,after,plan}=fixture();const override=inquiryMaintenanceOverride(before,'data',digest,plan.command,plan.healthCommand);
 assert.deepEqual(override.services.inquiry.volumes,['data:/data:ro']);assert.equal(override.services.inquiry.environment.SESSION_SECRET,'fixture-only');
 const result=validateInquiryMaintenanceTransition(before,after,plan);assert.equal(result.maintenanceReady,true);assert.equal(result.applicationReady,false);assert.equal(result.runtimeAccepted,false);
});
test('config, environment, health timing, volume, port, native-descriptor and network drift all refuse',()=>{
 const mutants=[r=>r.after.Config.Env.push('NEW=forbidden'),r=>r.after.Config.Healthcheck.Timeout++,r=>r.after.HostConfig.Memory++,
  r=>r.after.Mounts[0].RW=true,r=>r.after.HostConfig.Binds[0]='foreign:/data:ro',r=>r.after.NetworkSettings.Ports['3001/tcp'][0].HostPort='9999',
  r=>r.after.Image='sha256:'+'c'.repeat(64),r=>r.after.ImageManifestDescriptor={...r.after.ImageManifestDescriptor,size:1},
  r=>r.after.NetworkSettings.Networks.foreign={},r=>r.after.NetworkSettings.Networks.local.DNSNames.push('unowned')];
 for(const change of mutants){const row=fixture();change(row);assert.throws(()=>validateInquiryMaintenanceTransition(row.before,row.after,row.plan));}
});
test('managed or injected environments cannot create a local carrier proposal',()=>{
 for(const key of ['NODE_OPTIONS','LD_PRELOAD','BACKEND_RUNTIME_ROLE','INQUIRY_RUNTIME_GENERATION']){const{before,plan}=fixture();before.Config.Env.push(key+'=fixture');
  assert.throws(()=>inquiryMaintenanceOverride(before,'data',digest,plan.command,plan.healthCommand),/UNSAFE_CARRIER_ENVIRONMENT/);}
});
test('embedded maintenance source is literal Compose input rather than environment interpolation',()=>{
 const{before}=fixture(),source='const anchor=/^[a-f0-9]{64}$/; const literal="$DO_NOT_EXPAND";';
 const override=inquiryMaintenanceOverride(before,'data',digest,['-e',source],['-e',source]);
 assert.equal(override.services.inquiry.command[1],'const anchor=/^[a-f0-9]{64}$$/; const literal="$$DO_NOT_EXPAND";');
 assert.equal(override.services.inquiry.healthcheck.test[3],override.services.inquiry.command[1]);
});
