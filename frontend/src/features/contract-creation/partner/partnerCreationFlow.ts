export type PartnerCreationMode = 'sale' | 'inquiry';

type TechnicalCheck = { ok: boolean; conflicts?: readonly { message: string }[] };
type TechnicalPreviewCheck = { ok: false; error: { message: string } } | { ok: true; value: {
  conflicts: readonly { message: string }[];
  rows: readonly { calculation: TechnicalCheck; operations?: TechnicalCheck }[];
  dependents: readonly { calculation: TechnicalCheck; operations?: TechnicalCheck }[];
} };

export function partnerTechnicalSaveIssue(preview: TechnicalPreviewCheck): string | null {
  if (!preview.ok) return preview.error.message;
  if (preview.value.conflicts.length) return preview.value.conflicts[0].message;
  for (const row of [...preview.value.rows, ...preview.value.dependents]) {
    if (!row.calculation.ok) return row.calculation.conflicts?.[0]?.message ?? 'مشخصات این ردیف را کامل کنید.';
    if (row.operations && !row.operations.ok) return row.operations.conflicts?.[0]?.message ?? 'عملیات این ردیف را بررسی کنید.';
  }
  return null;
}

export interface PartnerTechnicalActionState {
  mode: PartnerCreationMode;
  pending: boolean;
  technicalReady: boolean;
  contractConfigurationReady: boolean;
  quickDimensionsValid: boolean;
  hasDraftAccess: boolean;
}

export function canSubmitPartnerTechnicalAction(state: PartnerTechnicalActionState): boolean {
  return !state.pending && state.technicalReady
    && (state.mode === 'inquiry' || state.contractConfigurationReady)
    && state.quickDimensionsValid && state.hasDraftAccess;
}

export function showPartnerContractConfigurationWarning(
  mode: PartnerCreationMode,
  contractConfigurationReady: boolean,
): boolean {
  return mode === 'sale' && !contractConfigurationReady;
}
