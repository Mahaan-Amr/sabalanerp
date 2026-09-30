import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStructuredNumerals } from './normalizeStructuredNumerals';

test('normalizes Persian and Arabic numerals recursively at the server boundary', () => {
  assert.deepEqual(normalizeStructuredNumerals({ amount: '۱۲۳٫۴۵', nested: ['٠٩١٢٣', 'نسخه ۲'] }), {
    amount: '123.45', nested: ['09123', 'نسخه 2'],
  });
});

test('mixed inquiry answers preserve the hashed rejection reason at the HTTP boundary', async () => {
  const { canonicalHash, partnerInputHash, PartnerCommandSchema } = await import('@sabalanerp/partner-sales-contracts');
  const { normalizeStructuredNumeralsMiddleware } = await import('./normalizeStructuredNumerals');
  const intent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const,
    inquiryId: 'inquiry', expectedAssignmentRevision: 1, decisions: [
      { rowId: 'approved', expectedRevision: 1, outcome: 'APPROVED' as const,
        wholesaleUnitPrice: { amount: '100', currency: 'IRT' as const } },
      { rowId: 'rejected', expectedRevision: 1, outcome: 'REJECTED' as const,
        reason: 'عرض ۳۰، تعداد ۵ و اندازه ٢ اصلاح شود' },
    ] };
  const body = { ...intent, commandId: 'command', correlationId: 'correlation',
    idempotency: { actorId: 'actor', operation: intent.type, targetId: intent.inquiryId,
      key: 'command', payloadHash: await partnerInputHash(intent) } };
  const request = { originalUrl: '/api/partner/inquiries/commands', body };
  normalizeStructuredNumeralsMiddleware(request as never, {} as never, () => undefined);
  const { commandId, correlationId, idempotency, ...receivedIntent } = PartnerCommandSchema.parse(request.body);
  assert.equal(idempotency.payloadHash, await canonicalHash(receivedIntent));
  assert.equal(receivedIntent.type, 'INQUIRY_DECIDE');
  if (receivedIntent.type !== 'INQUIRY_DECIDE') throw new Error('inquiry command expected');
  assert.equal(receivedIntent.decisions[1].outcome === 'REJECTED' && receivedIntent.decisions[1].reason, 'عرض 30, تعداد 5 و اندازه 2 اصلاح شود');
});
