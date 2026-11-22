import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { correctPersonnelIdentity, personnelIdentityVersion, PersonnelIdentityError, identityUserSelect } from '../hrPersonnelIdentity';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
assert.match(process.env.DATABASE_URL!, /@(?:127\.0\.0\.1|localhost):55432\//, 'identity tests use only the existing local database');
const rollback = new Error('ROLLBACK_PERSONNEL_IDENTITY');
const fixture = async (work: (tx: Prisma.TransactionClient) => Promise<void>) => {
  const db = new PrismaClient();
  try { await assert.rejects(db.$transaction(async tx => { await work(tx); throw rollback; }, { timeout: 30000, isolationLevel: 'Serializable' }), error => error === rollback); }
  finally { await db.$disconnect(); }
};

test('accountless homonym correction targets only its ID, preserves identifiers and records exact audit', () => fixture(async tx => {
  const number = `IDENTITY-${crypto.randomUUID()}`;
  const p = await tx.personnel.create({ data: { firstName: 'شهرام', lastName: 'قاسمی', employeeNumber: number } });
  const other = await tx.personnel.create({ data: { firstName: 'شهرام', lastName: 'قاسمی' } });
  const after = await correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'identity-test', source: 'PERSONNEL', expectedVersion: personnelIdentityVersion(p, null), fields: { lastName: 'قاسمی راننده' } });
  assert.equal(after.employeeNumber, number);
  assert.equal(after.firstName, p.firstName);
  assert.equal((await tx.personnel.findUniqueOrThrow({ where: { id: other.id } })).lastName, 'قاسمی');
  const audit = await tx.hrPersonnelAudit.findFirstOrThrow({ where: { personnelId: p.id } });
  assert.equal(audit.reason, ''); assert.equal(audit.actorUserId, 'identity-test');
  assert.equal((audit.payloadJson as any).before.lastName, 'قاسمی');
  assert.equal((audit.payloadJson as any).after.lastName, 'قاسمی راننده');
  await assert.rejects(correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'other-editor', source: 'PERSONNEL', expectedVersion: personnelIdentityVersion(p, null), fields: { firstName: 'old form' } }), error => error instanceof PersonnelIdentityError && error.status === 409);
  assert.equal(await tx.hrPersonnelAudit.count({ where: { personnelId: p.id } }), 1);
}));

test('linked names synchronize both directions, invalidate stale forms, preserve account access and recruitment evidence', () => fixture(async tx => {
  const p = await tx.personnel.create({ data: { firstName: 'نام', lastName: 'قدیمی' } });
  const key = crypto.randomUUID();
  const user = await tx.user.create({ data: { username: `identity-${key}`, email: `${key}@identity.invalid`, password: 'unused-test-hash', firstName: p.firstName, lastName: p.lastName, personnelId: p.id, role: 'USER', isActive: false } });
  const candidate = await tx.hrCandidate.create({ data: { firstName: p.firstName, lastName: p.lastName, linkedPersonnelId: p.id, mobile: `09${Date.now().toString().slice(-9)}` } });
  const initial = await tx.personnel.findUniqueOrThrow({ where: { id: p.id }, include: { user: { select: identityUserSelect } } });
  const firstVersion = personnelIdentityVersion(initial, initial.user);
  await correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'hr-editor', source: 'PERSONNEL', expectedVersion: firstVersion, fields: { firstName: 'نام جدید' } });
  const linked = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(linked.firstName, 'نام جدید');
  assert.equal(linked.username, user.username); assert.equal(linked.password, user.password); assert.equal(linked.role, 'USER'); assert.equal(linked.isActive, false);
  assert.equal((await tx.hrCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).firstName, 'نام');
  await assert.rejects(correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'user-editor', source: 'USER', expectedVersion: firstVersion, fields: { lastName: 'stale' } }), PersonnelIdentityError);
  const current = await tx.personnel.findUniqueOrThrow({ where: { id: p.id }, include: { user: { select: identityUserSelect } } });
  await correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'user-editor', source: 'USER', expectedVersion: personnelIdentityVersion(current, current.user), fields: { lastName: 'از حساب' } });
  assert.equal((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).lastName, 'از حساب');
  assert.equal((await tx.personnel.findUniqueOrThrow({ where: { id: p.id } })).lastName, 'از حساب');
  assert.equal(await tx.hrPersonnelAudit.count({ where: { personnelId: p.id } }), 2);
}));

