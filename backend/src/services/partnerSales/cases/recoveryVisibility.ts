export function shouldExposePartnerRecovery(
  partnerCaseId: string | undefined,
  editableOwnedCaseIds: ReadonlySet<string>,
): boolean {
  return partnerCaseId === undefined || editableOwnedCaseIds.has(partnerCaseId);
}
