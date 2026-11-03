/** Closed projection for the existing local two-backend Compose lane; rejects unsupported fields/drift. */
import assert from 'node:assert/strict';import {isDeepStrictEqual} from 'node:util';
const same=(a,b,code)=>assert.ok(isDeepStrictEqual(a,b),code);
function env(rows){const result={};for(const row of rows??[]){const at=row.indexOf('=');assert.ok(at>0&&!Object.hasOwn(result,row.slice(0,at)));Object.defineProperty(result,row.slice(0,at),{value:row.slice(at+1),enumerable:true,writable:true,configurable:true});}return result;}
function seconds(v){if(typeof v==='number')return v;let n=0,end=0;for(const m of v.matchAll(/(\d+(?:\.\d+)?)(h|ms|us|ns|m|s)/g)){assert.equal(m.index,end);end=m.index+m[0].length;n+=Number(m[1])*({h:3600,m:60,s:1,ms:.001,us:.000001,ns:.000000001}[m[2]]);}assert.equal(end,v.length);return n;}
export function restoredSlotNetworkConfiguration(networks,id){return Object.fromEntries(Object.entries(networks).map(([name,input])=>{const value=structuredClone(input);if(value.DNSNames)value.DNSNames=value.DNSNames.map(n=>n===id.slice(0,12)?'<docker-container-id>':n);for(const key of ['EndpointID','IPAddress','GlobalIPv6Address','MacAddress'])delete value[key];return[name,value];}));}
export function validateRestoredLocalSlot({before,after,model,service,image,replaced,daemonDefaults}){
 validateLocalRollbackModel({model,service,container:after,image,daemonDefaults});
 same(after.ImageManifestDescriptor,before.ImageManifestDescriptor,'ROLLBACK_PLATFORM_DESCRIPTOR_CHANGED');
 const a=structuredClone(after.Config),b=structuredClone(before.Config);
 if(!Object.hasOwn(model.services[service],'hostname')){assert.equal(a.Hostname,after.Id.slice(0,12));assert.equal(b.Hostname,before.Id.slice(0,12));delete a.Hostname;delete b.Hostname;}
 if(after.Id!==before.Id)assert.ok(Date.parse(after.State.StartedAt)>Date.parse(before.State.StartedAt));
 // Linux environment semantics are exact duplicate-free names/values. Compose
 // may serialize that same map in a different order after recreation.
 a.Env=env(a.Env);b.Env=env(b.Env);
 same(a,b,'ROLLBACK_RESTORED_CONFIG_CHANGED');
 const host=c=>({...c.HostConfig,Binds:c.HostConfig.Binds?[...c.HostConfig.Binds].sort():c.HostConfig.Binds,Mounts:[...(c.HostConfig.Mounts??[])].sort((x,y)=>x.Target.localeCompare(y.Target))});
 same(host(after),host(before),'ROLLBACK_RESTORED_HOST_CONFIG_CHANGED');
 same([...after.Mounts].sort((x,y)=>x.Destination.localeCompare(y.Destination)),[...before.Mounts].sort((x,y)=>x.Destination.localeCompare(y.Destination)),'ROLLBACK_RESTORED_MOUNTS_CHANGED');
 same(after.NetworkSettings.Ports,before.NetworkSettings.Ports,'ROLLBACK_RESTORED_PORTS_CHANGED');
 same(restoredSlotNetworkConfiguration(after.NetworkSettings.Networks,after.Id),restoredSlotNetworkConfiguration(before.NetworkSettings.Networks,before.Id),'ROLLBACK_RESTORED_NETWORK_CHANGED');
}
/** The retained UI owner restores through the current frozen Compose file.
 * Permit only the two measured generator labels after proving model equality;
 * every other original configuration/resource field remains exact. */
