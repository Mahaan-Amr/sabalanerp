import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requireWorkspaceAccessWithClient, WORKSPACES, WORKSPACE_PERMISSIONS } from '../../middleware/workspace';
import {
  deduplicatePersonnelReportParticipants,
  normalizePersonnelReportDirectoryQuery,
  normalizePersonnelReportHistoryQuery,
  personnelReportReporterSearchWhere,
} from '../securityPersonnelReportHistory';

const directory = normalizePersonnelReportDirectoryQuery({
  q: '  علی  رضایی ', status: 'all', departmentId: 'dep-1', hasReports: 'true', page: '3', pageSize: '500'
});
assert.deepEqual(directory, {
  q: 'علی رضایی', status: 'all', departmentId: 'dep-1', hasReports: true, page: 3, pageSize: 100
});

const history = normalizePersonnelReportHistoryQuery({
  q: ' ورود ', status: 'VOIDED', startDate: '2026-08-01', endDate: '2026-08-08',
  categoryId: 'cat', reportTypeId: 'type', reporterId: 'guard', attachments: 'with', page: '2', pageSize: '10'
});
assert.deepEqual(history, {
  q: 'ورود', status: 'VOIDED', startDate: '2026-08-01', endDate: '2026-08-08',
  categoryId: 'cat', reportTypeId: 'type', reporterId: 'guard', attachments: 'with', page: 2, pageSize: 10
});

assert.deepEqual(
  deduplicatePersonnelReportParticipants([
    { personnelId: null, userId: 'legacy-user', user: { personnel: { id: 'person-1' } } },
    { personnelId: 'person-1', userId: null },
    { personnelId: null, userId: 'unlinked-user', user: { personnel: null } },
  ]),
  [
    { personnelId: 'person-1', userId: null },
    { personnelId: null, userId: 'unlinked-user', user: { personnel: null } },
  ]
);

assert.deepEqual(personnelReportReporterSearchWhere('  علی   رضایی '), {
  AND: [
    { OR: [
      { firstName: { contains: 'علی', mode: 'insensitive' } },
      { lastName: { contains: 'علی', mode: 'insensitive' } },
      { username: { contains: 'علی', mode: 'insensitive' } },
    ] },
    { OR: [
      { firstName: { contains: 'رضایی', mode: 'insensitive' } },
      { lastName: { contains: 'رضایی', mode: 'insensitive' } },
      { username: { contains: 'رضایی', mode: 'insensitive' } },
    ] },
  ],
});

const routeSource = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'security.ts'), 'utf8');
for (const route of [
  "router.get('/reports/personnel-history', protect, securityAdmin",
  "router.get('/reports/personnel-history/:personnelId', protect, securityAdmin",
  "router.get('/reports/personnel-history/:personnelId/attachments/:attachmentId', protect, securityAdmin",
  "router.post('/reports/personnel-history/:personnelId.pdf', protect, securityAdmin",
]) assert.ok(routeSource.includes(route), `manager-only middleware missing from ${route}`);

const pdfGenerationIndex = routeSource.indexOf('const pdfPath = await generatePdfFromHtml', routeSource.indexOf("router.post('/reports/personnel-history/:personnelId.pdf'"));
const exportAuditIndex = routeSource.indexOf('securityPersonnelReportExportAudit.create', pdfGenerationIndex);
assert.ok(pdfGenerationIndex > 0 && exportAuditIndex > pdfGenerationIndex, 'export audit must be recorded only after complete PDF generation');

const runAccess = async (role: string, permissionLevel?: 'view' | 'edit' | 'admin') => {
  const prisma = {
    workspacePermission: { findUnique: async () => permissionLevel ? { permissionLevel, isActive: true, expiresAt: null } : null },
    roleWorkspacePermission: { findUnique: async () => null },
  } as any;
  const middleware = requireWorkspaceAccessWithClient(prisma, WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN);
  return new Promise<'next' | number>((resolve, reject) => {
    const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() { resolve(this.statusCode); } };
    middleware({ user: { id: 'review-user', role } } as any, response, () => resolve('next')).catch(reject);
  });
};

const verifyAccessPolicy = async () => {
  assert.equal(await runAccess('ADMIN'), 'next');
  assert.equal(await runAccess('USER', 'admin'), 'next');
  assert.equal(await runAccess('USER', 'edit'), 403);
  assert.equal(await runAccess('USER', 'view'), 403);
  console.log('security personnel report history policy tests passed');
};

void verifyAccessPolicy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
