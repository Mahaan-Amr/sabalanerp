import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';

type ProposedAccount = { sourceId: string; sourceHash: string; proposedTargetCode: string; parentCode: string | null; level: 'GROUP' | 'KOL' | 'MOIN'; titlePersian: string; sourceBalanceType: number; proposedStatementRole: string | null };
type Proposal = { snapshotId: string; sourcePackageHash: string; mappingVersion: number; accounts: ProposedAccount[];
  parties: Array<{ sourceId: string; sourceHash: string; displayName: string; roles: string[]; sourceDLRef: number | null }>;
  banks: Array<{ sourceId: string; sourceHash: string; accountNumber: string; iban: string | null; sourceDLRef: number | null }>;
  details: Array<{ sourceId: string; sourceHash: string; code: string; titlePersian: string }> };
const bookId = 'cmub2hd63007zrqlphrzi5eey';
const effectiveFrom = new Date('2025-03-21T00:00:00.000Z');
const actorId = 'sepidar-user-approved-development-import';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const idFor = (kind: string, sourceId: string) => sha(`${bookId}:${kind}:${sourceId}`);
const path = process.env.SEPIDAR_MAPPING_PROPOSAL;
if (!path) throw new Error('SEPIDAR_MAPPING_PROPOSAL is required');
const proposalContent = readFileSync(path, 'utf8');
const proposalHash = sha(proposalContent);
const proposal = JSON.parse(proposalContent) as Proposal;
const apply = process.argv.includes('--apply');

const roleFor = (account: ProposedAccount) => {
  if (!account.proposedTargetCode.startsWith('62')) return account.proposedStatementRole;
  if (account.level !== 'MOIN') return 'EXPENSE';
  return account.sourceBalanceType === 2 ? 'REVENUE' : 'EXPENSE';
};
const sideFor = (account: ProposedAccount) => {
  const role = roleFor(account);
  const defaultSide = ['LIABILITY', 'EQUITY', 'REVENUE'].includes(role ?? '') ? 'CREDIT' : 'DEBIT';
  return account.level === 'MOIN' && account.sourceBalanceType === 1 ? 'DEBIT'
    : account.level === 'MOIN' && account.sourceBalanceType === 2 ? 'CREDIT' : defaultSide;
};

