import { z } from 'zod';
import { resolveStaircaseQuantity } from '@sabalanerp/contract-product-graph';
import { IdSchema } from './primitives';

export const PartnerTechnicalStairSystemSchema = z.object({ stairSystemId: IdSchema,
  quantity: z.object({ mode: z.enum(['steps', 'staircases']), totalSteps: z.number().int().safe().optional(),
    numberOfStaircases: z.number().int().safe().optional(), stepsPerStaircase: z.number().int().safe().optional(),
  }).strict(),
}).strict();
export type PartnerTechnicalStairSystem = z.infer<typeof PartnerTechnicalStairSystemSchema>;
export interface TechnicalStairSystemConflict {
  code: 'stair-system-incomplete'; field: string; entityId: string; message: string;
}
export function previewTechnicalStairSystems(systems: readonly PartnerTechnicalStairSystem[]) {
  const quantities = new Map<string, number>();
  const conflicts: TechnicalStairSystemConflict[] = [];
  const counts = new Map<string, number>();
  systems.forEach(system => counts.set(system.stairSystemId, (counts.get(system.stairSystemId) ?? 0) + 1));
  for (const system of systems) {
    try {
      if (counts.get(system.stairSystemId) !== 1) throw new TypeError();
      const resolved = resolveStaircaseQuantity(system.quantity);
      if (!Number.isSafeInteger(resolved.totalSteps)) throw new TypeError();
      quantities.set(system.stairSystemId, resolved.totalSteps);
    } catch {
      conflicts.push({ code: 'stair-system-incomplete', field: 'stairSystems.quantity', entityId: system.stairSystemId,
        message: 'تعداد مجموعهٔ پله و شناسهٔ یکتای آن را کامل کنید.' });
    }
  }
  return { quantities, conflicts };
}
