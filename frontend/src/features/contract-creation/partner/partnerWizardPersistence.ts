import { canonicalJson } from '@sabalanerp/partner-sales-contracts';
import type { PartnerWizardDraft } from './PartnerContractWizard';

/** Inquiry presentation refreshes are not edits. Only the persisted step/intent
 * can schedule autosave; authority and lease are still checked by every write. */
export function partnerWizardPersistenceKey(draft: Pick<PartnerWizardDraft, 'step' | 'intent'> | null) {
  return draft ? canonicalJson(JSON.parse(JSON.stringify({ step: draft.step, intent: draft.intent }))) : null;
}