const main = async () => {
  const db = new PrismaClient();
  try {
    const [snapshot, book, scheme] = await Promise.all([
      db.accountingSepidarSourceSnapshot.findUnique({ where: { id: proposal.snapshotId } }),
      db.accountingBook.findUnique({ where: { id: bookId } }),
      db.accountingCodeScheme.findUnique({ where: { bookId_version: { bookId, version: 1 } } }),
    ]);
    if (!snapshot || snapshot.status !== 'COMPLETE' || snapshot.bookId !== bookId || snapshot.sourcePackageHash !== proposal.sourcePackageHash || !book || !scheme
      || scheme.groupLength !== 2 || scheme.kolLength !== 2 || scheme.moinLength !== 2) throw new Error('Complete snapshot and prepared 2/2/2 target book required');
    if (proposal.accounts.length !== 195 || proposal.parties.length !== 1514 || proposal.banks.length !== 62 || proposal.details.length !== 1617) throw new Error('Proposal coverage does not match audited source');
    const codes = new Set<string>();
    for (const account of proposal.accounts) {
      if (codes.has(account.proposedTargetCode) || !roleFor(account) || !['DEBIT', 'CREDIT'].includes(sideFor(account))) throw new Error(`Incomplete account meaning: ${account.proposedTargetCode}`);
      codes.add(account.proposedTargetCode);
      if (account.parentCode && !proposal.accounts.some((candidate) => candidate.proposedTargetCode === account.parentCode)) throw new Error(`Missing source account parent: ${account.proposedTargetCode}`);
    }
    const counts = { accounts: proposal.accounts.length, parties: proposal.parties.length, banks: proposal.banks.length, details: proposal.details.length };
    if (!apply) { console.log(JSON.stringify({ action: 'dry-run', bookId, snapshotId: snapshot.id, counts, approval: 'USER_APPROVED_DEVELOPMENT_ONLY' })); return; }
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sepidar:master-data:' + bookId}))`;
      const otherAccounts = await tx.accountingLedgerAccount.count({ where: { bookId, createdBy: { not: actorId } } });
      if (otherAccounts) throw new Error('Target chart has independently maintained accounts; refusing overwrite or merge');
      const existingLinks = await tx.accountingSepidarTargetLink.findMany({ where: { bookId }, select: { sourceTable: true, sourceKey: true, reviewEvidence: true } });
      if (existingLinks.some((link) => link.reviewEvidence !== proposalHash)) throw new Error('Existing mapping version differs from this proposal; use a reviewed successor instead of overwriting it');
      const accountByCode = new Map(proposal.accounts.map((account) => [account.proposedTargetCode, account]));
      for (const level of ['GROUP', 'KOL', 'MOIN'] as const) {
        const accounts = proposal.accounts.filter((item) => item.level === level);
        await tx.accountingLedgerAccount.createMany({ data: accounts.map((account) => ({
          id: idFor('ACCOUNT', account.sourceId), bookId, codeSchemeId: scheme.id, code: account.proposedTargetCode,
          titlePersian: account.titlePersian, level, normalSide: sideFor(account) as 'DEBIT' | 'CREDIT',
          statementRole: roleFor(account) as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'MEMO',
          parentId: account.parentCode ? idFor('ACCOUNT', accountByCode.get(account.parentCode)!.sourceId) : null,
          partyRequirement: level === 'MOIN' ? 'OPTIONAL' : 'FORBIDDEN',
          financialAccountRequirement: level === 'MOIN' ? 'OPTIONAL' : 'FORBIDDEN',
          effectiveFrom, createdBy: actorId,
        })), skipDuplicates: true });
      }
      await tx.accountingParty.createMany({ data: proposal.parties.map((party) => ({
        id: idFor('PARTY', party.sourceId), legalEntityId: book.legalEntityId, sourceKind: 'SEPIDAR', sourceId: party.sourceId,
        displayName: party.displayName || `شخص سپیدار ${party.sourceId}`, activeFrom: effectiveFrom,
      })), skipDuplicates: true });
      await tx.accountingPartyRoleAssignment.createMany({ data: proposal.parties.flatMap((party) => party.roles.map((role) => ({
        id: idFor(`PARTY_ROLE:${role}`, party.sourceId), partyId: idFor('PARTY', party.sourceId),
        role: role as 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'OTHER', effectiveFrom, createdBy: actorId,
        evidenceType: 'SEPIDAR', evidenceId: party.sourceId, evidenceVersion: 1, evidenceHash: party.sourceHash,
      }))), skipDuplicates: true });
      const detailById = new Map(proposal.details.map((detail) => [detail.sourceId, detail]));
      await tx.accountingFinancialAccount.createMany({ data: proposal.banks.map((bank) => ({
        id: idFor('BANK', bank.sourceId), legalEntityId: book.legalEntityId, kind: 'BANK',
        titlePersian: (bank.sourceDLRef == null ? null : detailById.get(String(bank.sourceDLRef))?.titlePersian) || `حساب بانکی سپیدار ${bank.sourceId}`,
        accountNumber: bank.accountNumber || null, iban: bank.iban || null, currency: 'IRR', activeFrom: effectiveFrom, createdBy: actorId,
      })), skipDuplicates: true });
      const dimensionId = idFor('DIMENSION_TYPE', 'DL');
      await tx.accountingDimensionType.upsert({ where: { bookId_code: { bookId, code: 'SEPIDAR_DL' } },
        create: { id: dimensionId, bookId, code: 'SEPIDAR_DL', titlePersian: 'تفصیلی سپیدار', sourceKind: 'SEPIDAR_ACC_DL', effectiveFrom, createdBy: actorId },
        update: {} });
      await tx.accountingDimensionMember.createMany({ data: proposal.details.map((detail) => ({
        id: idFor('DL', detail.sourceId), dimensionTypeId: dimensionId, sourceId: detail.sourceId, code: detail.code,
        titlePersian: detail.titlePersian, effectiveFrom,
      })), skipDuplicates: true });
      await tx.accountingLedgerAccountDimensionRule.createMany({ data: proposal.accounts.filter((account) => account.level === 'MOIN').map((account) => ({
        accountId: idFor('ACCOUNT', account.sourceId), dimensionTypeId: dimensionId, requirement: 'OPTIONAL',
      })), skipDuplicates: true });
      const links = [
        ...proposal.accounts.map((item) => ({ table: 'ACC.Account', key: item.sourceId, hash: item.sourceHash, kind: 'LEDGER_ACCOUNT', targetId: idFor('ACCOUNT', item.sourceId) })),
        ...proposal.parties.map((item) => ({ table: 'GNR.Party', key: item.sourceId, hash: item.sourceHash, kind: 'PARTY', targetId: idFor('PARTY', item.sourceId) })),
        ...proposal.banks.map((item) => ({ table: 'RPA.BankAccount', key: item.sourceId, hash: item.sourceHash, kind: 'FINANCIAL_ACCOUNT', targetId: idFor('BANK', item.sourceId) })),
        ...proposal.details.map((item) => ({ table: 'ACC.DL', key: item.sourceId, hash: item.sourceHash, kind: 'DIMENSION_MEMBER', targetId: idFor('DL', item.sourceId) })),
      ];
      for (let index = 0; index < links.length; index += 500) await tx.accountingSepidarTargetLink.createMany({ data: links.slice(index, index + 500).map((link) => ({
        id: idFor(`LINK:${link.table}:${link.kind}`, link.key), bookId, sourceTable: link.table, sourceKey: link.key,
        sourceHash: link.hash, firstSnapshotId: snapshot.id, latestSnapshotId: snapshot.id, targetKind: link.kind,
        targetId: link.targetId, mappingVersion: proposal.mappingVersion, reviewStatus: 'USER_APPROVED',
        reviewedBy: actorId, reviewEvidence: proposalHash,
      })), skipDuplicates: true });
      return { action: 'materialized', bookId, snapshotId: snapshot.id, counts, links: links.length };
    }, { timeout: 120_000, maxWait: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
