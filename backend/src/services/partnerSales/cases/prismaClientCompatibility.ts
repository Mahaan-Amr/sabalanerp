import { Prisma } from '@prisma/client';

type RuntimeModel = { name: string; fields: ReadonlyArray<{ name: string }> };

const requiredPartnerCaseFields = new Map<string, readonly string[]>([
  ['PartnerSaleCase', ['pricingState', 'customerConfirmationState']],
  ['PartnerCaseRevision', ['pricingState']],
]);

/**
 * Partner Case writes rely on schema fields introduced with the numbered Draft
 * lifecycle. Fail at router startup when the generated Prisma Client is older
 * than the running Case code instead of hiding a client validation exception
 * behind an unrelated business-integrity response.
 */
export function assertPartnerCasePrismaClientCompatibility(
  models: readonly RuntimeModel[] = Prisma.dmmf.datamodel.models,
) {
  const missing: string[] = [];
  for (const [modelName, fieldNames] of requiredPartnerCaseFields) {
    const model = models.find(candidate => candidate.name === modelName);
    const available = new Set(model?.fields.map(field => field.name) ?? []);
    for (const fieldName of fieldNames) {
      if (!available.has(fieldName)) missing.push(`${modelName}.${fieldName}`);
    }
  }
  if (missing.length) {
    throw new Error(`Generated Prisma Client is stale for Partner Case runtime; regenerate it before startup. Missing: ${missing.join(', ')}`);
  }
}
