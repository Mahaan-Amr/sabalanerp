import assert from 'node:assert/strict';
import { SecurityShiftLogStatus, SecurityShiftSessionStatus } from '@prisma/client';
import { renderCompletedSecurityShiftPdfHtml } from '../securityCompletedShiftPdf';

const slot = {
  startsAt: '2026-07-23T02:30:00.000Z',
  endsAt: '2026-07-23T14:30:00.000Z',
  plan: { title: 'شیفت نمونه' },
  plannedPersonnel: { user: { firstName: 'نیروی', lastName: 'برنامه' }, shift: { namePersian: 'روز' } },
  replacementPersonnel: null,
  temporaryCoverage: [],
  attendance: [],
  session: {
    status: SecurityShiftSessionStatus.CLOSED,
    startedAt: '2026-07-23T02:30:00.000Z',
    endedAt: '2026-07-23T14:30:00.000Z',
    personnel: { user: { firstName: 'نیروی', lastName: 'مؤثر' } },
    corrections: [],
    patrolSessions: [],
    logEntries: [{
      id: 'entry', rowNumber: 1, status: SecurityShiftLogStatus.ACTIVE,
      categoryNameSnapshot: 'کنترل', reportTypeNameSnapshot: 'ورودی', description: 'ثبت معتبر',
      createdAt: '2026-07-23T04:00:00.000Z', participants: [], reportType: null,
      attachments: [{ id: 'image', originalName: 'evidence.png', dataUri: 'data:image/png;base64,AA==' }],
    }],
  },
};

const html = renderCompletedSecurityShiftPdfHtml([slot, { ...slot, plan: { title: 'شیفت دوم' } }], {
  generatedAt: new Date('2026-08-01T09:30:00.000Z'),
});

assert.match(html, /گزارش شیفت‌های گارد/);
assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'evidence renders in a two-column grid');
assert.match(html, /object-fit:contain/, 'evidence retains its complete aspect ratio without cropping');
assert.match(html, /\.shift\+\.shift\{break-before:page\}/, 'subsequent shifts start on a fresh page');
assert.match(html, /ردیف ۱ · evidence\.png/, 'evidence caption keeps its timeline row and filename');
assert.equal((html.match(/class="shift"/g) || []).length, 2);

console.log('security completed shift PDF tests passed');
