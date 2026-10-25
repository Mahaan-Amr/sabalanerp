import{readNegativeRecoveryHandoff,negativeRecoveryDescriptor,negativeRecoveryInputs,negativeRecoveryStreamingInputs}from'./application-native-negative-baseline.mjs';
import{negativeCapsuleAcceptanceSelection,validateNegativeCapsuleAcceptanceResult,negativeCapsuleAcceptanceBootstrap}from'./application-native-negative-capsule-acceptance.mjs';
/** One exact naturally closed post-UP memory failure; negative reference only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateAuthorityCohortSlots, authorityWriterRoot } from './application-native-authority-cohort.mjs';
import { validateNegativeAcceptanceSlots } from './application-native-negative-acceptance.mjs';
import {validateHistoricalCapsulePair,historicalCapsulePreflightSpec,historicalCapsuleInputFiles} from './application-native-historical-capsules.mjs';
import {inertAcceptanceInputFiles,inertAcceptanceSpec,validateInertAcceptanceResult} from './application-native-inert-acceptance.mjs';
export const currentPostUpObserverSha256 = '7f52dbdea561c44f6dbb587853aece314528a8b1a0357562781f341df9f648f5';
export const postUpObserverSha256 = '855b385ce9a03f2199d0f81c8f063da21f36db428f29baacac28e6355015cb20';
export const postUpBaselineFormat = 'sabalan-post-up-memory-negative-baseline/v1';
function deepFreeze(value) { if (value && typeof value === 'object') {
    for (const child of Object.values(value))
        deepFreeze(child);
    Object.freeze(value);
} return value; }
export const postUpFailureContext = deepFreeze({ "failed": { "file": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\application-native-candidate-97148774bad27bef1d5b464a69a8bdcb.json", "sha256": "eb26a1ff706faa493019527ce6d82c89fdd61387a3345ced36bba6ea6aab5ab2" }, "closure": { "file": "D:\\sabalanerp-online-qa\\C22-positive-candidate-second-original-replace-20261024\\closure.json", "sha256": "d2eabd6a4012100545adfeb80984ed33f41447d794a4e52662edcbdb420a2a93" }, "stderr": { "file": "D:\\sabalanerp-online-qa\\C22-positive-candidate-second-original-replace-20261024\\stderr.raw", "sha256": "dd882326301df9fa560d576ba7ca9dc9aa3b4032a76db803f428e58cd55cb480" }, "originalSource": { "file": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\scripts\\replace-qualified-application-native-candidate-local.mjs", "sha256": "5bc6b6beaffbaf15cd96caf43f930b7108c9fc5ba29a4a1da54009da389eab2b" }, "originalSourceSnapshot": { "file": "D:\\sabalanerp-online-qa\\C23-post-up-memory-baseline-source-20261024\\immutable-original-c22-creator.mjs", "sha256": "5bc6b6beaffbaf15cd96caf43f930b7108c9fc5ba29a4a1da54009da389eab2b" }, "nativeQuietProbeSha256": "c9eec40ebffcaeb5eeea829c3beba3971f3a3e34e2362d9d5ef00979df446774", "image": { "file": "D:\\sabalanerp-online-qa\\current-backend-image-43a617b0d2a142236ada68cc1c53fcfd\\image-receipt.json", "sha256": "4d65545001775f521ec3eddc6e9a6edd769bca874ce9ce97dcb9c53d21932405" }, "material": { "file": "D:\\sabalanerp-online-qa\\current-backend-material-c22ea5ec5702414981a5c659d6b95551\\material-receipt.json", "sha256": "4d69ec47c644d27b71ac340aec1f12c270fac6b5da9305e7136af4b02e289492" }, "retainedImage": { "file": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json", "sha256": "431b6ab3b673a1dfe226b28f5a5e845628e3f91b78f667e4d946f67fe9d8e775" }, "retainedMaterial": { "file": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json", "sha256": "8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d" }, "acceptanceHistory": { "file": "D:\\sabalanerp-online-qa\\C16-finite-negative-recovery-resume-actual-r4-20261024\\baseline.json", "sha256": "8da9bcc8ffb2be0c37ddef1fc7e0f55cc2e1c8079fb1d4603c69bcb445eff22c" }, "installedProbe": { "originalPath": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\installed-native-image-probe.fixture.mjs", "sha256": "599c0cee1021356d6fd9503aabf929b6347d9665304452f6cd292f6a90f360b4" }, "authorityProbe": { "originalPath": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-authority-cohort.fixture.py", "sha256": "8691520a151c444de207959bbfe0c45da2387d963477a4c72ed471638dfc1215" }, "acceptanceProbe": { "originalPath": "C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-negative-acceptance.fixture.py", "sha256": "2ab67a15c8c87ea3ba6a3403754cc8ab57ccbded8e388f2f91d141c72bd1630a" } });
export const capsulePostUpBaselineFormat = 'sabalan-post-up-capsule-negative-baseline/v1';
export const capsulePostUpObserverSha256 = '79059da5e66250d8e92e24d1e1c927952a9c4f80edca0d44de29a0ca20bed890';
export const capsulePostUpFailureContext = deepFreeze({"failed":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\application-native-candidate-4d9e5e57a12e985025bc06d59f08e050.json","sha256":"b563205d2a02815573b0aed677f5481e6ee717c9163f54f8509be8bfa1e17620"},"originalSource":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\scripts\\replace-qualified-application-native-candidate-local.mjs","sha256":"6c626a81b0211f1d0fae5d9257dfef865d7ec6c6a60533b1d9c105d719c81ce0"},"originalSourceSnapshot":{"file":"D:\\sabalanerp-online-qa\\C26-capsule-post-up-recovery-source-20261024\\immutable-original-c25-creator.mjs","sha256":"6c626a81b0211f1d0fae5d9257dfef865d7ec6c6a60533b1d9c105d719c81ce0"},"nativeQuietProbeSha256":"c9eec40ebffcaeb5eeea829c3beba3971f3a3e34e2362d9d5ef00979df446774","image":{"file":"D:/sabalanerp-online-qa/current-backend-image-5e520f17b230d7bb14c0bea02bbc6c27/image-receipt.json","sha256":"d70287059e191ccf968ef16b22efee51961e1f51ae25881cc908b7926177e95f"},"material":{"file":"D:/sabalanerp-online-qa/current-backend-material-7bdc4431f5234af5b6c422718a1368b0/material-receipt.json","sha256":"3aa158405505ce36f4de1b4510bcf83b6255d82dc6be3901319be888cf788896"},"retainedImage":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json","sha256":"431b6ab3b673a1dfe226b28f5a5e845628e3f91b78f667e4d946f67fe9d8e775"},"retainedMaterial":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json","sha256":"8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d"},"acceptanceHistory":{"file":"D:\\sabalanerp-online-qa\\C16-finite-negative-recovery-resume-actual-r4-20261024\\baseline.json","sha256":"8da9bcc8ffb2be0c37ddef1fc7e0f55cc2e1c8079fb1d4603c69bcb445eff22c"},"installedProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\installed-native-image-probe.fixture.mjs","sha256":"599c0cee1021356d6fd9503aabf929b6347d9665304452f6cd292f6a90f360b4"},"authorityProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-authority-cohort.fixture.py","sha256":"8691520a151c444de207959bbfe0c45da2387d963477a4c72ed471638dfc1215"},"acceptanceProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-negative-acceptance.fixture.py","sha256":"2ab67a15c8c87ea3ba6a3403754cc8ab57ccbded8e388f2f91d141c72bd1630a"},"ownerObservation":{"file":"D:\\sabalanerp-online-qa\\C26-capsule-post-up-recovery-source-20261024\\original-tool-owner-observation.json","sha256":"93721ee418e9ad645efaf23ac01c7c97644545c4a953e81f03e6b374ff564391"}});
export const currentPostUpFailureContext = deepFreeze({"failed":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\application-native-candidate-0fa0284f2e393d124c9fc9e0d14c8e9c.json","sha256":"5af672637115a0d29083fc5c7ca2d6435450e77f89c302183cb7eb83617fa55b"},"originalSource":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\scripts\\replace-qualified-application-native-candidate-local.mjs","sha256":"c786f721afb3f3da3ef676fdd45816d4f08918973fa42f3464749f45b1ace4ed"},"originalSourceSnapshot":{"file":"D:\\sabalanerp-online-qa\\C28-post-up-memory-recovery-source-20261024\\immutable-original-c28-creator.mjs","sha256":"c786f721afb3f3da3ef676fdd45816d4f08918973fa42f3464749f45b1ace4ed"},"nativeQuietProbeSha256":"c9eec40ebffcaeb5eeea829c3beba3971f3a3e34e2362d9d5ef00979df446774","image":{"file":"D:\\sabalanerp-online-qa\\current-backend-image-c43a5df19d8b5245f490ba7a5d99911a\\image-receipt.json","sha256":"e313c5b673ef2277e3b2ab4d568d2d5ff9844946b03b8b4c4a7d132036b4579c"},"material":{"file":"D:\\sabalanerp-online-qa\\current-backend-material-6585db1307144321bbd3e6d25df23d95\\material-receipt.json","sha256":"a4d8fd8859407d8825a15bb4332c49b95edebed0a73bf37ca0d69fc82775eb85"},"retainedImage":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json","sha256":"431b6ab3b673a1dfe226b28f5a5e845628e3f91b78f667e4d946f67fe9d8e775"},"retainedMaterial":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json","sha256":"8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d"},"acceptanceHistory":{"file":"D:\\sabalanerp-online-qa\\C16-finite-negative-recovery-resume-actual-r4-20261024\\baseline.json","sha256":"8da9bcc8ffb2be0c37ddef1fc7e0f55cc2e1c8079fb1d4603c69bcb445eff22c"},"installedProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\installed-native-image-probe.fixture.mjs","sha256":"599c0cee1021356d6fd9503aabf929b6347d9665304452f6cd292f6a90f360b4"},"authorityProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-authority-cohort.fixture.py","sha256":"8691520a151c444de207959bbfe0c45da2387d963477a4c72ed471638dfc1215"},"acceptanceProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-negative-acceptance.fixture.py","sha256":"2ab67a15c8c87ea3ba6a3403754cc8ab57ccbded8e388f2f91d141c72bd1630a"},"closure":{"file":"D:\\sabalanerp-online-qa\\C28-ordinary-candidate-original-replace-r2-20261024\\closure.json","sha256":"01b56c450324072966739508a91e41d075e77f084fa14fa8e8825532fac7d1fb"},"stderr":{"file":"D:\\sabalanerp-online-qa\\C28-ordinary-candidate-original-replace-r2-20261024\\stderr.raw","sha256":"8472cf1fff25e883967ff57fed2008cf517b4713e5fca071ee8b70c02819a47c"}});
export const resourcePostUpFailureContext = deepFreeze({"failed":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\application-native-candidate-feb482a4221e75735339ceca7ce27643.json","sha256":"9d99f83515ebf1f2add49fc9812420c3349b08be630265106a5e816a1c244e29"},"originalSource":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\scripts\\replace-qualified-application-native-candidate-local.mjs","sha256":"9a1bb4db03389a81ac3c149cb00c05f09900f648aa2c94ab2f014a85b50ae273"},"originalSourceSnapshot":{"file":"D:\\sabalanerp-online-qa\\C30-feb482-post-up-baseline-source-r1-20261025\\immutable-original-candidate-creator.mjs","sha256":"9a1bb4db03389a81ac3c149cb00c05f09900f648aa2c94ab2f014a85b50ae273"},"nativeQuietProbeSha256":"c9eec40ebffcaeb5eeea829c3beba3971f3a3e34e2362d9d5ef00979df446774","image":{"file":"D:\\sabalanerp-online-qa\\current-backend-image-d1a80e00d272d9a752d7546a6bab69b1\\image-receipt.json","sha256":"6be65c4285e01345b7d0056b26ba5819a67d4c52062a88f52022de02cbe39ec6"},"material":{"file":"D:\\sabalanerp-online-qa\\current-backend-material-42fd29237864471bab719655b2463ac3\\material-receipt.json","sha256":"e233776f20675b87a4d0acdbcec48d487cc62948ffdec79980218c5f214b3438"},"retainedImage":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json","sha256":"431b6ab3b673a1dfe226b28f5a5e845628e3f91b78f667e4d946f67fe9d8e775"},"retainedMaterial":{"file":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json","sha256":"8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d"},"acceptanceHistory":{"file":"D:\\sabalanerp-online-qa\\C16-finite-negative-recovery-resume-actual-r4-20261024\\baseline.json","sha256":"8da9bcc8ffb2be0c37ddef1fc7e0f55cc2e1c8079fb1d4603c69bcb445eff22c"},"installedProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\installed-native-image-probe.fixture.mjs","sha256":"599c0cee1021356d6fd9503aabf929b6347d9665304452f6cd292f6a90f360b4"},"authorityProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-authority-cohort.fixture.py","sha256":"8691520a151c444de207959bbfe0c45da2387d963477a4c72ed471638dfc1215"},"acceptanceProbe":{"originalPath":"C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\tests\\online-deployment\\application-native-negative-acceptance.fixture.py","sha256":"2ab67a15c8c87ea3ba6a3403754cc8ab57ccbded8e388f2f91d141c72bd1630a"},"ownerObservation":{"file":"D:\\sabalanerp-online-qa\\C30-feb482-original-tool-terminal-observation-20261025.json","sha256":"791d86b72be290a1d6d959706b4e3c4b51a2a2afe5fd6f3c11d4437da643a23d"},"originalPolicySnapshot":{"file":"D:\\sabalanerp-online-qa\\C30-resource-profile-history-source-r1-20261025\\immutable-original-qa-memory.mjs","sha256":"f1587d8310039f9694719dfea0bc507bed2138631d8a7b47d4cc063ff4803860"}});
export const resourcePostUpObserverSha256 = "203f701247e608a365530aa432df704c9d1a6b5b1ec3b0682cf861b17d7af8a1";
export function isCapsulePostUpContext(context) { return context === resourcePostUpFailureContext || context === capsulePostUpFailureContext || context === currentPostUpFailureContext; }
function contextForFailure(failed) { if(failed?.operation==='feb482a4221e75735339ceca7ce27643')return resourcePostUpFailureContext; if (failed?.operation === '0fa0284f2e393d124c9fc9e0d14c8e9c') return currentPostUpFailureContext; if (failed?.operation === '4d9e5e57a12e985025bc06d59f08e050') return capsulePostUpFailureContext; return postUpFailureContext; }
export function postUpContextForBaseline(value) { if (value?.format === capsulePostUpBaselineFormat) { if(value.failed?.sha256===resourcePostUpFailureContext.failed.sha256){assert.deepEqual(value.failed,resourcePostUpFailureContext.failed);return resourcePostUpFailureContext;} if(value.failed?.sha256===currentPostUpFailureContext.failed.sha256){assert.deepEqual(value.failed,currentPostUpFailureContext.failed);return currentPostUpFailureContext;} assert.deepEqual(value.failed, capsulePostUpFailureContext.failed); return capsulePostUpFailureContext; } assert.equal(value?.format, postUpBaselineFormat); return postUpFailureContext; }
export const capsuleOwnerAbsenceScript = "$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^node(?:\\.exe)?$' -and $_.CommandLine -like '*replace-qualified-application-native-candidate-local.mjs*' -and $_.CommandLine -like '*--replace*' } | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;birth=$_.CreationDate.ToUniversalTime().ToString('o')} });[pscustomobject]@{format='sabalan-capsule-failed-owner-current-absence/v1';observedAt=[DateTime]::UtcNow.ToString('o');matches=@($rows);nativeClosureClaimed=$false;productionAdmission=$false}|ConvertTo-Json -Compress -Depth 5";
export const capsuleOwnerAbsenceArgv = () => ['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',capsuleOwnerAbsenceScript];
export function validateCapsuleOwnerAbsence(value) { assert.deepEqual(Object.keys(value).sort(), ['format','observedAt','matches','nativeClosureClaimed','productionAdmission'].sort()); assert.equal(value.format,'sabalan-capsule-failed-owner-current-absence/v1'); assert.ok(Number.isFinite(Date.parse(value.observedAt))); assert.deepEqual(value.matches,[]); assert.equal(value.nativeClosureClaimed,false); assert.equal(value.productionAdmission,false); }
function readCapsuleFailure(inputs) {
 const c=capsulePostUpFailureContext,f=JSON.parse(postUpReadReference(c.failed,inputs)),owner=JSON.parse(postUpReadReference(c.ownerObservation,inputs));
 assert.equal(owner.format,'sabalan-negative-preparation-tool-owner-observation/v1');assert.equal(owner.toolSessionId,59672);assert.equal(owner.actualFinalToolChunkId,'24ff5e');assert.equal(owner.toolReturnedExitCode,1);assert.equal(owner.toolReturnedFinalOutput,true);assert.deepEqual(owner.negativeReport,c.failed);assert.deepEqual(owner.originalSource,c.originalSourceSnapshot);
 for(const k of ['qualificationSucceeded','productionAdmission','originalNativeClosureClaimed','missingHistoricalFieldsReconstructed','originalPopenAdopted'])assert.equal(owner[k],false);
 const records=Object.fromEntries(Object.entries(owner.transcriptRecords).map(([k,ref])=>[k,JSON.parse(postUpReadReference(ref,inputs))]));assert.deepEqual(Object.keys(records).sort(),['146894','146896','146926','146930']);
 const launch=records['146894'].payload,wait=records['146926'].payload,start=records['146896'].payload,end=records['146930'].payload;
 assert.equal(launch.call_id,start.call_id);assert.equal(wait.call_id,end.call_id);assert.ok(launch.input.includes(c.originalSource.file.replaceAll('\\','/')));assert.ok(wait.input.includes('session_id:59672'));
 const decode=record=>record.output.filter(x=>x.type==='input_text').map(x=>{try{return JSON.parse(x.text);}catch{return null;}}).filter(Boolean);
 assert.equal(decode(start)[0].session_id,59672);assert.equal(decode(end)[0].chunk_id,'24ff5e');assert.equal(decode(end)[0].exit_code,1);assert.ok(decode(end)[0].output.includes('replace-qualified-application-native-candidate-local.mjs:349:12'));assert.ok(decode(end)[0].output.includes('1 !== 0'));
 postUpReadReference(c.originalSourceSnapshot,inputs);assert.equal(f.inputs[c.originalSource.file],c.originalSource.sha256);assert.equal(f.phase,'FAILED_CLOSED');assert.equal(f.pass,false);assert.equal(f.productionAdmission,false);assert.equal(f.operation,'4d9e5e57a12e985025bc06d59f08e050');assert.equal(f.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');assert.equal(f.up.code,0);assert.equal(f.up.signal,null);assert.equal(f.originalChildren,undefined);assert.deepEqual(f.protectedAfter,f.protectedBefore);assert.equal(f.immutableImage,'sha256:c31b6f0b5ecd6f28777d65311e3933081c2dfe40a155a3a8b13d5f64c9e93d04');
 assert.deepEqual(f.failure,{name:'AssertionError',message:'Expected values to be strictly equal:\n\n1 !== 0\n'});assert.deepEqual(Object.keys(f.historicalCapsulePreflight),['backend-candidate']);const probe=f.historicalCapsulePreflight['backend-candidate'];assert.equal(probe.code,1);assert.equal(probe.signal,null);assert.equal(probe.stdout,'');assert.equal(probe.stdoutEof,true);assert.equal(probe.stderrEof,true);assert.equal(probe.interrupted,false);assert.ok(probe.stderr.endsWith("NameError: name 'json' is not defined\n"));
 for(const service of postUpSlots){const v=f.authorityCohort.verified[service];assert.equal(v.code,0);assert.equal(v.signal,null);assert.deepEqual(JSON.parse(v.stdout),v.result);assert.deepEqual(v.result.namespace,f.authorityCohort.prepared[service].result.namespace);assert.equal(f.actual[service].memoryBytes,service==='backend-candidate'?2147483648:805306368);}
 return f;
}
export const postUpSql = "SELECT json_build_object('visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database LIKE 'qa_application_%'),'system',(SELECT system_identifier::text FROM pg_control_system()))";
export const postUpServices = Object.freeze(['backend', 'frontend', 'postgres', 'inquiry', 'redis', 'clamav', 'frontend-candidate', 'frontend-retained', 'backend-candidate', 'backend-retained']);
export const postUpSlots = Object.freeze(['backend-candidate', 'backend-retained']);
const tokens = new WeakMap(), sha = b => createHash('sha256').update(b).digest('hex');
export const postUpIdentity = c => ({ id: c.Id, image: c.Image, startedAt: c.State.StartedAt });
function raw(file) { assert.ok(path.isAbsolute(file)); file = path.resolve(file); assert.equal(fs.realpathSync(file), file); const a = fs.lstatSync(file, { bigint: true }); assert.ok(a.isFile() && !a.isSymbolicLink() && a.nlink === 1n && a.size > 0n && a.size <= 16n * 1024n ** 2n); const b = fs.readFileSync(file), z = fs.lstatSync(file, { bigint: true }); for (const k of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'])
    assert.equal(a[k], z[k]); return b; }
export function postUpReadReference(ref, inputs) { assert.deepEqual(Object.keys(ref).sort(), ['file', 'sha256']); assert.match(ref.sha256, /^[a-f0-9]{64}$/); const b = raw(ref.file); assert.equal(sha(b), ref.sha256); if (inputs)
    inputs.set(path.resolve(ref.file), { raw: b, sha256: ref.sha256 }); return b; }
export function readCurrentPostUpFailure(inputs) {
 const c=currentPostUpFailureContext,f=JSON.parse(postUpReadReference(c.failed,inputs)),closed=JSON.parse(postUpReadReference(c.closure,inputs));
 postUpReadReference(c.originalSourceSnapshot,inputs);const stderr=postUpReadReference(c.stderr,inputs);
 assert.equal(f.phase,'FAILED_CLOSED');assert.equal(f.pass,false);assert.equal(f.productionAdmission,false);assert.equal(f.operation,'0fa0284f2e393d124c9fc9e0d14c8e9c');
 assert.equal(f.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');assert.deepEqual(f.failure,{name:'AssertionError',message:'LOCAL_QA_HOST_MEMORY_STABILIZATION_DEADLINE'});
 assert.equal(f.inputs[c.originalSource.file],c.originalSource.sha256);assert.equal(f.up.originalPid,9316);assert.equal(f.up.code,0);assert.equal(f.up.signal,null);assert.equal(f.up.failure,undefined);
 assert.equal(f.actual,undefined);assert.equal(f.originalChildren,undefined);assert.deepEqual(f.protectedAfter,f.protectedBefore);
 assert.equal(f.immutableImage,'sha256:6fc93ae19459023d356b960bc287ec20b7a767a1dd8f1219767eea26d0716f46');assert.equal(f.imageReceiptSha256,c.image.sha256);assert.equal(f.materialReceiptSha256,c.material.sha256);
 assert.equal(closed.originalPid,34172);assert.equal(closed.code,1);assert.equal(closed.signal,null);assert.equal(closed.stdoutEof,true);assert.equal(closed.stderrEof,true);assert.equal(closed.interrupted,false);assert.deepEqual(closed.communicationFaults,[]);
 assert.equal(closed.format,'sabalan-canonical-ordinary-candidate-original-closure/v1');assert.equal(closed.inputPins[c.originalSource.file],c.originalSource.sha256);assert.equal(closed.inputPins[c.image.file],c.image.sha256);assert.equal(closed.inputPins[c.material.file],c.material.sha256);assert.equal(closed.stdoutSha256,sha(Buffer.alloc(0)));assert.equal(closed.stderrSha256,sha(stderr));
 const originalPreflight="C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\reports\\qa\\both-host-preflight-post-reopen-3ef4ef07f5b444fdbaa250f54ed02b41.json";assert.equal(closed.inputPins[originalPreflight],'14864f0d181595285c99346a9569c88a330001fa202d36567bf790e756c389ac');
 assert.deepEqual(closed.argv,['C:/Program Files/nodejs/node.exe',c.originalSource.file,'--replace','--image-receipt',c.image.file,'--material-receipt',c.material.file,'--preflight',originalPreflight,'--previous-replacement-receipt',f.previousReplacement.file,'--previous-replacement-sha256',f.previousReplacement.sha256,'--isolate-authority-cohort']);
 for(const flag of ['productionAdmission','originalUpAdopted','qualificationClaimed'])assert.equal(closed[flag],false);
 assert.equal(f.candidateQaMemoryProfile.beforeUp.platform,'win32');assert.ok(f.candidateQaMemoryProfile.beforeUp.availableBytes>=2*1024**3);assert.equal(f.candidateQaMemoryProfile.cacheCreditUsed,false);
 assert.equal(f.authorityCohort.nonce,'062be633e8f82962ca8abac853b80c20');
 for(const service of postUpSlots){const v=f.authorityCohort.verified[service];assert.ok(Number.isSafeInteger(v.originalPid)&&v.originalPid>0);assert.equal(v.code,0);assert.equal(v.signal,null);assert.equal(v.failure,undefined);assert.deepEqual(JSON.parse(v.stdout),v.result);assert.deepEqual(v.result.namespace,f.authorityCohort.prepared[service].result.namespace);}
 return f;
}
export function readResourcePostUpFailure(inputs){
 const c=resourcePostUpFailureContext,f=JSON.parse(postUpReadReference(c.failed,inputs)),tool=JSON.parse(postUpReadReference(c.ownerObservation,inputs));postUpReadReference(c.originalSourceSnapshot,inputs);postUpReadReference(c.originalPolicySnapshot,inputs);
 assert.equal(f.format,'sabalan-application-native-candidate/v1');assert.equal(f.phase,'FAILED_CLOSED');assert.equal(f.pass,false);assert.equal(f.productionAdmission,false);assert.equal(f.operation,'feb482a4221e75735339ceca7ce27643');assert.equal(f.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');
 assert.deepEqual(f.failure,{"name": "AssertionError", "message": "Expected values to be strictly equal:\n+ actual - expected\n\n+ '80e2d47c2f59f492df124109499393dbdc6b4c88efbfef954b048b0815dcfe67'\n- 'a1d336899e2f90c9a9324ee761a19f0d1ac5388bdaf5455c5cfadba07c91d18e'\n"});assert.equal(f.inputs[c.originalSource.file],c.originalSource.sha256);assert.equal(f.inputs["C:\\Users\\mahan\\.codex\\worktrees\\online-deployment\\sabalanerp\\scripts\\lib\\application-native-qa-memory.mjs"],c.originalPolicySnapshot.sha256);
 assert.equal(tool.format,'sabalan-owned-tool-terminal-observation/v1');assert.equal(tool.originalToolSessionId,56103);assert.equal(tool.terminalToolChunk,'9df0e7');assert.equal(tool.terminalExitCode,1);for(const k of ['toolTerminalObserved','nativePidNotInferredFromSessionId','notNativePopenCapability'])assert.equal(tool[k],true);for(const k of ['parentPromoted','qualificationGranted'])assert.equal(tool[k],false);assert.deepEqual(tool.failedReport,c.failed);assert.equal(tool.nativePid,undefined);
 assert.equal(f.up.originalPid,15268);assert.equal(f.up.code,0);assert.equal(f.up.signal,null);assert.equal(f.up.failure,undefined);assert.deepEqual(f.originalChildren,{allOriginalChildrenClosed:true,interrupted:false});assert.deepEqual(tool.reportedOriginalChildren,f.originalChildren);assert.equal(tool.originalUp.originalPid,15268);assert.equal(tool.originalUp.code,0);assert.equal(tool.originalUp.signal,null);
 assert.deepEqual(f.protectedAfter,f.protectedBefore);assert.deepEqual(f.finalProtected,f.protectedBefore);assert.equal(f.imageReceiptSha256,c.image.sha256);assert.equal(f.materialReceiptSha256,c.material.sha256);assert.equal(f.immutableImage,'sha256:327e1a686b8446ade7205b7a36fc401e510cd5f4b5e2e27e154424c535cb0fa3');
 assert.equal(f.candidateQaMemoryNegativeRecovery.handoff.sha256,'3d665ce8059a6849bc24af48a5bb4ae1db421c5c6e2deb28c60803a07e88bbff');assert.equal(f.candidateQaMemoryNegativeRecovery.history.sha256,'80e2d47c2f59f492df124109499393dbdc6b4c88efbfef954b048b0815dcfe67');
 for(const service of postUpSlots){assert.deepEqual({id:f.actual[service].id,image:f.actual[service].image,startedAt:f.actual[service].startedAt},{"backend-candidate": {"id": "98e9128fab016ee181197900ebfc6839c32eaa200c4373b79a1339519c74a73e", "image": "sha256:327e1a686b8446ade7205b7a36fc401e510cd5f4b5e2e27e154424c535cb0fa3", "startedAt": "2026-10-25T01:11:00.552718001Z"}, "backend-retained": {"id": "96f23cbbf1a1b743200c3a9578e1588de5c2de06f7edb28bbaa8cfcb43fa9467", "image": "sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186", "startedAt": "2026-10-25T01:11:00.889870775Z"}}[service]);const v=f.authorityCohort.verified[service];assert.ok(v.originalPid>0);assert.equal(v.code,0);assert.equal(v.signal,null);assert.equal(v.failure,undefined);assert.deepEqual(JSON.parse(v.stdout),v.result);assert.deepEqual(v.result.namespace,f.authorityCohort.prepared[service].result.namespace);assert.equal(f.installed[service].code,0);assert.equal(f.installed[service].signal,null);assert.equal(f.postMutationNativeQuiet[service].originalNativeProcesses,0);}
 return f;
}
export function readPostUpFailure(inputs, context = postUpFailureContext) {
 if(context===resourcePostUpFailureContext)return readResourcePostUpFailure(inputs);
    if(context === capsulePostUpFailureContext)return readCapsuleFailure(inputs);
    if(context === currentPostUpFailureContext)return readCurrentPostUpFailure(inputs);
    assert.equal(context,postUpFailureContext,'SOURCE_OWNED_POST_UP_FAILURE_CONTEXT_REQUIRED');
    const c = postUpFailureContext, f = JSON.parse(postUpReadReference(c.failed, inputs)), closed = JSON.parse(postUpReadReference(c.closure, inputs));
    postUpReadReference(c.originalSourceSnapshot, inputs);
    const stderr = postUpReadReference(c.stderr, inputs);
    assert.equal(sha(stderr), closed.stderrSha256);
    assert.equal(f.phase, 'FAILED_CLOSED');
    assert.equal(f.pass, false);
    assert.equal(f.productionAdmission, false);
    assert.deepEqual(f.failure, { name: 'AssertionError', message: 'LOCAL_QA_HOST_MEMORY_STABILIZATION_DEADLINE' });
    assert.equal(f.operation, '97148774bad27bef1d5b464a69a8bdcb');
    assert.equal(f.replacementEntry, 'scripts/replace-qualified-application-native-candidate-local.mjs');
    assert.equal(f.up.code, 0);
    assert.equal(f.up.signal, null);
    assert.equal(f.up.failure, undefined);
    assert.ok(Number.isSafeInteger(f.up.originalPid) && f.up.originalPid > 0);
    assert.equal(closed.code, 1);
    assert.equal(closed.signal, null);
    assert.equal(closed.stdoutEof, true);
    assert.equal(closed.stderrEof, true);
    assert.equal(closed.interrupted, false);
    assert.equal(closed.inputPins[c.originalSource.file], c.originalSource.sha256);
    assert.equal(closed.argv[1], c.originalSource.file);
    assert.equal(closed.argv[2], '--replace');
    assert.equal(closed.productionAdmission, false);
    assert.equal(f.actual, undefined);
    assert.equal(f.originalChildren, undefined);
    assert.deepEqual(f.protectedAfter, f.protectedBefore);
    assert.equal(f.immutableImage, 'sha256:b6b441843f56f55406da0afa40e9071ffdd206b6068d432a7c3c4f3f796f03d4');
    assert.equal(f.candidateQaMemoryProfile.beforeUp.platform, 'win32');
    assert.ok(f.candidateQaMemoryProfile.beforeUp.availableBytes >= 2 * 1024 ** 3);
    assert.equal(f.candidateQaMemoryProfile.cacheCreditUsed, false);
    for (const s of postUpSlots) {
        const v = f.authorityCohort.verified[s];
        assert.equal(v.code, 0);assert.equal(typeof v.code,'number');
        assert.equal(v.signal, null);
        assert.equal(v.failure, undefined);
        assert.deepEqual(JSON.parse(v.stdout), v.result);
        assert.deepEqual(v.result.namespace, f.authorityCohort.prepared[s].result.namespace);
    }
    return f;
}
export function postUpAcceptanceExpectation(inputs) { const b = JSON.parse(postUpReadReference(postUpFailureContext.acceptanceHistory, inputs)); assert.equal(b.acceptance.empty, true); const rows = []; for (const ref of Object.values(b.acceptance.verified)) {
    const c = JSON.parse(postUpReadReference(ref, inputs));
    assert.equal(c.code, 0);
    assert.equal(c.signal, null);
    assert.equal(c.stdoutEof, true);
    assert.equal(c.stderrEof, true);
    const raw = Buffer.from(c.stdoutBase64, 'base64');
    assert.equal(sha(raw), c.stdoutSha256);
    const v = JSON.parse(raw);
    assert.equal(v.empty, true);
    assert.equal(v.exclusivelyCreated, false);
    assert.equal(v.productionAdmission, false);
    rows.push(v.namespace);
} assert.deepEqual(rows[0], rows[1]); return { nonce: b.acceptance.subpath.slice('c16-recovery-'.length), namespace: rows[0] }; }
function child(ref, inputs) { const v = JSON.parse(postUpReadReference(ref, inputs)); assert.equal(v.format, 'sabalan-post-up-memory-original-readback/v1'); assert.ok(Number.isSafeInteger(v.originalPid) && v.originalPid > 0); assert.equal(v.code, 0);assert.equal(typeof v.code,'number'); assert.equal(v.signal, null); assert.equal(v.stdoutEof, true); assert.equal(v.stderrEof, true); assert.equal(v.interrupted, false);assert.equal(v.observationFault,null); const out = Buffer.from(v.stdoutBase64, 'base64'), err = Buffer.from(v.stderrBase64, 'base64'); assert.equal(out.toString('base64'), v.stdoutBase64); assert.equal(err.toString('base64'), v.stderrBase64); assert.equal(sha(out), v.stdoutSha256); assert.equal(sha(err), v.stderrSha256);assert.equal(v.stdoutBytes,out.length);assert.equal(v.stderrBytes,err.length); assert.ok(out.length <= 8 * 1024 ** 2 && err.length <= 65536); if (v.inputBase64 !== null)
    assert.equal(sha(Buffer.from(v.inputBase64, 'base64')), v.inputSha256);
else
    assert.equal(v.inputSha256, null); return { record: v, out, value: () => JSON.parse(out) }; }
function expectedInstalled(material) { const inv = prefix => { const entries = material.files.filter(r => r.path.startsWith(prefix)).map(r => ({ bytes: r.bytes, path: r.path.slice(prefix.length), sha256: r.sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); assert.ok(entries.length); return {relativeTo:'/'+prefix.slice(0,-1),algorithm:'sha256-json-array-bytes-path-sha256-codepoint-noLF/v1',files:entries.length,bytes:entries.reduce((sum,row)=>sum+row.bytes,0),entries,sha256:sha(Buffer.from(JSON.stringify(entries)))}; }; const entry = material.files.find(v => v.path === 'app/dist/onlinePrivateQualification.js'); assert.ok(entry); return { entrySha256: entry.sha256, schemaSha256: material.schemaSha256, dist: inv('app/dist/'), client: inv('app/node_modules/@prisma/client/') }; }
function installed(value, material) { const expected = expectedInstalled(material); assert.equal(value.format, 'sabalan-actual-installed-native-image/v1'); for (const k of ['entrySha256', 'schemaSha256', 'dist', 'client'])
    assert.deepEqual(value[k], expected[k]); assert.equal(value.entryExportPresent, true); for (const k of ['applicationStarted', 'databaseConnected', 'productionAdmission'])
    assert.equal(value[k], false); }
export function postUpStableContainers(containers) { const result = structuredClone(containers); for (const c of Object.values(result)) {
    if (c.State?.Health)
        delete c.State.Health.Log;
} return result; }
export function validatePostUpContainers(containers, failed) {
    assert.deepEqual(Object.keys(containers).sort(), postUpServices.slice().sort());
    for (const service of postUpServices) {
        const c = containers[service];
        assert.equal(c.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
        assert.equal(c.Config.Labels['com.docker.compose.service'], service);
        assert.equal(c.State.Running, true);
        assert.equal(c.State.Health.Status, 'healthy');
    }
    const protectedNow = Object.fromEntries(postUpServices.filter(s => !postUpSlots.includes(s)).map(s => [s, postUpIdentity(containers[s])]));
    assert.deepEqual(protectedNow, failed.protectedAfter);
    validateAuthorityCohortSlots(containers, failed.authorityCohort.nonce);
    validateNegativeAcceptanceSlots(containers, failed.acceptanceCohort.descriptor);
    if(isCapsulePostUpContext(contextForFailure(failed)))validateHistoricalCapsulePair(containers['backend-candidate'],containers['backend-retained']);
    for (const service of postUpSlots) {
        const c = containers[service];
        if(contextForFailure(failed) === capsulePostUpFailureContext || contextForFailure(failed) === resourcePostUpFailureContext) assert.deepEqual(postUpIdentity(c),Object.fromEntries(['id','image','startedAt'].map(k=>[k,failed.actual[service][k]])));
        assert.notEqual(c.Id, failed.previous[service].id);
        assert.equal(c.Image, service === 'backend-candidate' ? failed.immutableImage : 'sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186');
        assert.equal(c.HostConfig.Memory, service === 'backend-candidate' ? 2 * 1024 ** 3 : 768 * 1024 ** 2);
        const limits = (contextForFailure(failed)===resourcePostUpFailureContext?failed.candidateQaMemoryNegativeRecovery:failed.candidateQaMemoryProfile).runtimeLimitsBefore[service];
        for (const [k, v] of Object.entries(limits))
            assert.deepEqual(c.HostConfig[k], v);
        for (const m of c.Mounts)
            assert.ok(!failed.removedCodeTargets.includes(m.Destination));
    }
    return { identities: Object.fromEntries(postUpSlots.map(s => [s, postUpIdentity(containers[s])])), protectedEight: protectedNow };
}
export function validatePostUpMemorySamples(samples) { assert.ok(Array.isArray(samples) && samples.length >= 16 && samples.length <= 31); const final = samples.slice(-16); for (let i = 0; i < final.length; i++) {
    const s = final[i];
    assert.deepEqual(Object.keys(s).sort(), ['availableBytes', 'observedAt', 'platform']);
    assert.equal(s.platform, 'win32');
    assert.ok(Number.isSafeInteger(s.availableBytes) && s.availableBytes >= 2 * 1024 ** 3);
    assert.ok(Number.isFinite(Date.parse(s.observedAt)));
    if (i)
        assert.ok(Date.parse(s.observedAt) > Date.parse(final[i - 1].observedAt));
} assert.ok(Date.parse(final.at(-1).observedAt) - Date.parse(final[0].observedAt) >= 30000); return final.at(-1); }
const custodyIdentityKeys=['dev','ino','size','mtimeNs','ctimeNs','mode','nlink','uid','gid'];
function custodyIdentity(s){return Object.fromEntries(custodyIdentityKeys.map(k=>[k,s[k]]));}
function captureFullCustody(references){const seen=new Map();for(const ref of references){const file=path.resolve(ref.file);assert.equal(fs.realpathSync(file),file);assert.match(ref.sha256,/^[a-f0-9]{64}$/);const named=fs.lstatSync(file,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n);if(ref.bytes!==undefined)assert.equal(named.size,BigInt(ref.bytes));const fd=fs.openSync(file,fs.constants.O_RDONLY);let opened;try{opened=fs.fstatSync(fd,{bigint:true});assert.ok(opened.isFile()&&opened.nlink===1n);for(const key of ['ino','size','mtimeNs','mode','nlink'])assert.equal(opened[key],named[key]);assert.deepEqual(custodyIdentity(fs.lstatSync(file,{bigint:true})),custodyIdentity(named));}finally{fs.closeSync(fd);}const row={file,sha256:ref.sha256,bytes:Number(named.size),named:custodyIdentity(named),opened:custodyIdentity(opened)};if(seen.has(file))assert.deepEqual(seen.get(file),row);seen.set(file,row);}return Object.freeze([...seen.values()].map(deepFreeze));}
function verifyFullCustody(references,buffer,full=true){for(const ref of references){assert.equal(fs.realpathSync(ref.file),ref.file);const named=fs.lstatSync(ref.file,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n);assert.deepEqual(custodyIdentity(named),ref.named,'POST_UP_SOURCE_NAMED_IDENTITY_CHANGED');const fd=fs.openSync(ref.file,fs.constants.O_RDONLY);try{const opened=fs.fstatSync(fd,{bigint:true});assert.deepEqual(custodyIdentity(opened),ref.opened,'POST_UP_SOURCE_DESCRIPTOR_IDENTITY_CHANGED');if(full){const hash=createHash('sha256');let total=0;for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;total+=count;assert.ok(total<=ref.bytes);hash.update(buffer.subarray(0,count));}assert.equal(total,ref.bytes);assert.equal(hash.digest('hex'),ref.sha256,'POST_UP_SOURCE_FULL_HASH_CHANGED');}assert.deepEqual(custodyIdentity(fs.fstatSync(fd,{bigint:true})),ref.opened);assert.deepEqual(custodyIdentity(fs.lstatSync(ref.file,{bigint:true})),ref.named);assert.equal(fs.realpathSync(ref.file),ref.file);}finally{fs.closeSync(fd);}}}
let resourceOrigin=null,resourceDescriptor=null,resourceSmallInputs=null,resourceSmallCustody=null,resourceStreamCustody=null;
function resourceAcceptanceDescriptor(inputs){const f=readResourcePostUpFailure(inputs);if(!resourceOrigin){resourceOrigin=readNegativeRecoveryHandoff(f.negativeRecoveryHandoff);resourceDescriptor=deepFreeze(negativeRecoveryDescriptor(resourceOrigin));resourceSmallInputs=deepFreeze(negativeRecoveryInputs(resourceOrigin));const streams=negativeRecoveryStreamingInputs(resourceOrigin);assert.equal(Object.keys(streams).length,4);resourceSmallCustody=captureFullCustody(Object.entries(resourceSmallInputs).map(([file,sha256])=>({file,sha256})));resourceStreamCustody=captureFullCustody(Object.entries(streams).map(([file,ref])=>({file,...ref})));}return structuredClone(resourceDescriptor);}
function recheckResourceStatus(){const buffer=Buffer.alloc(262144);verifyFullCustody(resourceSmallCustody,buffer,true);verifyFullCustody(resourceStreamCustody,buffer,false);}

function resourceAcceptanceSelection(inputs){return negativeCapsuleAcceptanceSelection(path.dirname(path.dirname(resourcePostUpFailureContext.originalSource.file)),resourceAcceptanceDescriptor(inputs));}
function stableResourceAcceptance(v){const copy=structuredClone(v);delete copy.canonicalCapsules.inventoryChild.originalPid;return copy;}
export function postUpAcceptanceBootstrapForToken(token){postUpMemoryDescriptor(token);return postUpAcceptanceBootstrap(tokens.get(token).context);}
function capsuleAcceptanceSelection(inputs) {
 const root=path.dirname(path.dirname(capsulePostUpFailureContext.originalSource.file));
 for(const file of [...inertAcceptanceInputFiles(root),...historicalCapsuleInputFiles(root),path.join(root,'tests/online-deployment/historical-capsule-preflight.fixture.py')])postUpReadReference({file,sha256:sha(raw(file))},inputs);
 const file=path.join(root,'tests/online-deployment/inert-history-acceptance.fixture.py');return{source:{file,sha256:sha(raw(file))},spec:inertAcceptanceSpec(root),format:'sabalan-inert-owned-acceptance-history/v1'};
}
export function capsulePostUpAcceptanceSelection(inputs,context=capsulePostUpFailureContext){return structuredClone(context===resourcePostUpFailureContext?resourceAcceptanceSelection(inputs):capsuleAcceptanceSelection(inputs));}
export function postUpAcceptanceSelection(token){postUpMemoryDescriptor(token);const row=tokens.get(token);return structuredClone(row.context===resourcePostUpFailureContext?resourceAcceptanceSelection():isCapsulePostUpContext(row.context)?capsuleAcceptanceSelection():{source:{file:postUpFailureContext.acceptanceProbe.originalPath,sha256:postUpFailureContext.acceptanceProbe.sha256},spec:{nonce:postUpAcceptanceExpectation().nonce,expected:postUpAcceptanceExpectation().namespace},format:'sabalan-c16-empty-acceptance-namespace/v1'});}
export function validatePostUpAcceptanceResult(token,value){postUpMemoryDescriptor(token);const row=tokens.get(token);if(row.context===resourcePostUpFailureContext){validateNegativeCapsuleAcceptanceResult(resourceAcceptanceDescriptor(),value);assert.deepEqual(stableResourceAcceptance(value),stableResourceAcceptance(row.inertAcceptance));return value;}if(isCapsulePostUpContext(row.context)){const selection=capsuleAcceptanceSelection();validateInertAcceptanceResult(value,selection.spec,row.capsuleProof);assert.deepEqual(value,row.inertAcceptance);return value;}const expected=postUpAcceptanceExpectation();assert.deepEqual(value,{format:'sabalan-c16-empty-acceptance-namespace/v1',mode:'verify',nonce:expected.nonce,namespace:expected.namespace,empty:true,exclusivelyCreated:false,productionAdmission:false});return value;}
function validateCapsuleReadback(result){assert.equal(result.readOnly,true);assert.equal(result.capsulesVerified,2);for(const k of ['databaseExecuted','nativeActorStarted','productionAdmission'])assert.equal(result[k],false);assert.ok(Number.isSafeInteger(result.inventoryChild.originalPid)&&result.inventoryChild.originalPid>0);assert.equal(result.inventoryChild.code,0);assert.equal(result.inventoryChild.stdoutEof,true);assert.equal(result.inventoryChild.stderrEof,true);return result;}
function stableCapsuleReadback(value){const copy=structuredClone(value);delete copy.inventoryChild.originalPid;return copy;}
export function readPostUpMemoryBaseline(selection) {
    const inputs = new Map(), value = JSON.parse(postUpReadReference(selection, inputs)), context=postUpContextForBaseline(value), capsule=isCapsulePostUpContext(context), failed = readPostUpFailure(inputs,context);
    assert.deepEqual(Object.keys(value).sort(), ['format','classification','failed',(context===capsulePostUpFailureContext||context===resourcePostUpFailureContext)?'originalFailureOwnerObservation':'originalFailureClosure','qualificationSucceeded','productionAdmission','adoptsOriginalPopen','nativeCompletionClaimed','rotationPerformed','failedReportRemainsFailed','sourceCommit','observedAt','memorySamples','identities','protectedEight','components','observations','originalInventory','originalChildren','sourcePins'].sort());
    assert.equal(value.format, capsule?capsulePostUpBaselineFormat:postUpBaselineFormat);
    assert.equal(value.classification, context===resourcePostUpFailureContext?'POST_UP_RESOURCE_PROFILE_FAILURE_REOBSERVED':context===currentPostUpFailureContext?'POST_UP_CAPSULE_MEMORY_FAILURE_REOBSERVED':capsule?'POST_UP_CAPSULE_FAILURE_REOBSERVED':'POST_UP_MEMORY_FAILURE_REOBSERVED');
    assert.deepEqual(value.failed, context.failed);
    assert.deepEqual((context===capsulePostUpFailureContext||context===resourcePostUpFailureContext)?value.originalFailureOwnerObservation:value.originalFailureClosure, (context===capsulePostUpFailureContext||context===resourcePostUpFailureContext)?context.ownerObservation:context.closure);
    for (const k of ['qualificationSucceeded', 'productionAdmission', 'adoptsOriginalPopen', 'nativeCompletionClaimed', 'rotationPerformed'])
        assert.equal(value[k], false);
    assert.equal(value.failedReportRemainsFailed, true);
    assert.equal(value.originalChildren.allOriginalChildrenClosed, true);
    assert.equal(value.originalChildren.interrupted, false);
    assert.deepEqual(Object.keys(value.originalChildren).sort(),['allOriginalChildrenClosed','interrupted']);
    assert.equal(value.up, undefined);
    const lastMemory = validatePostUpMemorySamples(value.memorySamples);
    assert.ok(Number.isFinite(Date.parse(value.observedAt)));
    assert.ok(Date.parse(value.observedAt) >= Date.parse(lastMemory.observedAt) && Date.parse(value.observedAt) - Date.parse(lastMemory.observedAt) <= 30000);
    assert.match(value.sourceCommit, /^[a-f0-9]{40}$/);
    const inventory = JSON.parse(postUpReadReference(value.originalInventory, inputs));
    assert.equal(inventory.format, 'sabalan-post-up-memory-owned-readbacks/v1');
    assert.ok(inventory.children.length >= 15 && inventory.children.length <= 96);
    assert.deepEqual(inventory.children.map(x => x.ordinal), inventory.children.map((_, i) => i + 1));
    assert.equal(new Set(inventory.children.map(x => x.ref.file)).size, inventory.children.length);
    assert.deepEqual(Object.keys(inventory).sort(),['children','format']);for(const row of inventory.children)assert.deepEqual(Object.keys(row).sort(),['key','ordinal','ref']);assert.equal(new Set(inventory.children.map(row=>row.key)).size,inventory.children.length);const records = inventory.children.map(row => ({ key: row.key, ref: row.ref, ...child(row.ref, inputs) }));
    const read = name => { const rows = records.filter(x => x.key === name); assert.equal(rows.length, 1); assert.deepEqual(value.observations[name], rows[0].ref); return rows[0]; };
    const inspectArgv = ['docker', 'inspect', ...postUpServices.map(s => 'sabalanerp-local-' + s + '-1')];
    for (const name of ['inspectBefore', 'inspectAfter'])
        assert.deepEqual(read(name).record.argv, inspectArgv);
    const before = Object.fromEntries(read('inspectBefore').value().map(c => [c.Config.Labels['com.docker.compose.service'], c])), after = Object.fromEntries(read('inspectAfter').value().map(c => [c.Config.Labels['com.docker.compose.service'], c]));
    assert.deepEqual(postUpStableContainers(before), postUpStableContainers(after));
    const facts = validatePostUpContainers(before, failed);
    assert.deepEqual(value.identities, facts.identities);
    assert.deepEqual(value.protectedEight, facts.protectedEight);
    const materials = {};
    for (const role of ['candidate', 'retained']) {
        assert.deepEqual(value.components[role], { image: context[role === 'candidate' ? 'image' : 'retainedImage'], material: context[role === 'candidate' ? 'material' : 'retainedMaterial'] });
        const im = JSON.parse(postUpReadReference(value.components[role].image, inputs));
        const material = JSON.parse(postUpReadReference(value.components[role].material, inputs));
        assert.equal(im.pass, true);
        assert.equal(im.materialReceiptSha256, value.components[role].material.sha256);
        assert.equal(im.image.id, before['backend-' + role].Image);
        assert.equal(material.materialized, true);
        const imageRow = read('image-' + role);
        assert.deepEqual(imageRow.record.argv, ['docker', 'image', 'inspect', im.image.id]);
        const imageRows = imageRow.value();
        assert.equal(imageRows.length, 1);
        assert.equal(imageRows[0].Id, im.image.id);
        assert.deepEqual(imageRows[0].RootFS.Layers, im.image.layers);
        materials[role] = material;
    }
    assert.deepEqual(Object.keys(value.sourcePins).sort(), ['acceptanceProbe', 'authorityProbe', 'installedProbe', 'observer', 'reader',...(capsule?['capsuleProbe']:[]),...(context===resourcePostUpFailureContext?['currentCreator','currentSourceReuseHelper']:[])].sort());
    for (const k of ['installedProbe', 'authorityProbe', ...(capsule?[]:['acceptanceProbe'])])
        assert.equal(value.sourcePins[k].sha256, context[k].sha256);
    if(context===resourcePostUpFailureContext){const root=path.dirname(path.dirname(context.originalSource.file));for(const[k,relative]of [['currentCreator','scripts/replace-qualified-application-native-candidate-local.mjs'],['currentSourceReuseHelper','scripts/lib/application-native-operations-source-reuse.mjs']]){assert.equal(path.resolve(value.sourcePins[k].file),path.join(path.dirname(path.resolve(selection.file)),'evidence-source',k+'.mjs'));postUpReadReference(value.sourcePins[k],inputs);assert.equal(value.sourcePins[k].sha256,sha(raw(path.join(root,relative))));}}
    const acceptanceExpected = postUpAcceptanceExpectation(inputs);
    const acceptanceSelection=context===resourcePostUpFailureContext?resourceAcceptanceSelection(inputs):capsule?capsuleAcceptanceSelection(inputs):null,capsuleRoot=path.dirname(path.dirname(context.originalSource.file)),capsuleSpec=capsule?historicalCapsulePreflightSpec(capsuleRoot):null;
    if(capsule){assert.equal(value.sourcePins.acceptanceProbe.sha256,acceptanceSelection.source.sha256);assert.equal(value.sourcePins.capsuleProbe.sha256,sha(raw(path.join(capsuleRoot,'tests/online-deployment/historical-capsule-preflight.fixture.py'))));}
    const namespace = {};let inertAcceptance=null,capsuleProof=null;
    for (const role of ['candidate', 'retained']) {
        const service = 'backend-' + role, cid = before[service].Id;
        const quiet = read('quiet-' + role);
        assert.deepEqual(quiet.record.argv.slice(0, 6), ['docker', 'exec', cid, '/usr/bin/python3', '-I', '-B']);
        assert.equal(quiet.record.argv.length, 8);
        assert.equal(quiet.record.argv[6], '-c');
        assert.equal(sha(Buffer.from(quiet.record.argv[7])), context.nativeQuietProbeSha256);
        const n = quiet.value();
        assert.equal(n.originalNativeProcesses, 0);
        assert.equal(n.adoptsOriginalPopen, false);
        const ins = read('installed-' + role);
        assert.deepEqual(ins.record.argv, ['docker', 'exec', '-i', cid, 'node', '--input-type=module']);
        assert.equal(ins.record.inputSha256, value.sourcePins.installedProbe.sha256);
        installed(ins.value(), materials[role]);
        const a = read('authority-' + role);
        assert.deepEqual(a.record.argv, ['docker', 'exec', '-i', cid, '/usr/bin/python3', '-I', '-B', '-c', postUpAuthorityBootstrap()]);
        const payload = JSON.parse(Buffer.from(a.record.inputBase64, 'base64'));
        assert.equal(sha(Buffer.from(payload.source, 'base64')), context.authorityProbe.sha256);
        const writer = authorityWriterRoot(before[service], service);
        assert.deepEqual(payload.spec, { mode: 'verify', kind: writer.kind, nonce: failed.authorityCohort.nonce, root: writer.target, expected: failed.authorityCohort.verified[service].result.namespace, peerExpected: failed.authorityCohort.verified['backend-' + (role === 'candidate' ? 'retained' : 'candidate')].result.namespace });
        const av = a.value();
        assert.deepEqual(av, failed.authorityCohort.verified[service].result);
        assert.equal(av.nonce, failed.authorityCohort.nonce);
        assert.equal(av.mode, 'verify');
        namespace[service] = av.namespace;
        const accRow = read('acceptance-' + role);
        assert.deepEqual(accRow.record.argv, ['docker', 'exec', '-i', cid, '/usr/bin/python3', '-I', '-B', '-c', postUpAcceptanceBootstrap(context)]);
        const accPayload = JSON.parse(Buffer.from(accRow.record.inputBase64, 'base64'));
        assert.equal(sha(Buffer.from(accPayload.source, 'base64')), capsule?acceptanceSelection.source.sha256:context.acceptanceProbe.sha256);
        assert.deepEqual(accPayload.spec, capsule?acceptanceSelection.spec:{ nonce: acceptanceExpected.nonce, expected: acceptanceExpected.namespace });
        const acc = accRow.value();
        if(capsule){
          const probes=[];for(const stage of ['before','after']){const probe=read('capsule-'+stage+'-'+role);assert.deepEqual(probe.record.argv,['docker','exec','-i',cid,'/usr/bin/python3','-I','-B','-c',raw(path.join(capsuleRoot,'tests/online-deployment/historical-capsule-preflight.fixture.py')).toString('utf8')]);assert.deepEqual(JSON.parse(Buffer.from(probe.record.inputBase64,'base64')),capsuleSpec);probes.push(validateCapsuleReadback(probe.value()));}
          assert.deepEqual(stableCapsuleReadback(probes[0]),stableCapsuleReadback(probes[1]));if(context===resourcePostUpFailureContext){validateNegativeCapsuleAcceptanceResult(resourceAcceptanceDescriptor(),acc);if(inertAcceptance)assert.deepEqual(stableResourceAcceptance(acc),stableResourceAcceptance(inertAcceptance));}else{validateInertAcceptanceResult(acc,acceptanceSelection.spec,probes[0]);if(inertAcceptance)assert.deepEqual(acc,inertAcceptance);}inertAcceptance=acc;if(capsuleProof)assert.deepEqual(stableCapsuleReadback(capsuleProof),stableCapsuleReadback(probes[0]));capsuleProof=probes[0];
        }else{
        assert.deepEqual(acc,{format:'sabalan-c16-empty-acceptance-namespace/v1',mode:'verify',nonce:acceptanceExpected.nonce,namespace:acceptanceExpected.namespace,empty:true,exclusivelyCreated:false,productionAdmission:false});
        assert.equal(acc.empty, true);
        assert.equal(acc.exclusivelyCreated, false);
        assert.equal(acc.productionAdmission, false);
        assert.equal(acc.nonce, failed.acceptanceCohort.descriptor.subpath.slice('c16-recovery-'.length));
        }
    }
    for (const name of ['sqlBefore', 'sqlAfter']) {
        const row = read(name);
        assert.deepEqual(row.record.argv, ['docker', 'exec', before.postgres.Id, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', postUpSql]);
        const sql = row.value();
        assert.equal(sql.visible, true);
        assert.equal(sql.sessions, 0);
        assert.equal(sql.prepared, 0);
        assert.equal(sql.system, failed.sqlQuiet.system);
    }
    const required = [...(capsule?['owner-absence-before','owner-absence-after','capsule-before-candidate','capsule-after-candidate','capsule-before-retained','capsule-after-retained']:[]), 'inspectBefore', 'inspectAfter', 'image-candidate', 'image-retained', 'installed-candidate', 'installed-retained', 'quiet-candidate', 'quiet-retained', 'authority-candidate', 'authority-retained', 'acceptance-candidate', 'acceptance-retained', 'sqlBefore', 'sqlAfter'];
    assert.deepEqual(Object.keys(value.observations).sort(), required.sort());
    assert.equal(records.length, required.length * 2+2);assert.equal(records[0].key,'source-head');assert.equal(records.at(-1).key,'source-head-after');for(const r of [records[0],records.at(-1)]){assert.deepEqual(r.record.argv,['git','rev-parse','HEAD']);assert.equal(r.out.toString().trim(),value.sourceCommit);assert.equal(r.record.inputBase64,null);}
    for (let i = 1; i < records.length-1; i += 2) {
        assert.equal(records[i].key, 'ps-' + records[i + 1].key);
        assert.ok(required.includes(records[i + 1].key));
    }
    for (const record of records) {
        const a = record.record.argv;if(capsule&&record.key.startsWith('owner-absence-')){assert.deepEqual(a,capsuleOwnerAbsenceArgv());validateCapsuleOwnerAbsence(record.value());continue;}if(['source-head','source-head-after'].includes(record.key))continue;
        assert.equal(a[0], 'docker');
        assert.ok(record.key.startsWith('ps-') || Object.hasOwn(value.observations, record.key));
        if (record.key.startsWith('ps-')) {
            assert.deepEqual(a, ['docker', 'compose', '-f', context===resourcePostUpFailureContext?path.join(path.dirname(path.dirname(context.originalSource.file)),'docker-compose.local.yml'):'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json']);
            const rows = record.out.toString().trim().split(/\r?\n/).map(JSON.parse);
            assert.equal(rows.length, 10);
            assert.deepEqual(rows.map(r => r.Service).sort(), postUpServices.slice().sort());
            for (const r of rows) {
                assert.equal(r.Project, 'sabalanerp-local');
                assert.equal(r.State, 'running');
                assert.equal(r.Health, 'healthy');
            }
        }
    }
    for (const pin of Object.values(value.sourcePins))
        postUpReadReference(pin, inputs);
    assert.equal(value.sourcePins.reader.sha256, sha(raw(import.meta.filename)));postUpReadReference({file:import.meta.filename,sha256:value.sourcePins.reader.sha256},inputs);
    assert.equal(value.sourcePins.observer.sha256, context===resourcePostUpFailureContext?resourcePostUpObserverSha256:context===currentPostUpFailureContext?currentPostUpObserverSha256:capsule?capsulePostUpObserverSha256:postUpObserverSha256);
    const descriptor = { format: value.format, selection: structuredClone(selection), identities: facts.identities, protectedEight: facts.protectedEight, components: value.components, authorityCohort: { nonce: failed.authorityCohort.nonce, namespaces: namespace }, acceptance: failed.acceptanceCohort.descriptor, acceptanceOrigin: failed.acceptanceCohort.origin, failed: context.failed, memorySamples: value.memorySamples, qualificationSucceeded: false };
    const token = Object.freeze({});
    tokens.set(token, { inputs, value, descriptor,context,inertAcceptance,capsuleProof,fullCustody:captureFullCustody([...inputs].map(([file,pin])=>({file,sha256:pin.sha256}))) });
    return token;
}
export function postUpMemoryDescriptor(token) { const r = tokens.get(token); assert.ok(r, 'PRIVATE_POST_UP_BASELINE_REQUIRED');if(r.context===resourcePostUpFailureContext){resourceAcceptanceDescriptor();recheckResourceStatus();} for (const [file, pin] of r.inputs)
    assert.deepEqual(raw(file), pin.raw); postUpReadReference(r.context.failed); postUpReadReference(r.context.ownerObservation??r.context.closure); return structuredClone(r.descriptor); }
export function postUpMemoryInputs(token) { postUpMemoryDescriptor(token); return {...Object.fromEntries([...tokens.get(token).inputs].map(([f,p])=>[f,p.sha256])),...(tokens.get(token).context===resourcePostUpFailureContext?resourceSmallInputs:{})}; }
export function validatePostUpCurrentSlots(token, containers, now = Date.now()) { const d = postUpMemoryDescriptor(token), v = tokens.get(token).value; assert.ok(now - Date.parse(v.observedAt) >= 0 && now - Date.parse(v.observedAt) <= 600000, 'POST_UP_BASELINE_STALE'); const facts = validatePostUpContainers(containers, readPostUpFailure(undefined,tokens.get(token).context)); assert.deepEqual(facts.identities, d.identities); assert.deepEqual(facts.protectedEight, d.protectedEight); return { ...(isCapsulePostUpContext(tokens.get(token).context)?{currentAuthorityNamespacesVerified:false,currentInertAcceptanceVerified:false}:{}),format: 'sabalan-reobserved-post-up-negative-slots/v1', identities: facts.identities, previousIdentities: facts.identities, qualificationSucceeded: false, installedBytesVerified: false, nativeAndSqlQuietVerified: false, currentEmptyNamespacesVerified: false }; }
export function postUpAuthorityBootstrap() { return "import sys,json,base64,hashlib,io;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()==" + JSON.stringify(postUpFailureContext.authorityProbe.sha256) + ";sys.stdin=io.StringIO(json.dumps(p['spec']));exec(compile(s,'original-authority-cohort','exec'),globals())"; }
export function postUpAcceptanceBootstrap(context=postUpFailureContext) { if(context===resourcePostUpFailureContext)return negativeCapsuleAcceptanceBootstrap(resourceAcceptanceSelection().source.sha256); const capsule=isCapsulePostUpContext(context),selected=capsule?capsuleAcceptanceSelection().source.sha256:postUpFailureContext.acceptanceProbe.sha256;return "import base64,hashlib,io,json,sys;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()==" + JSON.stringify(selected) + ";sys.stdin="+(capsule?"io.TextIOWrapper(io.BytesIO(json.dumps(p['spec']).encode()))":"io.StringIO(json.dumps(p['spec']))")+";exec(compile(s,'source-owned-negative-acceptance','exec'),{'__name__':'__main__'})"; }
/** This validates the NEW ordinary COMPLETE rotation, never promotes the failed owner. */
export function validatePostUpCreatedReceipt(token, receipt) {
    const d = postUpMemoryDescriptor(token), p = receipt.candidateQaMemoryPostUpRecovery;
    assert.equal(receipt.format, 'sabalan-application-native-candidate/v1');
    assert.equal(receipt.phase, 'COMPLETE');
    assert.equal(receipt.pass, true);
    assert.equal(receipt.productionAdmission, false);
    assert.equal(receipt.up.code, 0);
    assert.equal(receipt.up.signal, null);
    assert.equal(receipt.up.failure, undefined);
    assert.equal(receipt.originalChildren.allOriginalChildrenClosed, true);
    assert.equal(receipt.originalChildren.interrupted, false);
    assert.deepEqual(p.baseline, d.selection);
    assert.deepEqual(receipt.postUpMemoryBaseline, d.selection);
    assert.equal(p.failedReportRemainsFailed, true);
    assert.equal(p.originalUpAdopted, false);
    assert.deepEqual(receipt.previous, d.identities);
    assert.deepEqual(receipt.protectedBefore, d.protectedEight);
    assert.deepEqual(receipt.protectedAfter, d.protectedEight);
    assert.deepEqual(receipt.finalProtected, d.protectedEight);
    const b = receipt.reobservedBaseline;
    assert.equal(b.format, 'sabalan-reobserved-post-up-negative-slots/v1');
    assert.equal(b.qualificationSucceeded, false);
    assert.deepEqual(b.identities, d.identities);
    assert.deepEqual(b.previousIdentities, d.identities);
    for (const k of ['installedBytesVerified', 'nativeAndSqlQuietVerified'])assert.equal(b[k],true);
    if(isCapsulePostUpContext(tokens.get(token).context)){assert.equal(b.currentEmptyNamespacesVerified,false);assert.equal(b.currentAuthorityNamespacesVerified,true);assert.equal(b.currentInertAcceptanceVerified,true);}else assert.equal(b.currentEmptyNamespacesVerified,true);
    for (const service of postUpSlots) {
        assert.notEqual(receipt.actual[service].id, d.identities[service].id);
        assert.equal(receipt.reobservedInstalled[service].code, 0);
        assert.equal(receipt.reobservedInstalled[service].signal, null);
        assert.equal(receipt.reobservedNativeQuiet[service].originalNativeProcesses, 0);
        assert.equal(receipt.reobservedNativeQuiet[service].adoptsOriginalPopen, false);
        const a = receipt.postUpBaselineAuthorityVerified[service];
        assert.equal(a.code, 0);
        assert.equal(a.signal, null);
        assert.equal(a.failure, undefined);
        assert.deepEqual(a.result.namespace, d.authorityCohort.namespaces[service]);
        const v = receipt.postUpBaselineAcceptanceVerified[service];
        if(isCapsulePostUpContext(tokens.get(token).context)){assert.ok(Number.isSafeInteger(v.originalPid)&&v.originalPid>0);assert.equal(v.stdoutEof,true);assert.equal(v.stderrEof,true);}
        assert.equal(v.code, 0);assert.equal(typeof v.code,'number');
        assert.equal(v.signal, null);
        assert.equal(v.failure, undefined);
        validatePostUpAcceptanceResult(token,v.result);
        assert.equal(v.result.productionAdmission, false);
        assert.deepEqual(p.runtimeLimitsBefore[service], (tokens.get(token).context===resourcePostUpFailureContext?readPostUpFailure(undefined,tokens.get(token).context).candidateQaMemoryNegativeRecovery:readPostUpFailure(undefined,tokens.get(token).context).candidateQaMemoryProfile).runtimeLimitsBefore[service]);
    }
    assert.equal(receipt.reobservedSqlQuiet.visible, true);
    assert.equal(receipt.reobservedSqlQuiet.sessions, 0);
    assert.equal(receipt.reobservedSqlQuiet.prepared, 0);
    assert.equal(receipt.reobservedSqlQuiet.system, readPostUpFailure(undefined,tokens.get(token).context).sqlQuiet.system);
    return receipt;
}

/** Full actual bytes at mutation/final boundaries; never accepts cached SHA/stat alone. */
export function recheckPostUpMemoryFullCustody(token){const r=tokens.get(token);assert.ok(r,'PRIVATE_POST_UP_BASELINE_REQUIRED');const buffer=Buffer.alloc(262144);verifyFullCustody(r.fullCustody,buffer,true);if(r.context===resourcePostUpFailureContext){verifyFullCustody(resourceSmallCustody,buffer,true);verifyFullCustody(resourceStreamCustody,buffer,true);}return true;}
