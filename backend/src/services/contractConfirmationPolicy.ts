/** Shared resend timing for ordinary and Partner customer confirmation. */
export function confirmationResendCooldownError(lastSentAt: Date | null, now: Date,
  cooldownSeconds = Number.parseInt(process.env.CONTRACT_CONFIRM_RESEND_COOLDOWN_SECONDS || '60', 10)): string | undefined {
  if (!lastSentAt) return undefined;
  const elapsed = Math.floor((now.getTime() - lastSentAt.getTime()) / 1000);
  return elapsed < cooldownSeconds
    ? `لطفا پس از ${cooldownSeconds - elapsed} ثانیه دوباره تلاش کنید` : undefined;
}
