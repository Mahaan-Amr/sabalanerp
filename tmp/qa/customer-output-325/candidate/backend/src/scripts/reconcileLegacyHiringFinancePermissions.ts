import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const valueFor = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const apply = process.argv.includes('--apply');
const reviewedManifest = valueFor('--manifest');
const actorUserId = valueFor('--actor');
const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decisions = process.argv.flatMap((value, index, values) => value === '--decision' && values[index + 1] ? [values[index + 1]] : [])
  .map((value) => {
    const [userId, permissionList = ''] = value.split('=');
    return { userId, permissions: permissionList.split(',').filter(Boolean).sort() };
  });
const allowedTargets = new Set(['RECORD_COLLATERAL_CUSTODY', 'VERIFY_COLLATERAL_CUSTODY', 'VERIFY_SIGNED_EMPLOYMENT_CONTRACT']);
if (decisions.some((decision) => decision.permissions.some((permission) => !allowedTargets.has(permission)))) {
  throw new Error('INVALID_EXPLICIT_PERMISSION_DECISION');
}

async function buildReport() {
  const grants = await prisma.hrFeatureAccessGrant.findMany({
    where: { featureCode: 'MANAGE_FINANCE_EVIDENCE', status: 'ACTIVE' },
    orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
  });
  const rows = [] as Array<Record<string, unknown>>;
  for (const grant of grants) {
    const authorities = await prisma.hrBusinessAuthorityGrant.findMany({
      where: { userId: grant.userId, status: 'ACTIVE', authorityCode: { in: ['FINANCE_RECORDER', 'FINANCE_MANAGER'] } },
      select: { authorityCode: true }, orderBy: { authorityCode: 'asc' },
    });
    const codes = authorities.map((item) => item.authorityCode);
    const explicitDecision = decisions.find((decision) => decision.userId === grant.userId);
    const targetPermissions = explicitDecision?.permissions || (codes.length === 1
      ? codes[0] === 'FINANCE_RECORDER'
        ? ['RECORD_COLLATERAL_CUSTODY']
        : ['VERIFY_COLLATERAL_CUSTODY', 'VERIFY_SIGNED_EMPLOYMENT_CONTRACT']
      : []);
    rows.push({ grantId: grant.id, userId: grant.userId, authorityCodes: codes,
      targetPermissions, decisionSource: explicitDecision ? 'EXPLICIT_ADMIN_DECISION' : codes.length === 1 ? 'LEGACY_AUTHORITY_MAPPING' : null,
      action: targetPermissions.length ? 'ADD_NARROW_GRANTS_KEEP_LEGACY_HISTORY' : 'ADMIN_DECISION_REQUIRED' });
  }
  const output = { version: 1, operation: 'RECONCILE_LEGACY_HIRING_FINANCE_PERMISSIONS', rows };
  return { output, manifest: digest(output) };
}

async function main() {
  const report = await buildReport();
  console.log(JSON.stringify({ ...report.output, manifest: report.manifest }, null, 2));
  if (!apply) return;
  if (!actorUserId) throw new Error('ACTOR_REQUIRED');
  if (!reviewedManifest || reviewedManifest !== report.manifest) throw new Error('REVIEWED_MANIFEST_REQUIRED');
  for (const row of report.output.rows) {
    if (row.action !== 'ADD_NARROW_GRANTS_KEEP_LEGACY_HISTORY') continue;
    for (const featureCode of row.targetPermissions as string[]) {
      await prisma.hrFeatureCatalog.upsert({ where: { code: featureCode }, update: { isActive: true }, create: {
        code: featureCode, workspaceCode: 'HUMAN_RESOURCES', displayName: featureCode,
      } });
      await prisma.hrFeatureAccessGrant.upsert({ where: {
        stableKey: `legacy-finance-cutover:${row.grantId}:${featureCode}`,
      }, update: {}, create: {
        stableKey: `legacy-finance-cutover:${row.grantId}:${featureCode}`,
        userId: String(row.userId), featureCode, level: 'EDIT', effectiveFrom: new Date(),
        grantedByUserId: actorUserId, reason: `Cutover from legacy grant ${row.grantId}; legacy history retained`,
      } });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
