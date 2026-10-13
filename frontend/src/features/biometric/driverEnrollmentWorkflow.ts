export const enrollmentFingers = ['RIGHT_INDEX', 'LEFT_INDEX'] as const;
export type EnrollmentFinger = (typeof enrollmentFingers)[number];
export type EnrollmentCaptureEvidence = {
  finger: EnrollmentFinger;
  qualityState: string;
  qualityScore?: number;
  livenessState: string;
  accepted?: boolean;
};
export type AcceptedEnrollmentCapture = EnrollmentCaptureEvidence & { challengeId: string; expiresAt: string };
export type EnrollmentAcceptanceRequest = { enrollmentSessionId: string; challengeId: string; signedResponse: { response: unknown; signature: string }; transportEnvelope: unknown };
export type EnrollmentSession = {
  enrollmentSessionId: string;
  captures: AcceptedEnrollmentCapture[];
  pendingAcceptance?: { finger: EnrollmentFinger; expiresAt: string; request: EnrollmentAcceptanceRequest };
};
export type EnrollmentCapture = { challengeId: string };

type EnrollmentWorkflowDependencies = {
  personnelId: string;
  session: EnrollmentSession;
  now?: () => number;
  getConnectorStatus: () => Promise<{ workstationId: string; availability: string }>;
  createEnrollmentCommand: (personnelId: string, data: { workstationId: string; finger: EnrollmentFinger; enrollmentSessionId: string }) => Promise<any>;
  executeConnectorCommand: (bundle: unknown) => Promise<any>;
  acceptEnrollmentCapture: (personnelId: string, data: EnrollmentAcceptanceRequest) => Promise<any>;
  requestFingerPlacement: (finger: EnrollmentFinger) => Promise<void>;
  onCaptureComplete?: (evidence: EnrollmentCaptureEvidence) => void;
  onSessionChange?: (session: EnrollmentSession) => void;
  isCancelled?: () => boolean;
};

export function enrollmentSessionExpired(session: EnrollmentSession, now = Date.now()): boolean {
  return [ ...session.captures, ...(session.pendingAcceptance ? [session.pendingAcceptance] : []) ].some((capture) => !Number.isFinite(Date.parse(capture.expiresAt)) || Date.parse(capture.expiresAt) <= now);
}

export function captureFailureMessage(result: any): string {
  const messages: Record<string, string> = {
    CAPTURE_TIMEOUT: 'مهلت برداشت اثر انگشت پایان یافت. انگشت را دوباره روی حسگر قرار دهید.',
    TIMEOUT: 'مهلت برداشت اثر انگشت پایان یافت. انگشت را دوباره روی حسگر قرار دهید.',
    CANCELLED: 'برداشت اثر انگشت لغو شد. دوباره شروع کنید.',
    DEVICE_UNAVAILABLE: 'حسگر اثر انگشت در دسترس نیست. اتصال دستگاه و اتصال‌گر را بررسی کنید.',
    SDK_LICENSE_INVALID: 'مجوز نرم‌افزار حسگر معتبر نیست. پشتیبانی باید مجوز اتصال‌گر را بررسی کند.',
    LIVENESS_UNAVAILABLE: 'ارزیابی زنده‌بودن در حسگر در دسترس نیست. تنظیمات دستگاه باید توسط پشتیبانی بررسی شود.',
    LIVENESS_FAILED: 'زنده‌بودن اثر انگشت تأیید نشد. برداشت را دوباره انجام دهید.',
    POOR_CAPTURE_QUALITY: 'کیفیت اثر انگشت کافی نیست. انگشت را دوباره روی حسگر قرار دهید.',
    CAPTURE_IMAGE_UNAVAILABLE: 'تصویر اثر انگشت دریافت نشد. برداشت را تکرار کنید و در صورت تکرار با پشتیبانی تماس بگیرید.',
    CAPTURE_IMAGE_INVALID: 'تصویر برداشت‌شده معتبر نیست. برداشت را تکرار کنید و در صورت تکرار با پشتیبانی تماس بگیرید.',
    DEVICE_DISCONNECTED: 'اتصال حسگر قطع شده است. کابل و اتصال دستگاه را بررسی کنید.',
    CONNECTOR_ERROR: 'اتصال‌گر نتوانست اثر انگشت را برداشت کند. اتصال حسگر را بررسی کنید و در صورت تکرار با پشتیبانی تماس بگیرید.',
  };
  if (messages[result?.errorCategory]) return messages[result.errorCategory];
  if (result?.availability !== 'AVAILABLE') return 'حسگر اثر انگشت در دسترس نیست. اتصال دستگاه و اتصال‌گر را بررسی کنید.';
  if (result?.captureQuality?.state !== 'ACCEPTED') return 'کیفیت اثر انگشت تأیید نشد. انگشت را دوباره روی حسگر قرار دهید.';
  return 'زنده‌بودن اثر انگشت تأیید نشد. برداشت را دوباره انجام دهید.';
}