test('rejects clearing identifiers, empty names, invalid national codes and archived edits without writes', () => fixture(async tx => {
  const p = await tx.personnel.create({ data: { firstName: 'نام', lastName: 'آزمون', employeeNumber: `E-${crypto.randomUUID()}` } });
  const base = { personnelId: p.id, actorUserId: 'test', source: 'PERSONNEL' as const, expectedVersion: personnelIdentityVersion(p, null) };
  for (const fields of [{ employeeNumber: '' }, { firstName: ' ' }, { nationalCode: '0000000000' }, { nationalCode: '123' }]) await assert.rejects(correctPersonnelIdentity(tx, { ...base, fields }), PersonnelIdentityError);
  assert.equal(await tx.hrPersonnelAudit.count({ where: { personnelId: p.id } }), 0);
  await tx.personnel.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
  await assert.rejects(correctPersonnelIdentity(tx, { ...base, fields: { firstName: 'تغییر' } }), error => error instanceof PersonnelIdentityError && error.code === 'PERSONNEL_ARCHIVED');
}));

test('identifier-only correction does not silently reconcile pre-existing divergent account names', () => fixture(async tx => {
  const p = await tx.personnel.create({ data: { firstName: 'نام پرسنلی', lastName: 'قدیمی' } });
  const key = crypto.randomUUID();
  const user = await tx.user.create({ data: { username: `divergent-${key}`, email: `${key}@identity.invalid`, password: 'unused', personnelId: p.id, firstName: 'نام حساب', lastName: 'مستقل قبلی' } });
  await correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'test', source: 'PERSONNEL', expectedVersion: personnelIdentityVersion(p, user), fields: { employeeNumber: `E-${key}` } });
  const after = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.firstName, user.firstName); assert.equal(after.lastName, user.lastName);
}));

test('two simultaneous transactions commit one coherent linked identity and one audit', async () => {
  const db = new PrismaClient();
  let personnelId = ''; let userId = '';
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let readers = 0;
  const timeout = setTimeout(release, 10000);
  try {
    const p = await db.personnel.create({ data: { firstName: 'هم‌زمان', lastName: 'قدیمی' } }); personnelId = p.id;
    const key = crypto.randomUUID();
    const u = await db.user.create({ data: { firstName: p.firstName, lastName: p.lastName, username: `race-${key}`, email: `${key}@identity.invalid`, password: 'unused', personnelId: p.id } }); userId = u.id;
    const version = personnelIdentityVersion(p, u);
    const results = await Promise.allSettled(['اول', 'دوم'].map(lastName => db.$transaction(async tx => {
      await tx.personnel.findUniqueOrThrow({ where: { id: p.id } });
      if (++readers === 2) release();
      await barrier;
      return correctPersonnelIdentity(tx, { personnelId: p.id, actorUserId: 'race', source: 'PERSONNEL', expectedVersion: version, fields: { lastName } });
    }, { isolationLevel: 'Serializable', timeout: 15000 })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(failure.reason instanceof PersonnelIdentityError || failure.reason.code === 'P2034');
    const final = await db.personnel.findUniqueOrThrow({ where: { id: p.id }, include: { user: true } });
    assert.equal(final.lastName, final.user?.lastName);
    assert.equal(await db.hrPersonnelAudit.count({ where: { personnelId: p.id } }), 1);
  } finally {
    release(); clearTimeout(timeout);
    if (userId) await db.user.delete({ where: { id: userId } });
    if (personnelId) { await db.hrPersonnelAudit.deleteMany({ where: { personnelId } }); await db.personnel.delete({ where: { id: personnelId } }); }
    await db.$disconnect();
  }
});
