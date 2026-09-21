interface StoredTemplateEvidence {
  finger: string;
  imageMimeType: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageByteLength: number | null;
  deviceEvidence: unknown;
}

export const projectBiometricEnrollmentTemplate = (template: StoredTemplateEvidence) => ({
  ...projectImageMetadata(template),
  ...projectSafeCaptureEvidence(template.deviceEvidence),
});

const projectImageMetadata = (template: StoredTemplateEvidence) => ({
  finger: template.finger, imageMimeType: template.imageMimeType, imageWidth: template.imageWidth,
  imageHeight: template.imageHeight, imageByteLength: template.imageByteLength,
});

const projectSafeCaptureEvidence = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const evidence = value as Record<string, unknown>;
  const quality = evidence.captureQuality as Record<string, unknown> | undefined;
  const liveness = evidence.liveness as Record<string, unknown> | undefined;
  const qualityState = quality?.state;
  const qualityScore = quality?.score;
  const livenessState = liveness?.state;
  if (!['ACCEPTED', 'REJECTED', 'NOT_EVALUATED'].includes(String(qualityState))
    || typeof qualityScore !== 'number' || !Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 100
    || !['LIVE', 'NOT_LIVE', 'NOT_EVALUATED'].includes(String(livenessState))) return {};
  return {
    captureQuality: { state: String(qualityState), score: qualityScore },
    liveness: { state: String(livenessState) },
  };
};
