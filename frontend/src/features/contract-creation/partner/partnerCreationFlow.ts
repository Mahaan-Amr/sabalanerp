export type PartnerCreationMode = 'sale' | 'inquiry';

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
