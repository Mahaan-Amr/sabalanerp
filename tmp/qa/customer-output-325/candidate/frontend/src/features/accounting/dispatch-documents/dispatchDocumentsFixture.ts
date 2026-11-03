import type {
  DispatchDocumentCase,
  DispatchDocumentPermission,
} from './dispatchDocumentsViewModel';
import type { DispatchDocumentsClient } from './dispatchDocumentsClient';

const now = '2026-08-09T12:00:00.000Z';
const artifact = (id: string, kind: 'WAYBILL' | 'STATEMENT' | 'ADJUSTMENT', fileName: string, checksum: string) => ({
  id, kind, fileName, checksum, byteSize: kind === 'WAYBILL' ? 148220 : 172640, createdAt: '2026-08-09T10:30:00.000Z',
});

const contracts = [{
  id: 'contract-1405-34', number: '۱۴۰۵-۳۴', rows: [
    { id: 'row-stable-11', label: 'تراورتن عباس‌آباد ممتاز (با خدمات متصل)', quantity: '18.500', unit: 'متر مربع', gross: { amount: '6100000000', currency: 'IRR' }, discount: { amount: '310000000', currency: 'IRR' }, net: { amount: '5790000000', currency: 'IRR' } },
    { id: 'row-stable-17', label: 'مرمریت دهبید ممتاز (با خدمات متصل)', quantity: '10.000', unit: 'متر مربع', gross: { amount: '3100000000', currency: 'IRR' }, discount: { amount: '150000000', currency: 'IRR' }, net: { amount: '2950000000', currency: 'IRR' } },
  ],
}];

const seedCases = (): DispatchDocumentCase[] => [
  {
    id: 'dispatch-ready', state: 'READY', customerName: 'شرکت عمران آریا', destination: 'پروژه ونک', loadingNumber: 'ارسال ۱۲۶۰', finalizedAt: '2026-08-09T08:15:00.000Z', total: { amount: '8740000000', currency: 'IRR' }, vehiclePlate: '۷۸ الف ۴۵۶ ایران ۱۱', driverName: 'علی رضایی', readiness: { code: 'READY', label: 'آماده بررسی', reasons: [] }, contracts,
  },
  {
    id: 'dispatch-blocked', state: 'BLOCKED', customerName: 'سازه گستر شرق', destination: 'پروژه نیاوران', loadingNumber: 'ارسال ۱۲۶۳', finalizedAt: '2026-08-09T09:10:00.000Z', total: { amount: '4920000000', currency: 'IRR' }, vehiclePlate: '۲۱ ب ۷۸۲ ایران ۳۳', driverName: 'رضا قنبری', readiness: { code: 'STALE_PRICING', label: 'نسخه قیمت پس از نهایی‌سازی تغییر کرده است', reasons: [
      { id: 'stale-1', label: 'قرارداد ۱۴۰۵-۳۴، ردیف پایدار ۱۱: نسخه قیمت تازه‌تری تأیید شده است.', ownerLabel: 'بازگشت به لجستیک', ownerHref: '/dashboard/logistics' },
      { id: 'stale-2', label: 'صدور فقط پس از نهایی‌سازی تخصیص جانشین ممکن است.', ownerLabel: 'مشاهده قرارداد', ownerHref: '/dashboard/accounting/contracts' },
    ] }, contracts,
  },
  {
    id: 'dispatch-issued', state: 'ISSUED', customerName: 'سنگ‌سازان پارس', destination: 'کارگاه شهریار', loadingNumber: 'ارسال ۱۲۵۸', finalizedAt: '2026-08-08T14:20:00.000Z', total: { amount: '2180000000', currency: 'IRR' }, vehiclePlate: '۴۵ ج ۶۷۸ ایران ۲۲', driverName: 'مهدی احمدی', readiness: { code: 'READY', label: 'بسته صادرشده', reasons: [] }, contracts,
    bundle: {
      id: 'bundle-1258', number: '۱۲۵۸', status: 'ISSUED', issuedAt: '2026-08-08T15:00:00.000Z',
      artifacts: [artifact('waybill-1258', 'WAYBILL', 'waybill-1258.pdf', 'sha256:3e7df73e…4c918d'), artifact('statement-1258', 'STATEMENT', 'statement-1258.pdf', 'sha256:961ac88b…bf024a')],
      printHistory: [
        { id: 'print-1', action: 'BOTH', actorName: 'مریم احمدی', occurredAt: '2026-08-08T15:05:00.000Z', outcome: 'SUCCEEDED' },
        { id: 'print-2', action: 'STATEMENT', actorName: 'مریم احمدی', occurredAt: '2026-08-08T15:08:00.000Z', outcome: 'FAILED' },
      ],
      adjustments: [{ id: 'adjustment-1', sequence: 1, sharedNumber: '۱۲۵۸', issuedAt: '2026-08-09T09:30:00.000Z', summary: 'کاهش مقدار ردیف قرارداد ۱۴۰۵-۳۴', netDelta: { amount: '-84000000', currency: 'IRR' }, artifactId: 'adjustment-1258-1' }],
      history: [{ id: 'history-1', number: '۱۲۵۸', status: 'ISSUED', occurredAt: '2026-08-08T15:00:00.000Z' }],
    },
  },
];

