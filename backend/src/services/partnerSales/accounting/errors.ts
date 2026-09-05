export class PartnerAccountingCommandError extends Error {
  constructor(readonly code: 'INVALID_PAYLOAD' | 'INTEGRITY_CONFLICT' | 'FORBIDDEN' | 'IDEMPOTENCY_CONFLICT', message: string) {
    super(message);
    this.name = 'PartnerAccountingCommandError';
  }
  get status() { return this.code === 'FORBIDDEN' ? 403 : this.code === 'INVALID_PAYLOAD' ? 400 : 409; }
  readonly actionUrl = '/dashboard/accounting/receivables';
}

export class PartnerAccountingTechnicalError extends Error {
  constructor(readonly diagnostic: unknown) {
    super('ثبت گردش حساب موقتاً ممکن نیست؛ دوباره تلاش کنید و در صورت تکرار، کد پیگیری را به پشتیبانی بدهید.');
    this.name = 'PartnerAccountingTechnicalError';
  }
}
