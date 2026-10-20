export type ClockSample = { terminalId: string; evidence: { offsetMs: number; uncertaintyMs: number; measuredAt: string } };

// Estimates are intentionally separate from immutable source timestamps and
// must not extrapolate a fresh clock reading over historical attendance.
export function estimateScanClock(raw: string | null | undefined, sample?: ClockSample, now = Date.now()) {
  if (!raw || !sample) return null;
  const { offsetMs, uncertaintyMs, measuredAt } = sample.evidence;
  const measured = Date.parse(measuredAt);
  const corrected = Date.parse(raw) + offsetMs;
  if (!Number.isFinite(corrected) || !Number.isFinite(measured) || !Number.isFinite(offsetMs) || !Number.isFinite(uncertaintyMs) || uncertaintyMs < 0 || uncertaintyMs > 15000 || Math.abs(offsetMs) > 300000 || Math.abs(now - measured) > 120000 || Math.abs(corrected - measured) > 120000) return null;
  return { at: new Date(corrected).toISOString(), uncertaintySeconds: (uncertaintyMs / 1000).toFixed(1) };
}
