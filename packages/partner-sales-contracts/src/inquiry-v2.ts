import { z } from 'zod';
import { ApprovedRowBindingSchema, PartnerConfigurationRefSchema, PartnerInquiryViewSchema } from './inquiry';
import { PersianReasonSchema } from './primitives';

// Companion wire version: the original strict v1 reader and its output stay intact.
const inquiryV1 = PartnerInquiryViewSchema.innerType();
const rowV1 = inquiryV1.shape.rows.element.innerType();
export const InquiryRowStateV2Schema = rowV1.shape.state;
export const InquiryPredecessorV2Schema = ApprovedRowBindingSchema.extend({ reason: PersianReasonSchema }).strict();
export const InquirySuccessorV2Schema = ApprovedRowBindingSchema.extend({ state: InquiryRowStateV2Schema }).strict();

export const PartnerInquiryViewV2Schema = inquiryV1.extend({
  schemaVersion: z.literal(2),
  rows: z.array(rowV1.extend({
    // Resolved by the owner; never inferred from inquiry/catalog IDs by the browser.
    configurationRef: PartnerConfigurationRefSchema,
    predecessor: InquiryPredecessorV2Schema.optional(),
    successor: InquirySuccessorV2Schema.optional(),
  }).strict()),
}).strict().superRefine((view, context) => {
  const oldReader = PartnerInquiryViewSchema.safeParse({ ...view, schemaVersion: 1,
    rows: view.rows.map(({ configurationRef, predecessor, successor, ...row }) => row),
  });
  if (!oldReader.success) for (const issue of oldReader.error.issues) context.addIssue(issue);
  const seen = new Set<string>();
  view.rows.forEach((row, index) => {
    if (seen.has(row.rowId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', index, 'rowId'], message: 'Duplicate inquiry row' });
    seen.add(row.rowId);
    for (const name of ['predecessor', 'successor'] as const) {
      const link = row[name];
      if (link?.inquiryId === view.inquiryId && link.rowId === row.rowId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', index, name], message: 'Lineage cannot point to itself' });
      }
    }
  });
});
export type PartnerInquiryViewV2 = z.infer<typeof PartnerInquiryViewV2Schema>;
export type InquiryRowStateV2 = z.infer<typeof InquiryRowStateV2Schema>;
