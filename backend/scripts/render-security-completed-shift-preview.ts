import fs from 'fs';
import path from 'path';
import { SecurityShiftLogStatus, SecurityShiftSessionStatus } from '@prisma/client';
import { renderCompletedSecurityShiftPdfHtml } from '../src/services/securityCompletedShiftPdf';
import { generatePdfFromHtml } from '../src/utils/pdf';

const fixture = [{
  id: 'preview-slot-1',
  startsAt: new Date('2026-07-23T02:30:00.000Z'),
  endsAt: new Date('2026-07-23T14:30:00.000Z'),
  plan: { title: 'شیفت روز گارد - نمونه طراحی' },
  plannedPersonnel: { user: { firstName: 'امیر', lastName: 'رضایی' }, shift: { namePersian: 'شیفت روز' } },
  replacementPersonnel: { user: { firstName: 'سارا', lastName: 'محمدی' }, shift: { namePersian: 'شیفت روز' } },
  temporaryCoverage: [{ personnel: { user: { firstName: 'علی', lastName: 'کاظمی' } } }],
  attendance: [
    { personnel: { user: { firstName: 'سارا', lastName: 'محمدی' } }, arrivedAt: new Date('2026-07-23T02:37:00.000Z'), delayMinutes: 7, correctedAt: null, correctionReason: null },
    { personnel: { user: { firstName: 'علی', lastName: 'کاظمی' } }, arrivedAt: new Date('2026-07-23T06:25:00.000Z'), delayMinutes: 0, correctedAt: new Date('2026-07-23T07:10:00.000Z'), correctionReason: 'اصلاح زمان ثبت ورود براساس دفتر نگهبانی' },
  ],
  session: {
    status: SecurityShiftSessionStatus.FORCE_CLOSED,
    startedAt: new Date('2026-07-23T02:37:00.000Z'),
    endedAt: new Date('2026-07-23T14:42:00.000Z'),
    personnel: { user: { firstName: 'سارا', lastName: 'محمدی' } },
    forceCloseReason: 'پایان شیفت بدون ثبت نهایی اپراتور؛ بسته‌شدن پس از بررسی مدیر گارد',
    closureSummary: 'کنترل ورودی و خروجی، دو نوبت گشت و تحویل کامل دفتر وقایع انجام شد.',
    corrections: [{ correctedAt: new Date('2026-07-23T15:15:00.000Z'), correctedByName: 'مدیر گارد', previousStartedAt: new Date('2026-07-23T02:42:00.000Z'), previousEndedAt: new Date('2026-07-23T14:42:00.000Z'), effectiveStartedAt: new Date('2026-07-23T02:37:00.000Z'), effectiveEndedAt: new Date('2026-07-23T14:42:00.000Z'), reason: 'تطبیق با اولین ثبت معتبر دفتر نگهبانی' }],
    logEntries: [
      { id: 'log-1', rowNumber: 1, status: SecurityShiftLogStatus.ACTIVE, categoryNameSnapshot: 'کنترل ورودی', reportTypeNameSnapshot: 'بازرسی خودرو', description: 'خودروی ورودی بررسی شد و مجوز بارگیری تطبیق داده شد.', createdAt: new Date('2026-07-23T04:10:00.000Z'), reportType: { description: 'ثبت کنترل خودرو و مدارک همراه' }, participants: [{ personnel: { firstName: 'علی', lastName: 'کاظمی' } }], attachments: [] },
    ],
    patrolSessions: [],
  },
}];

const main = async () => {
  const asset = (...segments: string[]) => path.resolve(process.cwd(), 'public', ...segments);
  const fontFace = (name: string, weight: number) => {
    const file = asset('yekan-bakh', name);
    const encoded = fs.readFileSync(file).toString('base64');
    return `@font-face{font-family:'Yekan Bakh';src:url('data:font/woff2;base64,${encoded}') format('woff2');font-weight:${weight}}`;
  };
  const baseStyles = `<style>${fontFace('YekanBakh-Regular.woff2', 400)}${fontFace('YekanBakh-Bold.woff2', 700)}</style>`;
  const html = renderCompletedSecurityShiftPdfHtml(fixture, {
    generatedAt: new Date('2026-08-01T09:30:00.000Z'),
    baseStyles,
  });
  const outputDir = path.resolve(process.cwd(), '..', 'output', 'pdf');
  const output = await generatePdfFromHtml({
    fileName: 'guard-completed-shift-reference',
    outputDir,
    landscape: true,
    htmlContent: html,
    margin: { top: '6mm', right: '6mm', bottom: '14mm', left: '6mm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-family:Tahoma,Arial,sans-serif;font-size:8px;color:#64717d;text-align:center;direction:rtl">گزارش شیفت گارد · صفحه <span class="pageNumber"></span> از <span class="totalPages"></span></div>',
  });

  console.log(output);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