const clone = <T,>(value: T): T => structuredClone(value);

export function createFixtureDispatchDocumentsClient(permission: DispatchDocumentPermission = 'MANAGE'): DispatchDocumentsClient {
  let cases = permission === 'UNAUTHORIZED' ? [] : seedCases();
  const decisions = new Map<string, DispatchDocumentCase>();
  const replacements = new Map<string, DispatchDocumentCase>();
  const find = (caseId: string) => {
    const item = cases.find((candidate) => candidate.id === caseId);
    if (!item) throw new Error('پرونده اسناد ارسال در دسترس نیست.');
    return item;
  };
  const requireManage = () => { if (permission !== 'MANAGE') throw new Error('اجازه اجرای این فرمان را ندارید.'); };

  return {
    async load() { return { permission, cases: clone(cases), retrievedAt: now }; },
    async decide(caseId, input) {
      requireManage();
      const replay = decisions.get(input.idempotencyKey);
      if (replay) return clone(replay);
      const item = find(caseId);
      if (item.state !== 'READY' || item.readiness.code !== 'READY') throw new Error('شواهد پرونده برای تصمیم آماده نیست.');
      if (input.action === 'REJECT') {
        if (!input.reason.trim()) throw new Error('ثبت دلیل رد الزامی است.');
        cases = cases.filter((candidate) => candidate.id !== caseId);
      } else {
        item.state = 'ISSUED';
        item.readiness.label = 'بسته صادرشده';
        item.bundle = {
          id: 'bundle-1260', number: '۱۲۶۰', status: 'ISSUED', issuedAt: now,
          artifacts: [artifact('waybill-1260', 'WAYBILL', 'waybill-1260.pdf', 'sha256:2d7148…9e'), artifact('statement-1260', 'STATEMENT', 'statement-1260.pdf', 'sha256:6b92cd…31')],
          printHistory: [], adjustments: [], history: [{ id: 'history-1260', number: '۱۲۶۰', status: 'ISSUED', occurredAt: now }],
        };
      }
      decisions.set(input.idempotencyKey, clone(item));
      return clone(item);
    },
    async replace(caseId, input) {
      requireManage();
      if (!input.reason.trim()) throw new Error('ثبت دلیل جایگزینی الزامی است.');
      const replay = replacements.get(input.idempotencyKey);
      if (replay) return clone(replay);
      const item = find(caseId);
      if (!item.bundle || item.bundle.status !== 'ISSUED') throw new Error('فقط بسته فعال و خارج‌نشده قابل جایگزینی است.');
      const previous = item.bundle;
      item.bundle = {
        ...previous, id: `${previous.id}-replacement`, number: '۱۲۶۶', issuedAt: now,
        artifacts: [artifact('waybill-1266', 'WAYBILL', 'waybill-1266.pdf', 'sha256:1ee04a…8d'), artifact('statement-1266', 'STATEMENT', 'statement-1266.pdf', 'sha256:fa2190…41')],
        history: [{ id: `history-${previous.id}`, number: previous.number, status: 'REPLACED', occurredAt: now, reason: input.reason }, ...previous.history],
      };
      replacements.set(input.idempotencyKey, clone(item));
      return clone(item);
    },
    async handoff(caseId, input) {
      const item = find(caseId);
      if (!item.bundle) throw new Error('فایل صادرشده‌ای برای تحویل وجود ندارد.');
      const requestedKinds = input.kind === 'PRINT_BOTH' ? ['WAYBILL', 'STATEMENT'] as const : input.kind.endsWith('WAYBILL') ? ['WAYBILL'] as const : ['STATEMENT'] as const;
      if (input.kind.startsWith('PRINT')) item.bundle.printHistory.push({ id: `print-${item.bundle.printHistory.length + 1}`, action: input.kind === 'PRINT_BOTH' ? 'BOTH' : requestedKinds[0], actorName: 'کاربر fixture', occurredAt: now, outcome: 'SUCCEEDED' });
      return { artifacts: requestedKinds.map((kind) => ({ kind, url: `data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrpA==#${kind}`, fileName: `${kind === 'WAYBILL' ? 'waybill' : 'statement'}-${item.bundle!.number}.pdf` })) };
    },
  };
}
