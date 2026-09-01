export type WorkflowTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "purple";

const presentations: Record<string, { label: string; tone: WorkflowTone }> = {
  DRAFT: { label: "پیش‌نویس", tone: "warning" },
  SUBMITTED: { label: "در انتظار بررسی", tone: "info" },
  REJECTED: { label: "نیازمند اصلاح", tone: "danger" },
  ACCEPTED: { label: "پذیرفته‌شده", tone: "success" },
  NOT_EVALUABLE: { label: "غیرقابل‌ارزیابی", tone: "neutral" },
  INVALIDATED: { label: "نامعتبر", tone: "danger" },
  CANCELLED: { label: "لغوشده", tone: "neutral" },
  RUNNING: { label: "در حال اجرا", tone: "info" },
  COMPLETED: { label: "تکمیل‌شده", tone: "success" },
  FAILED: { label: "نیازمند تلاش مجدد", tone: "danger" },
  DRIFTED: { label: "دارای مغایرت منبع", tone: "warning" },
};

export const workflowStatusPresentation = (status: string) => presentations[status] ?? { label: status, tone: "neutral" as const };

export type SupervisorResponseDraft = {
  grade?: 1 | 2 | 3 | 4 | 5;
  evidenceKind: "STRUCTURED_OBSERVATION" | "OPERATIONAL_REFERENCE" | "CONTROLLED_DOCUMENT";
  evidenceQuality: "RELIABLE" | "INCOMPLETE" | "DISPUTED" | "MISSING" | "INVALIDATED";
  evidenceReference: string;
  sourceVersion: string;
  occurredAt: string;
  contentHash: string;
};

export const hasCompleteEvidence = (response: SupervisorResponseDraft) => Boolean(
  response.evidenceReference.trim()
  && response.sourceVersion.trim()
  && response.occurredAt
  && !Number.isNaN(Date.parse(response.occurredAt))
  && /^[a-f0-9]{64}$/i.test(response.contentHash.trim()),
);

export const buildSupervisorDraft = (input: {
  narrative: string;
  responses: Record<string, SupervisorResponseDraft>;
}) => ({
  narrative: input.narrative.trim(),
  responses: Object.entries(input.responses).sort(([left], [right]) => left.localeCompare(right)).map(([criterionVersionId, response]) => ({
    criterionVersionId,
    ...(response.grade ? { grade: response.grade } : {}),
    evidence: response.evidenceReference.trim() ? [{
      kind: response.evidenceKind,
      quality: response.evidenceQuality,
      referenceId: response.evidenceReference.trim(),
      sourceVersion: response.sourceVersion.trim(),
      occurredAt: new Date(response.occurredAt).toISOString(),
      contentHash: response.contentHash.trim(),
    }] : [],
  })),
});
