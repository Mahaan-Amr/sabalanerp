import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';

test('local HTTP identity correction synchronizes HR, User and Guard, preserves homonyms, and rejects stale and duplicate edits', async () => {
  assert.match(process.env.DATABASE_URL!, /@(?:127\.0\.0\.1|localhost):55432\//, 'HTTP harness is limited to the existing local database');
  const db = new PrismaClient();
  const base = 'http://127.0.0.1:5000/api';
  const ids: string[] = []; let userId = ''; let cookie = '';
  const request = async (path: string, method = 'GET', data?: unknown) => {
    const response = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin', password: process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123' }) });
    assert.equal(login.status, 200, 'local admin login');
    cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const key = crypto.randomUUID();
    const p = await db.personnel.create({ data: { firstName: 'آزمون هویت', lastName: key, employeeNumber: `E-${key}` } }); ids.push(p.id);
    const other = await db.personnel.create({ data: { firstName: p.firstName, lastName: p.lastName, employeeNumber: `OTHER-${key}` } }); ids.push(other.id);
    const u = await db.user.create({ data: { firstName: p.firstName, lastName: p.lastName, personnelId: p.id, username: `identity-http-${key}`, email: `${key}@identity.invalid`, password: 'not-a-login-hash' } }); userId = u.id;
    const initial = await request(`/hr/personnel/${p.id}/identity`); assert.equal(initial.status, 200);
    const put = await request(`/hr/personnel/${p.id}`, 'PUT', { lastName: `${key} راننده`, expectedIdentityVersion: initial.body.data.identityVersion });
    assert.equal(put.status, 200);
    assert.equal(put.body.data.employeeNumber, p.employeeNumber);
    const user = await request(`/users/${u.id}`); assert.equal(user.body.data.lastName, `${key} راننده`);
    assert.equal(user.body.data.username, u.username);
    const stale = await request(`/hr/personnel/${p.id}`, 'PUT', { firstName: 'stale', expectedIdentityVersion: initial.body.data.identityVersion });
    assert.equal(stale.status, 409);
    const reverse = await request(`/users/${u.id}`, 'PUT', { firstName: 'از مدیریت کاربران', expectedIdentityVersion: user.body.data.identityVersion }); assert.equal(reverse.status, 200);
    const latest = await request(`/hr/personnel/${p.id}/identity`);
    assert.equal(latest.body.data.firstName, 'از مدیریت کاربران');
    assert.equal(latest.body.data.history.length, 2);
    assert.equal(latest.body.data.history[0].source, 'USER');
    assert.equal((await db.personnel.findUniqueOrThrow({ where: { id: other.id } })).firstName, p.firstName);
    const roster = await request('/security/attendance-roster'); assert.equal(roster.status, 200);
    const guardPerson = roster.body.data.find((row: any) => row.personnel.id === p.id).personnel;
    assert.equal(guardPerson.firstName, 'از مدیریت کاربران'); assert.equal(guardPerson.lastName, `${key} راننده`);
    const duplicate = await request(`/hr/personnel/${p.id}`, 'PUT', { employeeNumber: other.employeeNumber, expectedIdentityVersion: latest.body.data.identityVersion }); assert.equal(duplicate.status, 409);
    const empty = await request(`/hr/personnel/${p.id}`, 'PUT', { employeeNumber: '', expectedIdentityVersion: latest.body.data.identityVersion }); assert.equal(empty.status, 400);
    assert.equal(await db.hrPersonnelAudit.count({ where: { personnelId: p.id } }), 2);
    await db.personnel.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
    const archived = await request(`/users/${u.id}`, 'PUT', { firstName: 'نباید ذخیره شود', expectedIdentityVersion: (await request(`/users/${u.id}`)).body.data.identityVersion }); assert.equal(archived.status, 409);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).firstName, 'از مدیریت کاربران');
  } finally {
    if (cookie) await request('/auth/logout', 'POST', {});
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.hrPersonnelAudit.deleteMany({ where: { personnelId: { in: ids } } });
    await db.personnel.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
