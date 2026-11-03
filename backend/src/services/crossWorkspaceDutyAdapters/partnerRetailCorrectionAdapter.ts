import {
  PartnerCommandSchema,
  partnerError,
  type PartnerCommand,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import type { RetailCorrectionExecution } from '../partnerSales/corrections/retailCorrection';

export interface PartnerRetailCorrectionCommandPort {
  execute(command: PartnerCommand): Promise<Result<RetailCorrectionExecution>>;
}

const allowed = new Set(['CORRECTION_REQUEST', 'RETAIL_CORRECTION_SAVE', 'CORRECTION_GATE']);

/** Authentication is owned by the calling transport. This adapter binds that
 * resolved identity to the command envelope before handing work to the Module;
 * an Admin or manager never authors Partner evidence by choosing an actor ID. */
export function createPartnerRetailCorrectionAdapter(port: PartnerRetailCorrectionCommandPort) {
  return {
    async execute(authenticatedActorId: string, input: PartnerCommand): Promise<Result<RetailCorrectionExecution>> {
      const command = PartnerCommandSchema.safeParse(input);
      if (!command.success || !allowed.has(command.data.type)) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      if (command.data.idempotency.actorId !== authenticatedActorId) {
        return { ok: false, error: partnerError('FORBIDDEN') };
      }
      return port.execute(command.data);
    },
  };
}
