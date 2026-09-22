export type DriverEligibilitySection = 'status' | 'biometric' | 'dispatch';

export const driverEligibilitySections: Array<{ value: DriverEligibilitySection; label: string }> = [
  { value: 'status', label: 'وضعیت راننده' },
  { value: 'biometric', label: 'بیومتریک' },
  { value: 'dispatch', label: 'پرونده‌های ارسال' },
];

export const biometricEnrollmentPresentation = ({
  hasActiveEnrollment,
  imagesRequested,
}: {
  hasActiveEnrollment: boolean;
  imagesRequested: boolean;
}) => ({
  showEnrollmentForm: !hasActiveEnrollment,
  showActiveSummary: hasActiveEnrollment,
  showDeactivationAction: hasActiveEnrollment,
  loadEnrollmentImages: hasActiveEnrollment && imagesRequested,
});
