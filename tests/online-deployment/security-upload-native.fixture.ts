import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

type Input = { db: PrismaClient; baseUrl: string; sessionToken: string; actorId: string };
export type SecurityUploadQualification = {
  entryId: string; attachmentId: string; storageName: string; sha256: string; bytes: number;
  description: string; rejectedCategoryUploadRemoved: true; legacyVehicleMutationRefused: true;
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = () => path.resolve(process.cwd(), 'uploads/security-shift-log');

async function directoryFiles() {
  assert.equal(await fs.realpath(root()), root());
  const result: Record<string, string> = {};
  for (const name of (await fs.readdir(root())).sort()) {
    const file = path.join(root(), name), value = await fs.lstat(file);
    assert.ok(value.isFile() && !value.isSymbolicLink() && value.nlink === 1);
    result[name] = sha(await fs.readFile(file));
  }
  return result;
}

/** Isolated data setup only; upload, validation, retention and download use
 * the actual authenticated router. This does not qualify shift scheduling. */
export async function qualifyNativeSecurityUpload(input: Input): Promise<SecurityUploadQualification> {
  const [database] = await input.db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  assert.match(database.name, /^qa_application_native_[a-f0-9]{32}$/);
  assert.equal((await input.db.user.findUniqueOrThrow({ where: { id: input.actorId } })).role, 'ADMIN');
  const run = randomUUID(), now = new Date(), endsAt = new Date(now.getTime() + 3600_000);
  const shift = await input.db.shift.create({ data: { name: 'native-' + run, namePersian: 'native-' + run,
    startTime: '00:00', endTime: '01:00', duration: 60 } });
  const personnel = await input.db.securityPersonnel.create({ data: { userId: input.actorId, shiftId: shift.id,
    position: 'Private native upload fixture' } });
  const otherPersonnel: Array<{ id: string }> = [];
  for (const index of [1, 2]) {
    const user = await input.db.user.create({ data: { username: `native-guard-${run}-${index}`,
      email: `native-guard-${run}-${index}@isolated.invalid`, password: 'NO_LOGIN_PRIVATE_QA',
      firstName: 'Private', lastName: 'Guard', role: 'USER' } });
    otherPersonnel.push(await input.db.securityPersonnel.create({ data: { userId: user.id, shiftId: shift.id,
      position: 'Private native upload fixture' } }));
  }
  const plan = await input.db.securityShiftPlan.create({ data: { title: 'Private native upload ' + run,
    persianYear: 1405, anchorAt: now, generateUntil: endsAt, primaryAId: personnel.id,
    primaryBId: otherPersonnel[0].id, primaryCId: otherPersonnel[1].id, createdBy: input.actorId } });
  const slot = await input.db.securityShiftPlanSlot.create({ data: { planId: plan.id, sequence: 1,
    startsAt: now, endsAt, plannedPersonnelId: personnel.id } });
  await input.db.securityShiftSession.create({ data: { slotId: slot.id, personnelId: personnel.id } });
  const category = await input.db.securityInstantReportCategory.create({ data: { name: 'Native ' + run,
    useReportTypes: false, useRelatedPersonnel: false, createdBy: input.actorId } });
  const cookie = { Cookie: 'sabalan_session=' + input.sessionToken };
  const form = (categoryId: string, description: string) => {
    const value = new FormData(); value.append('categoryId', categoryId); value.append('description', description);
    value.append('images', new Blob([png], { type: 'image/png' }), 'private-native.png'); return value;
  };
  const before = await directoryFiles();
  const refused = await fetch(input.baseUrl + '/api/security/shift-log/entries', { method: 'POST', headers: cookie,
    body: form('missing-' + run, 'Private refused category') });
  assert.equal(refused.status, 404, await refused.text());
  assert.deepEqual(await directoryFiles(), before, 'rejected actual multipart must remove only its unreferenced live bytes');
  const description = 'Private native capture ' + run;
  const created = await fetch(input.baseUrl + '/api/security/shift-log/entries', { method: 'POST', headers: cookie,
    body: form(category.id, description) });
  const body = await created.json() as { data?: { id: string } };
  assert.equal(created.status, 201, JSON.stringify(body)); assert.ok(body.data?.id);
  const entry = await input.db.securityShiftLogEntry.findUniqueOrThrow({ where: { id: body.data.id }, include: { attachments: true } });
  assert.equal(entry.description, description); assert.equal(entry.attachments.length, 1);
  const attachment = entry.attachments[0]; assert.equal(attachment.size, png.length);
  const qualification: SecurityUploadQualification = { entryId: entry.id, attachmentId: attachment.id,
    storageName: attachment.storageName, sha256: sha(png), bytes: png.length, description,
    rejectedCategoryUploadRemoved: true, legacyVehicleMutationRefused: true };
  const legacy = await fetch(input.baseUrl + '/api/security/vehicle-pairs', { method: 'POST', headers: {
    ...cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(legacy.status, 410, await legacy.text());
  await verifyRestoredNativeSecurityUpload({ ...input, qualification });
  return qualification;
}

export async function verifyRestoredNativeSecurityUpload(input: Input & { qualification: SecurityUploadQualification }) {
  const expected = input.qualification;
  assert.match(expected.storageName, /^[A-Za-z0-9_.-]+$/); assert.equal(path.basename(expected.storageName), expected.storageName);
  const attachment = await input.db.securityShiftLogAttachment.findUniqueOrThrow({ where: { id: expected.attachmentId }, include: { entry: true } });
  assert.equal(attachment.entryId, expected.entryId); assert.equal(attachment.entry.description, expected.description);
  assert.equal(attachment.storageName, expected.storageName); assert.equal(attachment.size, expected.bytes);
  const file = path.join(root(), expected.storageName); assert.equal(await fs.realpath(file), file);
  const value = await fs.lstat(file); assert.ok(value.isFile() && value.nlink === 1 && !value.isSymbolicLink());
  const stored = await fs.readFile(file); assert.equal(stored.length, expected.bytes); assert.equal(sha(stored), expected.sha256);
  const response = await fetch(input.baseUrl + '/api/security/shift-log/attachments/' + encodeURIComponent(expected.attachmentId), {
    headers: { Cookie: 'sabalan_session=' + input.sessionToken } });
  assert.equal(response.status, 200); const downloaded = Buffer.from(await response.arrayBuffer());
  assert.equal(downloaded.length, expected.bytes); assert.equal(sha(downloaded), expected.sha256);
}