export const captureEvidenceTone = (state: string, acceptedState: string) =>
  state === acceptedState ? 'success' as const : state === 'REJECTED' ? 'danger' as const : 'warning' as const;

export async function captureEnrollmentFingers(dependencies: EnrollmentWorkflowDependencies): Promise<EnrollmentCapture[]> {
  const now = dependencies.now || Date.now;
  const session = dependencies.session;
  const checkActive = () => {
    if (dependencies.isCancelled?.()) throw new Error('ثبت اثر انگشت لغو شد.');
    if (enrollmentSessionExpired(session, now())) throw new Error('مهلت ثبت موقت اثر انگشت پایان یافت. ثبت هر دو انگشت را دوباره شروع کنید.');
  };
  checkActive();
  if (session.captures.length === enrollmentFingers.length) return session.captures.map(({ challengeId }) => ({ challengeId }));
  const acceptPending = async () => {
    const pending = session.pendingAcceptance;
    if (!pending) return;
    let response: any;
    try {
      response = await dependencies.acceptEnrollmentCapture(dependencies.personnelId, pending.request);
    } catch (error) {
      const status = (error as any)?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status)) delete session.pendingAcceptance;
      throw error;
    }
    checkActive();
    const accepted: AcceptedEnrollmentCapture = { ...response.data.data, accepted: true };
    if (accepted.challengeId !== pending.request.challengeId || accepted.finger !== pending.finger || accepted.qualityState !== 'ACCEPTED' || accepted.livenessState !== 'LIVE' || !Number.isFinite(Date.parse(accepted.expiresAt)) || Date.parse(accepted.expiresAt) <= now()) throw new Error('پاسخ ثبت موقت اثر انگشت معتبر نیست. دوباره شروع کنید.');
    session.captures.push(accepted);
    delete session.pendingAcceptance;
    dependencies.onSessionChange?.({ ...session, captures: [...session.captures] });
    dependencies.onCaptureComplete?.(accepted);
  };
  // A lost stage response must retry the identical encrypted request, never re-scan.
  await acceptPending();
  checkActive();
  if (session.captures.length === enrollmentFingers.length) return session.captures.map(({ challengeId }) => ({ challengeId }));
  const status = await dependencies.getConnectorStatus();
  if (status.availability !== 'AVAILABLE') throw new Error(captureFailureMessage(status));
  for (const finger of enrollmentFingers) {
    if (session.captures.some((capture) => capture.finger === finger)) continue;
    checkActive();
    await dependencies.requestFingerPlacement(finger);
    checkActive();
    const issued = await dependencies.createEnrollmentCommand(dependencies.personnelId, { workstationId: status.workstationId, finger, enrollmentSessionId: session.enrollmentSessionId });
    const connectorResult = await dependencies.executeConnectorCommand(issued.data.data);
    checkActive();
    const result = connectorResult.response?.result || {};
    if (result.availability !== 'AVAILABLE' || result.captureQuality?.state !== 'ACCEPTED' || result.liveness?.state !== 'LIVE' || (result.errorCategory && result.errorCategory !== 'NONE')) {
      dependencies.onCaptureComplete?.({ finger, qualityState: String(result.captureQuality?.state || 'NOT_EVALUATED'), livenessState: String(result.liveness?.state || 'NOT_EVALUATED'), accepted: false });
      // Report signed negative evidence so the server can durably close the command.
      // A failed report must never turn a known failed capture into retry/staging progress.
      try {
        await dependencies.acceptEnrollmentCapture(dependencies.personnelId, {
          enrollmentSessionId: session.enrollmentSessionId,
          challengeId: issued.data.data.command.commandId,
          signedResponse: { response: connectorResult.response, signature: connectorResult.signature },
          transportEnvelope: connectorResult.transportEnvelope,
        });
      } catch {
        // The operator still needs the safe capture failure, not a network/report error.
      }
      throw new Error(captureFailureMessage(result));
    }
    session.pendingAcceptance = {
      finger,
      expiresAt: session.captures[0]?.expiresAt || new Date(now() + 300_000).toISOString(),
      request: {
        enrollmentSessionId: session.enrollmentSessionId,
        challengeId: issued.data.data.command.commandId,
        signedResponse: { response: connectorResult.response, signature: connectorResult.signature },
        transportEnvelope: connectorResult.transportEnvelope,
      },
    };
    await acceptPending();
  }
  checkActive();
  return session.captures.map(({ challengeId }) => ({ challengeId }));
}
