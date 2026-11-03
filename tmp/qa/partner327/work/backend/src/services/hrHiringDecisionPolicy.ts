export const assertHiringDecisionGate = (input: {
  kind: string;
  actorUserId: string;
  sourceDecision?: { decidedBy: string } | null;
  broadManagerOverride: boolean;
  pendingCompanyEvaluations: number;
}) => {
  const fail = (code: string, statusCode: number) => {
    throw Object.assign(new Error(code), { statusCode });
  };
  if (input.kind === 'HR_PRELIMINARY_APPROVAL' && !input.sourceDecision) {
    fail('INITIAL_INTERVIEW_REPORT_REQUIRED', 409);
  }
  if (input.kind === 'COMPANY_APPROVAL' && !input.sourceDecision) {
    fail('PRELIMINARY_DECISION_REQUIRED', 409);
  }
  if (input.sourceDecision?.decidedBy === input.actorUserId && !input.broadManagerOverride) {
    fail('SEPARATION_OF_DUTY_REQUIRED', 403);
  }
  if (input.kind === 'COMPANY_APPROVAL' && input.pendingCompanyEvaluations > 0) {
    fail('COMPANY_EVALUATIONS_UNRESOLVED', 409);
  }
};
