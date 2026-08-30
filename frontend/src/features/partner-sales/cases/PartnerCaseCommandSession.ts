import { canonicalHash, PartnerCommandSchema, partnerError, type PartnerCommand, type PartnerCommandPort } from '@sabalanerp/partner-sales-contracts';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'schemaVersion' | 'commandId' | 'correlationId' | 'idempotency'> : never;
type CaseIntent = WithoutEnvelope<Extract<PartnerCommand, { expected: unknown }>>;
export type CaseCommandFeedback = { kind: 'success'; replayed: boolean } | { kind: 'error'; message: string } | { kind: 'uncertain'; message: string } | { kind: 'blocked'; message: string };

export class PartnerCaseCommandSession {
  private uncertain: PartnerCommand | null = null;
  private readonly savedOpportunities = new Set<string>();
  constructor(private readonly port: PartnerCommandPort, private readonly actorId: string) {}
  get isSaved() { return this.savedOpportunities.size > 0; }

  async submit(intent: CaseIntent): Promise<CaseCommandFeedback> {
    if (this.uncertain) return { kind: 'blocked', message: 'ابتدا نتیجه درخواست قبلی را با همان اطلاعات پیگیری کنید.' };
    if (intent.type === 'RETAIL_CORRECTION_SAVE' && this.savedOpportunities.has(intent.opportunityId)) return { kind: 'blocked', message: 'این فرصت یک‌بار ذخیره قبلاً مصرف شده است.' };
    const payloadHash = await canonicalHash({ schemaVersion: 1, ...intent });
    const command = PartnerCommandSchema.parse({ schemaVersion: 1, ...intent,
      commandId: crypto.randomUUID(), correlationId: crypto.randomUUID(),
      idempotency: { key: crypto.randomUUID(), actorId: this.actorId, targetId: intent.expected.caseId, operation: intent.type, payloadHash } });
    return this.execute(command);
  }

  async retry(): Promise<CaseCommandFeedback> {
    if (!this.uncertain) return { kind: 'blocked', message: 'درخواست نامشخصی برای پیگیری وجود ندارد.' };
    return this.execute(this.uncertain);
  }

  private async execute(command: PartnerCommand): Promise<CaseCommandFeedback> {
    try {
      const response = await this.port.execute(command);
      if (!response.ok) { this.uncertain = null; return { kind: 'error', message: partnerError(response.error.code).message }; }
      this.uncertain = null;
      if (command.type === 'RETAIL_CORRECTION_SAVE') this.savedOpportunities.add(command.opportunityId);
      return { kind: 'success', replayed: response.value.replayed };
    } catch {
      this.uncertain = command;
      return { kind: 'uncertain', message: 'نتیجه درخواست روشن نیست؛ پیگیری فقط با همان اطلاعات امن است.' };
    }
  }
}
