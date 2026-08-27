// Compile from the real backend package with its legacy Node module resolution.
// No source aliases: both names must resolve through the installed public package.
import { PartnerCommandSchema, type PartnerQueryV2Port, type PartnerManagementCommandV2 } from '@sabalanerp/partner-sales-contracts';
import { FixturePartnerQueryV2Adapter, createPartnerWorkspaceFixturesV2 } from '@sabalanerp/partner-sales-contracts/testing';

export function publicPartnerConsumer() {
  const query: PartnerQueryV2Port = new FixturePartnerQueryV2Adapter(['PARTNER_MANAGEMENT']);
  const fixture = createPartnerWorkspaceFixturesV2();
  const command: PartnerManagementCommandV2 = {
    schemaVersion: 2, type: 'PROFILE_CREATE', commandId: 'consumer-command', correlationId: 'consumer-correlation',
    identityEvidenceId: fixture.management.identityCandidates![0].identityEvidenceId, reason: 'تست قرارداد عمومی',
    idempotency: { actorId: fixture.management.actorId, operation: 'PROFILE_CREATE',
      targetId: fixture.management.identityCandidates![0].identityEvidenceId,
      key: 'consumer-key', payloadHash: 'sha256-v1:' + 'a'.repeat(64) },
  };
  return { query, command, rejectsV2ThroughV1: !PartnerCommandSchema.safeParse(command).success };
}
