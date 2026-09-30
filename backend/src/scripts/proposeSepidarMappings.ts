import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

type SourceRow = { sourceKey: string; sourceHash: string; payload: unknown };
type Payload = Record<string, unknown>;
const object = (row: SourceRow): Payload => row.payload as Payload;
const text = (value: unknown) => value == null ? '' : String(value).trim();
const bool = (value: unknown) => value === true;
const snapshotId = process.env.SEPIDAR_SNAPSHOT_ID;
const output = process.env.SEPIDAR_MAPPING_OUTPUT;
if (!snapshotId || !output) throw new Error('SEPIDAR_SNAPSHOT_ID and SEPIDAR_MAPPING_OUTPUT are required');

const main = async () => {
  const db = new PrismaClient();
  try {
    const snapshot = await db.accountingSepidarSourceSnapshot.findUnique({ where: { id: snapshotId }, select: { id: true, status: true, sourcePackageHash: true } });
    if (!snapshot || snapshot.status !== 'COMPLETE') throw new Error('Complete source snapshot required');
    const tables = ['ACC.Account', 'ACC.DL', 'GNR.Party', 'RPA.BankAccount', 'INV.Item', 'INV.Stock', 'INV.Unit'] as const;
    const rows = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await db.accountingSepidarSourceRecord.findMany({
      where: { snapshotId, sourceTable: table }, select: { sourceKey: true, sourceHash: true, payload: true }, orderBy: { sourceKey: 'asc' },
    })]))) as Record<typeof tables[number], SourceRow[]>;
    const accountsById = new Map(rows['ACC.Account'].map((row) => [row.sourceKey, row]));
    const codeFor = (row: SourceRow, seen = new Set<string>()): string => {
      if (seen.has(row.sourceKey)) throw new Error(`Cycle in source account hierarchy: ${row.sourceKey}`);
      seen.add(row.sourceKey);
      const payload = object(row);
      const segment = text(payload.Code);
      const parentKey = text(payload.ParentAccountRef);
      if (parentKey === '-5') return segment;
      const parent = accountsById.get(parentKey);
      if (!parent) throw new Error(`Missing parent for source account ${row.sourceKey}`);
      return codeFor(parent, seen) + segment;
    };
    const defaultRole = (code: string) => ({
      '11': 'ASSET', '12': 'ASSET', '21': 'LIABILITY', '22': 'LIABILITY', '31': 'EQUITY',
      '41': 'REVENUE', '51': 'EXPENSE', '61': 'EXPENSE', '91': 'MEMO',
    } as Record<string, string>)[code.slice(0, 2)] ?? null;
    const accounts = rows['ACC.Account'].filter((row) => row.sourceKey !== '-5').map((row) => {
      const payload = object(row);
      const code = codeFor(row);
      const level = ({ '1': 'GROUP', '2': 'KOL', '3': 'MOIN' } as Record<string, string>)[text(payload.Type)];
      if (!level || code.length !== ({ GROUP: 2, KOL: 4, MOIN: 6 } as Record<string, number>)[level]) throw new Error(`Invalid code/level for account ${row.sourceKey}: ${code}`);
      const parent = accountsById.get(text(payload.ParentAccountRef));
      const parentCode = parent?.sourceKey === '-5' ? null : parent ? codeFor(parent) : null;
      const role = defaultRole(code);
      return { sourceId: row.sourceKey, sourceHash: row.sourceHash, proposedTargetCode: code, parentCode, level,
        titlePersian: text(payload.Title), sourceBalanceType: payload.BalanceType, proposedStatementRole: role,
        proposedNormalSide: null, sourceHasDL: bool(payload.HasDL), active: bool(payload.IsActive),
        reviewStatus: 'PENDING_ACCOUNTANT', reviewReason: role ? 'ماهیت، نقش، حساب کاهنده و الزام تفصیلی باید تأیید شود.' : 'گروه مختلط درآمد و هزینه؛ نقش هر حساب باید جداگانه تعیین شود.',
      };
    }).sort((a, b) => a.proposedTargetCode.localeCompare(b.proposedTargetCode));
    if (accounts.length !== 195 || new Set(accounts.map((account) => account.proposedTargetCode)).size !== accounts.length) throw new Error('Source chart is not the expected 195 unique non-root accounts');
    const parties = rows['GNR.Party'].map((row) => {
      const payload = object(row);
      const roles = [bool(payload.IsCustomer) && 'CUSTOMER', bool(payload.IsVendor) && 'SUPPLIER', bool(payload.IsEmployee) && 'EMPLOYEE'].filter(Boolean);
      return { sourceId: row.sourceKey, sourceHash: row.sourceHash, proposedTargetIdentity: `SEPIDAR:PARTY:${row.sourceKey}`,
        displayName: [text(payload.LastName), text(payload.Name)].filter(Boolean).join(' ').trim(), sourceDLRef: payload.DLRef,
        roles: roles.length ? roles : ['OTHER'], reviewStatus: 'PENDING_ACCOUNTANT' };
    });
    const banks = rows['RPA.BankAccount'].map((row) => ({ sourceId: row.sourceKey, sourceHash: row.sourceHash,
      proposedTargetIdentity: `SEPIDAR:BANK_ACCOUNT:${row.sourceKey}`, accountNumber: text(object(row).AccountNo), iban: text(object(row).ShebaNumber) || null,
      sourceDLRef: object(row).DlRef, branchRef: object(row).BankBranchRef, reviewStatus: 'PENDING_ACCOUNTANT' }));
    const items = rows['INV.Item'].map((row) => ({ sourceId: row.sourceKey, sourceHash: row.sourceHash,
      proposedTargetIdentity: `SEPIDAR:ITEM:${row.sourceKey}`, code: text(object(row).Code), titlePersian: text(object(row).Title),
      unitRef: object(row).UnitRef, saleUnitRef: object(row).SaleUnitRef, defaultStockRef: object(row).DefaultStockRef,
      reviewStatus: 'PENDING_ACCOUNTANT' }));
    const warehouses = rows['INV.Stock'].map((row) => ({ sourceId: row.sourceKey, sourceHash: row.sourceHash,
      proposedTargetIdentity: `SEPIDAR:STOCK:${row.sourceKey}`, code: text(object(row).Code), titlePersian: text(object(row).Title),
      accountSLRef: object(row).AccountSLRef, reviewStatus: 'PENDING_ACCOUNTANT' }));
    const units = rows['INV.Unit'].map((row) => ({ sourceId: row.sourceKey, sourceHash: row.sourceHash,
      proposedTargetIdentity: `SEPIDAR:UNIT:${row.sourceKey}`, titlePersian: text(object(row).Title), reviewStatus: 'PENDING_ACCOUNTANT' }));
    const dlOwners = new Map<string, string[]>();
    for (const party of parties) if (party.sourceDLRef != null) dlOwners.set(text(party.sourceDLRef), [...(dlOwners.get(text(party.sourceDLRef)) ?? []), party.proposedTargetIdentity]);
    for (const bank of banks) if (bank.sourceDLRef != null) dlOwners.set(text(bank.sourceDLRef), [...(dlOwners.get(text(bank.sourceDLRef)) ?? []), bank.proposedTargetIdentity]);
    const details = rows['ACC.DL'].map((row) => ({ sourceId: row.sourceKey, sourceHash: row.sourceHash, code: text(object(row).Code),
      titlePersian: text(object(row).Title), sourceType: object(row).Type, proposedOwners: dlOwners.get(row.sourceKey) ?? [],
      reviewStatus: 'PENDING_ACCOUNTANT' }));
    const proposal = { format: 'sepidar-mapping-proposal-v1', snapshotId, sourcePackageHash: snapshot.sourcePackageHash, mappingVersion: 1,
      allMappingsRequireAccountantApproval: true, accounts, parties, banks, items, warehouses, units, details,
      counts: { accounts: accounts.length, parties: parties.length, banks: banks.length, items: items.length, warehouses: warehouses.length, units: units.length, details: details.length,
        detailsWithoutPartyOrBank: details.filter((detail) => detail.proposedOwners.length === 0).length,
        mixedAccountRoles: accounts.filter((account) => account.proposedStatementRole == null).length },
    };
    const content = JSON.stringify(proposal, null, 2) + '\n';
    writeFileSync(output, content, { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ output, sha256: createHash('sha256').update(content).digest('hex'), counts: proposal.counts }));
  } finally { await db.$disconnect(); }
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
