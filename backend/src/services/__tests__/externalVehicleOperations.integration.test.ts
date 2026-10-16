import { processDueHrAssignmentPlans } from "../hrVehicleAssignmentWorker";
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, ExternalVehicle } from '@prisma/client';
import { externalAssignmentScope, assignHrVehicle, previewHrAssignment, endHrAssignment, executeHrAssignmentPlan, cancelHrAssignmentPlans, lockHrVehicleOperations, HrVehicleError } from '../hrVehicleOperations';
import { externalOperationalReadiness } from '../externalVehicleOperations';
import { admitGuardDriverQueueTurn, isGuardQueueTurnCurrentlyReady, makeGuardQueueTurnAvailable, listGuardQueueAdmissionOptions } from '../guardDriverQueue';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { ProtectedTemplateVault, ProtectedTemplateEnvelope } from '../biometricTemplateVault';
import { DeterministicBiometricSimulator } from '../biometricSimulator';
import { PhysicalGateExitService } from '../physicalGateExit';

if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) throw new Error('Only existing sabalanerp-local may run this rollback harness.');
const prisma = new PrismaClient();
test.after(async () => prisma.$disconnect());
const rollback = new Error('rollback external operations fixture');
const fixture = async (work: (f: any) => Promise<void>, commit = false) => {
  try { await prisma.$transaction(async raw => {
    const tx = externalAssignmentScope(raw); await lockHrVehicleOperations(tx);
    const key = randomUUID(); const now = new Date(); const before = new Date(now.getTime() - 60_000);
    const expires = new Date(now.getTime() + 365 * 86400000);
    const actor = await tx.user.create({ data: { email: `external-${key}@example.invalid`, username: `external-${key}`, password: 'not-a-login', firstName: 'آزمون', lastName: key, role: 'ADMIN' } });
    const peopleBefore = await tx.personnel.count();
    const driver = await tx.externalDriver.create({ data: { firstName: 'راننده', lastName: 'بیرونی', nationalCode: key, phone: '09121111111', status: 'ACTIVE', licenceNumber: key, licenceClass: 'پایه یک', licenceExpiresAt: expires, createdBy: actor.id } });
    await tx.externalDriverDocument.create({ data: { driverId: driver.id, documentType: 'DRIVING_LICENCE', reference: key, expiresAt: expires, recordedBy: actor.id } });
    const vehicles: ExternalVehicle[] = [];
    for (const index of [0, 1]) {
      const v = await tx.externalVehicle.create({ data: { vehicleType: 'کامیون', status: 'ACTIVE', createdBy: actor.id } });
      await tx.externalVehiclePlate.create({ data: { vehicleId: v.id, plate: `آزمون ${key}-${index}`, normalizedPlate: key + index, effectiveFrom: before, reason: 'fixture', recordedBy: actor.id } });
      await tx.externalVehicleDocument.create({ data: { vehicleId: v.id, documentType: 'VEHICLE_REGISTRATION', reference: key, recordedBy: actor.id } }); vehicles.push(v);
    }
    // Reuse one real transaction; all fixtures, evidence and side effects roll back.
    const client = new Proxy(raw, { get(target, prop) { if (prop === '$transaction') return async (run: any) => run(raw); return Reflect.get(target, prop); }, has(target, prop) { return prop === '$transaction' || Reflect.has(target, prop); } }) as unknown as PrismaClient;
    const vault = new ProtectedTemplateVault({ activeKeyId: 'test', keys: { test: Buffer.alloc(32, 7) } });
    const messages: any[] = [];
    const service = new DispatchConfirmationService(client, { vault, connector: new DeterministicBiometricSimulator(), otpSecret: 'external-local-test-secret', sendOtp: async m => { messages.push(m); } });
    const templates = () => ['RIGHT_INDEX', 'LEFT_INDEX'].map(finger => ({ finger, format: 'ISO-19794-2', material: Buffer.from('test-template-' + finger), image: { material: Buffer.from([137,80,78,71,13,10,26,10,1]), mimeType: 'image/png' as const, width: 2, height: 2 }, deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' as const }));
    const enroll = () => service.enrollInternalDriver({ personnelId: `external:${driver.id}`, confirmationPhone: '09123333333', templates: templates(), actorId: actor.id });
    const assign = () => assignHrVehicle(tx, { driverId: driver.id, vehicleId: vehicles[0].id, confirmed: true, expectedAssignmentIds: [] }, actor.id, now);
    const admit = () => admitGuardDriverQueueTurn(client, { source: 'EXTERNAL', driverId: driver.id, vehicleId: vehicles[0].id, actorId: actor.id });
    const waybill = async () => {
      const turn = await admit();
      const customer = await tx.crmCustomer.create({ data: { companyName: key, firstName: 'آزمون', lastName: key } });
      const project = await tx.projectAddress.create({ data: { customerId: customer.id, address: 'نشانی آزمون' } });
      const loading = await tx.logisticsLoading.create({ data: { loadingNumber: key, customerId: customer.id, projectId: project.id, createdBy: actor.id, status: 'FINALIZED' } });
      await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: { status: 'LOADING_FINALIZED', loadingId: loading.id } });
      const batch = await tx.logisticsAllocationBatch.create({ data: { loadingId: loading.id, idempotencyKey: key, finalizedBy: actor.id } });
      const revision = await tx.logisticsAllocationRevision.create({ data: { batchId: batch.id, loadingId: loading.id, queueTurnId: turn.id, revisionNumber: 1, snapshot: {}, integrityHash: key + '-revision', finalizedBy: actor.id, sealedAt: now } });
      const candidate = await tx.accountingDispatchCandidate.create({ data: { allocationRevisionId: revision.id, status: 'ACCEPTED' } });
      const bill = await tx.accountingDispatchWaybill.create({ data: { candidateId: candidate.id, snapshot: {}, integrityHash: key + '-bill', issuedBy: actor.id } });
      return { turn, bill };
    };
    await work({ tx, raw, client, driver, vehicles, actor, now, before, key, expires, service, vault, messages, enroll, assign, admit, waybill });
    assert.equal(await tx.personnel.count(), peopleBefore, 'external operations never create Personnel');
    if (!commit) throw rollback;
  }, { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (e) { if (e !== rollback) throw e; }
};

test('external two-finger enrollment has direct identity, protected images, duplicate prevention and deactivation', () => fixture(async f => {
  const enrolled = await f.enroll();
  assert.equal(enrolled.personnelId, null); assert.equal(enrolled.externalDriverId, f.driver.id);
  assert.equal(enrolled.templates.length, 2);
  await assert.rejects(f.enroll, /قبلاً/);
  const image = await f.service.readEnrollmentImage({ enrollmentId: enrolled.id, finger: 'RIGHT_INDEX', actorId: f.actor.id }); assert.equal(image.image.length, 9); image.image.fill(0);
  const t = await f.tx.driverBiometricTemplate.findFirstOrThrow({ where: { enrollmentId: enrolled.id } });
  assert.throws(() => f.vault.open(t.protectedEnvelope as ProtectedTemplateEnvelope, { personnelId: f.driver.id, finger: t.finger, format: t.format }), 'un-namespaced identity cannot decrypt');
  await f.service.deactivateEnrollment({ enrollmentId: enrolled.id, actorId: f.actor.id, reason: 'automatic test action' });
  assert.equal((await f.enroll()).status, 'ACTIVE');
}));

test('external shared engine transfers, repeats without duplicates, ends and audits both identities', () => fixture(async f => {
  const first = await f.assign();
  assert.equal((await f.assign()).unchanged, true);
  const next = new Date(f.now.getTime() + 2);
  const second = await assignHrVehicle(f.tx, { driverId: f.driver.id, vehicleId: f.vehicles[1].id, expectedAssignmentIds: [first.data.id], confirmed: true }, f.actor.id, next);
  const old = await f.tx.externalDriverVehicleAssignment.findUniqueOrThrow({ where: { id: first.data.id } }); assert.equal(old.effectiveTo.getTime(), second.data.effectiveFrom.getTime());
  await endHrAssignment(f.tx, second.data.id, f.actor.id, [], new Date(next.getTime() + 2));
  assert.equal(await f.tx.externalDriverVehicleAssignment.count({ where: { driverId: f.driver.id, effectiveTo: null } }), 0);
  const audits = await f.tx.dispatchMasterDataAudit.findMany({ where: { subjectId: { in: [f.driver.id, ...f.vehicles.map((v: any) => v.id)] } } });
  assert.ok(audits.some((a: any) => a.subjectType === 'EXTERNAL_DRIVER')); assert.ok(audits.some((a: any) => a.subjectType === 'EXTERNAL_VEHICLE'));
  assert.ok(audits.every((a: any) => a.ownerScope === 'GUARD'));
}));

test('external plans share forecast, execution, independent end and explicit cancellation rules', () => fixture(async f => {
  const initial = await f.assign();
  const from = new Date(f.now.getTime() + 3600000);
  const planned = await assignHrVehicle(f.tx, { driverId: f.driver.id, vehicleId: f.vehicles[1].id, effectiveFrom: from.toISOString(), effectiveTo: new Date(from.getTime() + 3600000).toISOString(), expectedAssignmentIds: [initial.data.id], confirmed: true }, f.actor.id, f.now);
  assert.equal(planned.planned, true);
  const applied = await executeHrAssignmentPlan(f.tx, planned.data.id, f.actor.id, false, { expectedAssignmentIds: [initial.data.id], cancelPlanIds: [] }, from);
  assert.equal(applied.status, 'APPLIED'); assert.ok(applied.assignmentId); const assignmentId = applied.assignmentId;
  const end = await f.tx.externalDriverVehicleAssignmentPlan.findFirstOrThrow({ where: { assignmentId: applied.assignmentId, action: 'END', status: 'PLANNED' } });
  await assert.rejects(() => endHrAssignment(f.tx, assignmentId, f.actor.id, [], new Date(from.getTime() + 5)), /پایان برنامه/);
  await endHrAssignment(f.tx, assignmentId, f.actor.id, [end.id], new Date(from.getTime() + 5));
  assert.equal((await f.tx.externalDriverVehicleAssignmentPlan.findUniqueOrThrow({ where: { id: end.id } })).status, 'CANCELLED');
}));

test('external admission requires assigned vehicle and enrollment; open operations block transfer and preserve snapshot', () => fixture(async f => {
  await f.assign(); await assert.rejects(() => externalOperationalReadiness(f.tx, f.driver.id, f.vehicles[0].id), /بیومتریک/);
  await f.enroll();
  await assert.rejects(() => admitGuardDriverQueueTurn(f.client, { source: 'EXTERNAL', driverId: f.driver.id, vehicleId: f.vehicles[1].id, actorId: f.actor.id }), /تخصیص فعال/);
  const turn = await f.admit();
  const current = await f.tx.externalDriverVehicleAssignment.findFirstOrThrow({ where: { driverId: f.driver.id, effectiveTo: null } });
  await assert.rejects(() => assignHrVehicle(f.tx, { driverId: f.driver.id, vehicleId: f.vehicles[1].id, confirmed: true, expectedAssignmentIds: [current.id] }, f.actor.id), /عملیات باز/);
  await f.tx.externalDriver.update({ where: { id: f.driver.id }, data: { status: 'RESTRICTED' } });
  assert.equal(await isGuardQueueTurnCurrentlyReady(f.raw, turn), false);
  assert.equal((await f.tx.externalDriverVehicleAssignment.findUniqueOrThrow({ where: { id: current.id } })).effectiveTo, null);
  assert.deepEqual((await f.tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } })).admissionSnapshot, turn.admissionSnapshot);
}));

test('external biometrics issues authorization, suspension blocks exit, restoration permits single physical exit', () => fixture(async f => {
  await f.assign(); await f.enroll(); const { turn, bill } = await f.waybill();
  const session = await f.service.startSession({ waybillId: bill.id, actorId: f.actor.id, workstationId: 'TEST' });
  assert.equal(session.method, 'EXTERNAL_BIOMETRIC'); assert.equal(f.messages.length, 0);
  await assert.rejects(() => f.service.resendOtp(session.id), /مسیر جایگزین/);
  const result = await f.service.verifyInternalBiometric({ sessionId: session.id, actorId: f.actor.id }); assert.ok(result.authorization);
  await f.tx.externalDriver.update({ where: { id: f.driver.id }, data: { status: 'RESTRICTED' } });
  const exit = new PhysicalGateExitService(f.client);
  const input = { authorizationId: result.authorization.id, actorId: f.actor.id, effectiveAuthority: {}, idempotencyKey: f.key, correlationId: f.key };
  await assert.rejects(() => exit.recordExit(input), /خروج مجاز نیست/);
  await f.tx.externalDriver.update({ where: { id: f.driver.id }, data: { status: 'ACTIVE' } });
  const recorded = await exit.recordExit(input); assert.equal((await exit.recordExit(input)).id, recorded.id);
  assert.equal((await f.tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } })).status, 'EXIT_RECORDED');
}));

