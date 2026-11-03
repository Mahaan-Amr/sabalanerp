// Explicit testing subpath: never imported by the production entry point.
import { InstantSchema } from './primitives';
import { NotificationGateway, SafeNotification, SafeNotificationSchema, TransactionClock } from './ports';
import { canonicalJson } from './integrity';
import { partnerError, Result } from './errors';

export class FixedTransactionClock implements TransactionClock {
  private instant: string;
  constructor(instant: string) { this.instant = InstantSchema.parse(instant); }
  async now(): Promise<string> { return this.instant; }
  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new TypeError('Clock advances by nonnegative integral milliseconds');
    this.instant = new Date(Date.parse(this.instant) + milliseconds).toISOString();
  }
}
export class SandboxNotificationGateway implements NotificationGateway {
  private readonly messages = new Map<string, string>();
  async enqueue(input: SafeNotification): Promise<Result<{ deliveryId: string; mode: 'SANDBOX' }>> {
    const parsed = SafeNotificationSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const message = parsed.data;
    const bytes = canonicalJson(message);
    const previous = this.messages.get(message.notificationId);
    if (previous && previous !== bytes) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    this.messages.set(message.notificationId, bytes);
    return { ok: true, value: { deliveryId: 'sandbox-' + message.notificationId, mode: 'SANDBOX' } };
  }
}

export { createPartnerFixtures, createNegativePartnerFixtures } from './testing/fixtures';
export { FixturePartnerQueryAdapter } from './testing/queryAdapter';
