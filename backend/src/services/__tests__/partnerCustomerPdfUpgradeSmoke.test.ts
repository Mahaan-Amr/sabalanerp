import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createCustomerOutputSnapshots } from '../partnerSales/customerOutput/snapshots';
import { generateCustomerContractPdf } from '../../utils/pdf';

const requireContract = createRequire(path.resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const contract = requireContract('@sabalanerp/partner-sales-contracts');
const testing = requireContract('@sabalanerp/partner-sales-contracts/testing');

test('Partner customer output renders through the production Puppeteer PDF path', async () => {
  const fixture = testing.createPartnerFixtures();
  const { seller: _seller, outputHash: _outputHash, ...retail } = fixture.customer;
  const snapshot = await createCustomerOutputSnapshots(contract).mint({
    snapshotId: 'puppeteer-upgrade-smoke',
    owner: fixture.case.head,
    normalizedRecipient: '+989120000001',
    createdAt: '2026-08-27T12:00:00.000Z',
    expiresAt: '2026-10-26T12:00:00.000Z',
    business: {
      tradeName: 'سنگ آفتاب',
      legalName: 'شرکت آفتاب',
      businessPhone: '02111111111',
      businessAddress: 'تهران، نشانی تجاری آزمایشی',
    },
    retail,
  });

  const bytes = await generateCustomerContractPdf(contract, snapshot.content);
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(bytes.length > 30_000, 'customer contract should contain branded PDF content');
});