test('external fallback requires qualifying failures, OTP, separate Guard actor and exception reason', () => fixture(async f => {
  await f.assign(); await f.enroll(); const { bill } = await f.waybill();
  const session = await f.service.startSession({ waybillId: bill.id, actorId: f.actor.id, workstationId: 'TEST' });
  await assert.rejects(() => f.service.beginInternalFallback({ sessionId: session.id, actorId: f.actor.id }), /qualifying/);
  for (let i = 0; i < 3; i++) await f.service.verifyInternalBiometric({ sessionId: session.id, actorId: f.actor.id, scenario: 'NON_MATCH' });
  assert.equal((await f.service.beginInternalFallback({ sessionId: session.id, actorId: f.actor.id })).method, 'EXTERNAL_FALLBACK');
  assert.equal(f.messages[0].phone, '09123333333');
  await f.service.verifyOtp({ sessionId: session.id, code: f.messages[0].code });
  await assert.rejects(() => f.service.approveByGuard({ sessionId: session.id, guardActorId: f.actor.id, reauthenticatedAt: new Date(), reason: 'test' }), /different actor/);
  await assert.rejects(() => f.service.approveByGuard({ sessionId: session.id, guardActorId: 'other-guard', reauthenticatedAt: new Date() }), /reason/);
  const auth = await f.service.approveByGuard({ sessionId: session.id, guardActorId: 'other-guard', reauthenticatedAt: new Date(), reason: 'خطای حسگر در آزمون' });
  assert.equal(auth.method, 'EXTERNAL_FALLBACK');
}));

