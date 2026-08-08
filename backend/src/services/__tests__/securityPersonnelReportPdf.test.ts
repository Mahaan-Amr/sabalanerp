import assert from 'node:assert/strict';
import { prepareSecurityPersonnelReportPdfEvidence, renderSecurityPersonnelReportHistoryPdfHtml } from '../securityPersonnelReportPdf';

const base = {
  personnel: { firstName: 'علی', lastName: 'رضایی', employeeNumber: 'EMP-7', nationalCode: '0012345678', department: { namePersian: 'تولید' } },
  exporterName: 'مدیر گارد', generatedAt: new Date('2026-08-08T08:00:00.000Z'),
  filters: { status: 'ACTIVE', q: '', startDate: '', endDate: '', categoryId: '', reportTypeId: '', reporterId: '', attachments: 'all' },
  reports: [{ id: 'report-1', rowNumber: 4, createdAt: new Date('2026-08-07T08:00:00.000Z'), status: 'ACTIVE', categoryNameSnapshot: 'کنترل تردد', reportTypeNameSnapshot: 'ورود غیرمجاز', description: 'شرح رویداد', reporterName: 'نگهبان یک', participants: [{ name: 'علی رضایی' }, { name: 'رضا احمدی' }], attachments: [{ originalName: 'evidence.jpg', dataUri: 'data:image/jpeg;base64,abc' }], session: { status: 'CLOSED', startedAt: new Date('2026-08-07T06:00:00.000Z'), endedAt: new Date('2026-08-07T10:00:00.000Z'), slot: { startsAt: new Date('2026-08-07T06:00:00.000Z'), endsAt: new Date('2026-08-07T10:00:00.000Z') } } }]
};

const withImages = renderSecurityPersonnelReportHistoryPdfHtml({ ...base, includeImages: true });
assert.match(withImages, /سوابق گزارش‌های گارد/);
assert.match(withImages, /evidence\.jpg/);
assert.match(withImages, /data:image\/jpeg;base64,abc/);
assert.match(withImages, /شرح رویداد/);

const compact = renderSecurityPersonnelReportHistoryPdfHtml({ ...base, includeImages: false });
assert.doesNotMatch(compact, /data:image\/jpeg;base64,abc/);
assert.match(compact, /تصاویر در این خروجی درج نشده‌اند/);
assert.match(compact, /evidence\.jpg/);

assert.throws(() => prepareSecurityPersonnelReportPdfEvidence(
  base.reports,
  [{ attachments: [{ id: undefined, originalName: 'evidence.jpg', storageName: 'missing.jpg', mimeType: 'image/jpeg' }] }],
  true,
  () => '',
), /Attachment file is missing/);

console.log('security personnel report PDF tests passed');
