const u = new URL(process.env.DATABASE_URL);
u.searchParams.set('options', '-c default_transaction_read_only=on');
process.env.DATABASE_URL = u.toString();
const { prisma } = require('/app/dist/lib/prisma');
(async () => {
  const c = await prisma.salesContract.findUniqueOrThrow({ where: { contractNumber: '100697' }, select: { id: true, partnerCaseId: true } });
  const root = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: c.partnerCaseId }, select: { id: true, internalRecordId: true, headRevision: true, state: true } });
  const invoices = await prisma.accountingFinancialRecord.findMany({ where: { sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: root.internalRecordId }, select: { id: true, status: true, kind: true, systemInvoiceNumber: true, financiallyApprovedAt: true, postedAt: true, voidedAt: true, createdBy: true, createdAt: true } });
  if (invoices.length !== 1) throw Error('EXPECTED_ONE_INVOICE');
  const triggers = await prisma.$queryRawUnsafe(`SELECT t.tgname,p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='accounting_financial_records'::regclass AND NOT t.tgisinternal`);
  const refs = await prisma.$queryRawUnsafe(`SELECT con.conname,c.relname AS table_name,a.attname AS column_name,con.confdeltype,cardinality(con.conkey) AS key_columns FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=con.conkey[1] WHERE con.contype='f' AND con.confrelid='accounting_financial_records'::regclass ORDER BY c.relname`);
  for (const r of refs) {
    if (r.key_columns !== 1) throw Error('COMPOSITE_REFERENCE');
    const q = s => '"' + s.replaceAll('"', '""') + '"';
    r.count = Number((await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM ' + q(r.table_name) + ' WHERE ' + q(r.column_name) + ' = $1', invoices[0].id))[0].count);
  }
  console.log(JSON.stringify({ contractNumber: '100697', root, invoices, triggers, refs, polymorphic: {
    auditCount: await prisma.accountingAuditLog.count({ where: { OR: [{ recordId: invoices[0].id }, { entityId: invoices[0].id }] } }),
    flags: await prisma.accountingContractFlag.count({ where: { sourceFinancialRecordId: invoices[0].id } }),
    corrections: await prisma.accountingCorrectionRequest.count({ where: { recordId: invoices[0].id } }),
  } }));
})().catch(e => { console.log(JSON.stringify({ error: e.message, code: e.code })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
