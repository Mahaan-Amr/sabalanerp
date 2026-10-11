import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { casePdfAvailability, casePdfContent, readCasePdfConfirmation } from '../../customerOutput/casePdf';
import { createCustomerOutputSnapshots } from '../../customerOutput/snapshots';

test('committed authorized Case can preview and print before sending any SMS', () => {
  assert.deepEqual(casePdfAvailability({ authorized: true, state: 'COMMITTED', hasContent: true, hasSnapshot: false }),
    { canPreview: true, canIssue: true });
  assert.deepEqual(casePdfAvailability({ authorized: false, state: 'COMMITTED', hasContent: true, hasSnapshot: true }),
    { canPreview: false, canIssue: false });
  assert.equal(casePdfAvailability({ authorized: true, state: 'DRAFT', hasContent: true, hasSnapshot: false }).canIssue, false);
});

test('final PDF seals existing retail content as printed without pretending customer signed', async () => {
  const fixture = createPartnerFixtures();
  const { seller, outputHash, ...retail } = fixture.customer;
  const sealed = await createCustomerOutputSnapshots(contracts).mint({ snapshotId: 'case-pdf-test', owner: fixture.case.head,
    normalizedRecipient: '+989120000001', createdAt: '2026-09-29T10:00:00.000Z', expiresAt: '2026-10-29T10:00:00.000Z',
    business: { legalName: seller.displayName, businessPhone: seller.phone, businessAddress: seller.address },
    retail: { ...retail, status: 'DRAFT', confirmation: 'NOT_SENT', signatures: [] } });
  const final = await casePdfContent(sealed.content, 'FINAL');
  assert.equal(final.status, 'PRINTED');
  assert.equal(final.confirmation, 'NOT_SENT');
  assert.deepEqual(final.signatures, []);
  assert.deepEqual(final.products, sealed.content.products);
  assert.deepEqual(final.totals, sealed.content.totals);
  assert.deepEqual(await casePdfContent(sealed.content, 'PREVIEW'), sealed.content);
});

test('output request requires immutable revision evidence or an existing snapshot', () => {
  assert.equal(contracts.PartnerCustomerOutputRequestSchema.safeParse({ mode: 'FINAL' }).success, false);
  assert.equal(contracts.PartnerCustomerOutputRequestSchema.safeParse({ mode: 'FINAL', expected: createPartnerFixtures().case.head }).success, true);
  assert.equal(contracts.PartnerCustomerOutputRequestSchema.safeParse({ mode: 'PREVIEW', snapshotId: 'existing-snapshot' }).success, true);
});

 test('PDF reflects authenticated current confirmation without inventing a signature or changing frozen prices', async () => {
  const content = createPartnerFixtures().customer;
  const output = await casePdfContent(content, 'FINAL', 'VERIFIED');
  assert.equal(output.confirmation, 'VERIFIED');
  assert.deepEqual(output.signatures, content.signatures);
  assert.deepEqual(output.products, content.products);
  assert.deepEqual(output.totals, content.totals);
  assert.equal(content.confirmation, 'NOT_SENT');
  const preview = await casePdfContent(content, 'PREVIEW', 'VERIFIED');
  assert.equal(preview.status, 'APPROVED');
  assert.equal(preview.confirmation, 'VERIFIED');
  assert.equal((await casePdfContent(content, 'PREVIEW', 'INVALIDATED')).confirmation, 'INVALIDATED');
 });

test('PDF confirmation resolver rejects obsolete acceptance and cancelled or different revisions', async () => {
  let root = { headRevision: 4, commercialFlowVersion: 1, customerConfirmationState: 'APPROVED', state: 'COMMITTED', customerContractId: 'contract' };
  let sale = { commercialRevision: 3, customerAcceptanceRevision: 3, customerAcceptanceMethod: 'DIGITAL' };
  const tx = { partnerSaleCase: { findUnique: async () => root }, salesContract: { findUnique: async () => sale },
    contractPublicConfirmation: { findFirst: async () => null } } as unknown as Parameters<typeof readCasePdfConfirmation>[0];
  assert.equal(await readCasePdfConfirmation(tx, 'case', 4), 'VERIFIED');
  sale = { ...sale, customerAcceptanceMethod: 'PAPER' };
  assert.equal(await readCasePdfConfirmation(tx, 'case', 4), 'NOT_SENT');
  sale = { ...sale, customerAcceptanceMethod: 'DIGITAL' };
  sale = { ...sale, customerAcceptanceRevision: 2 };
  assert.equal(await readCasePdfConfirmation(tx, 'case', 4), 'NOT_SENT');
  assert.equal(await readCasePdfConfirmation(tx, 'case', 3), 'INVALIDATED');
  root = { ...root, state: 'CANCELLED' };
  assert.equal(await readCasePdfConfirmation(tx, 'case', 4), 'INVALIDATED');
});