test('expiry immediately blocks external confirmation and readiness; mixed source assignments fail', () => fixture(async f => {
  await f.assign(); await f.enroll(); const { turn, bill } = await f.waybill();
  const session = await f.service.startSession({ waybillId: bill.id, actorId: f.actor.id, workstationId: 'TEST' });
  await f.tx.externalDriver.update({ where: { id: f.driver.id }, data: { licenceExpiresAt: f.before } });
  await assert.rejects(() => f.service.prepareInternalBiometric(session.id, f.actor.id), /منقضی/);
  assert.equal(await isGuardQueueTurnCurrentlyReady(f.raw, turn), false);
  const internalVehicle = await f.tx.companyVehicle.create({data:{fleetCode:f.key+'-internal',vehicleType:'سواری',createdBy:f.actor.id}});
  await assert.rejects(() => previewHrAssignment(f.tx, { driverId: f.driver.id, vehicleId: internalVehicle.id }), /هر دو بیرونی/);
}));

test('external scheduler retains preceding assignment on open dispatch and requires manual review after blocker clears', () => fixture(async f => {
 const initial = await f.assign(); await f.enroll();
 const due = new Date(f.now.getTime() + 3600000);
 const planned = await assignHrVehicle(f.tx, {driverId:f.driver.id, vehicleId:f.vehicles[1].id, effectiveFrom:due.toISOString(), expectedAssignmentIds:[initial.data.id],confirmed:true},f.actor.id,f.now);
 const turn = await f.admit();
 await processDueHrAssignmentPlans(f.client,due);
 let plan = await f.tx.externalDriverVehicleAssignmentPlan.findUniqueOrThrow({where:{id:planned.data.id}});
 assert.equal(plan.status,'NEEDS_ATTENTION'); assert.match(plan.blockedReason,/عملیات باز/);
 assert.equal((await f.tx.externalDriverVehicleAssignment.findUniqueOrThrow({where:{id:initial.data.id}})).effectiveTo,null);
 await f.tx.guardDriverQueueTurn.update({where:{id:turn.id},data:{status:'CLOSED_WITHOUT_LOADING'}});
 await processDueHrAssignmentPlans(f.client,new Date(due.getTime()+1000));
 plan = await f.tx.externalDriverVehicleAssignmentPlan.findUniqueOrThrow({where:{id:planned.data.id}}); assert.equal(plan.status,'NEEDS_ATTENTION');
 const result = await executeHrAssignmentPlan(f.tx,plan.id,f.actor.id,false,{expectedAssignmentIds:[initial.data.id],cancelPlanIds:[]},new Date(due.getTime()+2000));
 assert.equal(result.status,'APPLIED');
}));

