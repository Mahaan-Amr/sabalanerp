import type { PrismaClient } from '@prisma/client';
import { processNextTaxOutboxMessagePrisma } from './accountingCustomerTreasuryPrisma';

const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;

const resolveVaultReference = async (reference: string, keyVersion: string) => `${reference}\u0000${keyVersion}`;
const deliveryBrokerEndpoint = () => process.env.TAXPAYER_DELIVERY_BROKER_ENDPOINT?.trim();

export const deliverNextTaxpayerOutboxMessage = (database: PrismaClient) => processNextTaxOutboxMessagePrisma(database, {
  resolveSecret: resolveVaultReference,
  submit: async ({ channelKind, credential: opaqueSecretHandle, requestIdentity, protocolVersion, payload }) => {
    const endpoint = deliveryBrokerEndpoint();
    if (!endpoint) throw new Error('TAXPAYER_ENDPOINT_UNAVAILABLE');
    const [secretReference, keyVersion] = opaqueSecretHandle.split('\u0000');
    if (!secretReference || !keyVersion) throw new Error('TAXPAYER_SECRET_REFERENCE_INVALID');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json',
      'idempotency-key': requestIdentity, 'x-protocol-version': protocolVersion },
    body: JSON.stringify({ channelKind, secretReference, keyVersion, requestIdentity, protocolVersion, payload }),
    signal: controller.signal }).finally(() => clearTimeout(timeout));
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`TAXPAYER_HTTP_${response.status}`);
    const externalUniqueTaxId = String(body.externalUniqueTaxId ?? '').trim();
    if (!externalUniqueTaxId) throw new Error('TAXPAYER_EXTERNAL_ID_MISSING');
    return { externalUniqueTaxId, receiptNumber: typeof body.receiptNumber === 'string' ? body.receiptNumber : undefined,
      safeResponse: { status: typeof body.status === 'string' ? body.status : 'accepted',
        receiptNumber: typeof body.receiptNumber === 'string' ? body.receiptNumber : undefined } };
  },
});

export const startAccountingTaxpayerOutboxDelivery = (database: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await deliverNextTaxpayerOutboxMessage(database); }
    catch (error) { console.error('Accounting Taxpayer outbox delivery failed:', error instanceof Error ? error.name : 'UNKNOWN'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), POLL_INTERVAL_MS);
  timer.unref();
  return timer;
};