export function validateOwnedBrowserReturn({before,after,model,service,image,daemonDefaults,currentSource}){
 assert.ok(['frontend-candidate','frontend-retained'].includes(service));assert.match(currentSource.configHash,/^[a-f0-9]{64}$/);
 assert.equal(model.services[service].read_only,true);same(model.services[service].volumes??[],[],'BROWSER_RETURN_BUSINESS_MOUNT_REFUSED');same(before.Mounts,[],'BROWSER_RETURN_INITIAL_MOUNT_REFUSED');same(after.Mounts,[],'BROWSER_RETURN_ADDED_MOUNT_REFUSED');assert.ok(before.ImageManifestDescriptor&&after.ImageManifestDescriptor,'BROWSER_RETURN_PLATFORM_DESCRIPTOR_REQUIRED');
 same(currentSource.model.name,model.name,'BROWSER_RETURN_PROJECT_CHANGED');same(currentSource.model.services[service],model.services[service],'BROWSER_RETURN_MODEL_CHANGED');
 same(currentSource.model.networks,model.networks,'BROWSER_RETURN_NETWORK_MODEL_CHANGED');same(currentSource.model.volumes,model.volumes,'BROWSER_RETURN_VOLUME_MODEL_CHANGED');
 assert.equal(currentSource.files.length,2);assert.ok(currentSource.files.every(f=>typeof f==='string'&&!/[,\r\n\0]/.test(f)&&/^(?:[A-Z]:\\|\/)/.test(f)));
 const normalized=structuredClone(after),labels=normalized.Config.Labels;
 assert.equal(labels['com.docker.compose.config-hash'],currentSource.configHash,'BROWSER_RETURN_GENERATED_HASH_CHANGED');
 assert.equal(labels['com.docker.compose.project.config_files'],currentSource.files.join(','),'BROWSER_RETURN_GENERATED_FILES_CHANGED');
 for(const key of ['com.docker.compose.config-hash','com.docker.compose.project.config_files'])labels[key]=before.Config.Labels[key];
 validateRestoredLocalSlot({before,after:normalized,model,service,image,daemonDefaults});
 return {format:'sabalan-owned-browser-source-metadata-return/v1',service,beforeId:before.Id,afterId:after.Id,configHash:currentSource.configHash,composeFiles:[...currentSource.files],onlyMeasuredGeneratorLabelsChanged:true,additionalBrowserUp:false,productionAdmission:false};
}
export function validateLocalRollbackModel({model,service,container:c,image,daemonDefaults}){
 assert.ok(['backend-candidate','backend-retained','inquiry','frontend-candidate','frontend-retained'].includes(service));const m=model.services[service];
 const allowed=['profiles','build','cpus','command','depends_on','entrypoint','environment','healthcheck','image','logging','mem_limit','memswap_limit','networks','ports','pull_policy','read_only','restart','stop_grace_period','tmpfs','volumes','labels','hostname','domainname','user','working_dir','stdin_open','tty','cap_drop','security_opt'];
 assert.ok(Object.keys(m).every(k=>allowed.includes(k)),'ROLLBACK_UNSUPPORTED_COMPOSE_FIELD');assert.equal(m.image,c.Image);assert.equal(image.Id,c.Image);assert.match(c.Image,/^sha256:[a-f0-9]{64}$/);
 same(env(c.Config.Env),{...env(image.Config.Env),...m.environment},'ROLLBACK_MODEL_ENV_DIFFERS');
 const health={...(image.Config.Healthcheck??{}),Test:m.healthcheck.test};for(const [a,b]of [['interval','Interval'],['timeout','Timeout'],['start_period','StartPeriod'],['start_interval','StartInterval']])if(Object.hasOwn(m.healthcheck,a))health[b]=Math.round(seconds(m.healthcheck[a])*1e9);if(Object.hasOwn(m.healthcheck,'retries'))health.Retries=m.healthcheck.retries;
 assert.ok(Object.keys(m.healthcheck).every(k=>['test','interval','timeout','start_period','start_interval','retries'].includes(k)));
 const labels={...(image.Config.Labels??{}),...(m.labels??{})};const generated=['config-hash','container-number','depends_on','image','oneoff','project','project.config_files','project.working_dir','replace','service','version'].map(k=>'com.docker.compose.'+k);
 for(const [key,value]of Object.entries(c.Config.Labels))if(key.startsWith('com.docker.compose.')){assert.ok(generated.includes(key));labels[key]=value;}
 assert.equal(labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(labels['com.docker.compose.service'],service);
 const exposed={...(image.Config.ExposedPorts??{})};for(const p of m.ports??[])exposed[p.target+'/'+(p.protocol??'tcp')]={};
 const config={Hostname:m.hostname??c.Id.slice(0,12),Domainname:m.domainname??'',User:m.user??image.Config.User??'',AttachStdin:m.stdin_open??false,AttachStdout:true,AttachStderr:true,ExposedPorts:Object.keys(exposed).length?exposed:null,Tty:m.tty??false,OpenStdin:m.stdin_open??false,StdinOnce:false,Env:c.Config.Env,Cmd:m.command??image.Config.Cmd??null,Healthcheck:health,Image:m.image,Volumes:image.Config.Volumes??null,WorkingDir:m.working_dir??image.Config.WorkingDir??'',Entrypoint:m.entrypoint??image.Config.Entrypoint??null,Labels:labels,StopTimeout:seconds(m.stop_grace_period??'10s')};
 same(c.Config,config,'ROLLBACK_FULL_CONFIG_DIFFERS');
 if(!m.logging){assert.ok(daemonDefaults,'ROLLBACK_OBSERVED_DAEMON_LOGGING_REQUIRED');same(Object.keys(daemonDefaults),['logging'],'ROLLBACK_UNSUPPORTED_DAEMON_DEFAULT');assert.ok(['local','json-file'].includes(daemonDefaults.logging.driver),'ROLLBACK_UNSUPPORTED_LOGGING_DRIVER');}
 const logging=m.logging??daemonDefaults.logging;
 const host={...structuredClone(defaults),Binds:[],Mounts:[],LogConfig:{Type:logging.driver,Config:logging.options},NetworkMode:model.networks.default.name,PortBindings:{},RestartPolicy:{Name:m.restart??'no',MaximumRetryCount:0},ReadonlyRootfs:m.read_only??false,Tmpfs:Object.fromEntries((m.tmpfs??[]).map(v=>{const at=v.indexOf(':');return at<0?[v,'']:[v.slice(0,at),v.slice(at+1)];})),Memory:Number(m.mem_limit??0),MemorySwap:Number(m.memswap_limit??(Number(m.mem_limit??0)*2)),NanoCpus:Math.round(Number(m.cpus??0)*1e9)};
 if(m.cap_drop)host.CapDrop=m.cap_drop;if(m.security_opt)host.SecurityOpt=m.security_opt;
 same(m.networks,{default:null},'ROLLBACK_UNSUPPORTED_NETWORK_SELECTION');
 for(const p of m.ports??[]){assert.ok(Object.keys(p).every(k=>['mode','host_ip','target','published','protocol'].includes(k)));assert.equal(p.mode,'ingress');const key=p.target+'/'+(p.protocol??'tcp');(host.PortBindings[key]??=[]).push({HostIp:p.host_ip??'',HostPort:String(p.published)});}
 for(const v of m.volumes??[]){assert.equal(v.type,'volume');assert.ok(Object.keys(v).every(k=>['type','source','target','read_only','volume'].includes(k)));assert.ok(Object.keys(v.volume??{}).every(k=>['nocopy','subpath'].includes(k)));const name=model.volumes[v.source].name;
  if(v.volume?.nocopy||v.volume?.subpath){const mount={Type:'volume',Source:name,Target:v.target};if(v.read_only)mount.ReadOnly=true;mount.VolumeOptions={NoCopy:v.volume.nocopy??false};if(v.volume.subpath)mount.VolumeOptions.Subpath=v.volume.subpath;host.Mounts.push(mount);}
  else host.Binds.push(name+':'+v.target+':'+(v.read_only?'ro':'rw'));
 }
 if(!Object.hasOwn(c.HostConfig,'Mounts')&&!host.Mounts.length)delete host.Mounts;
 if(c.HostConfig.Binds===null&&!host.Binds.length)host.Binds=null;
 if(!Object.hasOwn(c.HostConfig,'Tmpfs')&&!(m.tmpfs??[]).length)delete host.Tmpfs;
 const normalize=h=>({...h,Binds:h.Binds?[...h.Binds].sort():h.Binds,Mounts:h.Mounts?[...h.Mounts].sort((a,b)=>a.Target.localeCompare(b.Target)):h.Mounts});
 same(normalize(c.HostConfig),normalize(host),'ROLLBACK_FULL_HOST_CONFIG_DIFFERS');
 return {fullConfigVerified:true,fullHostConfigVerified:true,productionAdmission:false};
}
const defaults={"ContainerIDFile":"","AutoRemove":false,"VolumeDriver":"","VolumesFrom":null,"ConsoleSize":[0,0],"CapAdd":null,"CapDrop":null,"CgroupnsMode":"private","Dns":null,"DnsOptions":null,"DnsSearch":null,"ExtraHosts":[],"GroupAdd":null,"IpcMode":"private","Cgroup":"","Links":null,"OomScoreAdj":0,"PidMode":"","Privileged":false,"PublishAllPorts":false,"SecurityOpt":null,"UTSMode":"","UsernsMode":"","ShmSize":67108864,"Runtime":"runc","Isolation":"","CpuShares":0,"CgroupParent":"","BlkioWeight":0,"BlkioWeightDevice":null,"BlkioDeviceReadBps":null,"BlkioDeviceWriteBps":null,"BlkioDeviceReadIOps":null,"BlkioDeviceWriteIOps":null,"CpuPeriod":0,"CpuQuota":0,"CpuRealtimePeriod":0,"CpuRealtimeRuntime":0,"CpusetCpus":"","CpusetMems":"","Devices":null,"DeviceCgroupRules":null,"DeviceRequests":null,"MemoryReservation":0,"MemorySwappiness":null,"OomKillDisable":null,"PidsLimit":null,"Ulimits":null,"CpuCount":0,"CpuPercent":0,"IOMaximumIOps":0,"IOMaximumBandwidth":0,"MaskedPaths":["/proc/acpi","/proc/asound","/proc/interrupts","/proc/kcore","/proc/keys","/proc/latency_stats","/proc/sched_debug","/proc/scsi","/proc/timer_list","/proc/timer_stats","/sys/devices/virtual/powercap","/sys/firmware"],"ReadonlyPaths":["/proc/bus","/proc/fs","/proc/irq","/proc/sys","/proc/sysrq-trigger"]};

/** The existing bridge/volumes must remain physically present; this lane never
 * reconstructs shared infrastructure. Explicit definitions and every actual
 * resource field are checked/pinned independently of service config hashes. */
export function validateLocalRollbackResources({model,service,container,network,volumes}){
 const n=model.networks.default;assert.ok(Object.keys(n).every(k=>['name','driver','driver_opts','ipam','internal','attachable','enable_ipv4','enable_ipv6','labels','external'].includes(k)),'ROLLBACK_UNSUPPORTED_NETWORK_DEFINITION');
 assert.notEqual(n.external,true);assert.equal(network.Name,n.name);assert.equal(network.Driver,n.driver??'bridge');assert.equal(network.Scope,'local');assert.equal(network.Internal,n.internal??false);assert.equal(network.Attachable,n.attachable??false);assert.equal(network.EnableIPv4,n.enable_ipv4??true);assert.equal(network.EnableIPv6,n.enable_ipv6??false);assert.equal(network.Ingress,false);assert.equal(network.ConfigOnly,false);
 assert.equal(container.NetworkSettings.Networks[n.name].NetworkID,network.Id);assert.equal(network.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(network.Labels['com.docker.compose.network'],'default');
 const opts={...(n.driver_opts??{})};for(const [key,value]of [['com.docker.network.enable_ipv4',n.enable_ipv4??true],['com.docker.network.enable_ipv6',n.enable_ipv6??false]])if(Object.hasOwn(opts,key))assert.equal(opts[key],String(value));for(const [key,value]of [['com.docker.network.enable_ipv4',network.EnableIPv4],['com.docker.network.enable_ipv6',network.EnableIPv6]])if(Object.hasOwn(network.Options??{},key)&&!Object.hasOwn(opts,key))opts[key]=String(value);
 same(network.Options??{},opts,'ROLLBACK_NETWORK_DRIVER_OPTIONS_DIFFERS');const ipam=n.ipam??{};assert.ok(Object.keys(ipam).every(k=>['driver','options','config'].includes(k)));assert.equal(network.IPAM.Driver,ipam.driver??'default');same(network.IPAM.Options??{},ipam.options??{},'ROLLBACK_NETWORK_IPAM_OPTIONS_DIFFERS');
 if(ipam.config?.length){const configs=ipam.config.map(c=>{assert.ok(Object.keys(c).every(k=>['subnet','ip_range','gateway','aux_addresses'].includes(k)));return Object.fromEntries([['subnet','Subnet'],['ip_range','IPRange'],['gateway','Gateway'],['aux_addresses','AuxiliaryAddresses']].filter(([key])=>Object.hasOwn(c,key)).map(([key,to])=>[to,c[key]]));});same(network.IPAM.Config,configs,'ROLLBACK_NETWORK_IPAM_CONFIG_DIFFERS');}
 const customLabels=Object.fromEntries(Object.entries(network.Labels??{}).filter(([key])=>!key.startsWith('com.docker.compose.')));same(customLabels,n.labels??{},'ROLLBACK_NETWORK_LABELS_DIFFERS');
 for(const mount of model.services[service].volumes){const def=model.volumes[mount.source];assert.ok(Object.keys(def).every(k=>['name','driver','driver_opts','external','labels'].includes(k)),'ROLLBACK_UNSUPPORTED_VOLUME_DEFINITION');assert.notEqual(def.external,true);const volume=volumes.find(v=>v.Name===def.name);assert.ok(volume,'ROLLBACK_PHYSICAL_VOLUME_MISSING');assert.equal(volume.Driver,def.driver??'local');assert.equal(volume.Driver,'local');assert.equal(volume.Scope,'local');same(volume.Options??{},def.driver_opts??{},'ROLLBACK_VOLUME_OPTIONS_DIFFERS');
  assert.equal(volume.Mountpoint,'/var/lib/docker/volumes/'+def.name+'/_data');assert.equal(volume.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(volume.Labels['com.docker.compose.volume'],mount.source);same(Object.fromEntries(Object.entries(volume.Labels??{}).filter(([key])=>!key.startsWith('com.docker.compose.'))),def.labels??{},'ROLLBACK_VOLUME_LABELS_DIFFERS');
  const actual=container.Mounts.find(v=>v.Destination===mount.target);assert.ok(actual);assert.equal(actual.Name,volume.Name);assert.equal(actual.Driver,volume.Driver);assert.equal(actual.RW,!mount.read_only);const permitted=[volume.Mountpoint];if(mount.volume?.subpath)permitted.push(volume.Mountpoint+'/'+mount.volume.subpath);assert.ok(permitted.includes(actual.Source),'ROLLBACK_PHYSICAL_MOUNTPOINT_DIFFERS');
 }
 return{sameExistingInfrastructureRequired:true,productionAdmission:false};
}