for (const change of ['licence', 'biometric']) test(`external stale Serializable readiness cannot survive a committed ${change} withdrawal`, async () => {
 let f: any;
 await fixture(async value => { await value.assign(); const enrollment = await value.tx.driverBiometricEnrollment.create({data:{externalDriverId:value.driver.id,confirmationPhone:'09121111111',enrolledBy:value.actor.id}}); f = {...value,enrollment}; }, true);
 let writerReady!:()=>void, readerReady!:()=>void, release!:()=>void;
 const written=new Promise<void>(r=>{writerReady=r;}); const reading=new Promise<void>(r=>{readerReady=r;}); const barrier=new Promise<void>(r=>{release=r;});
 let writer:Promise<unknown>|undefined, reader:Promise<unknown>|undefined;
 try {
  writer=prisma.$transaction(async tx=>{
   await lockHrVehicleOperations(tx);
   if(change==='licence') await tx.externalDriver.update({where:{id:f.driver.id},data:{licenceExpiresAt:f.before}});
   else await tx.driverBiometricEnrollment.update({where:{id:f.enrollment.id},data:{status:'INACTIVE'}});
   writerReady(); await barrier;
  },{timeout:10000});
  await written;
  reader=prisma.$transaction(async tx=>{
   const old=await tx.externalDriver.findUniqueOrThrow({where:{id:f.driver.id}}); assert.ok(old.licenceExpiresAt!>f.now);
   assert.equal((await tx.driverBiometricEnrollment.findUniqueOrThrow({where:{id:f.enrollment.id}})).status,'ACTIVE');
   readerReady();
   return isGuardQueueTurnCurrentlyReady(tx,{driverSource:'EXTERNAL',internalDriverId:null,companyVehicleId:null,assignmentId:null,externalDriverId:f.driver.id,externalVehicleId:f.vehicles[0].id},f.now);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:10000});
  const observed=reader.then(result=>({result}),error=>({error})); await reading; release(); await writer;
  const outcome=await observed; assert.ok('error' in outcome,'stale readiness must fail instead of authorizing');
  const error=(outcome as {error:any}).error; assert.ok(error.code==='P2034'||String(error.meta?.code)==='40001');
 } finally {
  release(); await Promise.allSettled([writer,reader].filter(Boolean));
  const vehicleIds=f.vehicles.map((v:any)=>v.id);
  await prisma.dispatchMasterDataAudit.deleteMany({where:{subjectId:{in:[f.driver.id,...vehicleIds]}}});
  await prisma.driverBiometricEnrollment.delete({where:{id:f.enrollment.id}});
  await prisma.externalDriverVehicleAssignment.deleteMany({where:{driverId:f.driver.id}});
  await prisma.externalDriverDocument.deleteMany({where:{driverId:f.driver.id}}); await prisma.externalDriver.delete({where:{id:f.driver.id}});
  await prisma.externalVehicleDocument.deleteMany({where:{vehicleId:{in:vehicleIds}}}); await prisma.externalVehiclePlate.deleteMany({where:{vehicleId:{in:vehicleIds}}}); await prisma.externalVehicle.deleteMany({where:{id:{in:vehicleIds}}});
  await prisma.user.delete({where:{id:f.actor.id}});
 }
});

