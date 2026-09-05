import { canonicalHash, InquiryBatchResultSchema, PartnerCommandSchema, PartnerErrorSchema, PartnerManagementCommandV2Schema, partnerError } from '@sabalanerp/partner-sales-contracts';
import type { PartnerCommand, PartnerCommandPort, PartnerError, InquiryBatchResult, PartnerManagementCommandV2, PartnerManagementCommandV2Port } from '@sabalanerp/partner-sales-contracts';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'schemaVersion' | 'commandId' | 'correlationId' | 'idempotency'> : never;
export type ManagementIntent = WithoutEnvelope<PartnerCommand>;
export type ManagementIntentV2 = WithoutEnvelope<PartnerManagementCommandV2>;
export type CommandFeedback =
  | { kind: 'success'; batch?: InquiryBatchResult }
  | { kind: 'error'; error: PartnerError }
  | { kind: 'uncertain'; message: string }
  | { kind: 'blocked'; message: string };

/** One in-flight intent per workspace. Never persist sensitive command payloads in browser storage. */
export class PartnerCommandSession {
  private command: PartnerCommand | PartnerManagementCommandV2 | null = null;
  private running = false;
  constructor(private readonly port: PartnerCommandPort, private readonly actorId: string,
    private readonly managementPort?: PartnerManagementCommandV2Port) {}

  async submit(intent: ManagementIntent, targetId: string): Promise<CommandFeedback> {
    return this.prepare(intent, targetId, 1);
  }

  async submitManagement(intent: ManagementIntentV2, targetId: string): Promise<CommandFeedback> {
    if (!this.managementPort) return { kind: 'error', error: partnerError('FORBIDDEN') };
    return this.prepare(intent, targetId, 2);
  }

  private async prepare(intent: ManagementIntent | ManagementIntentV2, targetId: string, schemaVersion: 1 | 2): Promise<CommandFeedback> {
    if (this.running || this.command) return { kind: 'blocked', message: 'ابتدا نتیجه درخواست قبلی را بررسی کنید.' };
    this.running = true;
    try {
      const id = crypto.randomUUID();
      const envelope = { ...intent, schemaVersion, commandId: id, correlationId: id,
        idempotency: { actorId: this.actorId, operation: intent.type, targetId, key: id,
          payloadHash: await canonicalHash({ schemaVersion, ...intent }) } };
      this.command = schemaVersion === 1 ? PartnerCommandSchema.parse(envelope) : PartnerManagementCommandV2Schema.parse(envelope);
    } catch {
      this.running = false;
      return { kind: 'error', error: partnerError('INVALID_PAYLOAD') };
    }
    return this.execute();
  }

  async retry(): Promise<CommandFeedback> {
    if (this.running || !this.command) return { kind: 'blocked', message: 'درخواستی برای بررسی دوباره وجود ندارد.' };
    this.running = true;
    return this.execute();
  }

  private async execute(): Promise<CommandFeedback> {
    try {
      const command = this.command!;
      const response = command.schemaVersion === 1 ? await this.port.execute(command) : await this.managementPort!.execute(command);
      if (!response.ok) {
        const error = PartnerErrorSchema.parse(response.error);
        this.command = null;
        return { kind: 'error', error };
      }
      if (response.value.commandId !== command.commandId) throw new Error('Mismatched command outcome');
      const batch = 'batch' in response.value && response.value.batch ? InquiryBatchResultSchema.parse(response.value.batch) : undefined;
      if (command.type === 'INQUIRY_DECIDE' && (!batch || batch.commandId !== command.commandId ||
        batch.outcomes.length !== command.decisions.length || new Set(batch.outcomes.map(row => row.rowId)).size !== batch.outcomes.length ||
        batch.outcomes.some(row => !command.decisions.some(decision => decision.rowId === row.rowId)))) throw new Error('Incomplete row outcomes');
      this.command = null;
      return { kind: 'success', ...(batch ? { batch } : {}) };
    } catch {
      return { kind: 'uncertain', message: 'نتیجه ثبت هنوز مشخص نیست؛ همان درخواست را دوباره بررسی کنید.' };
    } finally {
      this.running = false;
    }
  }
}
