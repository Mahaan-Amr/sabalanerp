export type DispatchConfirmationIdentity = {
  driverSource?: string | null;
  method?: string | null;
};

export const confirmationActionsFor = (confirmation: DispatchConfirmationIdentity) => {
  const internalBiometric = (confirmation.driverSource === 'INTERNAL' && confirmation.method === 'INTERNAL_BIOMETRIC')
    || (confirmation.driverSource === 'EXTERNAL' && confirmation.method === 'EXTERNAL_BIOMETRIC');
  const externalOtp = (confirmation.driverSource === 'EXTERNAL' && confirmation.method === 'EXTERNAL_FALLBACK')
    || (confirmation.driverSource === 'INTERNAL' && confirmation.method === 'INTERNAL_FALLBACK');

  return {
    biometric: internalBiometric,
    fallback: internalBiometric,
    otp: externalOtp,
  };
};
