import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../backend/node_modules/@prisma/client';

const main = async () => {
const prisma = new PrismaClient();
const root = resolve(process.cwd());
const manifestPath = resolve(root, 'tmp', 'legacy-owner-review-manifest.json');
const outputDir = resolve(root, 'output', 'reports');
const generatedAt = new Date().toISOString();

const manifestFile = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifest = manifestFile.beforeManifest;
const entries = manifest.entries as Array<any>;
const contractIds = entries.map((entry) => entry.contractId);
const recordIds = entries.map((entry) => entry.sourceFinancialRecordId);

const [contracts, records] = await Promise.all([
  prisma.salesContract.findMany({
    where: { id: { in: contractIds } },
    select: {
      id: true, contractNumber: true, title: true, titlePersian: true, status: true, createdAt: true,
      createdBy: true, responsibleSellerId: true,
      customer: { select: { firstName: true, lastName: true, companyName: true } },
    },
  }),
  prisma.accountingFinancialRecord.findMany({
    where: { id: { in: recordIds } },
    select: { id: true, status: true, createdBy: true, financiallyApprovedBy: true, financiallyApprovedAt: true },
  }),
]);

const userIds = [...new Set([
  ...contracts.flatMap((contract) => [contract.createdBy, contract.responsibleSellerId]),
  ...records.flatMap((record) => [record.createdBy, record.financiallyApprovedBy]).filter(Boolean),
])] as string[];
const users = await prisma.user.findMany({
  where: { id: { in: userIds } },
  select: { id: true, username: true, firstName: true, lastName: true, role: true, isActive: true },
});
const byContract = new Map(contracts.map((contract) => [contract.id, contract]));
const byRecord = new Map(records.map((record) => [record.id, record]));
const byUser = new Map(users.map((user) => [user.id, user]));
const displayUser = (id: string | null | undefined) => {
  if (!id) return 'UNASSIGNED';
  const user = byUser.get(id);
  return user ? `${user.firstName} ${user.lastName} (@${user.username})${user.isActive ? '' : ' [INACTIVE]'}` : `${id} [USER_NOT_FOUND]`;
};
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const rows = entries.map((entry) => {
  const contract = byContract.get(entry.contractId);
  const record = byRecord.get(entry.sourceFinancialRecordId);
  const customer = contract?.customer;
  const customerName = customer?.companyName || [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || 'UNKNOWN';
  const qaLike = /(?:^|\b)(DISPATCH|QA|TEST|ISSUE256)(?:\b|-)/i.test(`${contract?.contractNumber || ''} ${contract?.title || ''} ${contract?.titlePersian || ''}`)
    || /dispatch|verifier/i.test(customerName);
  const reasonCodes = [...new Set(entry.reasons.map((reason: any) => reason.code))].sort();
  return {
    contractId: entry.contractId,
    contractNumber: contract?.contractNumber || 'NOT_FOUND',
    title: contract?.titlePersian || contract?.title || '',
    contractStatus: contract?.status || 'NOT_FOUND',
    createdAt: contract?.createdAt?.toISOString() || '',
    customer: customerName,
    salesOwner: displayUser(contract?.responsibleSellerId),
    salesCreator: displayUser(contract?.createdBy),
    accountingOwner: displayUser(record?.financiallyApprovedBy || record?.createdBy),
    accountingStatus: record?.status || 'NOT_FOUND',
    financiallyApprovedAt: record?.financiallyApprovedAt?.toISOString() || '',
    sourceFinancialRecordId: entry.sourceFinancialRecordId,
    sourceEvidenceHash: entry.sourceEvidenceHash,
    sourceRowCount: entry.sourceCount,
    status: entry.status,
    reasonCodes,
    qaLike,
    recommendedDisposition: qaLike
      ? 'EXCLUDE_QA_TEST_DATA_AFTER_OWNER_CONFIRMATION'
      : 'CORRECT_SOURCE_AND_CREATE_SUCCESSOR_APPROVAL',
    ownerDecision: 'PENDING_OWNER_REVIEW',
  };
}).sort((left, right) => left.contractNumber.localeCompare(right.contractNumber));

const reasonCounts = new Map<string, number>();
for (const row of rows) for (const code of row.reasonCodes) reasonCounts.set(code, (reasonCounts.get(code) || 0) + 1);
const ownerCounts = new Map<string, number>();
for (const row of rows) ownerCounts.set(row.salesOwner, (ownerCounts.get(row.salesOwner) || 0) + 1);
const qaCount = rows.filter((row) => row.qaLike).length;
const missingSalesOwners = rows.filter((row) => /UNASSIGNED|USER_NOT_FOUND/.test(row.salesOwner)).length;
const missingAccountingOwners = rows.filter((row) => /UNASSIGNED|USER_NOT_FOUND/.test(row.accountingOwner)).length;
const inactiveSalesOwners = rows.filter((row) => row.salesOwner.includes('[INACTIVE]')).length;

await mkdir(outputDir, { recursive: true });
const headers = Object.keys(rows[0]).filter((key) => key !== 'reasonCodes');
const csvText = '\uFEFF' + [
  [...headers, 'reasonCodes'].map(csv).join(','),
  ...rows.map((row) => [...headers.map((key) => (row as any)[key]), row.reasonCodes.join('|')].map(csv).join(',')),
].join('\r\n') + '\r\n';
await writeFile(resolve(outputDir, 'legacy-contract-owner-review.csv'), csvText, 'utf8');

const topOwners = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const reasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const markdown = `# Legacy Contract Pricing Owner Review\n\n`+
`Generated: ${generatedAt}\n\n`+
`Authoritative dry-run manifest: \`${manifest.manifestHash}\`\n\n`+
`## Outcome\n\n`+
`- Current authoritative candidates: **${rows.length}** (the prior handoff reported 252; the local QA dataset now contains ${rows.length - 252 >= 0 ? rows.length - 252 : 0} additional candidate).\n`+
`- READY: **${rows.filter((row) => row.status === 'READY').length}**\n`+
`- REPAIR_REQUIRED: **${rows.filter((row) => row.status === 'REPAIR_REQUIRED').length}**\n`+
`- Likely QA/test records recommended for release-cohort exclusion after owner confirmation: **${qaCount}**\n`+
`- Business contracts requiring source correction and successor approval: **${rows.length - qaCount}**\n`+
`- Missing/unresolvable Sales owner: **${missingSalesOwners}**; inactive Sales owner: **${inactiveSalesOwners}**\n`+
`- Missing/unresolvable Accounting owner: **${missingAccountingOwners}**\n`+
`- Formal owner decisions recorded by this audit: **0**. Automated review cannot approve prices or exclude contracts on an owner's behalf.\n\n`+
`## Required owner action\n\n`+
`Every business contract remains blocked until the named Sales owner corrects the source through the manager-approved correction workflow and Accounting creates a successor valid financial approval. Likely QA/test records may be excluded only after an authorized owner confirms that classification and records the blocked disposition.\n\n`+
`## Sales owner routing\n\n| Sales owner | Contracts |\n|---|---:|\n${topOwners.map(([owner, count]) => `| ${owner.replaceAll('|', '\\|')} | ${count} |`).join('\n')}\n\n`+
`## Contract-level reason coverage\n\n| Reason | Affected contracts |\n|---|---:|\n${reasons.map(([reason, count]) => `| \`${reason}\` | ${count} |`).join('\n')}\n\n`+
`## Evidence and limitations\n\n`+
`The CSV beside this report contains every contract, stable internal identity, financial-record identity, source-evidence hash, Sales owner, Accounting owner, reason codes, and recommended routing. Customer-facing prices and full source snapshots are intentionally excluded. Recommendations are not approvals and do not change production or migration state.\n`;
await writeFile(resolve(outputDir, 'legacy-contract-owner-review.md'), markdown, 'utf8');
await writeFile(resolve(outputDir, 'legacy-contract-owner-review.json'), JSON.stringify({ generatedAt, manifestHash: manifest.manifestHash, rows }, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  generatedAt, manifestHash: manifest.manifestHash, total: rows.length, qaLike: qaCount,
  business: rows.length - qaCount, missingSalesOwners, inactiveSalesOwners, missingAccountingOwners,
  ownerGroups: topOwners.length, reasonCodes: reasons.length,
}, null, 2));
await prisma.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
