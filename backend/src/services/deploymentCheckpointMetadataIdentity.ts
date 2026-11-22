import {createHash} from 'node:crypto';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function fail():never{throw Error('DEPLOYMENT_CANONICAL_CHECKPOINT_METADATA_UNPROVEN');}

/** Keep the exact database JSON identity inside both transport sidecars. The
 * remote sidecar may omit local paths; those omissions never redefine identity. */
export function checkpointMetadataTransport<T extends object>(metadata:T){
 const normalized=JSON.parse(JSON.stringify(metadata));
 if(!normalized||Array.isArray(normalized)||typeof normalized!=='object'
  ||'canonicalMetadata'in normalized||'canonicalMetadataSha256'in normalized)fail();
 return {...metadata,canonicalMetadata:normalized,canonicalMetadataSha256:hash(normalized)};
}

/** Online qualification requires this new exact envelope. Legacy recovery
 * readers remain free to read older sidecars, which cannot qualify ONLINE. */
export function readCanonicalCheckpointMetadata(sidecar:unknown):{metadata:any;sha256:string}{
 const value=sidecar as any,metadata=value?.canonicalMetadata;
 if(!value||typeof value!=='object'||Array.isArray(value)||!metadata||typeof metadata!=='object'||Array.isArray(metadata)
  ||'canonicalMetadata'in metadata||'canonicalMetadataSha256'in metadata
  ||typeof value.canonicalMetadataSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.canonicalMetadataSha256)
  ||hash(metadata)!==value.canonicalMetadataSha256)fail();
 const transport=new Set(['metadataPath','localPath','archivePath','canonicalMetadata','canonicalMetadataSha256']);
 for(const key of Object.keys(value))if(!transport.has(key)&&(!(key in metadata)||hash(value[key])!==hash(metadata[key])))fail();
 for(const key of Object.keys(metadata)){
  if(transport.has(key)){
   if(key in value&&hash(value[key])!==hash(metadata[key]))fail();
  }else if(!(key in value)||hash(value[key])!==hash(metadata[key]))fail();
 }
 return{metadata:JSON.parse(JSON.stringify(metadata)),sha256:value.canonicalMetadataSha256};
}
