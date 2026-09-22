import { createHmac } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { hashAccountingEvidence } from '../services/accountingLedgerFoundation';

const payloadPath = process.argv[2];
const producerId = process.env.ACCOUNTING_RECONCILIATION_PRODUCER_ID || '';
const producerSecret = process.env.ACCOUNTING_RECONCILIATION_PRODUCER_SECRET || '';
const endpoint = process.env.ACCOUNTING_RECONCILIATION_URL
  || 'http://127.0.0.1:5000/api/accounting/period-end/operational-reconciliations';

if (!payloadPath) throw new Error('Usage: npm run accounting:reconciliation:submit -- <payload.json>');
if (!producerId || Buffer.byteLength(producerSecret) < 32) {
  throw new Error('ACCOUNTING_RECONCILIATION_PRODUCER_ID and a 32-byte producer secret are required.');
}

const main = async () => {
  const payload = JSON.parse(await readFile(resolve(payloadPath), 'utf8')) as Record<string, unknown>;
  const signature = createHmac('sha256', producerSecret)
    .update(hashAccountingEvidence(payload))
    .digest('hex');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Accounting-Reconciliation-Producer': producerId,
      'X-Accounting-Reconciliation-Signature': signature,
    },
    body: JSON.stringify(payload),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`Reconciliation rejected (${response.status}): ${responseBody}`);
  process.stdout.write(`${responseBody}\n`);
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
