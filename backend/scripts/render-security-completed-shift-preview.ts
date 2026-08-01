import fs from 'fs';
import path from 'path';
import { SecurityPatrolStatus, SecurityShiftLogStatus, SecurityShiftSessionStatus } from '@prisma/client';
import { renderCompletedSecurityShiftPdfHtml } from '../src/services/securityCompletedShiftPdf';
import { generatePdfFromHtml } from '../src/utils/pdf';

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const evidenceOne = dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#eef3f5"/><rect x="90" y="110" width="1020" height="500" rx="28" fill="#dce8e8" stroke="#5d817b" stroke-width="8"/><path d="M130 500h940M240 500V270h720v230" stroke="#40535d" stroke-width="18" fill="none"/><circle cx="600" cy="380" r="92" fill="#e5f5f1" stroke="#178974" stroke-width="14"/><path d="M555 380l30 30 65-75" fill="none" stroke="#178974" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
const evidenceTwo = dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#f2f5f6"/><rect x="155" y="280" width="890" height="220" rx="36" fill="#dbe6e9" stroke="#536773" stroke-width="9"/><path d="M275 280l115-120h350l150 120" fill="#e8f2f2" stroke="#536773" stroke-width="9"/><circle cx="360" cy="520" r="78" fill="#455965"/><circle cx="360" cy="520" r="32" fill="#eef3f5"/><circle cx="850" cy="520" r="78" fill="#455965"/><circle cx="850" cy="520" r="32" fill="#eef3f5"/><rect x="760" y="320" width="180" height="78" rx="12" fill="#e5f5f1" stroke="#178974" stroke-width="8"/></svg>`);

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
      { id: 'log-1', rowNumber: 1, status: SecurityShiftLogStatus.ACTIVE, categoryNameSnapshot: 'کنترل ورودی', reportTypeNameSnapshot: 'بازرسی خودرو', description: 'خودروی ورودی بررسی شد و مجوز بارگیری تطبیق داده شد.', createdAt: new Date('2026-07-23T04:10:00.000Z'), reportType: { description: 'ثبت کنترل خودرو و مدارک همراه' }, participants: [{ personnel: { firstName: 'علی', lastName: 'کاظمی' } }], attachments: [{ id: 'photo-1', originalName: 'کنترل-درب-ورودی.svg', dataUri: evidenceOne }, { id: 'photo-2', originalName: 'خودروی-بازرسی‌شده.svg', dataUri: evidenceTwo }] },
      { id: 'log-2', rowNumber: 2, status: SecurityShiftLogStatus.VOIDED, categoryNameSnapshot: 'رویداد محوطه', reportTypeNameSnapshot: 'گزارش اولیه', description: 'ثبت اولیه پس از تطبیق با دوربین اصلاح شد.', createdAt: new Date('2026-07-23T08:20:00.000Z'), reportType: { description: 'ثبت رویداد نیازمند پیگیری' }, participants: [], attachments: [], voidReason: 'ثبت تکراری', voidedAt: new Date('2026-07-23T08:35:00.000Z'), voidedBy: 'مدیر گارد' },
    ],
    patrolSessions: [{ id: 'patrol-1', status: SecurityPatrolStatus.FINISHED, startedAt: new Date('2026-07-23T10:00:00.000Z'), endedAt: new Date('2026-07-23T10:32:00.000Z'), description: 'گشت کامل محوطه و انبار بدون مورد باز', personnel: { user: { firstName: 'سارا', lastName: 'محمدی' } } }],
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
