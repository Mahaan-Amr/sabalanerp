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

export type ReadinessCoverage = {
  inventory: { personnelCount: number; relationshipCount: number; assignmentCount: number };
  inventoryClassifications: Partial<Record<ReadinessInventoryClassification, number>>;
  periodEligibility: { personnelCount: number; relationshipCount: number; assignmentCount: number };
  structuralTemplateReadiness: {
    readyPersonnelCount: number;
    readyRelationshipCount: number;
    readyAssignmentCount: number;
    blockedSourceCount: number;
    failedSourceCount: number;
  };
  cohort: { subjectCount: number };
  acceptedResult: { subjectCount: number };
  resultBadge: { subjectCount: number };
};

export type ReadinessInventoryClassification = "PERSONNEL_INACTIVE" | "EMPLOYMENT_RELATIONSHIP_MISSING"
  | "RELATIONSHIP_PLANNED" | "RELATIONSHIP_OUTSIDE_PERIOD" | "EMPLOYMENT_ASSIGNMENT_MISSING"
  | "ASSIGNMENT_OUTSIDE_PERIOD";

const readinessClassificationLabels: Record<ReadinessInventoryClassification, string> = {
  PERSONNEL_INACTIVE: "پرسنل غیرفعال یا بایگانی‌شده",
  EMPLOYMENT_RELATIONSHIP_MISSING: "بدون رابطه استخدامی",
  RELATIONSHIP_PLANNED: "رابطه برنامه‌ریزی‌شده",
  RELATIONSHIP_OUTSIDE_PERIOD: "رابطه خارج از بازه",
  EMPLOYMENT_ASSIGNMENT_MISSING: "بدون مأموریت",
  ASSIGNMENT_OUTSIDE_PERIOD: "مأموریت خارج از بازه",
};

export const buildReadinessCoverageSections = (coverage: ReadinessCoverage) => {
  const sections = [
    { title: "موجودی پایه", items: [
      { label: "پرسنل", value: coverage.inventory.personnelCount },
      { label: "روابط استخدامی", value: coverage.inventory.relationshipCount },
      { label: "مأموریت‌ها", value: coverage.inventory.assignmentCount },
    ] },
    { title: "واجد شرایط در بازه", items: [
      { label: "پرسنل", value: coverage.periodEligibility.personnelCount },
      { label: "روابط استخدامی", value: coverage.periodEligibility.relationshipCount },
      { label: "مأموریت‌ها", value: coverage.periodEligibility.assignmentCount },
    ] },
    { title: "آمادگی ساختاری و الگو", items: [
      { label: "پرسنل آماده", value: coverage.structuralTemplateReadiness.readyPersonnelCount },
      { label: "روابط آماده", value: coverage.structuralTemplateReadiness.readyRelationshipCount },
      { label: "مأموریت آماده", value: coverage.structuralTemplateReadiness.readyAssignmentCount },
      { label: "مانع ساختاری", value: coverage.structuralTemplateReadiness.blockedSourceCount },
      { label: "خطای پردازش", value: coverage.structuralTemplateReadiness.failedSourceCount },
    ] },
    { title: "خروجی‌های مستقل", items: [
      { label: "عضو گروه", value: coverage.cohort.subjectCount },
      { label: "نتیجه پذیرفته‌شده", value: coverage.acceptedResult.subjectCount },
      { label: "نشان نتیجه", value: coverage.resultBadge.subjectCount },
    ] },
  ];
  const classifications = (Object.entries(coverage.inventoryClassifications) as Array<[ReadinessInventoryClassification, number]>)
    .filter(([, value]) => value > 0)
    .map(([code, value]) => ({ label: readinessClassificationLabels[code], value }));
  return classifications.length ? [...sections, { title: "طبقه‌بندی پیوندها", items: classifications }] : sections;
};

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
