import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PurchasingError, docData, type Doc, type JsonObject } from './domain';
export type Tx = Prisma.TransactionClient;
export const asDoc = (row: any): Doc => ({ ...row, data: docData(row) });
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function document(tx: Tx | PrismaClient, id: string, kind?: string): Promise<Doc> {
  const row = await tx.purchasingDocument.findUnique({ where: { id } });
  if (!row || kind && row.kind !== kind) throw new PurchasingError('DOCUMENT_NOT_FOUND', 'سند موردنظر پیدا نشد؛ فهرست را به‌روزرسانی کنید.', 404);
  return asDoc(row);
}
export async function graph(tx: Tx | PrismaClient, orderId: string) {
  return (await tx.purchasingDocument.findMany({ where: { OR: [{ id: orderId }, { parentId: orderId }, { kind: 'EXCHANGE', data: { path: ['orderId'], equals: orderId } }] } })).map(asDoc);
}
export async function record(tx: Tx, actorId: string, doc: Doc, action: string, details: unknown) {
  const prior = await tx.purchasingEvent.findFirst({ where: { documentId: doc.id }, orderBy: { version: 'desc' } });
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, role: true } });
  const evidence = { actor: { id: actorId, name: actor ? `${actor.firstName} ${actor.lastName}`.trim() : actorId, role: actor?.role || null }, details };
  const body = { documentId: doc.id, version: doc.version, actorId, action, details: evidence, previousHash: prior?.entryHash || null };
  await tx.purchasingEvent.create({ data: { documentId: doc.id, version: doc.version, actorId, action, data: json(evidence), previousHash: prior?.entryHash, entryHash: hash(body) } });
}
export async function createDocument(tx: Tx, actorId: string, kind: string, data: JsonObject, refs: { ownerId?: string; contractId?: string | null; customerId?: string | null; parentId?: string | null } = {}) {
  const doc = asDoc(await tx.purchasingDocument.create({ data: { kind, creatorId: actorId, ownerId: refs.ownerId || actorId, contractId: refs.contractId, customerId: refs.customerId, parentId: refs.parentId, data: json(data) } }));
  await record(tx, actorId, doc, 'CREATED', data);
  return doc;
}
export async function updateDocument(tx: Tx, actorId: string, doc: Doc, action: string, data: JsonObject, expectedVersion?: unknown, extra: { status?: string; ownerId?: string; contractId?: string | null; customerId?: string | null } = {}) {
  if (expectedVersion !== undefined && expectedVersion !== doc.version) throw new PurchasingError('VERSION_CONFLICT', 'این پرونده هم‌زمان تغییر کرده است. نوشته‌هایتان حفظ شده؛ اطلاعات تازه را بررسی و دوباره ثبت کنید.');
  const changed = await tx.purchasingDocument.updateMany({ where: { id: doc.id, version: doc.version }, data: { data: json(data), version: { increment: 1 }, ...extra } });
  if (changed.count !== 1) throw new PurchasingError('VERSION_CONFLICT', 'پرونده تغییر کرده است؛ پیش از ثبت دوباره، اطلاعات تازه را بررسی کنید.');
  const next = await document(tx, doc.id);
  await record(tx, actorId, next, action, { before: { data: doc.data, status: doc.status, ownerId: doc.ownerId, contractId: doc.contractId, customerId: doc.customerId }, after: { data, status: next.status, ownerId: next.ownerId, contractId: next.contractId, customerId: next.customerId } });
  return next;
}
