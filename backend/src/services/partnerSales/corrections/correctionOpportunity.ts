import {
  CorrectionOpportunitySchema,
  IdSchema,
  InstantSchema,
  PersianReasonSchema,
  RevisionRefSchema,
  canonicalHash,
  partnerError,
  type Result,
  type TehranWorkingCalendar,
} from '@sabalanerp/partner-sales-contracts';

export type RetailCorrectionOpportunity = ReturnType<typeof CorrectionOpportunitySchema.parse>;

export type RetailCorrectionOpportunityInput = {
  opportunityId: string;
  correctionId: string;
  predecessor: ReturnType<typeof RevisionRefSchema.parse>;
  partnerSellerId: string;
  approvedAt: string;
  reason: string;
};

/** Builds the one-shot opportunity from the approved Sales scope. The calendar
 * is an owned, versioned boundary; this module never substitutes elapsed time. */
export async function createRetailCorrectionOpportunity(
  input: RetailCorrectionOpportunityInput,
  calendar: TehranWorkingCalendar,
): Promise<Result<RetailCorrectionOpportunity>> {
  try {
    const opportunityId = IdSchema.parse(input.opportunityId);
    const correctionId = IdSchema.parse(input.correctionId);
    const predecessor = RevisionRefSchema.parse(input.predecessor);
    const partnerSellerId = IdSchema.parse(input.partnerSellerId);
    const approvedAt = InstantSchema.parse(input.approvedAt);
    const reason = PersianReasonSchema.parse(input.reason);
    const calendarVersion = IdSchema.parse(calendar.version);
    const expiresAt = InstantSchema.parse(await calendar.addWorkingDays(approvedAt, 3));
    if (expiresAt <= approvedAt) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const scopeHash = await canonicalHash({
      purpose: 'PARTNER_RETAIL_CORRECTION_SCOPE', schemaVersion: 1,
      correctionId, predecessor, partnerSellerId, scope: 'RETAIL_ONLY', reason,
      approvedAt, expiresAt, calendarVersion, workingDays: 3, successfulSavesAllowed: 1,
    });
    return { ok: true, value: CorrectionOpportunitySchema.parse({
      schemaVersion: 1, opportunityId, predecessor, scope: 'RETAIL_ONLY', partnerSellerId,
      approvedAt, expiresAt, calendarVersion, workingDays: 3,
      successfulSavesAllowed: 1, scopeHash,
    }) };
  } catch {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
}
