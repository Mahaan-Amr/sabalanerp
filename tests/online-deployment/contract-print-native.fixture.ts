import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import type { PrismaClient } from '@prisma/client';

export type NativeContractPrintQualification = { format: 'sabalan-native-contract-print/v1'; contractId: string;
  contractNumber: string; customerId: string; departmentId: string; reporterId: string;
  storedPath: string; fileName: string; sha256: string; byteLength: number; printedAt: string; signature: unknown };
type Transport = { db: PrismaClient; baseUrl: string; sessionToken: string };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function assertNativeContractPrintBase(baseUrl: string) {
  const value = new URL(baseUrl);
  const expectedHost = process.env.APPLICATION_NATIVE_BIND_HOST;
  assert.equal(typeof expectedHost, 'string'); assert.equal(isIP(expectedHost!), 4);
  const octets = expectedHost!.split('.').map(Number);
  assert.ok(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168), 'CONTRACT_PRINT_PRIVATE_HOST_REQUIRED');
  assert.ok(Object.values(networkInterfaces()).flat().some(item => item && !item.internal
    && item.family === 'IPv4' && item.address === expectedHost), 'CONTRACT_PRINT_ASSIGNED_INTERFACE_REQUIRED');
  assert.equal(value.protocol, 'http:'); assert.equal(value.hostname, expectedHost, 'CONTRACT_PRINT_ENROLLED_HOST_CHANGED');
  assert.equal(value.pathname, '/'); assert.equal(value.username + value.password + value.search + value.hash, '');
  assert.ok(value.port && Number(value.port) >= 1024 && Number(value.port) <= 65535);
  return value;
}
async function download(input: Transport, fileName: string) {
  assertNativeContractPrintBase(input.baseUrl); assert.match(fileName, /^[\w.-]+\.pdf$/);
  const result = await fetch(input.baseUrl + '/files/contracts/' + encodeURIComponent(fileName),
    { headers: { cookie: 'sabalan_session=' + input.sessionToken }, redirect: 'error' });
  assert.equal(result.status, 200); assert.match(result.headers.get('content-type') ?? '', /^application\/pdf/);
  const bytes = Buffer.from(await result.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  return bytes;
}

/** Runs the actual authenticated legacy Contract print route, including its
 * business template, Chromium, retained publisher and persisted print marker.
 * No feature/auth guard, renderer or file port is substituted by this helper. */
export async function qualifyNativeContractPrint(input: Transport & { reporterId: string }): Promise<NativeContractPrintQualification> {
  assertNativeContractPrintBase(input.baseUrl);
  const [{ name }] = await input.db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.match(name, /^qa_[a-z_]+_[a-f0-9]{32}$/);
  const actor = await input.db.user.findUniqueOrThrow({ where: { id: input.reporterId }, select: { role: true } });
  assert.equal(actor.role, 'ADMIN');
  const suffix = randomUUID();
  const customer = await input.db.customer.create({ data: { firstName: 'آزمون', lastName: 'چاپ بازیابی ' + suffix,
    companyName: 'شرکت آزمون خصوصی', address: 'نشانی آزمون خصوصی' } });
  const department = await input.db.department.create({ data: { name: 'private-contract-' + suffix, namePersian: 'چاپ خصوصی ' + suffix } });
  const contract = await input.db.contract.create({ data: { contractNumber: 'QA-' + suffix, title: 'Private restore print',
    titlePersian: 'قرارداد آزمون بازیابی', content: 'متن قرارداد آزمون خصوصی', status: 'SIGNED',
    customerId: customer.id, departmentId: department.id, createdBy: input.reporterId, signedBy: input.reporterId,
    signedAt: new Date(), totalAmount: 0, currency: 'IRR', contractData: { products: [], deliveries: [], payment: { payments: [] } } } });
  const response = await fetch(input.baseUrl + '/api/contracts/' + encodeURIComponent(contract.id) + '/print', {
    method: 'PUT', headers: { cookie: 'sabalan_session=' + input.sessionToken, 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'Private native restore qualification' }), redirect: 'error',
  });
  const body = await response.text(); assert.equal(response.status, 200, body);
  const row = await input.db.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(row.status, 'PRINTED'); assert.ok(row.printedAt);
  const signature = (row.signatures as any)?.print; assert.equal(signature?.by, input.reporterId);
  assert.equal(typeof signature?.pdfPath, 'string'); const fileName = path.basename(signature.pdfPath);
  assert.equal(path.dirname(signature.pdfPath), path.join(process.cwd(), 'storage', 'contracts'));
  const bytes = await download(input, fileName);
  return { format: 'sabalan-native-contract-print/v1', contractId: row.id, contractNumber: row.contractNumber,
    customerId: customer.id, departmentId: department.id, reporterId: input.reporterId, storedPath: signature.pdfPath,
    fileName, sha256: digest(bytes), byteLength: bytes.length, printedAt: row.printedAt.toISOString(), signature };
}

/** Verifies restored SQL meaning and actual HTTP-served retained PDF bytes;
 * does not regenerate or mutate the restored contract to hide missing data. */
export async function verifyRestoredContractPrint(input: Transport & { qualification: NativeContractPrintQualification }): Promise<void> {
  const q = input.qualification; assert.equal(q.format, 'sabalan-native-contract-print/v1');
  const row = await input.db.contract.findUniqueOrThrow({ where: { id: q.contractId } });
  assert.equal(row.status, 'PRINTED'); assert.equal(row.contractNumber, q.contractNumber);
  assert.equal(row.customerId, q.customerId); assert.equal(row.departmentId, q.departmentId);
  assert.equal(row.createdBy, q.reporterId); assert.equal(row.printedAt?.toISOString(), q.printedAt);
  assert.deepEqual((row.signatures as any)?.print, q.signature);
  assert.equal((row.signatures as any)?.print?.pdfPath, q.storedPath); assert.equal(path.basename(q.storedPath), q.fileName);
  const bytes = await download(input, q.fileName); assert.equal(bytes.length, q.byteLength); assert.equal(digest(bytes), q.sha256);
}
