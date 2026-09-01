import {
  InquiryIdentitySchema, PartnerConfigurationRefSchema, PersianReasonSchema, TextSchema,
  type InquiryIdentity,
} from '@sabalanerp/partner-sales-contracts';

export type ConfigurationRef = { recoveryId: string; recoveryRevision: number; productRowId: string };
export type InquiryDefinition = { version: 1; configurationRef: ConfigurationRef; identity: InquiryIdentity;
  description: string; configuration: Array<{ label: string; value: string }>; predecessorReason?: string };

/** Strict private persistence decoder. Unknown fields never flow into either
 * public inquiry projection. */
export function parseInquiryDefinition(value: unknown): InquiryDefinition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['version', 'configurationRef', 'identity', 'description', 'configuration', 'predecessorReason'].includes(key)) ||
      row.version !== 1 || !Array.isArray(row.configuration)) return undefined;
  const reference = PartnerConfigurationRefSchema.safeParse(row.configurationRef);
  const identity = InquiryIdentitySchema.safeParse(row.identity);
  const description = TextSchema.safeParse(row.description);
  const configuration: Array<{ label: string; value: string }> = [];
  for (const item of row.configuration) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['label', 'value'].includes(key))) return undefined;
    const label = TextSchema.safeParse((item as Record<string, unknown>).label);
    const fieldValue = TextSchema.safeParse((item as Record<string, unknown>).value);
    if (!label.success || !fieldValue.success) return undefined;
    configuration.push({ label: label.data, value: fieldValue.data });
  }
  const reason = row.predecessorReason === undefined ? undefined : PersianReasonSchema.safeParse(row.predecessorReason);
  if (!reference.success || !identity.success || !description.success || (reason && !reason.success)) return undefined;
  return { version: 1, configurationRef: reference.data, identity: identity.data,
    description: description.data, configuration, ...(reason?.success ? { predecessorReason: reason.data } : {}) };
}
