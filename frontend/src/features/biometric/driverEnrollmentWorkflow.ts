export const enrollmentFingers = ['RIGHT_INDEX', 'LEFT_INDEX'] as const;

export type EnrollmentFinger = (typeof enrollmentFingers)[number];

export type EnrollmentCapture = {
  challengeId: string;
  signedResponse: { response: unknown; signature: string };
  transportEnvelope: unknown;
};

export type EnrollmentCaptureEvidence = {
  finger: EnrollmentFinger;
  qualityState: string;
  qualityScore?: number;
  livenessState: string;
};

type EnrollmentWorkflowDependencies = {
  personnelId: string;
  getConnectorStatus: () => Promise<{ workstationId: string }>;
  createEnrollmentCommand: (personnelId: string, data: { workstationId: string; finger: EnrollmentFinger }) => Promise<any>;
  executeConnectorCommand: (bundle: unknown) => Promise<any>;
  requestFingerPlacement: (finger: EnrollmentFinger) => Promise<void>;
  onCaptureComplete?: (evidence: EnrollmentCaptureEvidence) => void;
};

export async function captureEnrollmentFingers(dependencies: EnrollmentWorkflowDependencies): Promise<EnrollmentCapture[]> {
  const status = await dependencies.getConnectorStatus();
  const captures: EnrollmentCapture[] = [];
  for (const finger of enrollmentFingers) {
    await dependencies.requestFingerPlacement(finger);
    const issued = await dependencies.createEnrollmentCommand(dependencies.personnelId, { workstationId: status.workstationId, finger });
    const connectorResult = await dependencies.executeConnectorCommand(issued.data.data);
    captures.push({
      challengeId: issued.data.data.command.commandId,
      signedResponse: { response: connectorResult.response, signature: connectorResult.signature },
      transportEnvelope: connectorResult.transportEnvelope,
    });
    const result = connectorResult.response?.result || {};
    dependencies.onCaptureComplete?.({
      finger,
      qualityState: String(result.captureQuality?.state || 'UNKNOWN'),
      qualityScore: typeof result.captureQuality?.score === 'number' ? result.captureQuality.score : undefined,
      livenessState: String(result.liveness?.state || 'UNKNOWN'),
    });
  }
  return captures;
}
