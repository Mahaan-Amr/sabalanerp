import type { PrismaClient } from '@prisma/client';
import type { ShipmentStatementCutoverRepository } from '.';
import { SHIPMENT_STATEMENT_OPERATIONS_LOCK } from '../dispatchDocuments/featureGate';
import { startShipmentStatementOperationsForSignedCutoverUnderLock } from '../shipmentStatementOperations';
import { assertProtectedProductionCutoverBoundary } from './productionBoundary';

const CUTOVER_ID = 'customer-shipment-statements';

export class PrismaShipmentStatementCutoverRepository implements ShipmentStatementCutoverRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadState() {
    const state = await this.prisma.shipmentStatementCutover.findUniqueOrThrow({ where: { id: CUTOVER_ID },
      select: { enabled: true, cutoverAt: true, manifestId: true, integrityHash: true } });
    return state;
  }

  async activate(input: { expectedDisabled: true; migrationManifestId: string; integrityHash: string; activatedBy: string; expiresAt: Date;
    productionBoundary?: { deploymentId: string; leaseToken: string; releaseId: string; targetCommit: string } }) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', SHIPMENT_STATEMENT_OPERATIONS_LOCK);
      if (input.productionBoundary) {
        await assertProtectedProductionCutoverBoundary(tx, {
          sourceCommit: input.productionBoundary.targetCommit,
          releaseId: input.productionBoundary.releaseId,
          environment: {
            NODE_ENV: 'production',
            DEPLOYMENT_ID: input.productionBoundary.deploymentId,
            DEPLOYMENT_LEASE_TOKEN: input.productionBoundary.leaseToken,
          },
        });
      }
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
      if (!clock) throw new Error('Database cutover clock is unavailable.');
      if (clock.now.getTime() > input.expiresAt.getTime()) {
        throw new Error('The GO cutover manifest expired according to the database clock.');
      }
      const updated = await tx.$queryRaw<Array<{
        enabled: boolean;
        cutoverAt: Date;
        activatedAt: Date;
        activatedBy: string;
        manifestId: string;
        integrityHash: string;
      }>>`
        UPDATE "shipment_statement_cutovers"
        SET "enabled" = true,
            "cutoverAt" = ${clock.now},
            "activatedAt" = ${clock.now},
            "activatedBy" = ${input.activatedBy},
            "manifestId" = ${input.migrationManifestId},
            "integrityHash" = ${input.integrityHash}
        WHERE "id" = ${CUTOVER_ID} AND "enabled" = false
        RETURNING "enabled", "cutoverAt", "activatedAt", "activatedBy", "manifestId", "integrityHash"
      `;
      if (!updated[0]) throw new Error('Customer Shipment Statements are already activated; cutover is one-way.');
      await startShipmentStatementOperationsForSignedCutoverUnderLock(tx, {
        actorId: input.activatedBy, cutoverIntegrityHash: input.integrityHash,
      });
      return updated[0];
    });
  }
}
