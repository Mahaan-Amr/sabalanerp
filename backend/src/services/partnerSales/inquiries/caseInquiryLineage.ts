/** A corrected row can follow its rejected row across immutable Case revisions.
 * The old inquiry stays attached to its original Case revision. */
export function sameCaseInquiryLineage(input: {
  inquiryId: string; caseId: string; caseRevision: number; productRowId: string;
  predecessorInquiryId: string; predecessorCaseId: string | null;
  predecessorCaseRevision: number | null; predecessorProductRowId: string;
}): boolean {
  return input.productRowId === input.predecessorProductRowId && (
    input.predecessorInquiryId === input.inquiryId ||
    (input.predecessorCaseId === input.caseId && input.predecessorCaseRevision !== null &&
      input.predecessorCaseRevision < input.caseRevision)
  );
}
