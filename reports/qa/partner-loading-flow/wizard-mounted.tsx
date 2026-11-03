import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PartnerContractWizard, type PartnerWizardDraft } from '../../../frontend/src/features/contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission } from '../../../frontend/src/features/contract-creation/partner/partnerCaseSubmission';
import { defaultPartnerRetailRows, partnerRetailIntentRows } from '../../../frontend/src/features/contract-creation/partner/partnerRetail';
import { createWizardFixtures } from '../../../frontend/src/features/partner-sales/__tests__/wizardFixtures';
const fixture = createWizardFixtures();
const target = window as any;
let root: ReturnType<typeof createRoot> | undefined;
target.mountScenario = (scenario: 'success' | 'uncertain' | 'service-only') => {
  root?.unmount();
  document.body.innerHTML = '<div id="root"></div>';
  target.observed = { commands: [], preparations: 0, edits: 0, steps: [] };
  const rows = defaultPartnerRetailRows([{ productRowId: fixture.configurationDraft.productRowId,
    quantity: '2', unit: 'm', inquiryRow: { ...fixture.inquiry.rows[0], state: 'PENDING',
      approvedPrice: undefined, approvedRowBinding: undefined, approvedAt: undefined, expiresAt: undefined } }]);
  rows[0].retailUnitPrice = { amount: '1000', currency: 'IRR' };
  const serviceOnly = scenario === 'service-only';
  const initial: PartnerWizardDraft = { rows: serviceOnly ? [] : rows, step: 'pricing',
    serviceRows: serviceOnly ? [{ serviceRowId: 'service-1', title: 'خدمت آزمایشی', quantity: '1', unit: 'count',
      retailUnitPrice: { amount: '1000', currency: 'IRR' }, wholesaleUnitPrice: { amount: '800', currency: 'IRR' } }] : [],
    intent: { ...fixture.draftSubmissionReference, contractDate: '2026-08-27',
      rows: serviceOnly ? [] : partnerRetailIntentRows(rows), serviceRows: serviceOnly ? [{ serviceRowId: 'service-1' }] : [],
      customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: fixture.partner.deliveries,
      retailDiscount: { amount: '0', currency: 'IRR' }, belowCostConfirmed: false } };
  let pending: any = null;
  const submission = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
    commands: { execute: async command => {
      target.observed.commands.push(command);
      if (scenario === 'uncertain') throw new Error('response lost');
      return { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: [],
        case: fixture.partner } };
    } },
    recovery: { pending: () => pending, savePending: async command => { pending = command; },
      clearPending: async () => { pending = null; }, finalizeCommitted: async () => undefined,
      prepareEditLease: async () => { throw new Error('unused'); } } });
  function App() {
    const [draft, setDraft] = useState(initial);
    return <PartnerContractWizard draft={draft} onChange={next => { target.observed.steps.push(next.step); setDraft(next); }}
      recovery={{ state: 'writable' }} submission={submission} now={Date.parse('2026-08-27T09:00:00Z')}
      renderSection={step => <p>{step === 'delivery' ? 'برنامه تحویل آزمایشی' : step}</p>}
      validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined}
      onEditProducts={() => { target.observed.edits++; }} onPreparePricingQuote={async current => {
        target.observed.preparations++; await new Promise(resolve => setTimeout(resolve, 75)); return current;
      }} />;
  }
  root = createRoot(document.getElementById('root')!);
  root.render(<StrictMode><App /></StrictMode>);
};
