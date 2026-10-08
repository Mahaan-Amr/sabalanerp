const assert = require('node:assert/strict');
const { prisma } = require('/app/dist/lib/prisma.js');
const { getNextContractNumberPreview } = require('/app/dist/services/contractNumberService.js');
const { PartnerCreationContextSchema } = require('/packages/partner-sales-contracts/dist/index.js');
(async () => {
  const preview = await prisma.$transaction(tx => getNextContractNumberPreview('qa-preview-read-only', tx));
  assert.match(preview.contractNumber, /^\d+$/);
  const context = PartnerCreationContextSchema.parse({ schemaVersion: 1, kind: 'PARTNER', actorId: 'qa-preview-read-only',
    profileId: 'qa-preview-read-only', writable: true, contractNumberPreview: preview.contractNumber, inquiryIds: [], customers: [], projects: [] });
  assert.equal(context.contractNumberPreview, preview.contractNumber);
  console.log('Existing-database read-only numbering preview and current Partner context schema passed. No allocation or business mutation.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
