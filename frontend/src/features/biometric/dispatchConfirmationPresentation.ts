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

type BiometricResult = {
  availability?: string;
  captureQuality?: { state?: string };
  liveness?: { state?: string };
  match?: { state?: string };
  errorCategory?: string;
};

const biometricFailureReasons: Record<string, string> = {
  DEVICE_DISCONNECTED: 'اتصال حسگر اثر انگشت قطع شد.',
  DEVICE_UNAVAILABLE: 'حسگر اثر انگشت در دسترس نیست.',
  CAPTURE_TIMEOUT: 'مهلت برداشت اثر انگشت پایان یافت.',
  SDK_LICENSE_INVALID: 'مجوز نرم‌افزار حسگر معتبر نیست.',
  POOR_CAPTURE_QUALITY: 'کیفیت برداشت اثر انگشت کافی نیست.',
  LIVENESS_FAILED: 'زنده‌بودن اثر انگشت تأیید نشد.',
  NO_MATCH: 'اثر انگشت با نمونهٔ ثبت‌شدهٔ راننده تطابق ندارد.',
  WRONG_DRIVER: 'اثر انگشت با نمونهٔ ثبت‌شدهٔ راننده تطابق ندارد.',
};

function biometricFailureReason(result?: BiometricResult) {
  const category = result?.errorCategory;
  if (category && Object.prototype.hasOwnProperty.call(biometricFailureReasons, category)) return biometricFailureReasons[category];
  if (result?.availability === 'UNAVAILABLE') return biometricFailureReasons.DEVICE_UNAVAILABLE;
  if (result?.captureQuality?.state === 'REJECTED') return biometricFailureReasons.POOR_CAPTURE_QUALITY;
  if (result?.liveness?.state === 'NOT_LIVE') return biometricFailureReasons.LIVENESS_FAILED;
  if (result?.match?.state === 'NO_MATCH') return biometricFailureReasons.NO_MATCH;
  return 'نتیجهٔ تأیید اثر انگشت در دسترس نیست.';
}

export function biometricAttemptNotice(attempt?: {
  result?: BiometricResult;
  authorization?: { id?: string };
  fallbackEligible?: boolean;
}) {
  if (attempt?.authorization?.id) {
    return { kind: 'success' as const, text: 'اثر انگشت راننده تأیید شد.' };
  }
  const reason = biometricFailureReason(attempt?.result);
  const fallback = attempt?.fallbackEligible ? ' روش جایگزین در دسترس است.' : '';
  return { kind: 'error' as const, text: `تأیید اثر انگشت ناموفق بود. ${reason}${fallback}` };
}

export function biometricAttemptEventLabel(result: BiometricResult) {
  if (result.match?.state === 'MATCH' && result.captureQuality?.state === 'ACCEPTED' && result.liveness?.state === 'LIVE') {
    return 'اثر انگشت با نمونهٔ ثبت‌شدهٔ راننده تطابق داشت';
  }
  return `بررسی اثر انگشت ناموفق بود. ${biometricFailureReason(result)}`;
}
