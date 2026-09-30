import { CaseDraftIntentSchema, PartnerWizardRecoverySnapshotSchema } from '@sabalanerp/partner-sales-contracts';

/** Only the requested recovery may supply entry fields after product editing. */
export function partnerProductEditEntry(recoveryId: string, serverSnapshot: unknown, localIntent?: unknown) {
  const server = PartnerWizardRecoverySnapshotSchema.safeParse(serverSnapshot);
  const intent = server.success ? server.data.intent : CaseDraftIntentSchema.parse(localIntent);
  if (intent.recoveryId !== recoveryId) throw new Error('Product edit recovery mismatch');
  return { customerId: intent.customerId, projectId: intent.projectId, contractDate: intent.contractDate };
}

export function partnerSaleEntryIssue(entry: { contractDate: string; customerId: string; projectId: string }) {
  if (!entry.contractDate) return { step: 'date' as const, message: 'تاریخ قرارداد را وارد کنید.' };
  if (!entry.customerId) return { step: 'customer' as const, message: 'مشتری را انتخاب کنید.' };
  if (!entry.projectId) return { step: 'project' as const, message: 'پروژه را انتخاب کنید.' };
  return null;
}
