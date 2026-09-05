import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErpButton } from '@/components/erp';
import { PartnerInquiryPanel } from '../inquiries/PartnerInquiryPanel';
import { PartnerContractWizard, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission, type PartnerSubmitCommand } from '../../contract-creation/partner/partnerCaseSubmission';
import { enterPartnerWizard } from '../../contract-creation/partner/partnerWizardEntry';
import { createWizardFixtures } from './wizardFixtures';
import { PartnerInquiryWorkspace } from '../inquiries/PartnerInquiryWorkspace';
import type { PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';
import type { PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { WizardTechnicalBrowserFixture } from './wizardTechnicalBrowserFixture';

// Explicit browser fixture only. It cannot activate a persona, access a DB,
// send a message, or become a fallback transport in the production boundary.
function Fixture() {
  const fixture = useMemo(createWizardFixtures, []);
  const [draft, setDraft] = useState<PartnerWizardDraft | null>(null);
  const [expired, setExpired] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [opened, setOpened] = useState(false);
  const submission = useMemo(() => {
    let pending: PartnerSubmitCommand | null = null;
    return createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
      commands: { execute: async command => ({ ok: true, value: { commandId: command.commandId, replayed: false, case: fixture.partner, eventIds: [] } }) },
      recovery: { pending: () => pending, savePending: async command => { pending = command; }, clearPending: async () => { pending = null; }, finalizeCommitted: async () => { pending = null; } },
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
        ] }} now={now} pending={false} onRefresh={() => undefined} onReinquire={() => undefined}
        onEnterWizard={() => setDraft(enterPartnerWizard({ inquiry: fixture.inquiry, now,
          base: { customerId: fixture.draftSubmissionReference.customerId, recoveryId: fixture.draftSubmissionReference.recoveryId,
            recoveryRevision: fixture.draftSubmissionReference.recoveryRevision, sabalanTermsVersionId: fixture.draftSubmissionReference.sabalanTermsVersionId,
            contractDate: fixture.customer.contractDate, customerPaymentPlan: fixture.partner.customerPaymentPlan,
            deliveries: fixture.partner.deliveries, retailDiscount: { amount: '0', currency: 'IRR' } },
          validated: fixture.technicalSaved,
        }))} />}
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
    };
  }, []);
  return <main className="mx-auto max-w-5xl p-4" dir="rtl">
    <p role="status">تعداد ارسال: {calls}</p>
    <PartnerInquiryWorkspace {...composition} commands={composition.commands as React.ComponentProps<typeof PartnerInquiryWorkspace>['commands']}
      writable configuredRows={[]} configurationEditor={<p>مشخصات فنی محفوظ</p>}
      onEnterWizard={async () => undefined} onOpenInquiry={() => undefined} />
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(new URLSearchParams(location.search).has('technical') ? <WizardTechnicalBrowserFixture />
  : new URLSearchParams(location.search).has('reinquiry') ? <ReinquiryFixture /> : <Fixture />);
