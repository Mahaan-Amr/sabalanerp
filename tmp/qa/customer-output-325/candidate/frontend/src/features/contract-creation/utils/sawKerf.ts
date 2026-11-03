export const SAW_KERF_CM = 0.3;

export const resolveSawKerfCm = (
  sawKerfEnabled?: boolean,
  sawKerfCm?: number | null
): number => {
  if (!sawKerfEnabled) return 0;

  const storedKerf = Number(sawKerfCm);
  return Number.isFinite(storedKerf) && storedKerf > 0 ? storedKerf : SAW_KERF_CM;
};

export const addSawKerfForCut = (
  finishedDimension: number,
  sawKerfEnabled?: boolean,
  sawKerfCm?: number | null
): number => finishedDimension + resolveSawKerfCm(sawKerfEnabled, sawKerfCm);
