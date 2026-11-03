/** Same-live-owner restoration. Facts never substitute for a live lease. */
import assert from 'node:assert/strict';import fs from 'node:fs';import{createHash}from'node:crypto';
import {containerSemantic}from'./container-semantics.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const hash=x=>sha(JSON.stringify(canonical(x)));
export function reconstructExactOriginal(wrapper,image,obligation){
 assert.equal(wrapper.Image,obligation.originalImage);assert.equal(image.Id,wrapper.Image);
 const value=containerSemantic(wrapper,{normalizeUnsetDns:false});value.config.Cmd=image.Config.Cmd;value.config.Entrypoint=image.Config.Entrypoint;value.host.RestartPolicy=obligation.originalRestart;
 for(const key of ['Dns','DnsOptions','DnsSearch'])if(value.host[key]===null)value.host[key]=[];
 assert.equal(hash(value),obligation.originalConfigurationSha256,'EXACT_ORIGINAL_RECONSTRUCTION_FAILED');return value;
}
export function observeReadOnlyDescriptorRefusal(fd){
 let error;try{fs.writeSync(fd,Buffer.from('refused'));}catch(e){error=e;}
 assert.ok(error&&['EBADF','EPERM','EACCES'].includes(error.code),'READONLY_NATIVE_REFUSAL_REQUIRED');return error.code;
}
/** Restore only from exact observations under the same live native owner. */
export async function completeHeldRestoration(d,{original,obligation,preflight,sourceCommit}){
 d.lease.assertHeld();d.assertNoChildren();assert.equal(hash(original),obligation.originalConfigurationSha256,'EXACT_ORIGINAL_RECONSTRUCTION_FAILED');
 const restored=await d.inspect(d.pgId);assert.equal(hash(containerSemantic(restored)),hash(original),'RESTORED_NORMALIZED_CONFIGURATION_DRIFT');assert.equal(restored.State.Running,true);assert.equal(restored.State.Health.Status,'healthy');
 const catalog=await d.sql("SELECT json_build_object('system',(SELECT system_identifier::text FROM pg_control_system()),'databases',(SELECT json_agg(x ORDER BY oid) FROM (SELECT oid,datname,datallowconn FROM pg_database) x))::text");assert.equal(sha(catalog),preflight.catalogSha256,'ORIGINAL_CLUSTER_CATALOG_CHANGED');
 d.save('normalized-configuration-verification.json',{sourceCommit,normalization:'docker-unset-dns-arrays/v1',exactRawOriginalSha256:hash(original),expected:hash(original),observed:hash(containerSemantic(restored)),allSettingsPreserved:true});
 await d.restoreClients();await d.verifyRestoration();await d.persistCompleted();await d.releaseLease();d.save('restoration-only.json',{sourceCommit,operation:d.operation,originalLeaseClosed:true,allTenHealthy:true,originalClusterRestored:true,primitiveFaultAcceptance:false,physicalReplayQualified:false,productionAdmission:false});return {restored:true,primitiveAcceptance:false};
}
