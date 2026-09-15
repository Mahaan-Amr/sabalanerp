import { z } from 'zod';
import { IdSchema, PaymentPlanSchema, RevisionRefSchema } from './primitives';

export const SabalanPaymentPlanSetSchema = z.object({
  expected: RevisionRefSchema,
  idempotencyKey: IdSchema,
  plan: PaymentPlanSchema.innerType().omit({ planId: true, version: true, predecessorPlanId: true }),
}).strict().superRefine((command, context) => {
  command.plan.installments.forEach((installment, index) => {
    if (installment.method === 'CHECK' && (!installment.check || installment.check.dueDate !== installment.dueDate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['plan', 'installments', index, 'check'],
        message: 'Check evidence and installment due date must match' });
    }
  });
});

export const SabalanPaymentPlanCandidateSchema = z.object({
  expected: RevisionRefSchema,
  caseNumber: IdSchema,
  internalRecordNumber: IdSchema,
  partnerDisplayName: z.string().trim().min(1).max(4000),
  payable: z.object({ amount: z.string(), currency: z.enum(['IRR', 'IRT']) }).strict(),
}).strict();

export type SabalanPaymentPlanSet = z.infer<typeof SabalanPaymentPlanSetSchema>;
export type SabalanPaymentPlanCandidate = z.infer<typeof SabalanPaymentPlanCandidateSchema>;
