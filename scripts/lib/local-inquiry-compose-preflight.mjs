/** Closed local profile: compare the complete effective Compose service BEFORE mutation. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const same=(a,b,code)=>assert.ok(isDeepStrictEqual(a,b),code);
const keys=(value,expected,code)=>same(Object.keys(value).sort(),[...expected].sort(),code);
const environment=rows=>Object.fromEntries(rows.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const nanoseconds=value=>{assert.match(value,/^[0-9]+s$/);return Number(value.slice(0,-1))*1_000_000_000;};
const serviceKeys=['build','cpus','command','entrypoint','environment','hostname','healthcheck','image','logging','mem_limit','networks','ports','restart','stop_grace_period','volumes','working_dir'];
// Compose 5.5.1's interpolated config JSON serializes literal $ as $$ so that
// the output is reusable input. Decode only that exact reversible representation.
const encodeCommand=items=>items.map(s=>s.replaceAll('$',()=> '$$'));
const decodeCommand=items=>items.map(s=>{assert.equal(typeof s,'string');assert.match(s,/^(?:[^$]|\$\$)*$/,'UNREVIEWED_COMMAND_INTERPOLATION');return s.replaceAll('$$','$');});
const hostDefaults=Object.freeze({ContainerIDFile:'',AutoRemove:false,VolumeDriver:'',VolumesFrom:null,ConsoleSize:[0,0],CapAdd:null,CapDrop:null,
 CgroupnsMode:'private',Dns:[],DnsOptions:[],DnsSearch:[],ExtraHosts:[],GroupAdd:null,IpcMode:'private',Cgroup:'',Links:null,OomScoreAdj:0,PidMode:'',Privileged:false,
 PublishAllPorts:false,ReadonlyRootfs:false,SecurityOpt:null,UTSMode:'',UsernsMode:'',ShmSize:67108864,Runtime:'runc',Isolation:'',CpuShares:0,CgroupParent:'',
 BlkioWeight:0,BlkioWeightDevice:null,BlkioDeviceReadBps:null,BlkioDeviceWriteBps:null,BlkioDeviceReadIOps:null,BlkioDeviceWriteIOps:null,CpuPeriod:0,CpuQuota:0,
 CpuRealtimePeriod:0,CpuRealtimeRuntime:0,CpusetCpus:'',CpusetMems:'',Devices:null,DeviceCgroupRules:null,DeviceRequests:null,MemoryReservation:0,
 MemorySwappiness:null,OomKillDisable:null,PidsLimit:null,Ulimits:null,CpuCount:0,CpuPercent:0,IOMaximumIOps:0,IOMaximumBandwidth:0,
 MaskedPaths:['/proc/acpi','/proc/asound','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/sched_debug','/proc/scsi','/proc/timer_list','/proc/timer_stats','/sys/devices/virtual/powercap','/sys/firmware'],
 ReadonlyPaths:['/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger']});

function project(model,image,resources){
 const service=model.services.inquiry;keys(service,serviceKeys,'UNSUPPORTED_INQUIRY_SERVICE_FIELD');
 assert.ok(service.build&&typeof service.build==='object'); // Ignored only with mandatory --no-build/--pull never.
 assert.equal(service.restart,'unless-stopped');assert.equal(service.logging.driver,'local');keys(service.logging,['driver','options'],'UNSUPPORTED_LOGGING_FIELD');
 keys(service.logging.options,['max-file','max-size'],'UNSUPPORTED_LOGGING_OPTION');
 assert.equal(service.cpus,1);assert.match(service.mem_limit,/^[0-9]+$/);const memory=Number(service.mem_limit);assert.ok(Number.isSafeInteger(memory)&&memory>0);
 same(service.ports,[{mode:'ingress',host_ip:'127.0.0.1',target:3001,published:'3001',protocol:'tcp'}],'LOCAL_PORT_PROFILE_CHANGED');
 same(service.networks,{default:null},'NETWORK_ATTACHMENT_PROFILE_CHANGED');
 keys(model.networks.default,['name','ipam'],'UNSUPPORTED_NETWORK_DEFINITION');same(model.networks.default.ipam,{},'UNSUPPORTED_NETWORK_IPAM');
 const networkName=model.networks.default.name,network=resources.network;
 assert.equal(network.Name,networkName);assert.equal(network.Driver,'bridge');assert.equal(network.Scope,'local');assert.equal(network.Internal,false);
 assert.equal(network.Attachable,false);assert.equal(network.EnableIPv6,false);assert.equal(network.EnableIPv4,true);
 same(network.Options,{'com.docker.network.enable_ipv4':'true','com.docker.network.enable_ipv6':'false'},'NETWORK_OPTIONS_CHANGED');assert.equal(network.Labels['com.docker.compose.project'],'sabalanerp-local');
 assert.equal(network.Labels['com.docker.compose.network'],'default');
 assert.equal(service.volumes.length,2);
 const mounts=service.volumes.map(v=>{
  const expected=['type','source','target','volume',...(Object.hasOwn(v,'read_only')?['read_only']:[])];keys(v,expected,'UNSUPPORTED_VOLUME_FIELD');
  assert.equal(v.type,'volume');same(v.volume,{},'UNSUPPORTED_VOLUME_OPTIONS');assert.ok(['/data','/app/recovery-coordination'].includes(v.target));
  if(Object.hasOwn(v,'read_only'))assert.equal(typeof v.read_only,'boolean');
  const definition=model.volumes[v.source];keys(definition,['name'],'UNSUPPORTED_VOLUME_DEFINITION');const actual=resources.volumes[definition.name];
  assert.ok(actual);assert.equal(actual.Name,definition.name);assert.equal(actual.Driver,'local');assert.equal(actual.Scope,'local');same(actual.Options??{},{},'VOLUME_OPTIONS_CHANGED');
  assert.equal(actual.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(actual.Labels['com.docker.compose.volume'],v.source);
  return{Type:'volume',Name:actual.Name,Source:actual.Mountpoint,Destination:v.target,Driver:'local',Mode:v.read_only?'ro':'rw',RW:!v.read_only,Propagation:''};
 });
 assert.equal(new Set(mounts.map(m=>m.Destination)).size,2);
 const host={...structuredClone(hostDefaults),Binds:mounts.map(m=>m.Name+':'+m.Destination+':'+m.Mode),LogConfig:{Type:service.logging.driver,Config:service.logging.options},
  NetworkMode:networkName,PortBindings:{'3001/tcp':[{HostIp:'127.0.0.1',HostPort:'3001'}]},RestartPolicy:{Name:service.restart,MaximumRetryCount:0},Memory:memory,MemorySwap:memory*2,NanoCpus:service.cpus*1_000_000_000};
 keys(service.healthcheck,['test','timeout','interval','retries','start_period'],'UNSUPPORTED_HEALTH_FIELD');
 const health={Test:decodeCommand(service.healthcheck.test),Timeout:nanoseconds(service.healthcheck.timeout),Interval:nanoseconds(service.healthcheck.interval),
  Retries:service.healthcheck.retries,StartPeriod:nanoseconds(service.healthcheck.start_period)};
 const config={Hostname:service.hostname,Domainname:'',User:image.Config.User??'',AttachStdin:false,AttachStdout:true,AttachStderr:true,
  ExposedPorts:{...(image.Config.ExposedPorts??{}),'3001/tcp':{}},Tty:false,OpenStdin:false,StdinOnce:false,
  Env:{...environment(image.Config.Env),...service.environment},Cmd:decodeCommand(service.command),Healthcheck:health,Image:service.image,
  Volumes:image.Config.Volumes??null,WorkingDir:service.working_dir,Entrypoint:service.entrypoint,StopTimeout:nanoseconds(service.stop_grace_period)/1_000_000_000};
 assert.ok(Object.values(config.Env).every(v=>typeof v==='string'),'UNRESOLVED_ENVIRONMENT');
 // Unhandled inherited runtime fields cannot silently enter this bounded profile.
 for(const field of ['StopSignal','Shell'])assert.ok(!Object.hasOwn(image.Config,field),'UNSUPPORTED_IMAGE_RUNTIME_FIELD');
 return{host,config,mounts,networkName};
}

export function assertOriginalInquiryComposeModel({model,before,image,resources,composeFiles,composeVersion,configHash}){
 assert.equal(composeVersion,'5.5.1','UNREVIEWED_COMPOSE_PRODUCER_VERSION');
 assert.equal(model.name,'sabalanerp-local');const projected=project(model,image,resources);
 assert.equal(image.Id,before.Image);assert.equal(before.Config.Labels['com.docker.compose.config-hash'],configHash,'BASE_MODEL_HASH_DRIFT');
 const config=structuredClone(before.Config),actualEnvironment=environment(config.Env);delete config.Env;
 const expected={...projected.config};delete expected.Env;
 const labels={...image.Config.Labels,'com.docker.compose.config-hash':configHash,'com.docker.compose.container-number':'1','com.docker.compose.depends_on':'',
  'com.docker.compose.image':before.ImageManifestDescriptor.digest,'com.docker.compose.oneoff':'False','com.docker.compose.project':'sabalanerp-local',
  'com.docker.compose.project.config_files':composeFiles.join(','),'com.docker.compose.project.working_dir':path.dirname(composeFiles[0]),
  'com.docker.compose.replace':'inquiry-1','com.docker.compose.service':'inquiry','com.docker.compose.version':composeVersion};
 expected.Labels=labels;same(config,expected,'RUNNING_CONFIG_MODEL_DRIFT');same(actualEnvironment,projected.config.Env,'RUNNING_ENVIRONMENT_MODEL_DRIFT');
 const host=structuredClone(before.HostConfig);for(const key of ['Dns','DnsOptions','DnsSearch'])if(host[key]===null)host[key]=[];
 same(host,projected.host,'RUNNING_HOST_MODEL_DRIFT');same(before.Mounts,projected.mounts,'RUNNING_MOUNT_MODEL_DRIFT');
 same(before.NetworkSettings.Ports,projected.host.PortBindings,'RUNNING_PORT_MODEL_DRIFT');
 same(Object.keys(before.NetworkSettings.Networks),[projected.networkName],'RUNNING_NETWORK_ATTACHMENTS_DRIFT');
 const attached=before.NetworkSettings.Networks[projected.networkName];assert.equal(attached.NetworkID,resources.network.Id);
 same(attached.Aliases,[before.Name.slice(1),'inquiry'],'RUNNING_NETWORK_ALIASES_DRIFT');
 const network={...attached};for(const key of ['EndpointID','Gateway','IPAddress','MacAddress','IPPrefixLen','IPv6Gateway','GlobalIPv6Address','GlobalIPv6PrefixLen','DNSNames'])delete network[key];
 same(network,{IPAMConfig:null,Links:null,Aliases:attached.Aliases,DriverOpts:null,GwPriority:0,NetworkID:resources.network.Id},'RUNNING_NETWORK_OPTIONS_DRIFT');
 return projected;
}

export function assertPlannedInquiryComposeModel({originalModel,model,before,image,resources,command,healthCommand}){
 same(model.name,originalModel.name,'EFFECTIVE_PROJECT_CHANGED');
 const expected=structuredClone(originalModel.services.inquiry);
 Object.assign(expected,{image:image.Id,hostname:before.Config.Hostname,entrypoint:['/usr/local/bin/node'],command:encodeCommand(command),
  environment:environment(before.Config.Env),healthcheck:{test:encodeCommand(['CMD','/usr/local/bin/node',...healthCommand]),timeout:'15s',interval:'5s',retries:3,start_period:'5s'}});
 Object.assign(expected.volumes.find(v=>v.target==='/data'),{read_only:true});
 same(model.services.inquiry,expected,'UNDECLARED_EFFECTIVE_SERVICE_CHANGE');
 same(model.volumes,originalModel.volumes,'EFFECTIVE_VOLUME_DEFINITIONS_CHANGED');same(model.networks,originalModel.networks,'EFFECTIVE_NETWORK_DEFINITIONS_CHANGED');
 const projected=project(model,image,resources),originalHost=structuredClone(before.HostConfig);
 for(const key of ['Dns','DnsOptions','DnsSearch'])if(originalHost[key]===null)originalHost[key]=[];
 const data=before.Mounts.find(m=>m.Destination==='/data');originalHost.Binds=originalHost.Binds.map(s=>s===data.Name+':/data:rw'?data.Name+':/data:ro':s);
 same(projected.host,originalHost,'PLANNED_HOST_MODEL_DRIFT');
 const originalConfig=structuredClone(before.Config);delete originalConfig.Labels;originalConfig.Env=environment(originalConfig.Env);
 const expectedConfig={...originalConfig,Image:image.Id,Entrypoint:['/usr/local/bin/node'],Cmd:command,Healthcheck:projected.config.Healthcheck};
 same(projected.config,expectedConfig,'PLANNED_CONFIG_MODEL_DRIFT');
 const mounts=structuredClone(before.Mounts);Object.assign(mounts.find(m=>m.Destination==='/data'),{RW:false,Mode:'ro'});
 same(projected.mounts,mounts,'PLANNED_MOUNT_MODEL_DRIFT');
 return{format:'sabalan-local-inquiry-effective-compose-preflight/v1',completeOriginalProfileCompared:true,completePlannedServiceCompared:true,
  declaredChanges:['image','entrypoint','command','healthcheck','original-data-read-only'],maintenanceOnly:true,applicationReady:false,runtimeAccepted:false};
}
