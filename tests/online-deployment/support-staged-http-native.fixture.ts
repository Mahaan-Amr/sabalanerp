import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { PrismaClient } from '@prisma/client';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { assertSupportStoredArtifact, supportTicketStorageDirectory } from '../../backend/src/services/supportFileRuntime';
import { SUPPORT_STAGED_HTTP_CLIENT_SOURCE, SUPPORT_STAGED_HTTP_TARGET_SOURCE } from './support-staged-http-client.fixture';

export type SupportStagedHttpQualification = { format: 'sabalan-native-support-staged-http/v1'; ticketId: string;
  attachmentId: string; storageName: string; sha256: string; bytes: number; sourceRoot: string; sourceVersionSha256: string;
  reporterId: string; title: string; description: string; originalName: string; actualPdfXrefQualified: true;
  httpClientOriginalExit0: true };
type ClientResult = Omit<SupportStagedHttpQualification, 'format' | 'sourceRoot' | 'sourceVersionSha256' | 'reporterId' | 'httpClientOriginalExit0'>
  & { format: 'sabalan-support-staged-http-client-result/v1' };

async function streamDigest(stream: AsyncIterable<Uint8Array>, maximum: number) {
  let bytes = 0; const hash = createHash('sha256');
  for await (const chunk of stream) { bytes += chunk.byteLength; assert.ok(bytes <= maximum); hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}
/** Original child handle remains owned until its real close event. A failed
 * input/write/exit/output never authorizes READY or an unknown-child adoption.
 * Child code is fixed captured source; the session is anonymous stdin only. */
async function originalHttpClient(baseUrl: string, sessionToken: string): Promise<ClientResult> {
  const expectedHost = process.env.APPLICATION_NATIVE_BIND_HOST;
  // Validate before creating a child or sending its private session. The same
  // fixed validator runs again inside the original HTTP-only child.
  const validate = new Function('require', SUPPORT_STAGED_HTTP_TARGET_SOURCE + '\nreturn validateSupportHttpTarget;')(require);
  validate(baseUrl, expectedHost);
  const child = spawn(process.execPath, ['-e', SUPPORT_STAGED_HTTP_CLIENT_SOURCE], {
    env: { NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0, failure: Error | undefined;
  child.once('error', error => { failure = error; });
  child.stdin.once('error', error => { failure ||= error; });
  child.stdout.once('error', error => { failure ||= error; });
  child.stderr.once('error', error => { failure ||= error; });
  child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += chunk.length; if (stdoutBytes <= 32768) stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes <= 65536) stderr += chunk.toString('utf8'); });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdin.end(JSON.stringify({ format: 'sabalan-support-staged-http-client-input/v2', baseUrl, sessionToken, expectedHost }));
  const outcome = await closed;
  console.log(JSON.stringify({ event: 'support-staged-http-client-closed', pid: child.pid, ...outcome, stdoutBytes, stderrBytes }));
  if (failure) throw failure;
  assert.equal(outcome.signal, null); assert.equal(outcome.code, 0, 'Original Support HTTP client failed: ' + stderr);
  assert.ok(stdoutBytes > 0 && stdoutBytes <= 32768 && stderrBytes <= 65536);
  const value = JSON.parse(stdout) as ClientResult;
  assert.equal(value.format, 'sabalan-support-staged-http-client-result/v1');
  assert.equal(value.bytes, 17826244); assert.equal(value.sha256, 'a0d7162c0efb828b1df63eeec4f32efba8f857e72b0daa393e890ccca86b3e33');
  assert.equal(value.originalName, 'native-large-valid.pdf'); assert.equal(value.actualPdfXrefQualified, true);
  for (const id of [value.ticketId, value.attachmentId]) assert.match(id, /^[a-z0-9]{20,32}$/);
  assert.match(value.storageName, /^staged-[0-9]+-[a-f0-9]{32}\.pdf$/);
  assert.equal(typeof value.title, 'string'); assert.equal(typeof value.description, 'string');
  return value;
}

async function verifyStoredSqlAndDownload(input: { db: PrismaClient; baseUrl: string; sessionToken: string;
  qualification: SupportStagedHttpQualification; restored: boolean }) {
  const { db, baseUrl, sessionToken, qualification: value } = input;
  assert.equal(value.format, 'sabalan-native-support-staged-http/v1');
  assert.equal(value.httpClientOriginalExit0, true);
  assert.equal(path.basename(value.storageName), value.storageName); assert.match(value.sha256, /^[a-f0-9]{64}$/);
  const ticket = await db.supportTicket.findUniqueOrThrow({ where: { id: value.ticketId }, include: { entries: true, attachments: true } });
  assert.equal(ticket.reporterId, value.reporterId); assert.equal(ticket.title, value.title);
  const reports = ticket.entries.filter(entry => entry.kind === 'REPORT'); assert.equal(reports.length, 1);
  assert.equal(reports[0].body, value.description); assert.equal(reports[0].authorId, value.reporterId);
  assert.equal(ticket.attachments.length, 1); const attachment = ticket.attachments[0];
  assert.equal(attachment.id, value.attachmentId); assert.equal(attachment.storageName, value.storageName);
  assert.equal(attachment.kind, 'DOCUMENT'); assert.equal(attachment.mimeType, 'application/pdf');
  assert.equal(attachment.size, value.bytes); assert.equal(attachment.sha256, value.sha256); assert.equal(attachment.originalName, value.originalName);
  assert.equal(attachment.deletedAt, null); assert.equal(attachment.redactedAt, null);
  const root = supportTicketStorageDirectory(); if (input.restored) assert.notEqual(root, value.sourceRoot);
  const file = await streamDigest(createReadStream(path.join(root, value.storageName), { highWaterMark: 256 * 1024 }), value.bytes);
  assert.deepEqual(file, { bytes: value.bytes, sha256: value.sha256 });
  const response = await fetch(baseUrl + '/api/support-tickets/attachments/' + value.attachmentId + '/download', { headers: { Cookie: 'sabalan_session=' + sessionToken } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/pdf');
  assert.equal(Number(response.headers.get('content-length')), value.bytes); assert.ok(response.body);
  const downloaded = await streamDigest(response.body, value.bytes); assert.deepEqual(downloaded, file);
  const denied = await fetch(baseUrl + '/api/support-tickets/attachments/' + value.attachmentId + '/download');
  assert.equal(denied.status, 401); if (denied.body) await streamDigest(denied.body, 65536);
}

/** The large producer/HTTP client exits before READY; the real application
 * still serves every request and the original parent verifies actual SQL,
 * settled publication, negative hash/size guards, and streamed file/download. */
export async function qualifyNativeSupportStagedHttp(input: { db: PrismaClient; boundary: RuntimeWorkBoundary;
  publication: VersionedFilePublication; baseUrl: string; sessionToken: string; reporterId: string }): Promise<SupportStagedHttpQualification> {
  const { boundary, publication, baseUrl, sessionToken, reporterId } = input;
  const client = await originalHttpClient(baseUrl, sessionToken), files = await publication.bindRoot(supportTicketStorageDirectory());
  let sourceVersionSha256 = '';
  await boundary.context.run(async () => {
    const settled = await files.readSettledDigest(client.storageName, 25 * 1024 * 1024);
    assert.equal(settled.head?.operation, 'PUT'); assert.equal(settled.sha256, client.sha256); assert.equal(settled.byteLength, client.bytes);
    sourceVersionSha256 = settled.head!.versionSha256;
    await assert.rejects(assertSupportStoredArtifact(client.storageName, '0'.repeat(64), client.bytes), /SUPPORT_STAGED_ARTIFACT_UNPROVEN/);
    await assert.rejects(assertSupportStoredArtifact(client.storageName, client.sha256, client.bytes - 1), /SUPPORT_STAGED_ARTIFACT_UNPROVEN/);
  });
  const qualification: SupportStagedHttpQualification = { format: 'sabalan-native-support-staged-http/v1', ticketId: client.ticketId,
    attachmentId: client.attachmentId, storageName: client.storageName, sha256: client.sha256, bytes: client.bytes,
    sourceRoot: supportTicketStorageDirectory(), sourceVersionSha256, reporterId, title: client.title,
    description: client.description, originalName: client.originalName, actualPdfXrefQualified: true, httpClientOriginalExit0: true };
  await verifyStoredSqlAndDownload({ ...input, qualification, restored: false });
  await boundary.context.run(async () => assert.equal((await files.inspect(client.storageName))?.versionSha256, sourceVersionSha256));
  return qualification;
}
export async function verifyRestoredSupportStagedHttp(input: { db: PrismaClient; baseUrl: string; sessionToken: string;
  qualification: SupportStagedHttpQualification }) {
  await verifyStoredSqlAndDownload({ ...input, restored: true });
  return { above16MiBValidPdf: true, originalSqlAndFileHash: true, actualAuthorizedDownload: true, unauthorized401: true };
}
