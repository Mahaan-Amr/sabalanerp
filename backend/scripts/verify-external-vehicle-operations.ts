import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';
import { FEATURES } from '../src/middleware/feature';
assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Existing sabalanerp-local only');
const db = new PrismaClient(); const key = randomUUID(); const users: string[] = [], drivers: string[] = [], vehicles: string[] = [];
let checks = 0;
const call = async (token: string, path: string, method = 'GET', data?: unknown, status = 200, base = '/dispatch-master-data') => {
 const r = await fetch('http://127.0.0.1:5000/api' + base + path, {method, headers: {'content-type':'application/json',cookie: SESSION_COOKIE+'='+encodeURIComponent(token)}, ...(data ? {body:JSON.stringify(data)}:{})});
 const body: any = await r.json(); assert.equal(r.status, status, `${path}: ${JSON.stringify(body)}`); checks++; return body;
};
const main = async () => {
 const a = await db.user.create({data:{email:`ext-${key}@example.invalid`,username:`ext-${key}`,password:'unused-fixture',firstName:'آزمون',lastName:'بیرونی',role:'USER'}}); users.push(a.id);
 await db.hrWorkspaceAccessGrant.create({data:{userId:a.id,stableKey:key+'-workspace',workspaceCode:'HUMAN_RESOURCES',level:'EDIT',effectiveFrom:new Date(Date.now()-86400000)}});
 for (const feature of [FEATURES.HR_VEHICLE_OPERATIONS_VIEW, FEATURES.HR_DRIVER_PROFILES_MANAGE, FEATURES.HR_COMPANY_VEHICLES_MANAGE, FEATURES.HR_VEHICLE_PLATES_MANAGE, FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE, FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE, FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE])
   { await db.hrFeatureCatalog.upsert({where:{code:feature},update:{},create:{code:feature,workspaceCode:'HUMAN_RESOURCES',displayName:feature}});
     await db.hrFeatureAccessGrant.create({data:{userId:a.id,stableKey:key+'-'+feature,featureCode:feature,level:'EDIT',effectiveFrom:new Date(Date.now()-86400000)}});
     await db.featurePermission.create({data:{userId:a.id,workspace:'hr',feature,permissionLevel:'edit'}}); }
 const token = (await createAuthoritativeSession(db,a.id,{userAgent:'external-local-verifier'})).token;
 const peopleBefore = await db.personnel.count();
 const identity={firstName:'راننده',lastName:key,nationalCode:key,phone:'09121111111'};
 const created = await call(token,'/external-drivers','POST',identity,201); drivers.push(created.data.id); const driver=created.data.id;
 assert.equal(created.data.status,'DRAFT');
 const invalid = await call(token,`/external-drivers/${driver}/status`,'POST',{status:'ACTIVE'},400); assert.match(invalid.error,/گواهینامه/);
 await call(token,`/external-drivers/${driver}`,'PUT',{...identity,licenceNumber:key,licenceClass:'پایه یک',licenceExpiresAt:'2030-01-01'});
 await call(token,`/external-drivers/${driver}/status`,'POST',{status:'ACTIVE'});
 const vdata={vehicleType:'کامیون',manufactureYear:1400,registrationReference:key,notes:'آزمون محلی'};
 for (let index=0;index<2;index++) {
   const v=await call(token,'/external-vehicles','POST',{...vdata,plate:`${randomInt(10,99)} ب ${randomInt(100,999)} ایران ${randomInt(10,99)}`},201); vehicles.push(v.data.id);
   await call(token,`/external-vehicles/${v.data.id}/status`,'POST',{status:'ACTIVE'});
 }
 const payload={driverId:driver,vehicleId:vehicles[0]};
 const preview=await call(token,'/external/driver-vehicle-assignments/preview','POST',payload); assert.deepEqual(preview.data.current,[]);
 const assigned=await call(token,'/external/driver-vehicle-assignments','POST',{...payload,confirmed:true,expectedAssignmentIds:[]},201);
 const repeat=await call(token,'/external/driver-vehicle-assignments','POST',payload); assert.equal(repeat.unchanged,true);
 const p=await call(token,'/external/driver-vehicle-assignments/preview','POST',{...payload,vehicleId:vehicles[1]});
 const transferred=await call(token,'/external/driver-vehicle-assignments','POST',{...payload,vehicleId:vehicles[1],confirmed:true,expectedAssignmentIds:p.data.current.map((a:any)=>a.id)},201);
 await call(token,`/external/driver-vehicle-assignments/${transferred.data.id}/end`,'POST',{confirmed:true,cancelPlanIds:[]});
 const dossier=await call(token,`/external-drivers/${driver}/eligibility`); assert.equal(dossier.data.identity.id,driver); assert.equal(dossier.data.identity.externalLinks,undefined); assert.equal(dossier.data.activeBiometricEnrollment,null); assert.equal(dossier.capabilities.canManageBiometricEnrollment,true);
 await call(token,`/external-drivers/${driver}/status`,'POST',{status:'RESTRICTED'});
 await call(token,`/external-drivers/${driver}/status`,'POST',{status:'ACTIVE'});
 const deniedFeature=FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE;
 await db.featurePermission.update({where:{userId_workspace_feature:{userId:a.id,workspace:'hr',feature:deniedFeature}},data:{permissionLevel:'none'}});
 await call(token,`/external-drivers/${driver}/enrollment-commands`,'POST',{},403,'/dispatch-confirmation');
 await call(token,`/internal-drivers/unused-person/enrollment-commands`,'POST',{},403,'/dispatch-confirmation');
 await db.featurePermission.update({where:{userId_workspace_feature:{userId:a.id,workspace:'hr',feature:FEATURES.HR_COMPANY_VEHICLES_MANAGE}},data:{permissionLevel:'none'}});
 await call(token,'/external-vehicles','POST',vdata,403); await call(token,'/company-vehicles','POST',vdata,403);
 const beforeNoPermission=await db.externalVehicle.findUniqueOrThrow({where:{id:vehicles[0]}});
 await call(token,`/external-vehicles/${vehicles[0]}`,'PUT',vdata,403); assert.deepEqual(await db.externalVehicle.findUniqueOrThrow({where:{id:vehicles[0]}}),beforeNoPermission);
 await call(token,`/external-drivers/${driver}/status`,'POST',{status:'ARCHIVED',confirmed:true,cancelPlanIds:[]});
 await call(token,`/external-drivers/${driver}/status`,'POST',{status:'DRAFT'});
 const registry=await call(token,'/external-registry?archived=include'); assert.ok(registry.data.drivers.some((d:any)=>d.id===driver));
 assert.equal(await db.personnel.count(),peopleBefore); checks++;
 console.log(`PASS: ${checks} local API checks; CRUD, draft readiness, assignment/transfer/end, shared permissions, biometric permission parity, restoration, no Personnel creation.`);
};
main().finally(async()=>{try{
 await db.dispatchMasterDataAudit.deleteMany({where:{subjectId:{in:[...drivers,...vehicles]}}});
 await db.externalDriverVehicleAssignmentPlan.deleteMany({where:{driverId:{in:drivers}}});
 await db.externalDriverVehicleAssignment.deleteMany({where:{driverId:{in:drivers}}});
 await db.externalDriverDocument.deleteMany({where:{driverId:{in:drivers}}}); await db.externalDriver.deleteMany({where:{id:{in:drivers}}});
 await db.externalVehicleDocument.deleteMany({where:{vehicleId:{in:vehicles}}}); await db.externalVehiclePlate.deleteMany({where:{vehicleId:{in:vehicles}}}); await db.externalVehicle.deleteMany({where:{id:{in:vehicles}}});
 await db.authSession.deleteMany({where:{userId:{in:users}}}); await db.recognizedBrowserProfile.deleteMany({where:{userId:{in:users}}});
 await db.hrFeatureAccessGrant.deleteMany({where:{userId:{in:users}}}); await db.hrWorkspaceAccessGrant.deleteMany({where:{userId:{in:users}}});
 await db.featurePermission.deleteMany({where:{userId:{in:users}}}); await db.workspacePermission.deleteMany({where:{userId:{in:users}}}); await db.user.deleteMany({where:{id:{in:users}}});
}finally{await db.$disconnect();}}).catch(e=>{console.error(e);process.exitCode=1;});
