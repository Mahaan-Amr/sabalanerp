import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErpButton } from '@/components/erp';
import { PartnerInquiryPanel } from '../inquiries/PartnerInquiryPanel';
import { PartnerContractWizard, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission, type PartnerDraftCommand } from '../../contract-creation/partner/partnerCaseSubmission';
import { createWizardFixtures } from './wizardFixtures';
import { PartnerInquiryWorkspace } from '../inquiries/PartnerInquiryWorkspace';
import type { PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';
import type { PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { WizardTechnicalBrowserFixture } from './wizardTechnicalBrowserFixture';
import { defaultPartnerRetailRows, partnerRetailIntentRows } from '../../contract-creation/partner/partnerRetail';

function AsyncDraftFixture() {
  const fixture = useMemo(createWizardFixtures, []);
  const approved = fixture.inquiry.rows[0];
  const pendingRow = { ...approved, state: 'PENDING' as const, approvedPrice: undefined,
    approvedRowBinding: undefined, approvedAt: undefined, expiresAt: undefined };
  const [draft, setDraft] = useState<PartnerWizardDraft>(() => {
    const rows = defaultPartnerRetailRows([{ productRowId: fixture.configurationDraft.productRowId,
      quantity: '2', unit: 'meter', inquiryRow: pendingRow,
      retailUnitPrice: { amount: '1000', currency: 'IRR' }, wholesaleUnitPrice: { amount: '800', currency: 'IRR' } }]);
    return { step: 'pricing', rows, intent: { ...fixture.draftSubmissionReference,
      contractDate: '2026-08-27', preparationCompleted: false, rows: partnerRetailIntentRows(rows),
      customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: [],
      retailDiscount: { amount: '0', currency: 'IRR' }, belowCostConfirmed: false } };
  });
  const [completed, setCompleted] = useState(false);
  const [committed, setCommitted] = useState(0);
  const [rejected, setRejected] = useState('');
  const submission = useMemo(() => {
    let pending: PartnerDraftCommand | null = null;
    let revision = fixture.partner.owner.revision;
    return createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
      initialCase: { ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY', preparationCompleted: false },
      commands: { execute: async command => {
        if (command.type !== 'CASE_SUBMIT' && command.type !== 'CASE_DRAFT_REVISE') throw new Error('Unexpected command');
        setCompleted(Boolean(command.intent.preparationCompleted));
        const ready = command.intent.rows.every(row => row.approvedRowBinding);
        const { sabalanTotals, sabalanPaymentPlan, resaleDifference, ...unpriced } = fixture.partner;
        return { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: [],
          case: { ...(ready ? fixture.partner : { ...unpriced, products: unpriced.products.map(({ wholesaleUnitPrice: _rate, ...product }) => product) }),
            state: 'DRAFT', preparationCompleted: command.intent.preparationCompleted,
            pricingState: ready ? 'READY_TO_FINALIZE' : 'AWAITING_INQUIRY',
            owner: { ...fixture.partner.owner, revision: ++revision } } } };
      } }, recovery: { pending: () => pending, savePending: async command => { pending = command; },
        clearPending: async () => { pending = null; }, finalizeCommitted: async () => { pending = null; },
        prepareEditLease: async () => ({ recoveryId: fixture.draftSubmissionReference.recoveryId,
          browserSessionId: 'async-browser', leaseToken: 'async-lease', baseRevision: 0 }) } });
  }, [fixture]);
  return <main dir="rtl" className="mx-auto max-w-5xl space-y-4 p-4">
    <p role="status">تکمیل: {String(completed)} · قطعیت: {committed}</p>
    {rejected && <p role="status">دلیل رد: {rejected}</p>}
    <ErpButton label="دریافت قیمت آزمایشی" onClick={() => setDraft(current => ({ ...current,
      rows: current.rows.map(row => ({ ...row, inquiryRow: approved })) }))} />
    <PartnerContractWizard draft={draft} onChange={setDraft} submission={submission}
      recovery={{ state: 'writable' }} now={Date.parse('2026-08-27T09:00:00.000Z')}
      renderSection={step => <p>بخش {step}</p>} validateStep={() => null}
      onReinquire={() => undefined} onOpenCase={() => undefined}
      onRejectPrice={async (_row, reason) => { setRejected(reason); }}
      onFinalize={async () => { setCommitted(value => value + 1); }} />
  </main>;
}

