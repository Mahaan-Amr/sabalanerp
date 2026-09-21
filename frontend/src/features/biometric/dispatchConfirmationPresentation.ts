export type DispatchConfirmationIdentity = {
  driverSource?: string | null;
  method?: string | null;
};

export const confirmationActionsFor = (confirmation: DispatchConfirmationIdentity) => {
  const internalBiometric = confirmation.driverSource === 'INTERNAL'
    && confirmation.method === 'INTERNAL_BIOMETRIC';
  const externalOtp = confirmation.driverSource === 'EXTERNAL'
    && confirmation.method === 'EXTERNAL_OTP_GUARD';

  return {
    biometric: internalBiometric,
    fallback: internalBiometric,
    otp: externalOtp,
  };
};
