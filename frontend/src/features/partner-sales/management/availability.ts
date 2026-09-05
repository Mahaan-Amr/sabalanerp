import type { ActionAvailabilityV2, PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';

/** Presentation-only denial: the server remains authoritative for every read/write. */
export function actionPresentation(actions: readonly ActionAvailabilityV2[], action: PartnerActionV2, now: number) {
  const value = actions.find(item => item.action === action);
  if (!value) return null;
  const expired = Boolean(value.expiresAt && Date.parse(value.expiresAt) <= now);
  return { enabled: value.enabled && !expired,
    reason: expired ? 'مهلت دسترسی به این اقدام پایان یافته است؛ وضعیت را تازه کنید.' : value.disabledReason?.message || (!value.enabled ? 'این اقدام فعلاً در دسترس نیست.' : undefined) };
}
