import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDispatchDocumentView,
  canRunDispatchDocumentCommand,
  formatDisplayedMoney,
  type DispatchDocumentCase,
  type DispatchDocumentWorkspace,
} from './dispatchDocumentsViewModel';

const cases: DispatchDocumentCase[] = [
  { id: 'ready', canManage: true, state: 'READY', customerName: 'آماده', destination: 'الف', loadingNumber: '۱', finalizedAt: '2026-08-09T08:00:00Z', total: { amount: '120000', currency: 'IRR' }, vehiclePlate: '۱۱الف۱۱۱', driverName: 'راننده', readiness: { code: 'READY', label: 'آماده صدور', reasons: [] }, contracts: [] },
  { id: 'blocked', canManage: true, state: 'BLOCKED', customerName: 'مسدود', destination: 'ب', loadingNumber: '۲', finalizedAt: '2026-08-09T09:00:00Z', total: { amount: '0', currency: 'IRR' }, vehiclePlate: '۲۲ب۲۲۲', driverName: 'راننده', readiness: { code: 'STALE_PRICING', label: 'نسخه قیمت تغییر کرده', reasons: [{ id: 'r1', label: 'قرارداد ۳، ردیف ۴', ownerLabel: 'بازگشت به لجستیک', ownerHref: '/dashboard/logistics' }] }, contracts: [] },
  { id: 'issued', canManage: true, state: 'ISSUED', customerName: 'صادرشده', destination: 'پ', loadingNumber: '۳', finalizedAt: '2026-08-09T10:00:00Z', total: { amount: '90000', currency: 'IRR' }, vehiclePlate: '۳۳ج۳۳۳', driverName: 'راننده', readiness: { code: 'READY', label: 'صادرشده', reasons: [] }, contracts: [], bundle: { id: 'bundle', number: '۱۲۵۸', status: 'ISSUED', issuedAt: '2026-08-09T11:00:00Z', artifacts: [
    { id: 'waybill', kind: 'WAYBILL', fileName: 'waybill.pdf', checksum: 'a', byteSize: 1, createdAt: '2026-08-09T11:00:00Z' },
    { id: 'statement', kind: 'STATEMENT', fileName: 'statement.pdf', checksum: 'b', byteSize: 1, createdAt: '2026-08-09T11:00:00Z' },
  ], printHistory: [], adjustments: [], history: [] } },
];

const workspace = (permission: DispatchDocumentWorkspace['permission']): DispatchDocumentWorkspace => ({
  permission,
  cases,
  retrievedAt: '2026-08-09T12:00:00Z',
});

test('queue filter keeps named counts and selected case', () => {
  const view = buildDispatchDocumentView(workspace('MANAGE'), 'BLOCKED', 'blocked');
  assert.deepEqual(view.counts, { READY: 1, BLOCKED: 1, ISSUED: 1 });
  assert.deepEqual(view.visibleCases.map((item) => item.id), ['blocked']);
  assert.equal(view.selectedCase?.id, 'blocked');
});

test('unauthorized projection discloses no case existence', () => {
  const view = buildDispatchDocumentView(workspace('UNAUTHORIZED'), 'READY', 'ready');
  assert.deepEqual(view.counts, { READY: 0, BLOCKED: 0, ISSUED: 0 });
  assert.deepEqual(view.visibleCases, []);
  assert.equal(view.selectedCase, null);
});

test('commands fail closed for view-only, blocked, stale, or incomplete state', () => {
  assert.equal(canRunDispatchDocumentCommand('ACCEPT', workspace('VIEW'), cases[0], false), false);
  assert.equal(canRunDispatchDocumentCommand('ACCEPT', workspace('MANAGE'), cases[1], false), false);
  assert.equal(canRunDispatchDocumentCommand('ACCEPT', workspace('MANAGE'), cases[0], true), false);
  assert.equal(canRunDispatchDocumentCommand('ACCEPT', workspace('MANAGE'), cases[0], false), true);
  assert.equal(canRunDispatchDocumentCommand('ACCEPT', workspace('MANAGE'), { ...cases[0], canManage: false }, false), false);
  assert.equal(canRunDispatchDocumentCommand('PRINT', workspace('MANAGE'), cases[0], false), false);
  assert.equal(canRunDispatchDocumentCommand('PRINT', workspace('VIEW'), cases[2], false), true);
  assert.equal(canRunDispatchDocumentCommand('REPLACE', workspace('VIEW'), cases[2], false), false);
  const incomplete = structuredClone(cases[2]);
  incomplete.bundle!.artifacts = incomplete.bundle!.artifacts.filter((artifact) => artifact.kind === 'WAYBILL');
  assert.equal(canRunDispatchDocumentCommand('DOWNLOAD', workspace('VIEW'), incomplete, false), false);
  assert.equal(canRunDispatchDocumentCommand('PRINT', workspace('MANAGE'), incomplete, false), false);
  assert.equal(canRunDispatchDocumentCommand('REPLACE', workspace('MANAGE'), incomplete, false), false);
});

test('missing selected case falls back to first visible case without crossing filters', () => {
  const view = buildDispatchDocumentView(workspace('MANAGE'), 'ISSUED', 'ready');
  assert.equal(view.selectedCase?.id, 'issued');
});

test('display money rounds the authoritative decimal without binary floating-point loss', () => {
  assert.equal(formatDisplayedMoney({ amount: '9007199254740993.500000000000', currency: 'IRR' }), '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۴ ریال');
  assert.equal(formatDisplayedMoney({ amount: '-84000000.499999999999', currency: 'IRR' }), '‎−۸۴٬۰۰۰٬۰۰۰ ریال');
});
