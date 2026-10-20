import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
const hash=(raw:string|Uint8Array)=>createHash('sha256').update(raw).digest('hex');
function files(root:string){assert.equal(path.resolve(root),root);assert.equal(fs.realpathSync(root),root);return fs.readdirSync(root).sort().map(name=>{const file=path.join(root,name),st=fs.lstatSync(file);assert.ok(st.isFile()&&st.nlink===1&&!st.isSymbolicLink());return{name,bytes:st.size,sha256:hash(fs.readFileSync(file))};});}
/** Execute only in a genuinely granted isolated installed runtime whose DB
 * independently retains production's absent/disabled phase. This helper never
 * disables diagnostic history, creates grants, or enables a future feature. */
export async function qualifyInstalledDisabledPerformanceProfile({db,base,sessionToken,actorId,exportRoot}:{db:PrismaClient;base:string;sessionToken:string;actorId:string;exportRoot:string}){
 const [database]=await db.$queryRaw<Array<{name:string;now:Date}>>`SELECT current_database()::text AS name,clock_timestamp() AS now`;
 assert.match(database.name,/^qa_application_(?:native|restored)_[a-f0-9]{32}$/);
 const phase=await db.performanceFeaturePhaseVersion.findFirst({where:{effectiveFrom:{lte:database.now}},orderBy:[{effectiveFrom:'desc'},{version:'desc'}]});assert.equal(phase,null,'must exercise actual absent production phase, never rewrite diagnostic enabled history');
 const pauses=await db.performanceSafetyPause.findMany({where:{status:'ACTIVE'},orderBy:{id:'asc'}});assert.deepEqual(pauses,[]);
 const actor=await db.user.findUniqueOrThrow({where:{id:actorId}});assert.equal(actor.role,'USER');
 const catalog=await db.hrFeatureCatalog.findUniqueOrThrow({where:{code:'REQUEST_PERFORMANCE_EXPORT'}});assert.equal(catalog.isActive,false,'preserve actual retired catalog; never enable an old feature to force a gate response');
 const permissions=await db.hrFeatureAccessGrant.count({where:{userId:actorId,featureCode:'REQUEST_PERFORMANCE_EXPORT'}});assert.equal(permissions,0,'ordinary fixture actor must not revive a legacy grant');
 const cookie='sabalan_session='+sessionToken,me=await fetch(base+'/api/auth/me',{headers:{cookie},redirect:'error'});assert.equal(me.status,200);assert.equal(((await me.json())as any).data.id,actorId);
 const count=await db.performanceExportReceipt.count(),phaseCount=await db.performanceFeaturePhaseVersion.count(),before=files(exportRoot);
 const response=await fetch(base+'/api/hr/personnel-performance/exports',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({exportKind:'XLSX',reportKind:'AGGREGATE',purpose:'Actual installed production-disabled profile refusal'}),redirect:'error'});const result=await response.json()as any;assert.equal(response.status,403);assert.equal(result.success,false);assert.match(result.trackingId,/^HR-AUTH-/);assert.equal(await db.performanceExportReceipt.count(),count);assert.deepEqual(files(exportRoot),before);assert.equal(await db.performanceFeaturePhaseVersion.count(),phaseCount);assert.equal(await db.performanceSafetyPause.count({where:{status:'ACTIVE'}}),0);assert.deepEqual(await db.hrFeatureCatalog.findUniqueOrThrow({where:{code:catalog.code}}),catalog);
 return{format:'sabalan-installed-disabled-performance-profile/v1',httpStatus:403,reason:'RETIRED_ACTION_AUTHORIZATION_REFUSED',actualInstalledAuthorization:true,releaseGateReached:false,legacyCatalogActive:false,exportRowsMinted:0,liveArtifactChanges:0,releasePhaseCreated:false,futureEnabledExportsQualified:false,enabledWriterQualified:false,filesSha256:hash(JSON.stringify(before)),productionAdmission:false};
}
