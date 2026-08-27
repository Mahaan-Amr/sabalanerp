import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErpButton } from '@/components/erp';
import { PartnerInquiryPanel } from '../inquiries/PartnerInquiryPanel';
import { PartnerContractWizard, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission, type PartnerSubmitCommand } from '../../contract-creation/partner/partnerCaseSubmission';
import { enterPartnerWizard } from '../../contract-creation/partner/partnerWizardEntry';
import { createWizardFixtures } from './wizardFixtures';

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
          base: { ...fixture.draftSubmissionReference, contractDate: fixture.customer.contractDate, customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: fixture.partner.deliveries, retailDiscount: { amount: '0', currency: 'IRR' } },
          quantities: [{ productRowId: fixture.configurationDraft.productRowId, quantity: '2', unit: 'm' }],
        }))} />}
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Fixture />);
