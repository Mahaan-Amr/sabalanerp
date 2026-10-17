import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { applyAttendanceCorrection, previewAttendanceCorrection } from '../attendanceCorrection';
import { lockAttendance, tokenHash } from '../attendanceDevice';
import { buildPersonnelAttendanceReport, parsePersonnelAttendanceReportOptions } from '../personnelAttendanceReport';

if (!process.env.DATABASE_URL?.includes('@127.0.0.1:55432/sabalanerp?')) throw new Error('Existing local Compose only.');
const db = new PrismaClient();
test.after(() => db.$disconnect());
const rollback = new Error('rollback correction fixture');
async function fixture(work: (tx: Prisma.TransactionClient, f: any) => Promise<void>, attempt = 0): Promise<void> {
  try { await db.$transaction(async tx => {
    await lockAttendance(tx);
    const key=randomUUID();
    const actor=await tx.user.create({data:{username:key,email:`${key}@example.invalid`,firstName:'آزمون',lastName:'اصلاح',password:'not-a-login',role:'ADMIN'}});
    const person=await tx.personnel.create({data:{firstName:'آزمون اصلاح',lastName:key}});
    const make=async(day:string)=>{
      const record=await tx.attendanceRecord.create({data:{personnelId:person.id,date:new Date(`${day}T00:00:00Z`),status:'PRESENT',personnelFirstName:person.firstName,personnelLastName:person.lastName,workScheduleStatus:'NON_WORKING_DAY'}});
      return tx.attendanceInterval.create({data:{attendanceRecordId:record.id,enteredAt:new Date(`${day}T08:00:00+03:30`),exitedAt:new Date(`${day}T17:00:00+03:30`),entryRecordedBy:actor.id,exitRecordedBy:actor.id,confirmedBy:actor.id,confirmedAt:new Date()}});
    };
    const first=await make('2026-07-12'), second=await make('2026-07-13');
    const terminal=await tx.attendanceTerminal.create({data:{name:key,tokenHash:tokenHash(key),createdBy:actor.id}});
    const punch=await tx.attendancePunch.create({data:{terminalId:terminal.id,eventKey:key,deviceCode:'LOCAL_TEST',occurredAt:first.exitedAt!,correctedOccurredAt:first.exitedAt,verifyMode:1,inOutRaw:0,status:'LINKED',personnelId:person.id,nameSnapshot:'آزمون اصلاح',intervalId:first.id}});
    await work(tx,{actor,person,first,second,terminal,punch});throw rollback;
  },{isolationLevel:'Serializable',timeout:30000}); } catch(e) { if(e instanceof Prisma.PrismaClientKnownRequestError && e.code==='P2034' && attempt<4) return fixture(work,attempt+1); if(e!==rollback)throw e;}
}
const unknown={action:'UNKNOWN_EXIT',reason:'خروج انجام شده؛ ساعت قبلی پس از بررسی قابل اتکا نیست'};
const facts={entryReviewed:true,departureConfirmed:true};

