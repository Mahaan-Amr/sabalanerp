import {createHash} from 'node:crypto';

export type OnlineImageRole='backend'|'frontend'|'inquiry';
export type OnlineImageGraph={index:string;platform:string;config:string;rootfsDiffIds:string[];archiveSha256:string;archiveBytes:number};
export type ProductionImageExecutionBinding={
 format:'sabalan-production-image-execution-binding/v1';role:OnlineImageRole;releaseId:string;
 sourceMachineUuidSha256:string;sourceKernelBootIdSha256:string;store:'containerd'|'classic';executionImageId:string;
 graph:OnlineImageGraph;nativeInspection:{Id:string;Descriptor:null|{mediaType:string;digest:string;size:number};
 RootFS:{Type:'layers';Layers:string[]};Os:'linux';Architecture:'amd64';Config:{Labels:null|Record<string,string>}};inspectionSha256:string;
};
export type ProductionImageExecutionBindings=Record<OnlineImageRole,ProductionImageExecutionBinding>;
const roles:OnlineImageRole[]=['backend','frontend','inquiry'];
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:any,b:any)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const image=(v:any)=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v);
function requireProof(value:unknown):asserts value{if(!value)throw Error('ONLINE_IMAGE_EXECUTION_BINDING_UNPROVEN');}
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),keys.slice().sort());
export const productionImageInspectionSha256=(inspection:ProductionImageExecutionBinding['nativeInspection'])=>
 createHash('sha256').update(JSON.stringify(canonical(inspection))).digest('hex');

/** Content validation only. The original request/issuer supplies provenance;
 * this function cannot mint an original observation or runtime authority. */
export function validateProductionExecutionBindings(bindings:ProductionImageExecutionBindings|undefined,expected:{
 releaseId:string;imageGraphs:Record<OnlineImageRole,OnlineImageGraph>;deploymentTargetImages:Record<OnlineImageRole,string>;
 sourceHost?:{machineUuidSha256:string;kernelBootIdSha256:string};recoveryMachineUuidSha256?:string;
}):Record<OnlineImageRole,string>{
 if(bindings===undefined)return {...expected.deploymentTargetImages};
 requireProof(exact(bindings,roles));
 let host:string|undefined;
 const result={} as Record<OnlineImageRole,string>;
 for(const role of roles){
  const value=bindings[role];
  requireProof(exact(value,['format','role','releaseId','sourceMachineUuidSha256','sourceKernelBootIdSha256','store','executionImageId','graph','nativeInspection','inspectionSha256']));
  requireProof(value.format==='sabalan-production-image-execution-binding/v1'&&value.role===role&&value.releaseId===expected.releaseId
   &&digest(value.sourceMachineUuidSha256)&&digest(value.sourceKernelBootIdSha256));
  const identity=value.sourceMachineUuidSha256+':'+value.sourceKernelBootIdSha256;
  requireProof(host===undefined||host===identity);host=identity;
  if(expected.sourceHost)requireProof(value.sourceMachineUuidSha256===expected.sourceHost.machineUuidSha256&&value.sourceKernelBootIdSha256===expected.sourceHost.kernelBootIdSha256);
  if(expected.recoveryMachineUuidSha256)requireProof(digest(expected.recoveryMachineUuidSha256)&&value.sourceMachineUuidSha256!==expected.recoveryMachineUuidSha256);
  const graph=value.graph;
  requireProof(exact(graph,['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'])&&same(graph,expected.imageGraphs[role])
   &&graph.config===expected.deploymentTargetImages[role]&&[graph.index,graph.platform,graph.config].every(image)
   &&digest(graph.archiveSha256)&&Number.isSafeInteger(graph.archiveBytes)&&graph.archiveBytes>0
   &&Array.isArray(graph.rootfsDiffIds)&&graph.rootfsDiffIds.length>0&&graph.rootfsDiffIds.length<=128&&graph.rootfsDiffIds.every(image));
  const observed=value.nativeInspection;
  requireProof(exact(observed,['Id','Descriptor','RootFS','Os','Architecture','Config'])&&observed.Os==='linux'&&observed.Architecture==='amd64'
   &&exact(observed.RootFS,['Type','Layers'])&&observed.RootFS.Type==='layers'&&same(observed.RootFS.Layers,graph.rootfsDiffIds)
   &&exact(observed.Config,['Labels'])&&(observed.Config.Labels===null||typeof observed.Config.Labels==='object'&&!Array.isArray(observed.Config.Labels)
    &&Object.entries(observed.Config.Labels).every(([key,label])=>key.length>0&&typeof label==='string'))
   &&digest(value.inspectionSha256)&&productionImageInspectionSha256(observed)===value.inspectionSha256&&image(value.executionImageId)&&observed.Id===value.executionImageId);
  if(value.store==='containerd'){
   const descriptor=observed.Descriptor;
   requireProof(value.executionImageId===graph.index&&exact(descriptor,['mediaType','digest','size'])&&descriptor!.digest===graph.index
    &&['application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json'].includes(descriptor!.mediaType)
    &&Number.isSafeInteger(descriptor!.size)&&descriptor!.size>0);
  }else requireProof(value.store==='classic'&&value.executionImageId===graph.config&&observed.Descriptor===null);
  result[role]=value.executionImageId;
 }
 return result;
}