// Explicit browser fixture only. It cannot activate a persona, access a DB,
// send a message, or become a fallback transport in the production boundary.
function Fixture() {
  const fixture = useMemo(createWizardFixtures, []);
  const [draft, setDraft] = useState<PartnerWizardDraft | null>(null);
  const [expired, setExpired] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [opened, setOpened] = useState(false);
  const submission = useMemo(() => {
    let pending: PartnerDraftCommand | null = null;
    return createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
      commands: { execute: async command => ({ ok: true, value: { commandId: command.commandId, replayed: false, case: fixture.partner, eventIds: [] } }) },
      recovery: { pending: () => pending, savePending: async command => { pending = command; }, clearPending: async () => { pending = null; },
        finalizeCommitted: async () => { pending = null; }, prepareEditLease: async () => ({
          recoveryId: fixture.draftSubmissionReference.recoveryId, browserSessionId: 'browser-1',
          leaseToken: 'lease-1', baseRevision: 0 }) },
    });
  }, [fixture]);
  const now = Date.parse(expired ? fixture.approval.expiresAt : '2026-08-27T09:00:00.000Z');
  return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 sm:p-8" dir="rtl">
    <h1 className="text-2xl font-bold">فروش همکار · آزمون رابط</h1>
    <div className="flex flex-wrap gap-3">
      <ErpButton label="آزمون پایان اعتبار" variant="outline" onClick={() => setExpired(true)} />
      <ErpButton label="آزمون بازیابی" variant="outline" onClick={() => setTakeover(true)} />
    </div>
    {opened ? <p>جزئیات پرونده آزمایشی</p> : draft ? <PartnerContractWizard draft={draft} onChange={setDraft} submission={submission} now={now}
      recovery={takeover ? { state: 'takeover', takeover: async () => setTakeover(false), discard: async () => { setDraft(null); setTakeover(false); } } : { state: 'writable' }}
      renderSection={step => <p>{step === 'customer' ? 'مشتری آزمایشی' : step === 'delivery' ? 'تحویل آزمایشی' : step === 'payment' ? 'برنامه پرداخت آزمایشی' : 'بازبینی پرونده آزمایشی'}</p>}
      validateStep={() => null} onReinquire={() => setExpired(false)} onOpenCase={() => setOpened(true)} /> : <PartnerInquiryPanel
        inquiry={{ ...fixture.inquiry, rows: [...fixture.inquiry.rows,
          { rowId: 'pending-330', revision: 1, description: 'اسلب در انتظار پاسخ', state: 'PENDING', configuration: [], configurationRef: { ...fixture.configurationDraft, productRowId: 'pending-product' }, usedCaseNumbers: [] },
          { rowId: 'rejected-330', revision: 1, description: 'پله ردشده', state: 'REJECTED', configuration: [], configurationRef: { ...fixture.configurationDraft, productRowId: 'rejected-product' }, usedCaseNumbers: [], noteOrReason: 'این سنگ موجود نیست' },
        ] }} now={now} pending={false} onRefresh={() => undefined} onReinquire={() => undefined} />}
  </main>;
}

function ReinquiryFixture() {
  const [calls, setCalls] = useState(0);
  const composition = useMemo(() => {
    const fixture = createWizardFixtures();
    const inquiry = { ...fixture.inquiry, rows: fixture.inquiry.rows.map(row => ({ ...row, state: 'REJECTED' as const })) };
    let pending: PartnerInquirySubmitCommand | null = null;
    let sends = 0;
    const queries: PartnerQueryV2Port = { query: async () => ({ ok: true, value: inquiry }) } as PartnerQueryV2Port;
    return {
      actorId: fixture.profile.partnerSellerId, inquiryId: inquiry.inquiryId, queries,
      commands: { execute: async (command: PartnerInquirySubmitCommand) => {
        sends++; setCalls(sends);
        if (sends === 1) throw new Error('lost successor response');
        return { ok: true as const, value: { commandId: command.commandId, replayed: true, eventIds: [] } };
      } },
      recovery: { pending: () => pending, savePending: async (command: PartnerInquirySubmitCommand) => { pending = command; }, clearPending: async () => { pending = null; } },
      prepareSuccessor: async () => ({ rowId: 'new-successor', configuration: fixture.configurationDraft }),
      configuredRows: [{ rowId: inquiry.rows[0].rowId, configuration: fixture.configurationDraft }],
      configuredRowLabels: { [fixture.configurationDraft.productRowId]: 'سنگ طولی آزمایشی' },
    };
  }, []);
  return <main className="mx-auto max-w-5xl p-4" dir="rtl">
    <p role="status">تعداد ارسال: {calls}</p>
    <PartnerInquiryWorkspace {...composition} commands={composition.commands as React.ComponentProps<typeof PartnerInquiryWorkspace>['commands']}
      writable configurationEditor={<p>مشخصات فنی محفوظ</p>}
      onOpenInquiry={() => undefined} onCreateNewInquiry={() => undefined} />
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(new URLSearchParams(location.search).has('technical') ? <WizardTechnicalBrowserFixture />
  : new URLSearchParams(location.search).has('async') ? <AsyncDraftFixture />
  : new URLSearchParams(location.search).has('reinquiry') ? <ReinquiryFixture /> : <Fixture />);