test('correction preview preserves data; facts default to pending and no operational mode changes',()=>fixture(async(tx,f)=>{
  const p=await previewAttendanceCorrection(tx,f.first.id,unknown,f.actor.id);
  assert.equal(p.before.exitedAt!.toISOString(),f.first.exitedAt.toISOString());assert.equal(p.after.exitedAt,null);
  assert.equal(p.after.confirmedRevision,0);assert.equal(p.after.revision,2);
  assert.deepEqual(await tx.attendanceInterval.findUniqueOrThrow({where:{id:f.first.id}}),f.first);
  assert.equal(await tx.attendanceIntervalAudit.count({where:{intervalId:f.first.id}}),0);
  assert.equal((await tx.attendanceTerminal.findUniqueOrThrow({where:{id:f.terminal.id}})).mode,'SHADOW');
}));
test('missing, partial or string facts and missing final confirmation cannot apply',()=>fixture(async(tx,f)=>{
  const p=await previewAttendanceCorrection(tx,f.first.id,unknown,f.actor.id);
  for(const extra of [{},{facts},{facts:{entryReviewed:true} ,confirmApply:true},{facts:{entryReviewed:'true',departureConfirmed:true},confirmApply:true}])
    await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,...extra},f.actor.id),/تأیید/);
  await assert.rejects(previewAttendanceCorrection(tx,f.first.id,{...unknown,reason:' '},f.actor.id),/دلیل معتبر/);
  assert.deepEqual(await tx.attendanceInterval.findUniqueOrThrow({where:{id:f.first.id}}),f.first);
}));
test('disputed closed exit becomes unknown with full audit and known minutes preserved',()=>fixture(async(tx,f)=>{
  const p=await previewAttendanceCorrection(tx,f.first.id,unknown,f.actor.id);
  await applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,facts,confirmApply:true},f.actor.id);
  const after=await tx.attendanceInterval.findUniqueOrThrow({where:{id:f.first.id}});
  assert.equal(after.exitedAt,null);assert.equal(after.exitUnknown,true);assert.deepEqual(after.enteredAt,f.first.enteredAt);
  assert.equal(after.confirmedRevision,0);assert.equal(after.confirmedBy,null);assert.equal(after.confirmedAt,null);assert.equal(after.revision,2);
  assert.deepEqual(await tx.attendanceInterval.findUniqueOrThrow({where:{id:f.second.id}}),f.second);
  const audit=await tx.attendanceIntervalAudit.findFirstOrThrow({where:{intervalId:f.first.id}});
  assert.equal(audit.actorId,f.actor.id);assert.equal(audit.reason,unknown.reason);assert.equal(audit.action,'UNKNOWN_EXIT');
  assert.equal((audit.beforeData as any).exitedAt,f.first.exitedAt.toISOString());assert.equal((audit.afterData as any).correction.facts.departureConfirmed,true);
  const record=await tx.attendanceRecord.findUniqueOrThrow({where:{id:f.first.attendanceRecordId}});
  assert.equal(record.exitTime,null);assert.equal(record.overtimeMinutes,null);assert.equal(record.overtimePending,true);
  const rows=await tx.attendanceRecord.findMany({where:{personnelId:f.person.id},include:{intervals:true}});
  const report=buildPersonnelAttendanceReport(rows,parsePersonnelAttendanceReportOptions({startDate:'2026-07-12',endDate:'2026-07-13',restMinutes:120}));
  assert.equal(report.people[0].grossMinutes,540);assert.equal(report.people[0].durationUnknown,true);assert.equal(report.people[0].provisional,true);
  const punch=await tx.attendancePunch.findUniqueOrThrow({where:{id:f.punch.id}});
  for(const key of ['occurredAt','correctedOccurredAt','nameSnapshot','deviceCode','personnelId','intervalId'])assert.deepEqual((punch as any)[key],f.punch[key]);
  assert.equal(punch.status,'REVIEW');
}));
test('preview binds operator, decision, reason and expiry and rejects tampering without writes',()=>fixture(async(tx,f)=>{
  const p=await previewAttendanceCorrection(tx,f.first.id,unknown,f.actor.id);
  for(const change of [{reason:'دلیل دیگر'},{action:'VOID'},{expiresAt:new Date(Date.now()-1000).toISOString()},{fingerprint:'forged'}])
    await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,facts,confirmApply:true,...change},f.actor.id),/پیش‌نمایش/);
  await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,facts,confirmApply:true},'another-operator'),/پیش‌نمایش/);
  await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,facts,confirmApply:true},f.actor.id,new Date(Date.now()+360000)),/پیش‌نمایش/);
  assert.deepEqual(await tx.attendanceInterval.findUniqueOrThrow({where:{id:f.first.id}}),f.first);
}));
test('changes to another interval or daily record invalidate the preview even without a revision bump',()=>fixture(async(tx,f)=>{
  let p=await previewAttendanceCorrection(tx,f.first.id,unknown,f.actor.id);
  await tx.attendanceInterval.update({where:{id:f.second.id},data:{exitReason:'اصلاح هم‌زمان'}});
  await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,facts,confirmApply:true},f.actor.id),/اطلاعات تغییر/);
  p=await previewAttendanceCorrection(tx,f.first.id,unknown,f.actor.id);
  await tx.attendanceRecord.update({where:{id:f.second.attendanceRecordId},data:{notes:'اطلاعات تازه'}});
  await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...unknown,...p,facts,confirmApply:true},f.actor.id),/اطلاعات تغییر/);
}));
test('void requires confirmed error; preserves timestamps and dismisses evidence without deleting it',()=>fixture(async(tx,f)=>{
  const cmd={action:'VOID',reason:'پس از بررسی این بازه اشتباه ثبت شده است'};
  const p=await previewAttendanceCorrection(tx,f.first.id,cmd,f.actor.id);
  await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...cmd,...p,facts,confirmApply:true},f.actor.id),/تأیید/);
  await applyAttendanceCorrection(tx,f.first.id,{...cmd,...p,facts:{incorrectIntervalConfirmed:true},confirmApply:true},f.actor.id);
  const after=await tx.attendanceInterval.findUniqueOrThrow({where:{id:f.first.id}});
  assert.equal(after.status,'VOIDED');assert.deepEqual(after.enteredAt,f.first.enteredAt);assert.deepEqual(after.exitedAt,f.first.exitedAt);
  assert.equal(await tx.attendanceIntervalAudit.count({where:{intervalId:f.first.id}}),1);
  assert.equal((await tx.attendancePunch.findUniqueOrThrow({where:{id:f.punch.id}})).status,'DISMISSED');
  await assert.rejects(applyAttendanceCorrection(tx,f.first.id,{...cmd,...p,facts:{incorrectIntervalConfirmed:true},confirmApply:true},f.actor.id));
}));

