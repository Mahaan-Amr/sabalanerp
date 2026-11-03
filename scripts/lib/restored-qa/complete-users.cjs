/** Owned authentication probes on private restored B. Original users,
 * credential bytes, relationships and permissions are compared unchanged.
 * Temporary probe/session rows await the strict worker's real B retirement. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const states=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const encode=v=>Buffer.from(JSON.stringify(v)+'\n');
const stamp=s=>['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
const {isDeepStrictEqual}=require('node:util');
function assertOriginalUserCensus(actual,expected){assert.ok(isDeepStrictEqual(actual,expected),'ORIGINAL_COMPLETE_USER_CENSUS_CHANGED');}
async function prepareOriginalCompleteUsers({scope,layoutRoot,assertActive}){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assertActive();
 const{assertRestoredQaPrivateNormal}=require('/app/dist/services/restoredQaMigrationBaseline.js');
 const{withSystemRecoveryDatabaseClient}=require('/app/dist/services/systemRecoveryEngine.js');
 const{createAuthoritativeSession}=require('/app/dist/services/identitySessionService.js');
 const normal=assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner),file=path.join(layoutRoot,'browser-input.json');assert.equal(fs.realpathSync(layoutRoot),layoutRoot);
 const state=await withSystemRecoveryDatabaseClient(normal.database.name,async db=>{
  const[identity]=await db.$queryRawUnsafe('SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"');assert.deepEqual(identity,normal.database);
  const original=await db.user.findMany({orderBy:{id:'asc'}}),ids=original.map(v=>v.id);assert.ok(ids.length>0&&ids.length<=100000);const originalIds=new Set(ids);
  const snapshot=async()=>({users:await db.user.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),workspace:await db.workspacePermission.findMany({where:{userId:{in:ids}},orderBy:{id:'asc'}}),features:await db.featurePermission.findMany({where:{userId:{in:ids}},orderBy:{id:'asc'}}),roleWorkspace:await db.roleWorkspacePermission.findMany({orderBy:{id:'asc'}}),roleFeatures:await db.roleFeaturePermission.findMany({orderBy:{id:'asc'}})});
  const before=await snapshot(),admin=original.find(v=>v.role==='ADMIN'&&v.isActive&&!v.erasedAt&&!v.mustChangePassword&&!v.username.startsWith('qa-'));assert.ok(admin,'RESTORED_ORIGINAL_ADMIN_CASE_MISSING');
  const customer=await db.customer.findFirst({where:{isActive:true},select:{id:true},orderBy:{id:'asc'}});assert.ok(customer,'RESTORED_ORIGINAL_BUSINESS_CASE_MISSING');
  const nonce=randomBytes(16).toString('hex'),password=randomBytes(32).toString('base64url'),bcrypt=require('/app/node_modules/bcryptjs');
  const probe=await db.user.create({data:{username:'qa-complete-'+nonce,email:nonce+'@isolated.invalid',password:await bcrypt.hash(password,12),firstName:'Private',lastName:'Complete',role:'USER',mustChangePassword:false}});assert.ok(!originalIds.has(probe.id));
  const adminSession=await createAuthoritativeSession(db,admin.id,{ipAddress:'127.0.0.1',userAgent:'Owned private COMPLETE source acceptance'}),deniedSession=await createAuthoritativeSession(db,probe.id,{ipAddress:'127.0.0.1',userAgent:'Owned private COMPLETE negative authorization'});
  const input={format:'sabalan-original-complete-browser-private-input/v1',database:normal.database,originalAdminId:admin.id,adminToken:adminSession.token,deniedId:probe.id,deniedToken:deniedSession.token,passwordProbe:{id:probe.id,username:probe.username,password},businessCustomerId:customer.id};
  const raw=encode(input),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.ok(fs.readFileSync(file).equals(raw));return{ids,before,privateFile:stamp(fs.lstatSync(file,{bigint:true})),raw,probeId:probe.id,adminId:admin.id,sessionIds:[adminSession.session.id,deniedSession.session.id],profileIds:[adminSession.browserProfile.id,deniedSession.browserProfile.id]};
 });
 assertActive();let closed=false,closing;const owner=Object.freeze({closeAfterReaders(){return closing??=(async()=>{assert.equal(closed,false);assertActive();assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);assert.equal(stamp(fs.lstatSync(file,{bigint:true})),state.privateFile);assert.ok(fs.readFileSync(file).equals(state.raw));
  const result=await withSystemRecoveryDatabaseClient(normal.database.name,async db=>{const after={users:await db.user.findMany({where:{id:{in:state.ids}},orderBy:{id:'asc'}}),workspace:await db.workspacePermission.findMany({where:{userId:{in:state.ids}},orderBy:{id:'asc'}}),features:await db.featurePermission.findMany({where:{userId:{in:state.ids}},orderBy:{id:'asc'}}),roleWorkspace:await db.roleWorkspacePermission.findMany({orderBy:{id:'asc'}}),roleFeatures:await db.roleFeaturePermission.findMany({orderBy:{id:'asc'}})};assertOriginalUserCensus(after,state.before);const probe=await db.user.findUniqueOrThrow({where:{id:state.probeId}});assert.equal(probe.role,'USER');return{format:'sabalan-original-complete-users-observation/v1',database:normal.database,originalUsers:state.ids.length,originalCredentialAndPermissionCensusSha256:sha(encode(state.before)),originalUsersAndCredentialsUnchanged:true,originalRelationshipsAndPermissionsUnchanged:true,privateProbeUserId:state.probeId,ownedSessionCount:state.sessionIds.length,outerDatabaseRetirementPending:true,productionAdmission:false};});
  assertActive();assert.equal(stamp(fs.lstatSync(file,{bigint:true})),state.privateFile);assert.ok(fs.readFileSync(file).equals(state.raw));fs.unlinkSync(file);const fd=fs.openSync(layoutRoot,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}state.raw.fill(0);closed=true;return Object.freeze(result);
 })();}});states.set(owner,state);return owner;
}
module.exports={prepareOriginalCompleteUsers,assertOriginalUserCensus};
