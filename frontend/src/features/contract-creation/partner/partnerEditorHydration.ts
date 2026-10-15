/** The checkpoint identifies the immutable technical revision. Case authority
 * and checkpoint-dependent evidence can load independently, but nothing is
 * returned for publication until every fresh read succeeds. */
export async function readPartnerEditorHydration<Case, Checkpoint, Evidence>(input: {
  readCase: () => Promise<Case>;
  readCheckpoint: () => Promise<Checkpoint>;
  readEvidence: (checkpoint: Checkpoint) => Promise<Evidence>;
}) {
  const [caseResponse, restored] = await Promise.all([
    input.readCase(),
    input.readCheckpoint().then(async checkpoint => ({ checkpoint, evidence: await input.readEvidence(checkpoint) })),
  ]);
  return { caseResponse, ...restored };
}
