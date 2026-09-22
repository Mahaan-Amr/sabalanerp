import { prisma } from '../lib/prisma';
import { enqueueCommittedPartnerCase } from '../services/partnerSales/accounting/commitQueue';

const contractNumber = process.argv.find(argument => argument.startsWith('--contract='))?.slice('--contract='.length).trim();
const apply = process.argv.includes('--apply');

async function main() {
  if (!contractNumber) throw new Error('Pass --contract=<customer contract number>');
  const contract = await prisma.salesContract.findFirst({ where: { contractNumber, partnerKind: 'PARTNER_CUSTOMER',
    partnerCaseId: { not: null } }, select: { partnerCaseId: true, createdBy: true,
    partnerCase: { select: { state: true, profile: { select: { userId: true } } } } } });
  if (!contract?.partnerCaseId || contract.partnerCase?.state !== 'COMMITTED') throw new Error('Committed Partner contract not found');
  const existing = await prisma.accountingFinancialRecord.findFirst({ where: { sourceKind: 'PARTNER_INTERNAL_RECORD',
    metadata: { path: ['partnerCaseId'], equals: contract.partnerCaseId } }, select: { id: true } });
  if (existing) return { contractNumber, status: 'already-queued', queueEvidenceId: existing.id };
  if (!apply) return { contractNumber, status: 'missing', caseId: contract.partnerCaseId };
  const actorId = contract.partnerCase.profile.userId || contract.createdBy;
  const result = await prisma.$transaction(tx => enqueueCommittedPartnerCase(tx, { caseId: contract.partnerCaseId!, actorId }));
  if (!result.ok) throw new Error(`Queue reconciliation failed: ${result.error.code}`);
  return { contractNumber, status: 'queued', queueEvidenceId: result.value.queueEvidenceId };
}

main().then(result => console.log(JSON.stringify(result))).finally(() => prisma.$disconnect());
