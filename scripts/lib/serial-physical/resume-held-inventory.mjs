/** Finish bounded primitives through the SAME live held owner and actual child.
 * A serialized receipt cannot enter: the original ChildProcess and private
 * directory capability must still belong to this driver. No replay admission. */
import assert from 'node:assert/strict';import fs from 'node:fs';import{ChildProcess}from'node:child_process';import{createHash}from'node:crypto';
import{LocalBoundedSerialDriver}from'./local-bounded-driver.mjs';import{assertOriginalPrivateEvidenceDirectory}from'../original-private-evidence-directory.mjs';import{compareFrozenOriginalInventories}from'./bounded-runner.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function resumeHeldInventoryPrimitives(d,observed,{sourceCommit,sourcePins}){
 assert.ok(d instanceof LocalBoundedSerialDriver,'ORIGINAL_DRIVER_REQUIRED');d.lease.assertHeld();d.assertNoChildren();assertOriginalPrivateEvidenceDirectory(d.custody,d.directory);
 const s=d.boundedState;assert.ok(s?.leased&&s.obligation&&s.transition&&s.wrapper&&!s.wrapperReleased&&!s.initial,'HELD_INVENTORY_BOUNDARY_REQUIRED');
 assert.ok(d.heldOwnerTimer?.hasRef(),'STRONGLY_RETAINED_HELD_OWNER_REQUIRED');
 const child=observed.child;assert.ok(child instanceof ChildProcess&&child.pid>1,'ORIGINAL_INVENTORY_CHILD_REQUIRED');assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);assert.ok(child.stdout.readableEnded&&child.stderr.readableEnded&&observed.eof);
 assert.equal(child.spawnargs.at(-1),'final-1');assert.ok(child.spawnargs.includes(d.root+'/inventory-original.sh'));assert.ok(child.spawnargs.includes(d.pgId));
 const receipt=d.receipts.find(r=>r.originalPid===child.pid&&r.phase==='INVENTORY_final-1');assert.ok(receipt&&receipt.code===0&&receipt.signal===null&&receipt.stdoutEof&&receipt.stderrEof&&!receipt.observationFault,'SAME_ORIGINAL_CLOSURE_RECEIPT_REQUIRED');
 const first=d.receipts.find(r=>r.phase==='INVENTORY_initial');assert.ok(first&&first.code===0&&first.signal===null&&first.stdoutEof&&first.stderrEof&&!first.observationFault,'FIRST_ORIGINAL_CLOSURE_REQUIRED');assert.equal(first.stdoutSha256,receipt.stdoutSha256,'HELD_INVENTORY_PRODUCER_BYTES_CHANGED');
 assert.equal(observed.file,d.directory+'/owned-held-inventory.raw');const stat=fs.lstatSync(observed.file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);const raw=fs.readFileSync(observed.file);assert.equal(raw.length,receipt.stdoutBytes);assert.equal(sha(raw),receipt.stdoutSha256);assert.equal(sha(raw),observed.sha256);
 const modules={};for(const name of ['serial-owner.mjs','frozen-inventory.mjs']){const url=new URL('./'+name,import.meta.url),digest=sha(fs.readFileSync(url));assert.equal(digest,sourcePins[name],'COMMITTED_SOURCE_PIN_REQUIRED');url.searchParams.set('source',digest);modules[name]=await import(url.href);}
 const validate=modules['serial-owner.mjs'].validateFrozenOriginalInventory,parse=modules['frozen-inventory.mjs'].parseFrozenOriginalInventory,plan={originalDataExcludedEntry:d.owned,retainedEvidenceRoots:d.retainedEvidenceRoots};
 const initial=parse(plan,raw.toString('utf8'),validate);await d.script('set -eu\ntest ! -e '+d.root+'/request-release-wrapper\ntest ! -e /var/lib/postgresql/data/postmaster.pid\npg_controldata /var/lib/postgresql/data | grep -Eq "^Database cluster state: +shut down$"\n','RESUMED_FROZEN_GATE');
 s.initial=structuredClone(initial);await d.persistInitialInventory(s.initial);d.save('held-inventory-source-continuation.json',{sourceCommit,sourcePins,originalPid:process.pid,keeperPid:d.lease.originalPid,inventoryOriginalPid:child.pid,inventorySha256:receipt.stdoutSha256,earlierPolicyNegativePreserved:true,physicalReplayQualified:false,productionAdmission:false});
 await d.runFaultProofs(s.initial);d.assertNoChildren();
 const phase='final-'+d.inventoryCount++,pins=JSON.parse(fs.readFileSync(d.directory+'/source-pins.json'));assert.equal((await d.script('sha256sum '+d.root+'/inventory-original.sh\n','RESUMED_PRODUCER_IDENTITY')).trim().split(/\s+/)[0],pins['inventory-original.sh']);
 const finalRaw=await d.docker(['exec','--user','0:0',d.pgId,'/bin/sh',d.root+'/inventory-original.sh',phase],'RESUMED_POST_FAULT_INVENTORY'),final=parse(plan,finalRaw,validate),change=compareFrozenOriginalInventories(s.initial,final);if(change)await d.recordRootChange(change.before,change.after);await d.persistFinalInventory(final);s.finalCommitted=true;
 await d.releaseWrapper();s.wrapperReleased=true;await d.restorePostgres();s.postgresRestored=true;await d.restoreClients();s.clientsRestored=true;await d.verifyRestoration();await d.persistCompleted();s.obligation=false;await d.releaseLease();s.leased=false;
 const result={sourceCommit,operation:d.operation,primitiveProofsCompleted:true,originalClusterRestored:true,allTenHealthy:true,originalLeaseClosed:true,sameOwnerContinuation:true,earlierPolicyNegativePreserved:true,physicalReplayQualified:false,productionAdmission:false};d.save('bounded-native-acceptance.json',result);return result;
}
