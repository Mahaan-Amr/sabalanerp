export async function commitPartnerTechnicalDraft<T>({ checkpointRequired, checkpoint, save }: {
  checkpointRequired: boolean;
  checkpoint: () => Promise<boolean>;
  save: () => Promise<T>;
}): Promise<T | null> {
  if (checkpointRequired && !await checkpoint()) return null;
  return save();
}
