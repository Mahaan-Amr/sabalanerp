import type { PrismaClient } from '@prisma/client';
import type { ShipmentStatementCutoverRepository } from '.';

const CUTOVER_ID = 'customer-shipment-statements';

export class PrismaShipmentStatementCutoverRepository implements ShipmentStatementCutoverRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadState() {
    const state = await this.prisma.shipmentStatementCutover.findUniqueOrThrow({ where: { id: CUTOVER_ID },
      select: { enabled: true, cutoverAt: true, manifestId: true, integrityHash: true } });
    return state;
  }

  async activate(input: { expectedDisabled: true; migrationManifestId: string; integrityHash: string; activatedBy: string; expiresAt: Date }) {
    return this.prisma.$transaction(async tx => {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS "now"`;
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
      return updated[0];
    });
  }
}
