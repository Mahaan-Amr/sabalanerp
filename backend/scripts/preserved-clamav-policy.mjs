/** Nonsecret selection metadata only; never release or scanner admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const digest=/^[a-f0-9]{64}$/;
export const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort((left,right)=>{const a=Array.from(left,char=>char.codePointAt(0)),b=Array.from(right,char=>char.codePointAt(0));for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;}).map(key=>[key,sorted(value[key])])):value;
export const canonical=value=>JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function validateSelection(value){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),['format','containerId','image','startedAt','hostPid','stableConfigurationSha256','initialIdentitySha256','initialHealthSha256'].sort());
 assert.equal(value.format,'sabalan-preserved-clamav/v1');assert.match(value.containerId,digest);assert.match(value.image,/^sha256:[a-f0-9]{64}$/);
 assert.ok(typeof value.startedAt==='string'&&Number.isFinite(Date.parse(value.startedAt)));assert.ok(Number.isSafeInteger(value.hostPid)&&value.hostPid>1);
 for(const name of ['stableConfigurationSha256','initialIdentitySha256','initialHealthSha256'])assert.match(value[name],digest);
 return value;
}
export function validateBinding(binding){
 assert.ok(binding&&typeof binding==='object');assert.deepEqual(Object.keys(binding).sort(),['format','planSha256','selectionSha256','selection'].sort());
 assert.equal(binding.format,'sabalan-preserved-clamav-binding/v1');assert.match(binding.planSha256,digest);validateSelection(binding.selection);
 assert.equal(binding.selectionSha256,hash(canonical(binding.selection)));return binding;
}
export function selectionBinding(selection,planSha256){return validateBinding({format:'sabalan-preserved-clamav-binding/v1',planSha256,selectionSha256:hash(canonical(validateSelection(selection))),selection});}

export function validateResumeSelection(session,journal,metadata,inherited){
 assert.equal(journal.deploymentId,session.deploymentId);assert.equal(journal.sequence,1);assert.equal(journal.event,'deployment-prepared');
 const binding=session.preservedClamav;
 if(!binding){assert.ok(!journal.details?.preservedClamav&&!metadata&&!inherited,'PRESERVED_CLAMAV_SESSION_BINDING_MISSING');return null;}
 validateBinding(binding);assert.deepEqual(validateBinding(journal.details?.preservedClamav),binding,'PRESERVED_CLAMAV_JOURNAL_SELECTION_CHANGED');assert.deepEqual(validateBinding(metadata),binding,'PRESERVED_CLAMAV_DURABLE_SELECTION_CHANGED');
 if(inherited)assert.deepEqual(validateBinding(inherited),binding,'PRESERVED_CLAMAV_INHERITED_SELECTION_CHANGED');return binding;
}