test('all three legacy overlap shapes are corrected through the real service in temporary tables and rolled back', async()=>{
  const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('schema','pg_temp');url.searchParams.set('connection_limit','1');
  const temp=new PrismaClient({datasources:{db:{url:url.toString()}}});
  const legacy=[
    {person:'preview-a',day:'2026-07-12',entry:'2026-07-12T10:49:00Z',exit:'2026-07-13T10:15:00Z'},
    {person:'preview-a',day:'2026-07-13',entry:'2026-07-13T04:22:00Z',exit:'2026-07-13T14:53:00Z'},
    {person:'preview-b',day:'2026-07-12',entry:'2026-07-12T05:00:00Z',exit:null},
    {person:'preview-b',day:'2026-07-13',entry:'2026-07-13T03:41:00Z',exit:null},
    {person:'preview-c',day:'2026-08-29',entry:'2026-08-29T19:35:00Z',exit:'2026-08-30T15:09:00Z'},
    {person:'preview-c',day:'2026-08-30',entry:'2026-08-30T06:06:00Z',exit:'2026-08-30T11:05:00Z'},
  ];
  try {await assert.rejects(temp.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL search_path TO pg_temp, public');
    for(const table of ['attendance_records','attendance_intervals','attendance_punches','attendance_interval_audits'])
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    // Prisma qualifies enum casts using its datasource schema too. Match the
    // copied columns to transaction-local enum types; no public type changes.
    for(const [type,table,column,fallback] of [
      ['AttendanceStatus','attendance_records','status','PRESENT'],
      ['AttendanceIntervalStatus','attendance_intervals','status','ACTIVE'],
      ['AttendanceWorkScheduleStatus','attendance_records','workScheduleStatus',null],
    ]) {
      const labels=await tx.$queryRaw<{enumlabel:string}[]>`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=${type} ORDER BY e.enumsortorder`;
      const literals=labels.map(r=>"'"+r.enumlabel.replace(/'/g,"''")+"'").join(',');
      await tx.$executeRawUnsafe(`CREATE TYPE pg_temp."${type}" AS ENUM (${literals})`);
      await tx.$executeRawUnsafe(`ALTER TABLE pg_temp.${table} ALTER COLUMN "${column}" DROP DEFAULT`);
      await tx.$executeRawUnsafe(`ALTER TABLE pg_temp.${table} ALTER COLUMN "${column}" TYPE pg_temp."${type}" USING "${column}"::text::pg_temp."${type}"`);
      if(fallback)await tx.$executeRawUnsafe(`ALTER TABLE pg_temp.${table} ALTER COLUMN "${column}" SET DEFAULT '${fallback}'::pg_temp."${type}"`);
    }
    for(const [index,row] of legacy.entries()){
      const record=await tx.attendanceRecord.create({data:{id:`preview-record-${index}`,personnelId:row.person,date:new Date(row.day+'T00:00:00Z'),status:'PRESENT',personnelFirstName:'نمونه',personnelLastName:row.person}});
      await tx.attendanceInterval.create({data:{id:`preview-interval-${index}`,attendanceRecordId:record.id,enteredAt:new Date(row.entry),exitedAt:row.exit?new Date(row.exit):null,entryRecordedBy:'SIMULATED_REVIEWER'}});
    }
    await tx.$executeRawUnsafe('CREATE TRIGGER preview_integrity BEFORE INSERT OR UPDATE ON pg_temp.attendance_intervals FOR EACH ROW EXECUTE FUNCTION public.attendance_interval_integrity()');
    const publicBefore=await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM public.attendance_intervals');
    for(const index of [0,2,4]){
      const p=await previewAttendanceCorrection(tx,`preview-interval-${index}`,unknown,'SIMULATED_REVIEWER');
      // Previewing never treats missing facts as a correction command.
      await assert.rejects(applyAttendanceCorrection(tx,`preview-interval-${index}`,{...unknown,...p},'SIMULATED_REVIEWER'),/تأیید/);
      await applyAttendanceCorrection(tx,`preview-interval-${index}`,{...unknown,...p,facts,confirmApply:true},'SIMULATED_REVIEWER');
    }
    assert.equal(await tx.attendanceIntervalAudit.count(),3);
    assert.equal(await tx.attendanceInterval.count(),6);
    const later=await tx.attendanceInterval.findUniqueOrThrow({where:{id:'preview-interval-3'}});
    assert.equal(later.exitedAt,null);assert.equal(later.exitUnknown,false);
    const rows=await tx.attendanceRecord.findMany({include:{intervals:true}});
    const report=buildPersonnelAttendanceReport(rows,parsePersonnelAttendanceReportOptions({startDate:'2026-07-12',endDate:'2026-08-30',mergeMatchingNames:false}));
    assert.equal(report.people.reduce((n,p)=>n+p.grossMinutes,0),930);
    assert(report.people.every(p=>p.durationUnknown && p.provisional));
    assert.deepEqual(await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM public.attendance_intervals'),publicBefore);
    throw rollback;
  },{timeout:30000,isolationLevel:'Serializable'}),error=>error===rollback);
  } finally {await temp.$disconnect();}
});
