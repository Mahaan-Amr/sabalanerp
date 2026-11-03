import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import users from '../users';
import { prisma } from '../../lib/prisma';
import { personnelIdentityVersion } from '../../services/hrPersonnelIdentity';

test('profile edits preserve unchanged roles and actual role changes retain their guards', async (t) => {
  const url = new URL(process.env.USER_PROFILE_TEST_DATABASE_URL
    ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/sabalanerp', 'use only the existing local Compose database');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const transaction = prisma.$transaction;
  const findUser = prisma.user.findUnique;
  const findDepartment = prisma.department.findUnique;
  const route = (users as any).stack.find((layer: any) => layer.route?.path === '/:id' && layer.route.methods.put).route;
  const app = express();
  app.use(express.json());
  let actorRole = 'ADMIN';
  // Supply authentication in this harness; retain the registered validators and
  // real handler, Prisma queries, transaction semantics and database triggers.
  app.use((req: any, _res, next) => { req.user = { id: 'profile-test-actor', role: actorRole }; next(); });
  app.put('/users/:id', ...route.stack.slice(2).map((layer: any) => layer.handle));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const rollback = new Error('ROLLBACK_PROFILE_FIXTURE');
  const request = async (id: string, body: unknown) => {
    const response = await fetch(`${base}/users/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const cases = ['firstName', 'lastName', 'email', 'username', 'phone', 'departmentId', 'isActive', 'linkedNames', 'roleDenied', 'ordinaryRole', 'managerDenied'] as const;
  try {
    for (const scenario of cases) await t.test(scenario, async () => {
      actorRole = scenario === 'managerDenied' ? 'MANAGER' : 'ADMIN';
      await assert.rejects(db.$transaction(async tx => {
        const key = randomUUID();
        const person = scenario === 'linkedNames'
          ? await tx.personnel.create({ data: { firstName: 'نام قدیم', lastName: 'آزمون' } }) : null;
        const user = await tx.user.create({ data: {
          username: `profile-${key}`, email: `${key}@profile.invalid`, password: 'unused-test-hash',
          firstName: 'نام قدیم', lastName: 'آزمون', role: 'SALES', personnelId: person?.id,
        } });
        if (scenario !== 'ordinaryRole' && scenario !== 'managerDenied') {
          await tx.partnerProfile.create({ data: { userId: user.id, state: 'ACTIVE', irreversibleAt: new Date() } });
        }
        (prisma.user as any).findUnique = tx.user.findUnique.bind(tx.user);
        (prisma.department as any).findUnique = tx.department.findUnique.bind(tx.department);
        (prisma as any).$transaction = (work: (inner: typeof tx) => unknown) => work(tx);
        const data: Record<string, unknown> = { role: user.role };
        if (scenario === 'firstName' || scenario === 'linkedNames') data.firstName = 'نام تازه';
        if (scenario === 'lastName') data.lastName = 'خانوادگی تازه';
        if ('firstName' in data || 'lastName' in data) data.expectedIdentityVersion = personnelIdentityVersion(person, user);
        if (scenario === 'email') data.email = `changed-${key}@profile.invalid`;
        if (scenario === 'username') data.username = `changed-${key}`;
        if (scenario === 'phone') data.phone = '۰۹۱۲ ۳۴۵ ۶۷۸۹';
        if (scenario === 'departmentId') {
          const department = await tx.department.create({ data: { name: `profile-${key}`, namePersian: 'آزمون' } });
          data.departmentId = department.id;
        }
        if (scenario === 'isActive') data.isActive = false;
        if (scenario === 'roleDenied' || scenario === 'ordinaryRole') data.role = 'MODERATOR';
        if (scenario === 'managerDenied') data.role = 'ADMIN';
        // Keep the fixture readable after a deliberately rejected SQL write.
        await tx.$executeRawUnsafe('SAVEPOINT profile_command');
        const response = await request(user.id, data);
        if (scenario === 'roleDenied') {
          assert.equal(response.status, 409, JSON.stringify(response.body));
          assert.equal(response.body.code, 'PARTNER_PERSONA_CONFLICT');
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT profile_command');
        } else if (scenario === 'managerDenied') {
          assert.equal(response.status, 403);
        } else {
          assert.equal(response.status, 200, JSON.stringify(response.body));
        }
        const after = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
        assert.equal(after.role, scenario === 'ordinaryRole' ? 'MODERATOR' : user.role);
        assert.equal(after.password, user.password);
        for (const field of ['firstName', 'lastName', 'email', 'username', 'departmentId', 'isActive'] as const) {
          assert.equal(after[field], data[field] ?? user[field], field);
        }
        if (scenario === 'phone') assert.equal(after.profile?.phone, '09123456789');
        if (person) {
          assert.equal((await tx.personnel.findUniqueOrThrow({ where: { id: person.id } })).firstName, 'نام تازه');
          assert.equal(await tx.hrPersonnelAudit.count({ where: { personnelId: person.id } }), 1);
        }
        throw rollback;
      }, { isolationLevel: 'Serializable', timeout: 15000 }), error => error === rollback);
    });
  } finally {
    (prisma as any).$transaction = transaction;
    (prisma.user as any).findUnique = findUser;
    (prisma.department as any).findUnique = findDepartment;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.$disconnect();
  }
});
