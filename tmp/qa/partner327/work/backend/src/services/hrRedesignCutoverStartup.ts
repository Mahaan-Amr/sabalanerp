type CutoverEnvironment = Record<string, string | undefined>;

export type HrRedesignCutoverStartup = {
  enabled: boolean;
  acceptancePath: string | null;
  sourceRevision: string | null;
};

export const resolveHrRedesignCutoverStartup = (
  environment: CutoverEnvironment,
): HrRedesignCutoverStartup => {
  const enabled = environment.HR_REDESIGN_CUTOVER_ENABLED === 'true';
  if (!enabled) {
    return { enabled: false, acceptancePath: null, sourceRevision: null };
  }

  const acceptancePath = environment.HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH?.trim() || null;
  const sourceRevision = environment.HR_REDESIGN_CUTOVER_REVISION?.trim() || null;
  const missing = [
    !acceptancePath ? 'HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH' : null,
    !sourceRevision ? 'HR_REDESIGN_CUTOVER_REVISION' : null,
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(`HR redesign Cutover is enabled but missing: ${missing.join(', ')}`);
  }

  return { enabled: true, acceptancePath, sourceRevision };
};
