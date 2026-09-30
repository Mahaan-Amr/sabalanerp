export type PartnerCreationMode = 'sale' | 'inquiry';

type TechnicalConflict = { message: string; code?: string };
type TechnicalCheck = { ok: boolean; conflicts?: readonly TechnicalConflict[] };
type TechnicalPreviewCheck = { ok: false; error: { message: string } } | { ok: true; value: {
  conflicts: readonly TechnicalConflict[];
  rows: readonly { calculation: TechnicalCheck; operations?: TechnicalCheck }[];
  dependents: readonly { calculation: TechnicalCheck; operations?: TechnicalCheck }[];
} };

export function partnerTechnicalConflictMessage(conflict: TechnicalConflict | undefined, fallback: string): string {
  if (!conflict) return fallback;
  if (conflict.code === 'duplicate-operation-identity') return 'شناسهٔ گروه عملیات تکراری است؛ گروه و ابزارهای همان محصول را دوباره بررسی کنید.';
  if (conflict.code === 'group-scope-exceeds-product') return 'تعداد گروه عملیات از تعداد محصول بیشتر است؛ تعداد گروه را اصلاح کنید.';
  return /[A-Za-z]{3,}/.test(conflict.message) ? fallback : conflict.message;
}

export function partnerTechnicalSaveIssue(preview: TechnicalPreviewCheck): string | null {
  if (!preview.ok) return preview.error.message;
  if (preview.value.conflicts.length) return partnerTechnicalConflictMessage(preview.value.conflicts[0], 'مشخصات محصول‌ها با هم سازگار نیست؛ ردیف‌های علامت‌دار را بررسی کنید.');
  for (const row of [...preview.value.rows, ...preview.value.dependents]) {
    if (!row.calculation.ok) return partnerTechnicalConflictMessage(row.calculation.conflicts?.[0], 'مشخصات این ردیف را کامل کنید.');
    if (row.operations && !row.operations.ok) return partnerTechnicalConflictMessage(row.operations.conflicts?.[0], 'عملیات این ردیف را بررسی کنید.');
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
