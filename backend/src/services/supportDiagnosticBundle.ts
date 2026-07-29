import type { Prisma } from '@prisma/client';

const routeSourceMappings: Array<{ pattern: RegExp; sources: string[] }> = [
  { pattern: /^\/dashboard\/sales\/contracts/, sources: ['frontend/src/app/dashboard/sales/contracts', 'backend/src/routes/sales.ts', 'backend/src/services/contractService.ts'] },
  { pattern: /^\/dashboard\/accounting/, sources: ['frontend/src/app/dashboard/accounting', 'backend/src/routes/accounting.ts', 'backend/src/services/accountingService.ts'] },
  { pattern: /^\/dashboard\/hr/, sources: ['frontend/src/app/dashboard/hr', 'backend/src/routes/hr.ts', 'backend/src/routes/hr-hiring.ts'] },
  { pattern: /^\/dashboard\/crm/, sources: ['frontend/src/app/dashboard/crm', 'backend/src/routes/crm.ts'] },
  { pattern: /^\/dashboard\/inventory/, sources: ['frontend/src/app/dashboard/inventory', 'backend/src/routes/inventory.ts'] },
  { pattern: /^\/dashboard\/logistics/, sources: ['frontend/src/app/dashboard/logistics', 'backend/src/routes/logistics.ts'] },
  { pattern: /^\/dashboard\/security/, sources: ['frontend/src/app/dashboard/security', 'backend/src/routes/security.ts'] },
  { pattern: /^\/dashboard\/support/, sources: ['frontend/src/app/dashboard/support', 'backend/src/routes/support-tickets.ts'] },
];

const unsafeText = /(password|passcode|authorization|bearer|cookie|token|secret|otp|private.?key|encryption.?key)\s*[:=]/i;
const safeText = (value: unknown, maximum = 10_000) => typeof value === 'string' && !unsafeText.test(value)
  ? value.slice(0, maximum)
  : null;

export const routeToSourceFiles = (route: string): string[] =>
  routeSourceMappings.find((mapping) => mapping.pattern.test(route))?.sources || [
    'frontend/src/app/dashboard',
    'backend/src/routes',
  ];

export const buildSupportDiagnosticBundle = (ticket: {
  id: string;
  referenceCode: string;
  title: string;
  type: string;
  impact: string;
  workaroundExists: boolean;
  reportedWorkspace: string | null;
  reportedFeature: string | null;
  originRoute: string;
  releaseBuild: string | null;
  diagnosticSnapshot: Prisma.JsonValue;
  entries: Array<{ kind: string; body: string | null; redactedAt: Date | null }>;
  auditEvents: Array<{ action: string; afterData: Prisma.JsonValue | null }>;
}, selectedSensitiveMetadata: Array<Record<string, unknown>> = []) => {
  const createdAudit = ticket.auditEvents.find((event) => event.action === 'CREATED');
  const createdData = createdAudit?.afterData && typeof createdAudit.afterData === 'object' && !Array.isArray(createdAudit.afterData)
    ? createdAudit.afterData as Record<string, unknown>
    : {};
  const snapshot = ticket.diagnosticSnapshot && typeof ticket.diagnosticSnapshot === 'object' && !Array.isArray(ticket.diagnosticSnapshot)
    ? ticket.diagnosticSnapshot as Record<string, unknown>
    : {};
  const data = {
    schemaVersion: 1,
    ticket: {
      id: ticket.id,
      referenceCode: ticket.referenceCode,
      title: safeText(ticket.title, 180),
      type: ticket.type,
      impact: ticket.impact,
      workaroundExists: ticket.workaroundExists,
      workspace: ticket.reportedWorkspace,
      feature: ticket.reportedFeature,
    },
    reproduction: {
      steps: safeText(createdData.steps, 5_000),
      expectedResult: safeText(createdData.expectedResult, 5_000),
      safeConversation: ticket.entries
        .filter((entry) => !entry.redactedAt && ['REPORT', 'COMMENT', 'RESOLUTION'].includes(entry.kind))
        .map((entry) => safeText(entry.body, 5_000))
        .filter(Boolean),
    },
    technicalContext: {
      originatingRoute: ticket.originRoute,
      releaseCommit: ticket.releaseBuild,
      safeErrors: Array.isArray(snapshot.errors) ? snapshot.errors.map((entry) => safeText(entry, 500)).filter(Boolean) : [],
      relevantRecordIdentifiers: snapshot.recordIdentifiers || {},
      routeToSourceCode: routeToSourceFiles(ticket.originRoute),
    },
    selectedSensitiveEvidence: selectedSensitiveMetadata,
    exclusions: [
      'credentials',
      'tokens',
      'cookies',
      'passwords',
      'one-time codes',
      'encryption secrets',
      'unselected sensitive evidence',
    ],
  };
  const markdown = [
    `# ${ticket.referenceCode}: ${data.ticket.title || 'تیکت پشتیبانی'}`,
    '',
    `- نوع: ${ticket.type}`,
    `- اثر: ${ticket.impact}`,
    `- فضای کاری: ${ticket.reportedWorkspace || 'عمومی'}`,
    `- قابلیت: ${ticket.reportedFeature || 'نامشخص'}`,
    `- مسیر: \`${ticket.originRoute}\``,
    `- نسخه: \`${ticket.releaseBuild || 'نامشخص'}\``,
    '',
    '## بازسازی',
    '',
    data.reproduction.steps || 'مراحل ثبت نشده است.',
    '',
    '## نتیجه مورد انتظار',
    '',
    data.reproduction.expectedResult || 'ثبت نشده است.',
    '',
    '## نگاشت مسیر به کد',
    '',
    ...data.technicalContext.routeToSourceCode.map((source) => `- \`${source}\``),
    '',
    '## محدودیت امنیتی',
    '',
    'این بسته به‌صورت پیش‌فرض شاهد حساس، رمز، توکن، کوکی، گذرواژه و کلید رمزنگاری را حذف می‌کند.',
  ].join('\n');
  return { data, markdown };
};
