type LedgerAccount = { id: string; level: string; financialAccountRequirement?: string; partyRequirement?: string };
type LedgerContext = { books?: Array<{ id: string; accounts?: LedgerAccount[] }> };

/** The context owns accounts inside each book; never mix a different book's coding. */
export function treasuryLedgerAccounts(context: LedgerContext | undefined, bookId: string) {
  return context?.books?.find((book) => book.id === bookId)?.accounts ?? [];
}