test('external staged two-finger finalization decrypts namespaced captures atomically and is retry-idempotent', () => fixture(async f => {
 const sessionId=randomUUID(), subjectId=`external:${f.driver.id}`; const captures: {challengeId:string}[]=[];
 for (const finger of ['RIGHT_INDEX','LEFT_INDEX']) {
  const id=randomUUID(); const context={personnelId:subjectId,finger,actorId:f.actor.id,workstationId:'TEST',enrollmentSessionId:sessionId,challengeId:id};
  const template=f.vault.sealStagedCapture(Buffer.from('protected-test-finger-'+finger),{...context,kind:'TEMPLATE'});
  const image=f.vault.sealStagedCapture(Buffer.from([137,80,78,71,13,10,26,10,1]),{...context,kind:'IMAGE'});
  await f.tx.biometricConnectorChallenge.create({data:{id,operation:'CAPTURE',workstationId:'TEST',actorId:f.actor.id,subjectId,contextId:sessionId,finger,enrollmentSessionId:sessionId,
   commandDigest:f.key+finger,nonceHash:f.key+finger,status:'STAGED',issuedAt:f.now,expiresAt:new Date(f.now.getTime()+60000),stagedExpiresAt:new Date(Date.now()+300000),
   protectedCapture:{template,image},resultSummary:{device:{model:'TEST',serial:'TEST'},captureQuality:{state:'ACCEPTED'},liveness:{state:'LIVE'},captureImage:{width:2,height:2}}}});
  captures.push({challengeId:id});
 }
 const input={personnelId:subjectId,actorId:f.actor.id,enrollmentSessionId:sessionId,confirmationPhone:'09121111111',captures};
 const first=await f.service.enrollStagedInternalDriver(input); const again=await f.service.enrollStagedInternalDriver(input);
 assert.equal(first.id,again.id); assert.equal(first.externalDriverId,f.driver.id); assert.equal(again.externalDriverId,f.driver.id);
 const rows=await f.tx.biometricConnectorChallenge.findMany({where:{enrollmentSessionId:sessionId}});
 assert.equal(rows.length,2); assert.ok(rows.every((r:any)=>r.status==='CONSUMED'&&r.protectedCapture===null));
 assert.equal(await f.tx.driverBiometricEnrollment.count({where:{externalDriverId:f.driver.id}}),1);
}));
