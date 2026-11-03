/** File-only planning arithmetic. No runtime, cipher creation, import or admission. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {restoreResourceBudget} from '../../../scripts/run-independent-full-restore-controller.mjs';
const dir=import.meta.dirname,sha=b=>createHash('sha256').update(b).digest('hex'),MiB=1024**2,GiB=1024**3;
function input(file){const raw=fs.readFileSync(file);return{ref:{file:path.resolve(file),bytes:raw.length,sha256:sha(raw)},value:JSON.parse(raw)};}
const images=input(path.join(dir,'HELD-IMAGE-SPACE-44d1bdad08d94458b7eddcf5f4f08da9.json'));assert.equal(images.value.pass,true);
const observed=input(path.join(dir,'BACKUP-FILESYSTEM-52bdcf908218902b08afef4574630d91.json'));assert.equal(observed.value.pass,true);
const checkpoint=input('D:/sabalanerp-online-qa/C30-complete-final-plan-d1d83332c347419d91b66051adf39d81/windows/checkpoint.json');
const metadataBudget=restoreResourceBudget(checkpoint.value,4096);
const cryptoFile=path.resolve(dir,'../../../backend/src/services/recoveryCrypto.ts'),crypto=fs.readFileSync(cryptoFile,'utf8');
assert.ok(crypto.includes('headerLength > 16_384'));assert.ok(crypto.includes('const TAG_BYTES = 16;'));assert.ok(crypto.includes("const MAGIC = Buffer.from('SABREC01');"));
const fullReserve=512*MiB,imageReserve=GiB,imageHeadroom=128*MiB;
const fullTransferContent=2*checkpoint.value.size+64*MiB,fullTransferMinimum=fullTransferContent+fullReserve;
const fullRestoreContent=metadataBudget.requiredDiskBytes-metadataBudget.remainingHostReserve;
const fullRestoreWith512Reserve=fullRestoreContent+fullReserve;
const newC3=images.value.images.find(r=>r.name==='C3-application-backend');assert.ok(newC3&&newC3.cipher===null);
const c3ValidCipherPlanningUpper=newC3.compressed.bytes+8+4+16384+16;
const t=images.value.totals;
const allHeldRepresentations=t.rawArchiveBytes+t.compressedArchiveBytes+t.existingCipherBytes+c3ValidCipherPlanningUpper;
const daemonSourceSpool=images.value.images.reduce((n,r)=>n+r.raw.bytes+(r.proof.layers.length+8)*10240,0);
// Conservative extra charge even for classic overlay2: no credit is taken for
// an implementation not retaining compressed content or sharing existing layers.
const potentialCompressedContentStore=t.compressedArchiveBytes;
const imageContent=allHeldRepresentations+t.expandedAllocationUpperBoundBytes+daemonSourceSpool+potentialCompressedContentStore;
const imagePeak=imageContent+imageReserve+imageHeadroom;
const conditionalSequentialPeak=Math.max(fullTransferMinimum,fullRestoreWith512Reserve,imagePeak);
// This broader ceiling gives no retirement credit whatsoever: both FULL
// temporary-content allowances coexist with the complete four-image envelope.
const noRetirementCreditPeak=fullTransferContent+fullRestoreContent+imagePeak;
const available=observed.value.result.summary.availableBytesAfter;
const report={format:'sabalan-419-capacity-planning-envelope/v1',planningOnly:true,admission:false,
 fullAccepted:false,productionAdmission:false,inputs:{images:images.ref,filesystem:observed.ref,checkpoint:checkpoint.ref,
 cryptoSource:{file:cryptoFile,sha256:sha(Buffer.from(crypto))}},
 target:observed.value.result.summary.mount.value.filesystems[0],availableBytes:available,
 filesystemReservedBytesExcludedFromAvailable:observed.value.result.summary.filesystem.filesystemReservedBytes,
 full:{sourceCipherBytes:checkpoint.value.size,transportContentUpperBytes:fullTransferContent,
 reserveBytes:fullReserve,transportAdmissionMinimumBytes:fullTransferMinimum,
 canonicalRestoreBudget:metadataBudget,canonicalRestoreWith512MiBReserveBytes:fullRestoreWith512Reserve,
 contentCoexistenceWithoutRetirementCreditBytes:fullTransferContent+fullRestoreContent,
 warning:'Held checkpoint is a content-size input only; fresh capture may require a larger budget.'},
 images:{artifactCount:4,scope:'Three accepted SourceA recovery images plus distinct C3 application backend; no local maintenance carrier or additional future image.',
 c3CipherCreated:false,c3ValidCipherPlanningUpperBytes:c3ValidCipherPlanningUpper,
 c3CipherBoundCondition:'Unchanged SABREC01/AES-GCM codec, header <=16384, source exactly the pinned gzip; no qualified cipher is claimed.',
 allHeldRepresentationsBytes:allHeldRepresentations,
 expandedExt4AllocationUpperBoundBytes:t.expandedAllocationUpperBoundBytes,
 sharedLayerCreditBytes:0,daemonSourceSpoolAllowanceBytes:daemonSourceSpool,
 potentialCompressedContentStoreAllowanceBytes:potentialCompressedContentStore,
 reserveBytes:imageReserve,headroomBytes:imageHeadroom,requiredFreeBytes:imagePeak,
 requiredFreeInodes:t.expandedInodeUpperBound+65536+4*4},
 conditionalSequentialPeakBytes:conditionalSequentialPeak,
 conditionalSequentialPrerequisite:'Actual owner-authenticated FULL temporary retirement/closure before image staging, and per-role importer retirement before next role. Not observed yet.',
 noRetirementCreditPlanningPeakBytes:noRetirementCreditPeak,
 minimumAdditionalUsableBytes:Math.max(0,noRetirementCreditPeak-available),
 proposedDiskGrowthGiB:24,proposedDiskGrowthBytes:24*GiB,
 growthIsNotAdmission:true,
 qualifications:['Ext4 4096-byte/overlay2 planning model; actual selected namespace and importer must match.',
 'One attempt only; failed-attempt holds are already protected, and a new failure requires a new budget.',
 'No cleanup, layer reuse, reserved-ext4-block consumption or unobserved retirement is credited.',
 'Extra future images, fresh larger captures, foreign growth or a changed codec invalidate this ceiling.',
 'Actual free bytes and inodes after disk/partition/filesystem growth must pass a new canonical preflight.']};
const file=path.join(dir,'CAPACITY-PLANNING-ENVELOPE.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({file,availableBytes:available,fullTransferMinimum,fullRestoreWith512Reserve,imagePeak,conditionalSequentialPeak,noRetirementCreditPeak,minimumAdditionalUsableBytes:report.minimumAdditionalUsableBytes,proposedDiskGrowthGiB:24}));
