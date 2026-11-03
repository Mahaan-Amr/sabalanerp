/** Explicit local prerequisite transition. Never canonical application admission. */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
const same=(a,b,code)=>assert.ok(isDeepStrictEqual(a,b),code);
export const preservationHealth=Object.freeze({Interval:5_000_000_000,Timeout:15_000_000_000,StartPeriod:5_000_000_000,Retries:3});
const literalCommand=items=>items.map(s=>{assert.equal(typeof s,'string');return s.replaceAll('$',()=> '$$');});
export function inquiryMaintenanceOverride(before,volumeAlias,image,command,healthCommand){
  assert.equal(before.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
  assert.equal(before.Config.Labels['com.docker.compose.service'],'inquiry');
  assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.match(volumeAlias,/^[a-zA-Z0-9_-]+$/);
  const environment=Object.fromEntries(before.Config.Env.map(row=>{const i=row.indexOf('=');return[row.slice(0,i),row.slice(i+1)];}));
  for(const key of ['NODE_OPTIONS','LD_PRELOAD','LD_LIBRARY_PATH','NODE_PATH','BACKEND_RUNTIME_ROLE','BACKEND_ONLINE_SCOPE_FILE','BACKEND_ONLINE_SCOPE_SHA256',
    'INQUIRY_NATIVE_AUTHORITY_FILE','INQUIRY_NATIVE_CLAIM_SHA256','INQUIRY_RUNTIME_GENERATION'])assert.ok(!Object.hasOwn(environment,key),'UNSAFE_CARRIER_ENVIRONMENT');
  return {services:{inquiry:{image,hostname:before.Config.Hostname,entrypoint:['/usr/local/bin/node'],command:literalCommand(command),
    environment,volumes:[volumeAlias+':/data:ro'],healthcheck:{test:literalCommand(['CMD','/usr/local/bin/node',...healthCommand]),interval:'5s',timeout:'15s',start_period:'5s',retries:3}}}};
}
function network(after,before){
  const left=structuredClone(after.NetworkSettings.Networks),right=structuredClone(before.NetworkSettings.Networks);
  same(Object.keys(left).sort(),Object.keys(right).sort(),'NETWORK_ATTACHMENTS_CHANGED');
  for(const name of Object.keys(right)){
    const a=left[name],b=right[name];
    if(b.DNSNames){
      const names=new Set(b.DNSNames),old=before.Id.slice(0,12),next=after.Id.slice(0,12);
      if(old!==before.Config.Hostname&&!(b.Aliases??[]).includes(old))names.delete(old);
      names.add(next);same([...(a.DNSNames??[])].sort(),[...names].sort(),'NETWORK_DNS_CHANGED');delete a.DNSNames;delete b.DNSNames;
    }
    for(const key of ['EndpointID','IPAddress','GlobalIPv6Address','MacAddress']){delete a[key];delete b[key];}
  }
  same(left,right,'NETWORK_CONFIGURATION_CHANGED');
}
export function validateInquiryMaintenanceTransition(before,after,plan){
  assert.notEqual(after.Id,before.Id);assert.ok(Date.parse(after.State.StartedAt)>Date.parse(before.State.StartedAt),'REINCARNATION_UNPROVEN');
  assert.equal(after.Image,plan.graph.index);assert.equal(after.ImageManifestDescriptor.digest,plan.graph.platform);
  assert.equal(plan.platformDescriptor.digest,plan.graph.platform);same(after.ImageManifestDescriptor,plan.platformDescriptor,'NATIVE_DESCRIPTOR_CHANGED');
  same(after.ImageManifestDescriptor.platform,{architecture:'amd64',os:'linux'},'NATIVE_PLATFORM_CHANGED');
  const config=structuredClone(before.Config),env=rows=>Object.fromEntries(rows.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
  config.Image=plan.graph.index;config.Cmd=plan.command;config.Entrypoint=['/usr/local/bin/node'];
  config.Healthcheck={...preservationHealth,Test:['CMD','/usr/local/bin/node',...plan.healthCommand]};
  config.Labels={...config.Labels,...plan.imageLabels,'com.docker.compose.image':plan.graph.platform,
    'com.docker.compose.config-hash':plan.configHash,'com.docker.compose.project.config_files':plan.configFiles.join(',')};
  same(env(after.Config.Env),env(config.Env),'ENVIRONMENT_CHANGED');config.Env=after.Config.Env;
  same(after.Config,config,'CONFIGURATION_CHANGED');
  const host=structuredClone(before.HostConfig),actualHost=structuredClone(after.HostConfig);
  const data=before.Mounts.find(m=>m.Destination==='/data');assert.ok(data?.Type==='volume'&&data.RW===true,'ORIGINAL_DATA_MOUNT_INVALID');
  const original=data.Name+':/data:rw',replacement=data.Name+':/data:ro';assert.equal(host.Binds.filter(s=>s===original).length,1);
  host.Binds=host.Binds.map(s=>s===original?replacement:s);
  for(const row of [host,actualHost])for(const key of ['Dns','DnsOptions','DnsSearch'])if(row[key]===null||Array.isArray(row[key])&&row[key].length===0)row[key]=[];
  same(actualHost,host,'HOST_CONFIGURATION_CHANGED');
  const mounts=structuredClone(before.Mounts);Object.assign(mounts.find(m=>m.Destination==='/data'),{Mode:'ro',RW:false});
  same(after.Mounts,mounts,'MOUNTS_CHANGED');same(after.NetworkSettings.Ports,before.NetworkSettings.Ports,'PORTS_CHANGED');network(after,before);
  assert.equal(after.State.Running,true);assert.equal(after.State.Health.Status,'healthy');
  return{format:'sabalan-local-inquiry-maintenance-transition/v1',beforeId:before.Id,afterId:after.Id,index:plan.graph.index,platform:plan.graph.platform,
    maintenanceReady:true,applicationReady:false,runtimeAccepted:false,productionAdmission:false,originalDataReadOnly:true};
}
