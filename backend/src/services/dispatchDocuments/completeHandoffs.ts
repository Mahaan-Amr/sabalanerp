/** Complete each independent audit even if another one fails. Sequential
 * commits avoid serializable predicate conflicts between the audit chains. */
export async function completeHandoffs(operations: readonly (() => Promise<void>)[]): Promise<void> {
  let failure: unknown;
  for (const operation of operations) {
    try { await operation(); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}
