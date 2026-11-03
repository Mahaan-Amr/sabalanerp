import {createHash} from 'node:crypto';

const fields=['workerStdout','workerStderr','workerOriginal','outerActive','outerFinal','privateProof','sourceCheckpoint','currentMaterial','currentCompiled','currentImage','currentInspect'] as const;
export type ProtectedFinancialQualificationArtifacts=Readonly<Record<typeof fields[number],Buffer>>;
export const protectedFinancialArtifactNames=Object.freeze([...fields,'certificate']);
export function protectedFinancialArtifactMaximum(name:string){return (name==='currentCompiled'?32:name==='workerStdout'?40:16)*1024*1024;}
const exact=(value:any,keys:readonly string[])=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
const hash=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');

/** Data-only artifact reader; it supplies no qualification or release authority. */
export function readProtectedFinancialArtifactInventory(source:any,read:(file:string,sha:string,maximum:number,bytes:number,json:boolean,allowEmpty:boolean)=>Buffer){
 if(!source?.evidence||!exact(source.evidence,protectedFinancialArtifactNames))throw new Error('ONLINE_RELEASE_EVIDENCE_UNPROVEN');
 const raws:Record<string,Buffer>={};
 for(const name of protectedFinancialArtifactNames){
  const descriptor=source.evidence[name],maximum=name==='certificate'?65536:protectedFinancialArtifactMaximum(name);
  if(!exact(descriptor,['file','bytes','sha256'])||typeof descriptor.sha256!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.sha256)||
    !Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<(name==='workerStderr'?0:1)||descriptor.bytes>maximum||descriptor.file!==`protected-financial-${name.toLowerCase()}.json`)throw new Error('ONLINE_RELEASE_EVIDENCE_UNPROVEN');
  const bytes=read(descriptor.file,descriptor.sha256,maximum,descriptor.bytes,false,name==='workerStderr');
  if(!Buffer.isBuffer(bytes)||bytes.length!==descriptor.bytes||hash(bytes)!==descriptor.sha256)throw new Error('ONLINE_RELEASE_EVIDENCE_UNPROVEN');
  raws[name]=bytes;
 }
 const {certificate,...artifacts}=raws;return {certificate,artifacts:artifacts as ProtectedFinancialQualificationArtifacts};
}
