"use client";
import {
  ErpInput,
  ErpRialInput,
  ErpCheckbox,
  ErpField,
  ErpInlineState,
  ErpPressable,
  ErpSegmentedControl,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import Link from "next/link";
import {
  FaArchive,
  FaCheck,
  FaFileUpload,
  FaSync,
  FaTrash,
  FaUndo,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpFieldView,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSheet,
  ErpSummaryGrid,
} from "@/components/erp";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { HiringLifecycle } from "@/features/hr-hiring/HiringLifecycle";
import {
  hiringTaskDetailVisible,
  resolvePhaseAfterLifecycleAdvance,
  resolveSelectedHiringPhase,
  startPreparationStatusItems,
  shouldLoadCompanyEvaluationPlan,
} from "@/features/hr-hiring/hiringLifecycleViewModel";
import { insuranceSubmissionBlocker } from "@/features/hr-hiring/insuranceViewModel";
import { parseLocalizedAssessmentScore } from "@/features/hr-hiring/assessmentScore";
import { ApplicantCaseOverview } from "@/features/hr-hiring/ApplicantCaseOverview";
import { FinalHiringRejection } from "@/features/hr-hiring/FinalHiringRejection";
import { ProductionHrInterview, ProductionInterviewReport } from "@/features/hr-hiring/prototype/HrInterviewPrototype";
import type { InterviewEvidencePayload } from "@/features/hr-hiring/prototype/interviewEvidence";
import { validateHiringQueueReturnHref } from "@/features/hr-hiring/hiringQueueViewModel";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import PermanentDeletionDialog from "@/features/hr/PermanentDeletionDialog";
import RetentionAction from "@/features/hr/RetentionActionSheet";
import {
  dateTimeFa,
  dateFa,
  fromIsoDate,
  fromIsoDateTime,
  toIsoDate,
  toIsoDateTime,
} from "@/features/hr/hrUi";
import {
  assessmentTypeLabel,
  authorityLabel,
  hrCandidateDocumentStatusLabel,
  hrDisplayLabel,
} from "@/features/hr/hrDisplay";
import { normalizeIdentifierDigits, normalizeNumericText } from "@/lib/numberFormat";

const identityFields = [
  "firstName",
  "lastName",
  "birthDate",
  "birthPlace",
  "fatherName",
  "nationalCode",
  "foreignIdentity",
  "militaryStatus",
  "address",
  "postalCode",
  "mobile",
  "educationLevel",
  "maritalStatus",
  "birthCertificateExplanations",
];
const identityFieldLabels: Record<string, string> = {
  firstName: "نام",
  lastName: "نام خانوادگی",
  birthDate: "تاریخ تولد",
  birthPlace: "محل تولد",
  fatherName: "نام پدر",
  nationalCode: "کد ملی",
  foreignIdentity: "اطلاعات هویتی اتباع",
  militaryStatus: "وضعیت نظام وظیفه",
  address: "نشانی",
  postalCode: "کد پستی",
  mobile: "شماره همراه",
  educationLevel: "سطح تحصیلات",
  maritalStatus: "وضعیت تأهل",
  birthCertificateExplanations: "توضیحات شناسنامه",
  alias: "نام مستعار یا نام رایج",
  fatherOccupation: "شغل پدر",
  childrenCount: "تعداد فرزندان",
  spouseOccupation: "شغل همسر",
  homePhone: "تلفن منزل",
  email: "رایانامه",
  socialMedia: "شبکه اجتماعی",
  fieldOfStudy: "رشته تحصیلی",
  graduationYear: "سال فراغت از تحصیل",
  identityKind: "نوع هویت",
  foreignIdentityType: "نوع مدرک هویت اتباع",
  foreignIdentityNumber: "شماره مدرک هویت اتباع",
  hasSocialSecurityHistory: "سابقه تأمین اجتماعی",
  cooperationType: "نوع همکاری",
  cooperationDuration: "مدت همکاری",
  requestedPosition: "جایگاه درخواستی",
  desiredSalary: "حقوق درخواستی",
};
const documentCategories = [
  "BIRTH_CERTIFICATE_ALL_PAGES",
  "BIRTH_CERTIFICATE_EXPLANATIONS",
  "NATIONAL_ID_FRONT",
  "NATIONAL_ID_BACK",
  "MILITARY",
  "EDUCATION",
  "PHOTO",
  "OTHER",
];
const assessmentScoreFields: Record<
  string,
  Array<{ key: string; label: string }>
> = {
  DISC: [
    { key: "dominance", label: "تسلط‌گرایی (D)" },
    { key: "influence", label: "تأثیرگذاری (I)" },
    { key: "steadiness", label: "ثبات (S)" },
    { key: "conscientiousness", label: "وظیفه‌شناسی (C)" },
  ],
  BIG_FIVE: [
    { key: "openness", label: "پذیرش تجربه‌های جدید" },
    { key: "conscientiousness", label: "وظیفه‌شناسی" },
    { key: "extraversion", label: "برون‌گرایی" },
    { key: "agreeableness", label: "توافق‌پذیری" },
    { key: "neuroticism", label: "روان‌رنجوری" },
  ],
  EQ: [{ key: "score", label: "امتیاز کل هوش هیجانی" }],
};
export default function HiringCasePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousCurrentPhaseId = useRef<string | null>(null);
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<any>(null);
  const [retentionTarget, setRetentionTarget] = useState<any>(null);
  const [actionPermissions, setActionPermissions] = useState<string[]>([]);
  const [applicantOtp, setApplicantOtp] = useState<any>(null);
  const [correctionExplanations, setCorrectionExplanations] = useState<
    Record<string, string>
  >({});
  const [identityCorrectionOpen, setIdentityCorrectionOpen] = useState(false);
  const [identityMismatchDraft, setIdentityMismatchDraft] = useState({ fieldKey: "", note: "" });
  const [identityResolution, setIdentityResolution] = useState({
    resolutionCode: "CREATE_NEW",
    evidenceIds: [] as string[],
    correctionReason: "",
  });
  const [document, setDocument] = useState<any>({
    category: "BIRTH_CERTIFICATE_ALL_PAGES",
    side: "",
    customTitle: "",
    inspectionSource: "ORIGINAL_SEEN",
    note: "",
    file: null,
  });
  const [components, setComponents] = useState([
    { label: "حقوق پایه", category: "BASE_SALARY", amountRials: "" },
  ]);
  const [payrollReturn, setPayrollReturn] = useState({
    reasonCode: "AMOUNT_INCORRECT",
    reasonDetail: "",
  });
  const [assessment, setAssessment] = useState<any>({
    assessmentType: "DISC",
    scores: {},
    title: "",
    result: "",
    notes: "",
    file: null,
  });
  const [editingAssessmentId, setEditingAssessmentId] = useState("");
  const [assessmentVoidTarget, setAssessmentVoidTarget] = useState<any>(null);
  const [assessmentVoidReason, setAssessmentVoidReason] = useState("");
  const [offlineDecision, setOfflineDecision] = useState({
    decision: "ACCEPTED",
    communicationMethod: "PHONE",
    communicatedOn: "",
    offlineReason: "",
    declineCategory: "",
    note: "",
  });
  const [offlineDecisionAttempted, setOfflineDecisionAttempted] = useState(false);
  const [closure, setClosure] = useState({ outcome: "REJECTED", reason: "" });
  const [conversion, setConversion] = useState({
    scheduledStartDate: "",
  });
  const [plannedStartRevision, setPlannedStartRevision] = useState({ open: false, scheduledStartDate: "", reason: "" });
  const [contract, setContract] = useState<any>({
    contractNumber: "",
    effectiveFrom: "",
    effectiveTo: "",
    file: null,
  });
  const [contractReturnReason, setContractReturnReason] = useState("");
  const [contractWithdrawOpen, setContractWithdrawOpen] = useState(false);
  const [insurance, setInsurance] = useState({
    registrationPath: "COMPANY",
    status: "NOT_STARTED",
    effectiveDate: "",
    dueDate: "",
    communicationMethod: "PHONE",
    communicatedAt: "",
    note: "",
  });
  const [payrollDate, setPayrollDate] = useState("");
  const [payrollMismatchReason, setPayrollMismatchReason] = useState("");
  const [payrollReviewConfirmed, setPayrollReviewConfirmed] = useState(false);
  const load = async () => {
    try {
      setError("");
      const result = await hiringAPI.get(id);
      setData(result.data.data);
      setPlannedStartRevision((current) => ({
        ...current,
        scheduledStartDate: current.open ? current.scheduledStartDate : fromIsoDate(result.data.data.scheduledStartDate),
      }));
      setPayrollDate(
        fromIsoDate(
          result.data.data.payrollParticipation?.effectiveFrom ||
            result.data.data.scheduledStartDate,
        ),
      );
      setPayrollMismatchReason(
        result.data.data.payrollParticipation?.startMismatchReason || "",
      );
      const currentCompensation = result.data.data.compensationSnapshots?.find(
        (snapshot: any) => !snapshot.obsoleteAt,
      );
      if (Array.isArray(currentCompensation?.componentsJson))
        setComponents(currentCompensation.componentsJson);
      if (result.data.data.insuranceEnrollment)
        setInsurance({
          ...insurance,
          ...result.data.data.insuranceEnrollment,
          communicationMethod: result.data.data.insuranceEnrollment.communicationMethod ?? "PHONE",
          note: result.data.data.insuranceEnrollment.note ?? "",
          effectiveDate: fromIsoDate(
            result.data.data.insuranceEnrollment.effectiveDate,
          ),
          dueDate: fromIsoDate(result.data.data.insuranceEnrollment.dueDate),
          communicatedAt: fromIsoDateTime(
            result.data.data.insuranceEnrollment.communicatedAt,
          ),
        });
    } catch (e) {
      setError(hiringError(e));
    }
  };
  useEffect(() => {
    void load();
    void hiringAPI
      .myActionPermissions()
      .then((result) => setActionPermissions(result.data.data))
      .catch(() => setActionPermissions([]));
    // `load` intentionally follows the route id; recreating it is harmless but would retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const requestedLifecyclePhaseId = searchParams.get("phase");
  const currentLifecyclePhaseId = data?.lifecycle?.currentPhaseId || null;
  const effectiveRequestedLifecyclePhaseId = currentLifecyclePhaseId
    ? resolvePhaseAfterLifecycleAdvance({
        requestedPhaseId: requestedLifecyclePhaseId,
        previousCurrentPhaseId: previousCurrentPhaseId.current,
        nextCurrentPhaseId: currentLifecyclePhaseId,
      })
    : requestedLifecyclePhaseId;
  useEffect(() => {
    if (!currentLifecyclePhaseId) return;
    previousCurrentPhaseId.current = currentLifecyclePhaseId;
    if (
      !effectiveRequestedLifecyclePhaseId ||
      effectiveRequestedLifecyclePhaseId === requestedLifecyclePhaseId
    )
      return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("phase", effectiveRequestedLifecyclePhaseId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [
    currentLifecyclePhaseId,
    effectiveRequestedLifecyclePhaseId,
    pathname,
    requestedLifecyclePhaseId,
    router,
    searchParams,
  ]);
  const run = async (
    action: () => Promise<any>,
    success: string,
    options: CaseActionOptions = {},
  ) => {
    const { propagateActionError = false, awaitRefresh = true } = options;
    try {
      setBusy(true);
      setError("");
      const response = await action();
      setMessage(response?.data?.meta?.warning || success);
    } catch (e) {
      if (propagateActionError) throw e;
      setError(hiringError(e));
      return false;
    } finally {
      setBusy(false);
    }
    if (awaitRefresh) await load();
    else void load();
    return true;
  };
  const confirmRetentionAction = async ({ reason }: { reason: string }) => {
    if (!retentionTarget) return;
    try {
      setBusy(true);
      setError("");
      if (retentionTarget.archivedAt)
        await hiringAPI.restore(retentionTarget.id, reason);
      else await hiringAPI.archive(retentionTarget.id, reason);
      setRetentionTarget(null);
      setMessage(
        retentionTarget.archivedAt
          ? "پرونده از بایگانی بازیابی شد."
          : "پرونده بایگانی شد.",
      );
      await load();
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };
  const beginPermanentDeletion = async () => {
    try {
      setBusy(true);
      setError("");
      const preview = (await hiringAPI.getDeletionPreview(id)).data.data;
      setDeletionTarget({ row: data, preview });
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };
  const confirmPermanentDeletion = async (payload: any) => {
    if (!deletionTarget) return;
    try {
      setBusy(true);
      setError("");
      await hiringAPI.permanentlyDelete(id, payload);
      router.replace("/dashboard/hr/hiring");
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <ErpLoading />;
  const form = data.formRevisions?.[0]?.dataJson || {};
  const latestSubmittedForm = data.formRevisions?.find((revision: any) => revision.status === "SUBMITTED")?.dataJson || null;
  const latestSubmittedName = latestSubmittedForm
    ? `${latestSubmittedForm.firstName || ""} ${latestSubmittedForm.lastName || ""}`.trim()
    : "";
  const compensation = data.compensationSnapshots?.find(
    (snapshot: any) => !snapshot.obsoleteAt,
  );
  const plannedStartDate = fromIsoDate(data.scheduledStartDate);
  const payrollDiffersFromPlanned = Boolean(
    payrollDate && plannedStartDate && payrollDate !== plannedStartDate,
  );
  const insuranceOverdue = Boolean(
    insurance.registrationPath === "COMPANY" &&
    insurance.dueDate &&
    !["ACTIVE", "EXEMPT"].includes(insurance.status) &&
    toIsoDate(insurance.dueDate) < new Date().toISOString().slice(0, 10),
  );
  const latestContract = data.contracts?.[0];
  const openIdentityConflict = data.identityConflicts?.find((item: any) => item.status === "OPEN");
  const currentCollateralItems = (data.collateralItems || []).filter((item: any) => !item.supersededBy);
  const collateralExplicitlyNotRequired = data.collateralRequirements?.[0]?.type === "NO_PRE_HIRE_COLLATERAL";
  const collateralRecorded = collateralExplicitlyNotRequired || currentCollateralItems.length > 0
    && currentCollateralItems.every((item: any) => item.status !== "MISSING");
  const collateralVerified = data.collateralClearance === "APPROVED";
  const offerAccepted = Boolean(data.acceptedOfferAt && compensation?.candidateAcceptedAt);
  const conversionStatuses = [
    { label: "احراز هویت", complete: data.identityClearance === "APPROVED", pending: "منتظر اقدام منابع انسانی" },
    { label: "پذیرش پیشنهاد", complete: offerAccepted, pending: "منتظر پذیرش متقاضی" },
    { label: "ثبت وثیقه", complete: collateralRecorded, pending: "منتظر اقدام امور مالی" },
    { label: "تأیید وثیقه", complete: collateralVerified, pending: collateralRecorded ? "منتظر اقدام تأییدکننده امور مالی" : "منتظر تکمیل ثبت" },
  ];
  const conversionReady = conversionStatuses.every((item) => item.complete);
  const hasActionPermission = (...values: string[]) =>
    !data.readOnlyArchived && values.some((value) => actionPermissions.includes(value));
  const canHrSensitive = hasActionPermission("MANAGE_RECRUITMENT_CASE");
  const canCompanyManager = hasActionPermission("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS", "MANAGE_COMPANY_EVALUATION_PLAN", "RECORD_FINAL_MANAGEMENT_DECISION");
  const canViewContractTask = hasActionPermission("RECORD_SIGNED_EMPLOYMENT_CONTRACT") || hiringTaskDetailVisible(
    data.taskCapabilities,
    "SIGNED_CONTRACT",
  );
  const canViewInsuranceTask = hiringTaskDetailVisible(
    data.taskCapabilities,
    "INSURANCE",
  );
  const canViewPayrollTask = hiringTaskDetailVisible(
    data.taskCapabilities,
    "PAYROLL_PARTICIPATION",
  );
  const canViewActivationTask = hiringTaskDetailVisible(
    data.taskCapabilities,
    "EMPLOYMENT_ACTIVATION",
  );
  const startPreparationStatuses = startPreparationStatusItems(
    data.taskCapabilities,
  );
  const selectedLifecyclePhase = data.lifecycle
    ? resolveSelectedHiringPhase(
        data.lifecycle,
        effectiveRequestedLifecyclePhaseId,
      )
    : null;
  const selectLifecyclePhase = (phaseId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("phase", phaseId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const requiredAssessmentScores =
    assessmentScoreFields[assessment.assessmentType] || [];
  const assessmentScoreValidation = Object.fromEntries(
    requiredAssessmentScores.map(({ key }) => [
      key,
      parseLocalizedAssessmentScore(assessment.scores[key]),
    ]),
  );
  const assessmentComplete =
    assessment.assessmentType === "OTHER"
      ? Boolean(assessment.title.trim() && assessment.result.trim())
      : requiredAssessmentScores.every(
          ({ key }) => assessmentScoreValidation[key]?.value !== undefined,
        );
  const compensationRowsValid =
    components.filter((item) => item.category === "BASE_SALARY").length === 1 &&
    components.every(
      (item) =>
        Boolean(item.category) &&
        /^\d+$/.test(String(item.amountRials || "")) &&
        BigInt(item.amountRials || "0") > BigInt(0) &&
        (item.category !== "OTHER" || Boolean(item.label.trim())),
    ) && new Set(components.filter((item) => item.category !== "OTHER").map((item) => item.category)).size === components.filter((item) => item.category !== "OTHER").length;
  const uploadDocument = () => {
    const fd = new FormData();
    fd.append("category", document.category);
    if (document.side) fd.append("side", document.side);
    if (document.customTitle) fd.append("customTitle", document.customTitle);
    fd.append("inspectionSource", document.inspectionSource);
    if (document.note) fd.append("note", document.note);
    if (document.inspectionSource === "COPY_RECEIVED" && document.file)
      fd.append("file", document.file);
    return run(
      () => hiringAPI.uploadDocument(id, fd),
      document.inspectionSource === "ORIGINAL_SEEN"
        ? "مشاهده اصل سند ثبت شد."
        : "کپی سند ثبت شد.",
    );
  };
  const uploadContract = () => {
    const fd = new FormData();
    Object.entries(contract).forEach(([key, value]) => {
      if (key !== "file" && value) {
        fd.append(
          key,
          key === "effectiveFrom" || key === "effectiveTo"
            ? toIsoDate(String(value))
            : String(value),
        );
      }
    });
    fd.append("file", contract.file);
    return run(() => hiringAPI.uploadContract(id, fd), "قرارداد بارگذاری شد.");
  };
  const addAssessment = () => {
    const fd = new FormData();
    fd.append("assessmentType", assessment.assessmentType);
    const result: Record<string, string | number> =
      assessment.assessmentType === "OTHER"
        ? { title: assessment.title.trim(), result: assessment.result.trim() }
        : Object.fromEntries(
            (assessmentScoreFields[assessment.assessmentType] || []).map(
              ({ key }) => [key, assessmentScoreValidation[key].value!],
            ),
          );
    if (assessment.notes.trim()) result.notes = assessment.notes.trim();
    fd.append("resultJson", JSON.stringify(result));
    if (assessment.file) fd.append("file", assessment.file);
    if (editingAssessmentId) {
      return run(
        () => hiringAPI.reviseAssessment(id, editingAssessmentId, result),
        "نسخه جدید ارزیابی ثبت شد.",
      ).then((succeeded) => { if (succeeded) setEditingAssessmentId(""); });
    }
    return run(() => hiringAPI.addAssessment(id, fd), "نتیجه ارزیابی ثبت شد.");
  };
  const download = async (request: () => Promise<any>, fileName: string) => {
    try {
      const response = await request();
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(hiringError(e));
    }
  };
  const downloadIndexedEvidence = (item: any) => {
    const request =
      item.downloadKind === "PRE_IDENTITY"
        ? () => hiringAPI.downloadPreIdentityEvidence(id, item.id)
        : item.downloadKind === "DOCUMENT"
          ? () => hiringAPI.downloadDocument(id, item.id)
          : item.downloadKind === "ASSESSMENT"
            ? () => hiringAPI.downloadAssessment(id, item.id)
            : item.downloadKind === "CONTRACT"
              ? () => hiringAPI.downloadContract(id, item.id)
              : item.downloadKind === "COLLATERAL_RETURN"
                ? () => hiringAPI.downloadCollateralReturnEvidence(id, item.id)
                : () => hiringAPI.downloadCollateral(id, item.id);
    return download(request, item.originalName || item.title);
  };
  const returnHref = validateHiringQueueReturnHref(searchParams.get("returnTo"));
  return (
    <ErpPage
      title={`${data.candidate.firstName} ${data.candidate.lastName}`}
      description={`${data.position.title} · ${data.candidate.mobile}`}
      backHref={returnHref}
      actions={[
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, disabled: busy, tone: "neutral", variant: "outline" },
        ...(data.retentionCapabilities?.canArchive ||
        data.retentionCapabilities?.canRestore
          ? [
              {
                label: data.archivedAt ? "بازیابی از بایگانی" : "بایگانی",
                icon: data.archivedAt ? FaUndo : FaArchive,
                tone: "warning" as const,
                variant: "outline" as const,
                onClick: () => setRetentionTarget(data),
                disabled: busy,
              },
            ]
          : []),
        ...(data.retentionCapabilities?.canPermanentlyDelete
          ? [
              {
                label: "حذف دائمی",
                icon: FaTrash,
                tone: "danger" as const,
                variant: "outline" as const,
                onClick: beginPermanentDeletion,
                disabled: busy,
              },
            ]
          : []),
      ]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      {message && <ErpInlineState kind="success" title={message} />}
      {data.readOnlyArchived && <ErpInlineState kind="stale" title="این پرونده بایگانی شده و تا زمان بازیابی فقط قابل مشاهده است." />}
      <ApplicantCaseOverview
        applicationId={id}
        returnTo={searchParams.get("returnTo") || undefined}
      />
      {!data.disposition
        && data.stage !== "CLOSED"
        && (hasActionPermission("RECORD_PRELIMINARY_DECISION")
          || hasActionPermission("RECORD_FINAL_MANAGEMENT_DECISION")) && (
        <FinalHiringRejection applicationId={id} busy={busy} run={run} />
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Metric label="مرحله" value={data.stage} />
        <Metric label="هویت" value={data.identityClearance} />
        <Metric label="جبران" value={data.compensationClearance} />
        <Metric label="وثیقه" value={data.collateralClearance} />
        <Metric label="قرارداد" value={data.contractClearance} />
        <Metric
          label="اشتغال"
          value={data.employmentRelationship?.status || "CANDIDATE"}
        />
      </div>
      {data.lifecycle && selectedLifecyclePhase && (
        <HiringLifecycle
          projection={data.lifecycle}
          selectedPhaseId={selectedLifecyclePhase}
          onSelect={selectLifecyclePhase}
        />
      )}
      {openIdentityConflict && (
        <ErpSection
          title="مغایرت هویت متقاضی و پرسنل"
          description="تا ثبت تصمیم مستقل و شواهد معتبر، تأیید نهایی هویت، تبدیل و فعال‌سازی مسدود می‌مانند."
        >
          <ErpSummaryGrid columns={3} items={[
            { label: "هویت ادعاشده", value: `${openIdentityConflict.claimedIdentityJson?.firstName || ""} ${openIdentityConflict.claimedIdentityJson?.lastName || ""}`.trim() || "—" },
            { label: "هویت متعارض", value: `${openIdentityConflict.matchedIdentityJson?.firstName || ""} ${openIdentityConflict.matchedIdentityJson?.lastName || ""}`.trim() || "—" },
            { label: "مهلت", value: new Date(openIdentityConflict.dueAt).toLocaleString("fa-IR") },
          ]} />
          {hasActionPermission("RESOLVE_CANDIDATE_PERSONNEL_IDENTITY_CONFLICT") && (
            <div className="mt-4 space-y-4">
              <ErpField label="نتیجه تعیین تکلیف" required>
                <ErpSelect value={identityResolution.resolutionCode} onChange={(event) => setIdentityResolution({ ...identityResolution, resolutionCode: event.target.value })}>
                  <option value="CREATE_NEW">ساخت Personnel جدید از هویت تأییدشده</option>
                  <option value="LINK_EXISTING">پیوند به Personnel موجود</option>
                  <option value="CORRECT_CANDIDATE_CLAIM">اصلاح ادعای هویت Candidate</option>
                </ErpSelect>
              </ErpField>
              {identityResolution.resolutionCode !== "CREATE_NEW" && (
                <ErpInlineState kind="empty" title={`Personnel متعارض همین پرونده انتخاب می‌شود: ${openIdentityConflict.matchedIdentityJson?.firstName || ""} ${openIdentityConflict.matchedIdentityJson?.lastName || ""}`} />
              )}
              {identityResolution.resolutionCode === "CORRECT_CANDIDATE_CLAIM" && (
                <ErpField label="دلیل اصلاح ادعای هویت" required>
                  <ErpTextarea value={identityResolution.correctionReason} onChange={(event) => setIdentityResolution({ ...identityResolution, correctionReason: event.target.value })} />
                </ErpField>
              )}
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--sds-text-secondary)]">شواهد معتبر مبنای تصمیم</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {(data.documents || []).map((item: any) => (
                    <ErpCheckbox
                      key={item.id}
                      label={`${hrDisplayLabel(item.category)} · نسخه ${Number(item.version).toLocaleString("fa-IR")}`}
                      checked={identityResolution.evidenceIds.includes(item.id)}
                      onChange={(event) => setIdentityResolution({ ...identityResolution, evidenceIds: event.target.checked
                        ? [...identityResolution.evidenceIds, item.id]
                        : identityResolution.evidenceIds.filter((id) => id !== item.id) })}
                    />
                  ))}
                </div>
              </div>
              <ErpButton
                label="ثبت تصمیم هویتی"
                tone="success"
                disabled={busy || !identityResolution.evidenceIds.length || (identityResolution.resolutionCode !== "CREATE_NEW" && !openIdentityConflict.potentialPersonnelId)}
                onClick={() => run(
                  () => hiringAPI.resolveIdentityConflict(id, openIdentityConflict.id, identityResolution),
                  "مغایرت هویت تعیین تکلیف شد؛ تأیید هویت باید دوباره انجام شود.",
                )}
              />
            </div>
          )}
        </ErpSection>
      )}
      {data.employmentRelationship?.personnel &&
        selectedLifecyclePhase &&
        ["ONBOARDING", "ACTIVATION"].includes(selectedLifecyclePhase) && (
          <ErpSection
            title="ادامه چرخه در پرونده پرسنلی"
            description="تبدیل انجام شده است؛ پرونده جذب و سابقه محرمانه آن مستقل باقی می‌ماند."
          >
            <ErpCard className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-bold">
                  {data.employmentRelationship.personnel.firstName}{" "}
                  {data.employmentRelationship.personnel.lastName}
                </p>
                <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                  رابطه استخدامی:{" "}
                  {hrDisplayLabel(data.employmentRelationship.status)} · نتیجه
                  پرونده: {hrDisplayLabel(data.outcome || "HIRED")}
                </p>
              </div>
              <ErpButton label="مشاهده در پرسنل و روابط استخدامی" tone="success" href={`/dashboard/hr/personnel?focus=${data.employmentRelationship.personnel.id}`} />
            </ErpCard>
          </ErpSection>
        )}
      {["INITIAL_HR_REVIEW", "COMPANY_EVALUATION_PLAN"].includes(selectedLifecyclePhase || "") &&
        (canHrSensitive || canCompanyManager) && (
          <PreIdentitySection
            phase={selectedLifecyclePhase as "INITIAL_HR_REVIEW" | "COMPANY_EVALUATION_PLAN"}
            application={data}
            actionPermissions={actionPermissions}
            busy={busy}
            applicationId={id}
            run={run}
            download={download}
          />
        )}
      {selectedLifecyclePhase === "FORMAL_ASSESSMENTS" &&
        actionPermissions.includes("VIEW_FORMAL_ASSESSMENT_RESULTS") && (
          <>
            <FormalAssessmentPlanPanel
              application={data}
              actionPermissions={actionPermissions}
              busy={busy}
              applicationId={id}
              run={run}
            />
          </>
        )}
      {(canHrSensitive ||
        (canCompanyManager && selectedLifecyclePhase === "ASSESSMENT")) && (
        <>
          {selectedLifecyclePhase === "APPLICATION" && (
            <ErpSection
              title="فرم متقاضی و کنترل اطلاعات"
              description="منابع انسانی پاسخ متقاضی را ویرایش نمی‌کند؛ فیلدهای دارای اشکال برای نسخه بعدی بازگردانده می‌شوند."
            >
              <ErpCard className="p-4">
                <div className="grid gap-2 md:grid-cols-3">
                  {Object.entries(form)
                    .filter(
                      ([, value]) =>
                        !Array.isArray(value) && typeof value !== "object",
                    )
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-lg bg-[var(--sds-surface-subtle)] p-2 text-xs dark:bg-[var(--sds-surface-raised)]"
                      >
                        <span className="text-[var(--sds-text-secondary)]">
                          {identityFieldLabels[key] || "اطلاعات تکمیلی"}
                        </span>
                        <p className="mt-1 font-bold">{String(value)}</p>
                      </div>
                    ))}
                </div>
              </ErpCard>
              <ErpCard className="mt-4 p-4">
                <div className="flex items-center justify-between gap-2">
                  <b>دعوت‌ها و وضعیت دسترسی /apply</b>
                  <ErpButton
                    label="ارسال مجدد دعوت و OTP جدید"
                    icon={FaSync}
                    tone="neutral"
                    variant="outline"
                    disabled={busy || data.stage === "CLOSED"}
                    onClick={() => {
                      setApplicantOtp(null);
                      return run(
                        () => hiringAPI.invite(id),
                        "OTP جدید ارسال شد؛ OTP قبلی تا اولین استفاده موفق از کد جدید، پایان اعتبار خودش یا ۳۰ دقیقه موقتاً معتبر می‌ماند.",
                      );
                    }}
                  />
                </div>
                {applicantOtp && (
                  <div className="mt-3">
                    <ErpFieldView
                      label="کد ورود جاری متقاضی"
                      value={<span dir="ltr" className="font-mono text-base tracking-[0.2em]">{applicantOtp.code}</span>}
                      hint={`معتبر تا ${dateTimeFa(applicantOtp.expiresAt)}`}
                      tone="info"
                    />
                  </div>
                )}
                {!applicantOtp && actionPermissions.includes("MANAGE_RECRUITMENT_CASE") && actionPermissions.includes("VIEW_FULL_APPLICANT_INFORMATION") && (
                  <ErpButton
                    className="mt-3"
                    label="نمایش کد ورود جاری"
                    variant="outline"
                    disabled={busy}
                    onClick={() => run(
                      async () => {
                        const response = await hiringAPI.revealApplicantOtp(id);
                        setApplicantOtp(response.data.data);
                        return response;
                      },
                      "نمایش کد ورود در ممیزی ثبت شد.",
                      { awaitRefresh: false },
                    )}
                  />
                )}
                <div className="mt-3 space-y-2">
                  {(data.invitations || []).map((invitation: any) => (
                    <div
                      key={invitation.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs"
                    >
                      <span className="flex flex-col gap-1">
                        <span>
                          {invitation.accessConfirmedAt
                            ? "تحویل‌شده (ورود موفق متقاضی)"
                            : invitation.providerDeliveryState
                              ? `گزارش SMS.ir: ${hrDisplayLabel(invitation.providerDeliveryState)}`
                              : "در انتظار گزارش ارسال"}
                        </span>
                        {invitation.accessConfirmedAt &&
                          invitation.providerDeliveryState && (
                            <span className="text-[var(--sds-text-secondary)]">
                              گزارش ارائه‌دهنده:{" "}
                              {hrDisplayLabel(invitation.providerDeliveryState)}
                            </span>
                          )}
                      </span>
                      <span>اعتبار تا {dateTimeFa(invitation.expiresAt)}</span>
                      {invitation.providerMessageId &&
                        !invitation.accessConfirmedAt && (
                          <ErpPressable
                            type="submit"
                            className="rounded-lg border px-3 py-1"
                            onClick={() =>
                              run(
                                () =>
                                  hiringAPI.refreshInvitationDelivery(
                                    id,
                                    invitation.id,
                                  ),
                                "آخرین گزارش تحویل SMS.ir دریافت شد.",
                              )
                            }
                          >
                            به‌روزرسانی گزارش تحویل
                          </ErpPressable>
                        )}
                    </div>
                  ))}
                </div>
              </ErpCard>
            </ErpSection>
          )}
          {selectedLifecyclePhase === "IDENTITY" && (
            <ErpSection title="اسناد و تطبیق هویت">
              <div className="grid gap-4 xl:grid-cols-2">
                <ErpCard className="p-4">
                  <h3 className="font-black">بررسی منابع انسانی</h3>
                  {hasActionPermission("REVIEW_IDENTITY_DOCUMENTS") && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <ErpSelect
                        value={document.category}
                        onChange={(e) =>
                          setDocument({
                            ...document,
                            category: e.target.value,
                            customTitle: e.target.value === "OTHER" ? document.customTitle : "",
                          })
                        }
                      >
                        {documentCategories.map((x) => (
                          <option key={x} value={x}>
                            {hrDisplayLabel(x)}
                          </option>
                        ))}
                      </ErpSelect>
                      {document.category === "OTHER" && (
                        <ErpInput
                          aria-label="عنوان سند"
                          placeholder="عنوان سند"
                          value={document.customTitle}
                          onChange={(e) =>
                            setDocument({ ...document, customTitle: e.target.value })
                          }
                        />
                      )}
                      <ErpSelect
                        value={document.inspectionSource}
                        onChange={(e) =>
                          setDocument({
                            ...document,
                            inspectionSource: e.target.value,
                            file: null,
                          })
                        }
                      >
                        <option value="ORIGINAL_SEEN">اصل مشاهده شد</option>
                        <option value="COPY_RECEIVED">کپی دریافت شد</option>
                      </ErpSelect>
                      <ErpInput
                        aria-label="یادداشت سند"
                        placeholder="یادداشت اختیاری"
                        value={document.note}
                        onChange={(e) =>
                          setDocument({ ...document, note: e.target.value })
                        }
                      />
                      {document.inspectionSource === "COPY_RECEIVED" && (
                        <ErpInput
                          type="file"
                          aria-label="فایل کپی سند"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(e) =>
                            setDocument({
                              ...document,
                              file: e.target.files?.[0],
                            })
                          }
                        />
                      )}
                      <ErpButton
                        label={
                          document.inspectionSource === "ORIGINAL_SEEN"
                            ? "ثبت مشاهده اصل"
                            : "بارگذاری کپی"
                        }
                        icon={FaFileUpload}
                        disabled={
                          busy ||
                          (document.category === "OTHER" && !document.customTitle.trim()) ||
                          (document.inspectionSource === "COPY_RECEIVED" && !document.file)
                        }
                        onClick={uploadDocument}
                      />
                    </div>
                  )}
                  <div className="mt-4 space-y-2">
                    {data.documents.map((doc: any) => (
                      <div
                        key={doc.id}
                        className="flex justify-between rounded-lg border p-2 text-xs"
                      >
                        <span>
                          {doc.category === "OTHER"
                            ? doc.customTitle
                            : hrDisplayLabel(doc.category)}{" "}
                          · نسخه {doc.version}
                        </span>
                        <span className="flex gap-2">
                          {doc.originalName && (
                            <ErpPressable
                              type="submit"
                              onClick={() =>
                                download(
                                  () => hiringAPI.downloadDocument(id, doc.id),
                                  doc.originalName,
                                )
                              }
                              className="text-[var(--sds-info)]"
                            >
                              دریافت
                            </ErpPressable>
                          )}
                          <ErpBadge tone={doc.inspectionSource === "ORIGINAL_SEEN" ? "success" : "info"}>{hrCandidateDocumentStatusLabel(doc)}</ErpBadge>
                        </span>
                      </div>
                    ))}
                  </div>
                </ErpCard>
                <ErpCard className="p-4">
                  <h3 className="font-black">کنترل فیلد به فیلد</h3>
                  {data.formRevisions?.[0]?.correctionNotificationStatus ===
                    "FAILED" && (
                    <ErpInlineState
                      className="mt-3"
                      kind="error"
                      title={data.formRevisions[0].correctionNotificationError || "ارسال پیامک درخواست اصلاح ناموفق بود."}
                      action={{ label: "ارسال مجدد پیامک درخواست اصلاح", disabled: busy, onClick: () => run(() => hiringAPI.retryCorrectionNotification(id), "پیامک درخواست اصلاح ارسال شد."), tone: "warning" }}
                    />
                  )}
                  <div className="mt-3 space-y-2">
                    {identityFields.map((key) => {
                      const check = data.identityChecks.find(
                        (x: any) => x.fieldKey === key,
                      );
                      return (
                        <div key={key} className="rounded-xl border border-[var(--sds-border-default)] p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold">{identityFieldLabels[key]}</span>
                            <ErpBadge tone={check?.status === "VERIFIED" ? "success" : check?.status === "MISMATCH" ? "danger" : check?.status === "NOT_APPLICABLE" ? "neutral" : "warning"}>
                              {check?.status === "VERIFIED" ? "مطابق" : check?.status === "MISMATCH" ? "مغایرت" : check?.status === "UNREADABLE" ? "ناخوانا" : check?.status === "NOT_APPLICABLE" ? "نامرتبط" : "بررسی‌نشده"}
                            </ErpBadge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {hasActionPermission("REVIEW_IDENTITY_DOCUMENTS") && (
                              <>
                                <ErpButton
                                  label="مطابق"
                                  tone="success"
                                  variant="soft"
                                  disabled={busy}
                                  onClick={() =>
                                    run(
                                      () =>
                                        hiringAPI.setIdentityCheck(id, key, {
                                          status: "VERIFIED",
                                        }),
                                      `${identityFieldLabels[key]} تأیید شد.`,
                                    )
                                  }
                                />
                                <ErpButton label="مغایرت" tone="danger" variant="soft" disabled={busy} onClick={() => setIdentityMismatchDraft({ fieldKey: key, note: check?.status === "MISMATCH" ? check.note || "" : "" })} />
                                {[
                                  "militaryStatus",
                                  "birthCertificateExplanations",
                                ].includes(key) && (
                                  <ErpButton
                                    label="نامرتبط"
                                    tone="neutral"
                                    variant="soft"
                                    disabled={busy}
                                    onClick={() =>
                                      run(
                                        () =>
                                          hiringAPI.setIdentityCheck(id, key, {
                                            status: "NOT_APPLICABLE",
                                          }),
                                        `${identityFieldLabels[key]} غیرقابل اعمال ثبت شد.`,
                                      )
                                    }
                                  />
                                )}
                              </>
                            )}
                          </div>
                          {identityMismatchDraft.fieldKey === key && (
                            <div className="mt-3 space-y-2">
                              <ErpField label="شرح مغایرت" required>
                                <ErpTextarea value={identityMismatchDraft.note} onChange={(event) => setIdentityMismatchDraft({ fieldKey: key, note: event.target.value })} />
                              </ErpField>
                              <div className="flex flex-wrap gap-2">
                                <ErpButton
                                  label="ثبت مغایرت"
                                  tone="danger"
                                  disabled={busy || !identityMismatchDraft.note.trim()}
                                  onClick={() => run(
                                    () => hiringAPI.setIdentityCheck(id, key, { status: "MISMATCH", note: identityMismatchDraft.note.trim() }),
                                    `${identityFieldLabels[key]} مغایر ثبت شد.`,
                                  ).then(() => setIdentityMismatchDraft({ fieldKey: "", note: "" }))}
                                />
                                <ErpButton label="انصراف" variant="ghost" onClick={() => setIdentityMismatchDraft({ fieldKey: "", note: "" })} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {hasActionPermission("REVIEW_IDENTITY_DOCUMENTS") &&
                    data.identityChecks.some((check: any) =>
                      ["MISMATCH", "UNREADABLE"].includes(check.status),
                    ) && (
                      identityCorrectionOpen ? <ErpCard className="mt-4 p-3">
                        <ErpInlineState kind="stale" title="درخواست اصلاح یکپارچه — برای هر مورد، توضیح فارسی قابل نمایش به متقاضی را وارد کنید. با ثبت نهایی فقط یک پیامک ارسال می‌شود." />
                        <div className="mt-3 space-y-2">
                          {data.identityChecks
                            .filter((check: any) =>
                              ["MISMATCH", "UNREADABLE"].includes(check.status),
                            )
                            .map((check: any) => (
                              <label
                                key={check.fieldKey}
                                className="grid gap-1 text-sm md:grid-cols-[12rem_1fr]"
                              >
                                <span>
                                  {identityFieldLabels[check.fieldKey]}
                                </span>
                                <ErpInput
                                  placeholder="توضیح مشکل و روش اصلاح"
                                  value={
                                    correctionExplanations[check.fieldKey] || ""
                                  }
                                  onChange={(event) =>
                                    setCorrectionExplanations((current) => ({
                                      ...current,
                                      [check.fieldKey]: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                            ))}
                        </div>
                        <ErpButton
                          className="mt-3"
                          label="ارسال درخواست اصلاح به متقاضی"
                          disabled={
                            busy ||
                            data.identityChecks
                              .filter((check: any) =>
                                ["MISMATCH", "UNREADABLE"].includes(
                                  check.status,
                                ),
                              )
                              .some(
                                (check: any) =>
                                  !correctionExplanations[
                                    check.fieldKey
                                  ]?.trim(),
                              )
                          }
                          onClick={() =>
                            run(
                              () =>
                                hiringAPI.returnForm(id, {
                                  fields: data.identityChecks
                                    .filter((check: any) =>
                                      ["MISMATCH", "UNREADABLE"].includes(
                                        check.status,
                                      ),
                                    )
                                    .map((check: any) => ({
                                      fieldKey: check.fieldKey,
                                      explanation:
                                        correctionExplanations[check.fieldKey],
                                    })),
                                }),
                              "درخواست اصلاح برای متقاضی ارسال شد.",
                            )
                          }
                          tone="warning"
                        />
                        <ErpButton
                          className="mt-3"
                          label="انصراف"
                          variant="soft"
                          disabled={busy}
                          onClick={() => setIdentityCorrectionOpen(false)}
                        />
                      </ErpCard> : <ErpButton
                        className="mt-4"
                        label="بازگشت برای اصلاح"
                        tone="warning"
                        variant="soft"
                        disabled={busy}
                        onClick={() => setIdentityCorrectionOpen(true)}
                      />
                    )}
                  {hasActionPermission("APPROVE_IDENTITY_CLEARANCE") && (
                    <ErpButton
                      className="mt-3"
                      label="تأیید نهایی مدیر منابع انسانی"
                      icon={FaCheck}
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => hiringAPI.approveIdentity(id),
                          "هویت توسط مدیر منابع انسانی تأیید شد.",
                        )
                      }
                      tone="success"
                    />
                  )}
                </ErpCard>
              </div>
            </ErpSection>
          )}
          {selectedLifecyclePhase === "ASSESSMENT" && (
            <ErpSection title={data.formalAssessmentPlans?.length ? "سابقه قدیمی ارزیابی‌ها" : "ارزیابی‌های DISC / BIG FIVE / EQ"} description={data.formalAssessmentPlans?.length ? "این داده‌ها برای حفظ سابقه نمایش داده می‌شوند و نتیجهٔ رسمی جاری نیستند." : undefined}>
              <ErpCard className="p-4">
                {(hasActionPermission("MANAGE_RECRUITMENT_CASE") ||
                  (hasActionPermission("MANAGE_RECRUITMENT_CASE") && editingAssessmentId)) && (
                  <>
                    <p className="mb-4 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                      امتیازهای درج‌شده در گزارش رسمی ارزیابی را وارد کنید. همه
                      امتیازها باید بین ۰ تا ۱۰۰ باشند.
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-sm font-medium">
                        نوع ارزیابی
                        <ErpSelect
                          className="mt-1"
                          value={assessment.assessmentType}
                          onChange={(e) =>
                            setAssessment({
                              assessmentType: e.target.value,
                              scores: {},
                              title: "",
                              result: "",
                              notes: "",
                              file: null,
                            })
                          }
                        >
                          {["DISC", "BIG_FIVE", "EQ", "OTHER"].map((value) => (
                            <option key={value} value={value}>
                              {assessmentTypeLabel(value)}
                            </option>
                          ))}
                        </ErpSelect>
                      </label>
                      {requiredAssessmentScores.map(({ key, label }) => (
                        <label key={key} className="text-sm font-medium">
                          {label} (۰ تا ۱۰۰)
                          <ErpInput
                            type="text"
                            inputMode="decimal"
                            className="mt-1"
                            value={assessment.scores[key] ?? ""}
                            onChange={(e) =>
                              setAssessment({
                                ...assessment,
                                scores: {
                                  ...assessment.scores,
                                  [key]: normalizeNumericText(e.target.value, 2),
                                },
                              })
                            }
                            placeholder="مثلاً ۸۰"
                          />
                          {assessment.scores[key] !== undefined &&
                            assessment.scores[key] !== "" &&
                            assessmentScoreValidation[key]?.error && (
                              <span className="mt-1 block text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
                                {assessmentScoreValidation[key].error}
                              </span>
                            )}
                        </label>
                      ))}
                      {assessment.assessmentType === "OTHER" && (
                        <>
                          <label className="text-sm font-medium">
                            عنوان ارزیابی
                            <ErpInput
                              className="mt-1"
                              value={assessment.title}
                              onChange={(e) =>
                                setAssessment({
                                  ...assessment,
                                  title: e.target.value,
                                })
                              }
                              placeholder="مثلاً آزمون تخصصی حسابداری"
                            />
                          </label>
                          <label className="text-sm font-medium md:col-span-2">
                            نتیجه ارزیابی
                            <ErpTextarea
                              className="mt-1"
                              value={assessment.result}
                              onChange={(e) =>
                                setAssessment({
                                  ...assessment,
                                  result: e.target.value,
                                })
                              }
                              placeholder="نتیجه را به زبان ساده بنویسید"
                            />
                          </label>
                        </>
                      )}
                      <label className="text-sm font-medium md:col-span-2">
                        توضیحات تکمیلی (اختیاری)
                        <ErpTextarea
                          className="mt-1"
                          value={assessment.notes}
                          onChange={(e) =>
                            setAssessment({
                              ...assessment,
                              notes: e.target.value,
                            })
                          }
                          placeholder="نکته یا توضیح تکمیلی گزارش"
                        />
                      </label>
                      <label className="text-sm font-medium">
                        فایل گزارش (اختیاری)
                        <ErpInput
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          className="mt-1"
                          onChange={(e) =>
                            setAssessment({
                              ...assessment,
                              file: e.target.files?.[0] || null,
                            })
                          }
                        />
                      </label>
                      <div className="md:col-span-3">
                        <ErpButton
                          label={
                            editingAssessmentId
                              ? "ثبت نسخه اصلاح‌شده"
                              : "ثبت ارزیابی"
                          }
                          onClick={addAssessment}
                          disabled={busy || !assessmentComplete}
                        />
                      </div>
                    </div>
                  </>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(data.assessments || []).map((item: any) => (
                    <span
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
                    >
                      <ErpBadge>
                        {data.formalAssessmentPlans?.length && "سابقه قدیمی · "}{assessmentTypeLabel(item.assessmentType)} · نسخه{" "}
                        {item.version || 1} ·{" "}
                        {item.status === "ACTIVE"
                          ? "فعال"
                          : item.status === "VOIDED"
                            ? "باطل‌شده"
                            : "جایگزین‌شده"}
                      </ErpBadge>
                      {item.originalName && (
                        <ErpPressable
                          type="submit"
                          onClick={() =>
                            download(
                              () => hiringAPI.downloadAssessment(id, item.id),
                              item.originalName,
                            )
                          }
                          className="text-xs text-[var(--sds-info)]"
                        >
                          دریافت فایل
                        </ErpPressable>
                      )}
                      {hasActionPermission("MANAGE_RECRUITMENT_CASE") &&
                        item.status === "ACTIVE" && (
                          <>
                            <ErpPressable
                              type="button"
                              className="text-xs text-[var(--sds-warning)]"
                              onClick={() => {
                                const result = item.resultJson || {};
                                setEditingAssessmentId(item.id);
                                setAssessment({
                                  assessmentType: item.assessmentType,
                                  scores: result,
                                  title: result.title || "",
                                  result: result.result || "",
                                  notes: result.notes || "",
                                  file: null,
                                });
                              }}
                            >
                              ویرایش
                            </ErpPressable>
                            <ErpPressable
                              type="button"
                              className="text-xs text-[var(--sds-danger)]"
                              onClick={() => { setAssessmentVoidReason(""); setAssessmentVoidTarget(item); }}
                            >
                              حذف با حفظ سابقه
                            </ErpPressable>
                          </>
                        )}
                    </span>
                  ))}
                </div>
                {hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
                  <ErpButton
                    className="mt-4"
                    label={
                      data.assessmentCompletedAt
                        ? "ارزیابی تکمیل‌شده"
                        : "تکمیل مرحله ارزیابی"
                    }
                    disabled={
                      busy ||
                      Boolean(data.assessmentCompletedAt) ||
                      !(data.assessments || []).some(
                        (item: any) => item.status === "ACTIVE",
                      )
                    }
                    onClick={() =>
                      run(
                        () => hiringAPI.completeAssessments(id),
                        "مرحله ارزیابی تکمیل شد و برای تصمیم مدیریت شرکت آماده است.",
                      )
                    }
                    tone="success"
                  />
                )}
                {hasActionPermission("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") &&
                  data.assessmentReviewRequired &&
                  data.assessmentCompletedAt && (
                    <ErpButton
                      className="mt-4"
                      label="تأیید بازبینی ارزیابی"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => hiringAPI.acknowledgeAssessmentReview(id),
                          "بازبینی ارزیابی تأیید شد.",
                        )
                      }
                    />
                  )}
                {hasActionPermission("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") &&
                  data.assessmentCompletedAt && (
                    <AssessmentDecisionPanel
                      applicationId={id}
                      currentDecision={data.assessmentDecision}
                      busy={busy}
                      run={run}
                    />
                  )}
              </ErpCard>
            </ErpSection>
          )}
        </>
      )}
      {selectedLifecyclePhase === "OFFER" &&
        hasActionPermission(
          "MANAGE_COMPENSATION",
          "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS",
          "MANAGE_PAYROLL",
          "RECORD_SIGNED_EMPLOYMENT_CONTRACT",
          "MANAGE_COLLATERAL_REQUIREMENTS",
          "MANAGE_RECRUITMENT_CASE",
        ) && (
          <>
            <ErpSection title="پیشنهاد حقوق و مزایا">
              {hasActionPermission("MANAGE_COLLATERAL_REQUIREMENTS") && (
                <CollateralRequirementPanel
                  applicationId={id}
                  current={data.collateralRequirements?.[0]}
                  busy={busy}
                  run={run}
                />
              )}
              <ErpCard className="p-4">
                <div className="space-y-2">
                  {components.map((item, i) => (
                    <div key={i} className={`grid gap-2 ${item.category === "OTHER" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                      <ErpSelect
                        value={item.category || ""}
                        onChange={(e) =>
                          setComponents(
                            components.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    category: e.target.value,
                                    label: e.target.value === "OTHER" ? "" : x.label,
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">طبقه‌بندی حقوق و دستمزد</option>
                        <option value="BASE_SALARY">حقوق پایه</option>
                        <option value="FIXED_BENEFIT">مزایای ثابت</option>
                        <option value="VARIABLE_BENEFIT">مزایای متغیر</option>
                        <option value="ALLOWANCE">کمک‌هزینه</option>
                        <option value="OTHER">سایر</option>
                      </ErpSelect>
                      {item.category === "OTHER" && (
                        <ErpInput
                          aria-label="عنوان مورد سایر"
                          placeholder="عنوان مورد سایر"
                          value={item.label}
                          onChange={(e) =>
                            setComponents(
                              components.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      )}
                      <ErpRialInput
                        aria-label="مبلغ ردیف حقوق و مزایا به ریال"
                        placeholder="مبلغ ریال"
                        value={item.amountRials}
                        onValueChange={(amountRials) =>
                          setComponents(
                            components.map((x, j) =>
                              j === i ? { ...x, amountRials } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(actionPermissions.includes("MANAGE_COMPENSATION") || actionPermissions.includes("MANAGE_PAYROLL")) && !data.readOnlyArchived && (
                    <ErpPressable
                      type="submit"
                      className="rounded-lg border px-3 py-2 text-sm"
                      onClick={() =>
                        setComponents([
                          ...components,
                          { label: "", category: "", amountRials: "" },
                        ])
                      }
                    >
                      افزودن ردیف
                    </ErpPressable>
                  )}
                  {actionPermissions.includes("MANAGE_COMPENSATION") && !data.readOnlyArchived && (
                    <ErpButton
                      label="پیشنهاد مدیریت شرکت"
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.createCompensation(id, { components }),
                          "پیشنهاد ثبت شد.",
                        )
                      }
                      disabled={busy || !compensationRowsValid}
                    />
                  )}
                  {hasActionPermission("MANAGE_PAYROLL") && compensation?.payrollReviewStatus === "PENDING" && (
                    <ErpButton
                      label="تأیید ردیف‌های حقوق و دستمزد"
                      onClick={() =>
                        run(
                          () => hiringAPI.reviewCompensationPayroll(id, compensation.id, { decision: "APPROVE" }),
                          "پیشنهاد تأیید و برای متقاضی ارسال شد.",
                        )
                      }
                      disabled={busy || !compensation}
                      tone="success"
                    />
                  )}
                  {hasActionPermission("MANAGE_PAYROLL") && compensation?.payrollReviewStatus === "PENDING" && (
                    <ErpButton
                      label="بازگرداندن برای اصلاح"
                      onClick={() =>
                        run(
                          () => hiringAPI.reviewCompensationPayroll(id, compensation.id, { decision: "RETURN", ...payrollReturn }),
                          "پیشنهاد برای اصلاح بازگردانده شد.",
                        )
                      }
                      disabled={busy || !payrollReturn.reasonDetail.trim()}
                      tone="warning"
                    />
                  )}
                </div>
                {hasActionPermission("MANAGE_PAYROLL") && compensation?.payrollReviewStatus === "PENDING" && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <ErpSelect aria-label="دسته علت بازگشت" value={payrollReturn.reasonCode} onChange={(event) => setPayrollReturn({ ...payrollReturn, reasonCode: event.target.value })}>
                      <option value="AMOUNT_INCORRECT">مبلغ نادرست است</option>
                      <option value="CATEGORY_INCORRECT">طبقه‌بندی نادرست است</option>
                      <option value="POLICY_MISMATCH">با سیاست حقوق و دستمزد سازگار نیست</option>
                      <option value="INCOMPLETE_INFORMATION">اطلاعات ناقص است</option>
                    </ErpSelect>
                    <ErpTextarea aria-label="شرح علت بازگشت" placeholder="شرح دقیق اصلاح موردنیاز" value={payrollReturn.reasonDetail} onChange={(event) => setPayrollReturn({ ...payrollReturn, reasonDetail: event.target.value })} />
                  </div>
                )}
                {compensation && (
                  <>
                    <p className="mt-3 font-black">
                      جمع:{" "}
                      {Number(compensation.totalRials).toLocaleString("fa-IR")}{" "}
                      ریال
                    </p>
                    <div className="mt-4 grid gap-2 md:grid-cols-3">
                      {[
                        {
                          title: "ثبت پیشنهاد",
                          role: "مدیریت شرکت",
                          actor: compensation.proposedBy,
                          at: compensation.createdAt,
                        },
                        {
                          title: "بررسی حقوق و دستمزد",
                          role: "دارنده مجوز بررسی حقوق و دستمزد",
                          actor: compensation.payrollVerifiedBy || compensation.hrApprovedBy || compensation.financeApprovedBy,
                          at: compensation.payrollVerifiedAt || compensation.hrApprovedAt || compensation.financeApprovedAt,
                        },
                        {
                          title: "تصمیم متقاضی",
                          role: "متقاضی",
                          actor:
                            compensation.candidateDecisionSource ===
                            "HR_PROCESSOR_OFFLINE"
                              ? compensation.candidateDecisionBy
                              : compensation.candidateDecision
                                ? "متقاضی"
                                : null,
                          at: compensation.candidateDecisionAt,
                        },
                      ].map((step) => (
                        <div
                          key={step.title}
                          className="rounded-xl border p-3 text-sm"
                        >
                          <b>{step.title}</b>
                          {step.actor ? (
                            <p className="mt-1 text-[var(--sds-success)] dark:text-[var(--sds-success)]">
                              {data.compensationParticipants?.[step.actor] ||
                                step.actor}
                              {step.at ? ` · ${dateTimeFa(step.at)}` : ""}
                            </p>
                          ) : (
                            <p className="mt-1 text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">
                              در انتظار {step.role}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    {compensation.candidateNotificationStatus === "FAILED" && (
                      <ErpInlineState
                        className="mt-3"
                        kind="error"
                        title={compensation.candidateNotificationError || "ارسال پیامک پیشنهاد همکاری ناموفق بود."}
                        action={hasActionPermission("MANAGE_RECRUITMENT_CASE") ? { label: "ارسال مجدد پیامک پیشنهاد", disabled: busy, onClick: () => run(() => hiringAPI.retryOfferNotification(id, compensation.id), "پیامک پیشنهاد همکاری ارسال شد.") } : undefined}
                      />
                    )}
                    {hasActionPermission("MANAGE_RECRUITMENT_CASE") &&
                      (compensation.payrollVerifiedAt || compensation.hrApprovedAt || compensation.financeApprovedAt) &&
                      !compensation.candidateDecision && (
                        <div className="mt-4 grid gap-2 rounded-xl border p-3 md:grid-cols-2">
                          <h4 className="font-bold md:col-span-2">
                            ثبت تصمیم آفلاین متقاضی
                          </h4>
                          <ErpSelect
                            value={offlineDecision.decision}
                            onChange={(event) =>
                              setOfflineDecision({
                                ...offlineDecision,
                                decision: event.target.value,
                              })
                            }
                          >
                            <option value="ACCEPTED">پذیرش</option>
                            <option value="DECLINED">رد پیشنهاد</option>
                          </ErpSelect>
                          <ErpSelect
                            value={offlineDecision.communicationMethod}
                            onChange={(event) =>
                              setOfflineDecision({
                                ...offlineDecision,
                                communicationMethod: event.target.value,
                              })
                            }
                          >
                            <option value="PHONE">تماس تلفنی</option>
                            <option value="IN_PERSON">جلسه حضوری</option>
                            <option value="VIDEO_CALL">تماس تصویری</option>
                            <option value="OTHER">روش دیگر</option>
                          </ErpSelect>
                          <ErpField label="تاریخ اعلام تصمیم متقاضی" required error={offlineDecisionAttempted && !offlineDecision.communicatedOn ? "انتخاب تاریخ اعلام تصمیم الزامی است." : undefined}>
                            <HrPersianCalendar
                              disableFutureDates
                              value={offlineDecision.communicatedOn}
                              onChange={(communicatedOn) =>
                                setOfflineDecision({
                                  ...offlineDecision,
                                  communicatedOn,
                                })
                              }
                            />
                          </ErpField>
                          <ErpField label="نام متقاضی در آخرین فرم ارسال‌شده">
                            <ErpInput value={latestSubmittedName} readOnly aria-readonly="true" />
                          </ErpField>
                          <ErpField label="دلیل استفاده از مسیر آفلاین" required error={offlineDecisionAttempted && !offlineDecision.offlineReason.trim() ? "دلیل استفاده از مسیر آفلاین الزامی است." : undefined}>
                            <ErpInput value={offlineDecision.offlineReason} onChange={(event) => setOfflineDecision({ ...offlineDecision, offlineReason: event.target.value })} />
                          </ErpField>
                          {offlineDecision.decision === "DECLINED" && (
                            <ErpField label="دسته‌بندی دلیل رد" required error={offlineDecisionAttempted && !offlineDecision.declineCategory ? "انتخاب دسته‌بندی دلیل رد الزامی است." : undefined}>
                              <ErpSelect value={offlineDecision.declineCategory} onChange={(event) => setOfflineDecision({ ...offlineDecision, declineCategory: event.target.value })}>
                                <option value="">انتخاب کنید</option>
                                <option value="COMPENSATION">حقوق و مزایا</option>
                                <option value="ROLE">شرح نقش یا مسئولیت‌ها</option>
                                <option value="START_DATE">تاریخ شروع همکاری</option>
                                <option value="PERSONAL">شرایط شخصی</option>
                                <option value="OTHER">سایر</option>
                              </ErpSelect>
                            </ErpField>
                          )}
                          <ErpField label="توضیح تکمیلی" required={false}>
                            <ErpInput value={offlineDecision.note} onChange={(event) => setOfflineDecision({ ...offlineDecision, note: event.target.value })} />
                          </ErpField>
                          <ErpButton
                            label="ثبت نهایی تصمیم آفلاین"
                            disabled={busy || !latestSubmittedName}
                            onClick={() => {
                              setOfflineDecisionAttempted(true);
                              if (!offlineDecision.communicatedOn || !offlineDecision.offlineReason.trim() || (offlineDecision.decision === "DECLINED" && !offlineDecision.declineCategory)) return;
                              run(
                                () => hiringAPI.recordOfflineOfferDecision(id, compensation.id, {
                                  ...offlineDecision,
                                  communicatedOn: toIsoDate(offlineDecision.communicatedOn),
                                }),
                                "تصمیم آفلاین متقاضی با سابقه حسابرسی ثبت شد.",
                              );
                            }}
                            tone="warning"
                          />
                          {!latestSubmittedName && <ErpInlineState className="md:col-span-2" kind="stale" title="ابتدا اصلاحات فرم متقاضی را ذخیره و ارسال کنید." />}
                        </div>
                      )}
                  </>
                )}
              </ErpCard>
            </ErpSection>
          </>
        )}
      {selectedLifecyclePhase === "CONVERSION" &&
        (data.collateralItems.length > 0 || data.collateralClearance === "IN_PROGRESS") && (
        <>
          <ErpSection title="وثیقه و تعهدات امور مالی">
            <ErpInlineState
              kind="permission"
              title={<span>اقدام مالی از وظایف بین‌واحدی حسابداری انجام می‌شود<br /><small>این پرونده فقط وضعیت پیشرفت را نمایش می‌دهد و امکان ثبت یا تأیید مدرک مالی در فضای منابع انسانی وجود ندارد.</small></span>}
            />
            <div className="grid gap-4 xl:grid-cols-2">
              <ErpCard className="p-4">
                <div className="space-y-2">
                  {data.collateralItems.map((item: any) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex justify-between">
                        <b>{hrDisplayLabel(item.type)}</b>
                        <ErpBadge>{hrDisplayLabel(item.status)}</ErpBadge>
                      </div>
                      {item.coordinationReason && (
                        <p className="mt-2 text-xs text-[var(--sds-warning)]">
                          علت نیاز به اصلاح یا پیگیری: {item.coordinationReason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ErpCard>
            </div>
          </ErpSection>
        </>
      )}
      {selectedLifecyclePhase === "CONVERSION" &&
        hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
          <>
            <ErpSection title="تبدیل به پرسنل برنامه‌ریزی‌شده">
              <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-3" aria-live="polite">
                  {conversionStatuses.map((status) => (
                    <div key={status.label} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{status.label}</span>
                      <ErpBadge>{status.complete ? "تکمیل‌شده" : status.pending}</ErpBadge>
                    </div>
                  ))}
                  <p className="sds-text-muted text-xs">منابع انسانی فقط وضعیت و واحد مسئول را می‌بیند؛ جزئیات محرمانه وثیقه نمایش داده نمی‌شود.</p>
                </div>
                <ErpField
                  label="تاریخ برنامه‌ریزی‌شده شروع همکاری"
                  required
                  hint="این تاریخ زمان ایجاد رابطه برنامه‌ریزی‌شده است و به‌تنهایی همکاری را فعال نمی‌کند."
                >
                  <HrPersianCalendar
                    value={conversion.scheduledStartDate}
                    onChange={(scheduledStartDate) =>
                      setConversion({
                        ...conversion,
                        scheduledStartDate,
                      })
                    }
                  />
                </ErpField>
                <ErpButton
                  className="self-end justify-self-start px-2 text-xs"
                  label="تبدیل متقاضی به پرسنل"
                  disabled={
                    busy || !conversion.scheduledStartDate || !!data.convertedAt || !conversionReady
                  }
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.convert(id, {
                          ...conversion,
                          scheduledStartDate: toIsoDate(
                            conversion.scheduledStartDate,
                          ),
                        }),
                      "پرسنل و رابطه استخدامی برنامه‌ریزی‌شده ساخته شد.",
                    )
                  }
                  tone="success"
                />
              </ErpCard>
            </ErpSection>
          </>
        )}
      {selectedLifecyclePhase &&
        ["ONBOARDING", "ACTIVATION"].includes(selectedLifecyclePhase) &&
        startPreparationStatuses.length > 0 && (
          <ErpSection title="وضعیت آماده‌سازی شروع همکاری">
            <ErpSummaryGrid
              columns={3}
              items={startPreparationStatuses.map((item) => ({
                label: item.label,
                value: hrDisplayLabel(item.status),
                hint: `${item.ownerAuthorities.map(authorityLabel).join("، ")} · ${item.activationEffect}`,
                tone: ["COMPLETE", "APPROVED", "ACTIVE", "EXEMPT"].includes(
                  item.status,
                )
                  ? "success"
                  : item.status === "REJECTED"
                    ? "danger"
                    : item.status === "IN_PROGRESS"
                      ? "info"
                      : "warning",
              }))}
            />
          </ErpSection>
        )}
      {selectedLifecyclePhase === "ONBOARDING" && data?.employmentRelationship?.status === "PLANNED" && hasActionPermission("REVISE_PLANNED_EMPLOYMENT_START") && (
        <ErpSection title="تاریخ برنامه‌ریزی‌شده شروع همکاری" description="فقط امروز یا آینده قابل ثبت است؛ تغییر با دلیل ممیزی می‌شود و ظرفیت جایگاه دوباره بررسی خواهد شد.">
          {!plannedStartRevision.open ? <div className="flex flex-wrap items-center gap-3"><b>{data.scheduledStartDate ? dateFa(data.scheduledStartDate) : "تعیین نشده"}</b><ErpButton label="تغییر تاریخ" variant="soft" onClick={() => setPlannedStartRevision({ open: true, scheduledStartDate: fromIsoDate(data.scheduledStartDate), reason: "" })} /></div> : <ErpCard className="grid gap-3 p-4 md:grid-cols-2">
            <ErpField label="تاریخ جدید" required><HrPersianCalendar value={plannedStartRevision.scheduledStartDate} onChange={(scheduledStartDate) => setPlannedStartRevision({ ...plannedStartRevision, scheduledStartDate })} /></ErpField>
            <ErpField label="دلیل تغییر" required><ErpTextarea value={plannedStartRevision.reason} onChange={(event) => setPlannedStartRevision({ ...plannedStartRevision, reason: event.target.value })} /></ErpField>
            <div className="flex gap-2 md:col-span-2"><ErpButton label="ثبت تغییر تاریخ" tone="warning" disabled={busy || !plannedStartRevision.scheduledStartDate || plannedStartRevision.reason.trim().length < 5} onClick={() => void run(() => hiringAPI.revisePlannedStart(id, { scheduledStartDate: toIsoDate(plannedStartRevision.scheduledStartDate), reason: plannedStartRevision.reason.trim() }), "تاریخ شروع تغییر کرد و موارد وابسته برای بازبینی علامت‌گذاری شدند.").then((succeeded) => { if (succeeded) setPlannedStartRevision({ open: false, scheduledStartDate: "", reason: "" }); })} /><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => setPlannedStartRevision({ open: false, scheduledStartDate: "", reason: "" })} /></div>
          </ErpCard>}
          {data.plannedStartRevisions?.length > 0 && <div className="mt-3 space-y-2">{data.plannedStartRevisions.map((revision: any) => <ErpCard key={revision.id} className="p-3 text-sm"><b>{dateFa(revision.priorScheduledStartDate)} ← {dateFa(revision.revisedScheduledStartDate)}</b><p className="text-[var(--sds-text-secondary)]">دلیل: {revision.reason}</p></ErpCard>)}</div>}
        </ErpSection>
      )}
      {selectedLifecyclePhase === "ONBOARDING" && canViewContractTask && (
        <>
          <ErpSection title="قرارداد کاغذی">
            <div className="grid gap-3 md:grid-cols-4">
              {hasActionPermission("RECORD_SIGNED_EMPLOYMENT_CONTRACT") && (
                <>
                  <ErpField label="شماره قرارداد" required>
                    <ErpInput
                      value={contract.contractNumber}
                      onChange={(e) =>
                        setContract({
                          ...contract,
                          contractNumber: e.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="تاریخ شروع اعتبار قرارداد" required>
                    <HrPersianCalendar
                      value={contract.effectiveFrom}
                      onChange={(effectiveFrom) =>
                        setContract({
                          ...contract,
                          effectiveFrom,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="تاریخ پایان اعتبار قرارداد" required>
                    <HrPersianCalendar
                      value={contract.effectiveTo}
                      onChange={(effectiveTo) =>
                        setContract({
                          ...contract,
                          effectiveTo,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="اسکن قرارداد امضاشده" required>
                    <ErpInput
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) =>
                        setContract({ ...contract, file: e.target.files?.[0] })
                      }
                    />
                  </ErpField>
                  <ErpButton
                    className="w-fit self-end px-3 py-1.5"
                    label="ثبت نسخه قرارداد"
                    disabled={
                      busy ||
                      !contract.file ||
                      !contract.contractNumber ||
                      !contract.effectiveFrom ||
                      !contract.effectiveTo
                    }
                    onClick={uploadContract}
                  />
                  {latestContract?.canSubmit && (
                    <ErpButton
                      label="ارسال برای بررسی مدیر مالی"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => hiringAPI.submitContract(id, latestContract.id),
                          "قرارداد برای بررسی مدیر مالی ارسال شد.",
                        )
                      }
                      tone="success"
                    />
                  )}
                  {latestContract?.canWithdraw && !contractWithdrawOpen && (
                    <ErpButton
                      label="پس گرفتن نسخه برای اصلاح"
                      variant="soft"
                      tone="warning"
                      disabled={busy}
                      onClick={() => setContractWithdrawOpen(true)}
                    />
                  )}
                  {latestContract?.canWithdraw && contractWithdrawOpen && (
                    <div className="space-y-2 md:col-span-2">
                      <ErpField label="دلیل پس گرفتن نسخه" required>
                        <ErpTextarea
                          value={contractReturnReason.trimStart()}
                          onChange={(event) => setContractReturnReason(event.target.value)}
                        />
                      </ErpField>
                      <div className="flex flex-wrap gap-2">
                        <ErpButton
                          label="ثبت پس گرفتن و ایجاد وظیفه اصلاح"
                          tone="warning"
                          disabled={busy || contractReturnReason.trim().length < 3}
                          onClick={() => run(
                            () => hiringAPI.withdrawContract(id, latestContract.id, contractReturnReason.trim()),
                            "نسخه قرارداد پس گرفته شد و وظیفه اصلاح ایجاد شد.",
                          ).then((succeeded) => {
                            if (succeeded) {
                              setContractWithdrawOpen(false);
                              setContractReturnReason("");
                            }
                          })}
                        />
                        <ErpButton label="انصراف" variant="soft" disabled={busy} onClick={() => {
                          setContractWithdrawOpen(false);
                          setContractReturnReason("");
                        }} />
                      </div>
                    </div>
                  )}
                </>
              )}
              {latestContract && (
                <ErpCard className="p-3 text-sm md:col-span-2">
                  <p className="font-bold">وضعیت آخرین نسخه</p>
                  <p className="mt-1">
                    {{
                      DRAFT: "ثبت‌شده؛ در انتظار ارسال",
                      SUBMITTED: "ارسال‌شده؛ در انتظار بررسی مدیر مالی",
                      WITHDRAWN: "پس‌گرفته‌شده؛ در انتظار نسخه اصلاح‌شده",
                      RETURNED: "برای اصلاح بازگردانده شده",
                      APPROVED: "تأییدشده",
                    }[latestContract.reviewState as string] ||
                      latestContract.reviewState}
                  </p>
                  {latestContract.returnReason && (
                    <p className="mt-2 text-[var(--sds-danger)]">
                      دلیل بازگشت: {latestContract.returnReason}
                    </p>
                  )}
                </ErpCard>
              )}
              {latestContract?.originalName && (
                <ErpPressable
                  type="submit"
                  className="rounded-lg border px-3 py-2 text-sm"
                  onClick={() =>
                    download(
                      () => hiringAPI.downloadContract(id, latestContract.id),
                      latestContract.originalName,
                    )
                  }
                >
                  دریافت قرارداد
                </ErpPressable>
              )}
            </div>
          </ErpSection>
        </>
      )}
      {selectedLifecyclePhase === "ONBOARDING" &&
        (canViewInsuranceTask || canViewPayrollTask) && (
          <>
            <ErpSection title="بیمه و حقوق">
              <div className="grid gap-3 xl:grid-cols-3">
                {canViewInsuranceTask && (
                  <ErpCard
                    className={`space-y-2 p-4 ${insuranceOverdue ? "ring-2 ring-[var(--sds-focus-ring)]" : ""}`}
                  >
                    {data.insuranceEnrollment?.startRevisionReviewRequired && <ErpInlineState kind="stale" title="تاریخ شروع تغییر کرده است؛ شواهد بیمه بازنویسی نشده‌اند و نیاز به بازبینی دارند." />}
                    {insuranceOverdue && (
                      <ErpInlineState kind="stale" title="مهلت پیگیری ثبت بیمه توسط شرکت گذشته است." />
                    )}
                    <ErpField label="روش ثبت بیمه" required>
                      <ErpSelect
                        value={insurance.registrationPath}
                        onChange={(e) =>
                          setInsurance({
                            ...insurance,
                            registrationPath: e.target.value,
                          })
                        }
                      >
                        <option value="COMPANY">ثبت بیمه توسط شرکت</option>
                        <option value="INDEPENDENT_REQUEST">
                          درخواست ثبت مستقل توسط شخص
                        </option>
                      </ErpSelect>
                    </ErpField>
                    {insurance.registrationPath === "COMPANY" ? (
                      <>
                        <ErpField label="وضعیت عملیاتی بیمه" required>
                          <ErpSelect
                            value={insurance.status}
                            onChange={(e) =>
                              setInsurance({
                                ...insurance,
                                status: e.target.value,
                              })
                            }
                          >
                            <option value="NOT_STARTED">شروع نشده</option>
                            <option value="IN_PROGRESS">در حال پیگیری</option>
                            <option value="ACTIVE">فعال</option>
                            <option value="EXEMPT">معاف/غیرقابل اعمال</option>
                          </ErpSelect>
                        </ErpField>
                        <ErpField
                          label="تاریخ شروع پوشش بیمه"
                          required={insurance.status === "ACTIVE"}
                          hint={
                            insurance.status === "ACTIVE"
                              ? undefined
                              : "اختیاری تا زمان فعال‌شدن بیمه"
                          }
                        >
                          <HrPersianCalendar
                            value={insurance.effectiveDate}
                            onChange={(effectiveDate) =>
                              setInsurance({ ...insurance, effectiveDate })
                            }
                          />
                        </ErpField>
                        <ErpField
                          label="مهلت پیگیری ثبت بیمه"
                          hint="اختیاری و غیرمسدودکننده فعال‌سازی همکاری"
                        >
                          <HrPersianCalendar
                            value={insurance.dueDate}
                            onChange={(dueDate) =>
                              setInsurance({ ...insurance, dueDate })
                            }
                          />
                        </ErpField>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-[var(--sds-text-secondary)]">
                          با ثبت این انتخاب، پیگیری شرکت خاتمه می‌یابد و مدرک یا
                          تاریخ فعال‌سازی بعدی از شخص درخواست نمی‌شود.
                        </p>
                        <ErpField label="روش اعلام درخواست شخص" required>
                          <ErpSelect
                            value={insurance.communicationMethod}
                            onChange={(e) =>
                              setInsurance({
                                ...insurance,
                                communicationMethod: e.target.value,
                              })
                            }
                          >
                            <option value="PHONE">تماس تلفنی</option>
                            <option value="IN_PERSON">حضوری</option>
                            <option value="MESSAGE">پیام</option>
                            <option value="EMAIL">ایمیل</option>
                          </ErpSelect>
                        </ErpField>
                        <ErpField label="زمان اعلام درخواست شخص" required>
                          <HrPersianCalendar
                            showTime
                            value={insurance.communicatedAt}
                            onChange={(communicatedAt) =>
                              setInsurance({ ...insurance, communicatedAt })
                            }
                          />
                        </ErpField>
                      </>
                    )}
                    <ErpTextarea
                      placeholder="یادداشت"
                      value={insurance.note}
                      onChange={(e) =>
                        setInsurance({ ...insurance, note: e.target.value })
                      }
                    />
                    <ErpButton
                      label="ذخیره وضعیت بیمه"
                      disabled={Boolean(insuranceSubmissionBlocker(insurance))}
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.setInsurance(id, {
                              ...insurance,
                              effectiveDate: toIsoDate(insurance.effectiveDate),
                              dueDate: toIsoDate(insurance.dueDate),
                              communicatedAt: toIsoDateTime(
                                insurance.communicatedAt,
                              ),
                            }),
                          "بیمه به‌روزرسانی شد.",
                        )
                      }
                    />
                  </ErpCard>
                )}
                {canViewPayrollTask && (
                  <ErpCard className="space-y-2 p-4">
                    <p className="font-bold">مشارکت حقوق و دستمزد</p>
                    {data.payrollParticipation?.startRevisionReviewRequired && <ErpInlineState kind="stale" title="مسئول حقوق و دستمزد باید تاریخ را دوباره تأیید یا اصلاح کند؛ تا آن زمان فعال‌سازی مسدود است." />}
                    <div className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 text-sm dark:bg-[var(--sds-surface-raised)]">
                      <p>
                        تاریخ شروع برنامه‌ریزی‌شده:{" "}
                        {dateFa(data.scheduledStartDate)}
                      </p>
                      <p className="mt-2 font-semibold">
                        حقوق و مزایای تأییدشده
                      </p>
                      {(compensation?.componentsJson || []).map(
                        (item: any, index: number) => (
                          <div
                            key={`${item.label}-${index}`}
                            className="flex justify-between gap-3"
                          >
                            <span>{item.label}</span>
                            <span>
                              {Number(item.amountRials || 0).toLocaleString(
                                "fa-IR",
                              )}{" "}
                              ریال
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                    <ErpField
                      label="تاریخ شروع مشارکت در حقوق و دستمزد"
                      required
                      hint="به‌صورت پیش‌فرض برابر تاریخ شروع برنامه‌ریزی‌شده است."
                    >
                      <HrPersianCalendar
                        value={payrollDate}
                        onChange={setPayrollDate}
                      />
                    </ErpField>
                    {payrollDiffersFromPlanned && (
                      <ErpField
                        label="دلیل تفاوت با تاریخ شروع برنامه‌ریزی‌شده"
                        required
                      >
                        <ErpTextarea
                          value={payrollMismatchReason}
                          onChange={(event) =>
                            setPayrollMismatchReason(event.target.value)
                          }
                        />
                      </ErpField>
                    )}
                    <label className="flex items-start gap-2 text-sm">
                      <ErpInput
                        type="checkbox"
                        checked={payrollReviewConfirmed}
                        onChange={(event) =>
                          setPayrollReviewConfirmed(event.target.checked)
                        }
                      />
                      <span>
                        حقوق و مزایای تأییدشده و تاریخ شروع را بررسی و تأیید
                        کردم.
                      </span>
                    </label>
                    <ErpButton
                      label="تنظیم مشارکت حقوق و دستمزد"
                      disabled={
                        !payrollDate ||
                        !payrollReviewConfirmed ||
                        (payrollDiffersFromPlanned &&
                          !payrollMismatchReason.trim())
                      }
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.setPayroll(id, {
                              effectiveFrom: toIsoDate(payrollDate),
                              startMismatchReason: payrollMismatchReason,
                              reviewConfirmed: payrollReviewConfirmed,
                            }),
                          "مشارکت حقوق تنظیم شد.",
                        )
                      }
                    />
                  </ErpCard>
                )}
              </div>
            </ErpSection>
          </>
        )}
      {selectedLifecyclePhase === "ACTIVATION" &&
        canViewActivationTask &&
        data.activationReadiness && (
          <ErpSection
            title="آمادگی فعال‌سازی رابطه استخدامی"
            description="این تصمیم رابطه استخدامی را از «برنامه‌ریزی‌شده» به «فعال» تغییر می‌دهد."
          >
            <ErpCard className="space-y-3 p-4">
              <div className="grid gap-2 text-sm md:grid-cols-4">
                <p>
                  شروع برنامه‌ریزی‌شده:{" "}
                  {dateFa(data.activationReadiness.plannedStartDate)}
                </p>
                <p>
                  قرارداد:{" "}
                  {hrDisplayLabel(
                    data.activationReadiness.paperContractClearance,
                  )}
                </p>
                <p>
                  حقوق و دستمزد:{" "}
                  {data.activationReadiness.payrollConfigured
                    ? "تنظیم‌شده"
                    : "تنظیم‌نشده"}
                </p>
                <p>
                  بیمه (غیرمسدودکننده):{" "}
                  {hrDisplayLabel(data.activationReadiness.insurance.status)}
                </p>
              </div>
              {data.activationReadiness.blockers.length > 0 && (
                <ErpInlineState kind="stale" title={data.activationReadiness.blockers.map((blocker: any) => blocker.message).join("؛ ")} />
              )}
              {data.activationReadiness.activatedAt ? (
                <ErpInlineState kind="success" title={`فعال‌سازی توسط ${data.activationReadiness.activatedBy || "مدیر منابع انسانی"} در ${dateTimeFa(data.activationReadiness.activatedAt)} انجام شد.`} />
              ) : (
                <ErpButton
                  label="تأیید نهایی و فعال‌سازی رابطه استخدامی"
                  disabled={!data.activationReadiness.ready}
                  onClick={() =>
                    run(() => hiringAPI.activate(id), "استخدام فعال شد.")
                  }
                  tone="success"
                />
              )}
            </ErpCard>
          </ErpSection>
        )}
      {selectedLifecyclePhase &&
        [
          "APPLICATION",
          "IDENTITY",
          "ASSESSMENT",
          "OFFER",
          "CONVERSION",
        ].includes(selectedLifecyclePhase) &&
        hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
          <>
            <ErpSection
              title="مختومه‌کردن پرونده استخدام"
              description="نتیجه مناسب را انتخاب کنید: رد توسط سازمان، انصراف متقاضی یا لغو درخواست استخدام. سابقه پرونده حفظ می‌شود."
            >
              <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
                <ErpField label="نحوه مختومه‌شدن پرونده" required>
                  <ErpSelect
                    value={closure.outcome}
                    onChange={(e) =>
                      setClosure({ ...closure, outcome: e.target.value })
                    }
                  >
                    <option value="REJECTED">رد شده</option>
                    <option value="WITHDRAWN">انصراف متقاضی</option>
                    <option value="REQUEST_CANCELLED">لغو درخواست</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="دلیل بستن پرونده" required>
                  <ErpInput
                    placeholder="دلیل الزامی"
                    value={closure.reason}
                    onChange={(e) =>
                      setClosure({ ...closure, reason: e.target.value })
                    }
                  />
                </ErpField>
                <ErpButton
                  label="ثبت نتیجه و مختومه‌کردن پرونده"
                  className="w-fit self-end justify-self-start"
                  tone="danger"
                  disabled={busy || !closure.reason || data.outcome === "HIRED"}
                  onClick={() =>
                    run(() => hiringAPI.close(id, closure), "پرونده بسته شد.")
                  }
                />
              </ErpCard>
            </ErpSection>
          </>
        )}
      {(data.disposition ||
        (data.stage === "CLOSED" && data.outcome !== "HIRED")) && (
        <CaseRecoveryPanel
          application={data}
          actionPermissions={actionPermissions}
          applicationId={id}
          busy={busy}
          run={run}
        />
      )}
      <ErpSheet
        open={Boolean(assessmentVoidTarget)}
        onClose={() => { if (!busy) { setAssessmentVoidTarget(null); setAssessmentVoidReason(""); } }}
        title="حذف ارزیابی با حفظ سابقه"
        presentation="modal"
        pending={busy}
        footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => { setAssessmentVoidTarget(null); setAssessmentVoidReason(""); }} /><ErpButton label="تأیید حذف" tone="danger" variant="solid" disabled={busy || !assessmentVoidReason.trim()} onClick={() => void run(() => hiringAPI.voidAssessment(id, assessmentVoidTarget.id, assessmentVoidReason.trim()), "ارزیابی با حفظ سابقه باطل شد.").then((succeeded) => { if (succeeded) { setAssessmentVoidTarget(null); setAssessmentVoidReason(""); } })} /></div>}
      >
        <ErpField label="دلیل حذف ارزیابی" required><ErpTextarea value={assessmentVoidReason} onChange={(event) => setAssessmentVoidReason(event.target.value)} /></ErpField>
      </ErpSheet>
      {deletionTarget && (
        <PermanentDeletionDialog
          title="حذف دائمی پرونده متقاضی"
          preview={deletionTarget.preview}
          busy={busy}
          onClose={() => setDeletionTarget(null)}
          onConfirm={confirmPermanentDeletion}
        />
      )}
      {retentionTarget && (
        <RetentionAction
          title={
            retentionTarget.archivedAt
              ? "بازیابی پرونده از بایگانی"
              : "بایگانی پرونده متقاضی"
          }
          targetName={`${retentionTarget.candidate.firstName} ${retentionTarget.candidate.lastName}`}
          busy={busy}
          confirmLabel={retentionTarget.archivedAt ? "بازیابی" : "بایگانی"}
          confirmTone={retentionTarget.archivedAt ? "success" : "warning"}
          onClose={() => setRetentionTarget(null)}
          onConfirm={confirmRetentionAction}
        />
      )}
    </ErpPage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <ErpCard className="p-3 text-center">
      <p className="text-xs text-[var(--sds-text-secondary)]">{label}</p>
      <b className="mt-1 block text-xs">{value}</b>
    </ErpCard>
  );
}

type CaseActionRunner = (
  action: () => Promise<any>,
  success: string,
  options?: CaseActionOptions,
) => Promise<boolean>;

type CaseActionOptions = {
  propagateActionError?: boolean;
  awaitRefresh?: boolean;
};

function CompanyEvaluationPlan({ applicationId, actionPermissions, busy, run, onPendingChange }: { applicationId: string; actionPermissions: string[]; busy: boolean; run: CaseActionRunner; onPendingChange: (pending: boolean) => void }) {
  const types = [["MANAGEMENT_INTERVIEW", "مصاحبه با مدیریت"], ["HR_MANAGER_INTERVIEW", "مصاحبه با مدیر منابع انسانی"], ["DEPARTMENT_SUPERVISOR_INTERVIEW", "مصاحبه با سرپرست بخش"], ["THERAPIST_CONSULTATION", "ارجاع مشاور/روان‌شناس"], ["OTHER", "سایر"]];
  const [items, setItems] = useState<any[]>([]);
  const [eligible, setEligible] = useState<Record<string, any[]>>({});
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<any>({ type: "MANAGEMENT_INTERVIEW", subject: "", instructions: "", evidencePolicy: "EXPLANATION_REQUIRED", scorePolicy: "REQUIRED", evaluatorPersonnelId: "", externalProviderName: "", externalProviderType: "", externalProviderPhone: "", externalProviderNote: "", plannedAt: "", reportDueAt: "" });
  const [results, setResults] = useState<Record<string, { effect: string; score: string; explanation: string; file?: File }>>({});
  const [cancelTarget, setCancelTarget] = useState<any>();
  const canPlan = actionPermissions.includes("MANAGE_COMPANY_EVALUATION_PLAN");
  const canResult = actionPermissions.includes("RECORD_COMPANY_EVALUATION_RESULT");
  const canViewResults = actionPermissions.includes("VIEW_COMPANY_EVALUATION_RESULTS");
  const isExternal = draft.type === "THERAPIST_CONSULTATION";
  const personnel = eligible[draft.type] || [];
  const refresh = useCallback(async () => {
    try {
      const personnelTypes = canPlan
        ? types.filter(([value]) => value !== "THERAPIST_CONSULTATION")
        : [];
      const [{ data }, ...personnelResponses] = await Promise.all([
        hiringAPI.companyEvaluations(applicationId),
        ...personnelTypes.map(([value]) => hiringAPI.eligibleCompanyEvaluationPersonnel(applicationId, value)),
      ]);
      const rows = data.data || [];
      const map: Record<string, any[]> = {};
      personnelTypes.forEach(([value], index) => { map[value] = personnelResponses[index]?.data?.data || []; });
      setItems(rows); setEligible(map); setLoadError("");
      onPendingChange(rows.some((item: any) => item.status === "PLANNED"));
    } catch (cause) { setItems([]); onPendingChange(false); setLoadError(hiringError(cause)); }
  }, [applicationId, canPlan, onPendingChange]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const required = ["MANAGEMENT_INTERVIEW", "HR_MANAGER_INTERVIEW", "DEPARTMENT_SUPERVISOR_INTERVIEW"].includes(draft.type);
    setDraft((current: any) => ({ ...current, evaluatorPersonnelId: "", scorePolicy: required ? "REQUIRED" : "OPTIONAL" }));
  }, [draft.type]);
  const downloadEvidence = async (item: any) => { const response = await hiringAPI.downloadCompanyEvaluationEvidence(applicationId, item.id); const href = URL.createObjectURL(response.data); const anchor = document.createElement("a"); anchor.href = href; anchor.download = item.resultOriginalName || "company-evaluation-evidence"; anchor.click(); URL.revokeObjectURL(href); };
  const cannotCreate = busy || (!isExternal && !draft.evaluatorPersonnelId) || (isExternal && !draft.externalProviderName.trim()) || (draft.type === "OTHER" && (!draft.subject.trim() || !draft.instructions.trim()));
  return <ErpSection title="برنامه ارزیابی شرکت" description="مسئول ارزیابی از Personnel انتخاب می‌شود؛ ثبت گزارش و پیگیری همچنان بر عهده منابع انسانی است.">
    {loadError && <ErpInlineState kind="error" title={loadError} />}
    {canPlan && <ErpCard className="mb-4 space-y-3 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ErpField label="نوع ارزیابی"><ErpSelect value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect></ErpField>
        {!isExternal ? <ErpField label="Personnel ارزیاب" required><ErpSelect value={draft.evaluatorPersonnelId} onChange={(event) => setDraft({ ...draft, evaluatorPersonnelId: event.target.value })}><option value="">انتخاب کنید</option>{personnel.map((person: any) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}{person.position?.title ? ` · ${person.position.title}` : ""}</option>)}</ErpSelect></ErpField> : <ErpField label="نام شخص یا مرکز" required><ErpInput value={draft.externalProviderName} onChange={(event) => setDraft({ ...draft, externalProviderName: event.target.value })} /></ErpField>}
        <ErpField label="سیاست امتیاز"><ErpSelect value={draft.scorePolicy} onChange={(event) => setDraft({ ...draft, scorePolicy: event.target.value })}><option value="REQUIRED">اجباری</option><option value="OPTIONAL">اختیاری</option><option value="NONE">بدون امتیاز</option></ErpSelect></ErpField>
        <ErpField label="شواهد"><ErpSelect value={draft.evidencePolicy} onChange={(event) => setDraft({ ...draft, evidencePolicy: event.target.value })}><option value="EXPLANATION_REQUIRED">توضیح الزامی</option><option value="FILE_REQUIRED">فایل الزامی</option><option value="FILE_OPTIONAL">فایل اختیاری</option><option value="NO_FILE">بدون فایل</option></ErpSelect></ErpField>
        <ErpField label="تاریخ برنامه‌ریزی‌شده"><HrPersianCalendar value={draft.plannedAt} onChange={(plannedAt) => setDraft({ ...draft, plannedAt })} clearable /></ErpField>
        <ErpField label="مهلت دریافت گزارش"><HrPersianCalendar value={draft.reportDueAt} onChange={(reportDueAt) => setDraft({ ...draft, reportDueAt })} clearable /></ErpField>
        {isExternal && <><ErpField label="نوع مرجع"><ErpInput value={draft.externalProviderType} onChange={(event) => setDraft({ ...draft, externalProviderType: event.target.value })} /></ErpField><ErpField label="شماره تماس"><ErpInput inputMode="numeric" value={draft.externalProviderPhone} onChange={(event) => setDraft({ ...draft, externalProviderPhone: normalizeIdentifierDigits(event.target.value) })} /></ErpField></>}
        {draft.type === "OTHER" && <><ErpField label="موضوع" required><ErpInput value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></ErpField><ErpField label="شرح پیگیری" required><ErpInput value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></ErpField></>}
      </div>
      {!isExternal && personnel.length === 0 && <ErpInlineState kind="stale" title={draft.type === "DEPARTMENT_SUPERVISOR_INTERVIEW" ? "ابتدا سرپرست جایگاه را در ساختار سازمانی تعیین کنید." : "برای این نوع ارزیابی، جایگاه مجاز و Personnel فعال پیدا نشد."} />}
      <ErpButton label="افزودن ارزیابی" variant="solid" disabled={cannotCreate} onClick={() => void run(() => hiringAPI.addCompanyEvaluation(applicationId, { ...draft, plannedAt: draft.plannedAt ? toIsoDate(draft.plannedAt) : null, reportDueAt: draft.reportDueAt ? toIsoDate(draft.reportDueAt) : null }), "ارزیابی به برنامه افزوده شد.").then(refresh)} />
    </ErpCard>}
    <div className="space-y-3">{items.map((item) => {
      const result = results[item.id] || { effect: "NEUTRAL", score: "", explanation: "" };
      const label = types.find(([value]) => value === item.type)?.[1] || item.type;
      const itemPersonnel = eligible[item.type] || [];
      const late = item.status === "PLANNED" && item.reportDueAt && new Date(item.reportDueAt) < new Date();
      const resultBlocked = busy || (item.scorePolicy === "REQUIRED" && !result.score) || (item.evidencePolicy === "EXPLANATION_REQUIRED" && !result.explanation.trim()) || (item.evidencePolicy === "FILE_REQUIRED" && !result.file);
      return <ErpCard key={item.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><b>{label} · نوبت {Number(item.occurrenceNumber).toLocaleString("fa-IR")}</b><p className="text-sm text-[var(--sds-text-secondary)]">منبع گزارش: {item.evaluatorPersonnel ? `${item.evaluatorPersonnel.firstName} ${item.evaluatorPersonnel.lastName}` : item.externalProviderName || "—"}</p>{item.assignmentHistory?.length > 1 && <p className="text-xs text-[var(--sds-text-muted)]">سابقه مسئولان: {item.assignmentHistory.map((entry: any) => `${entry.evaluatorPersonnel.firstName} ${entry.evaluatorPersonnel.lastName}`).join(" ← ")}</p>}</div><div className="flex gap-2"><ErpBadge tone={late ? "danger" : item.status === "COMPLETED" ? "success" : item.status === "CANCELLED" ? "neutral" : "warning"}>{late ? "گزارش دیرکرد دارد" : item.status === "COMPLETED" ? "تکمیل‌شده" : item.status === "CANCELLED" ? "لغوشده" : "در انتظار نتیجه"}</ErpBadge></div></div>
        {item.status === "PLANNED" && canPlan && item.evaluatorPersonnelId && <ErpField className="mt-3 max-w-md" label="تغییر مسئول"><ErpSelect value={item.evaluatorPersonnelId} onChange={(event) => void run(() => hiringAPI.reassignCompanyEvaluation(applicationId, item.id, event.target.value), "مسئول ارزیابی تغییر کرد.").then(refresh)}>{itemPersonnel.map((person: any) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}{person.position?.title ? ` · ${person.position.title}` : ""}</option>)}</ErpSelect></ErpField>}
        {item.status === "PLANNED" && canResult && <div className="mt-3 grid gap-2 md:grid-cols-4"><ErpSelect value={result.effect} onChange={(event) => setResults({ ...results, [item.id]: { ...result, effect: event.target.value } })}><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="NEGATIVE">منفی</option></ErpSelect>{item.scorePolicy !== "NONE" && <ErpSelect value={result.score} onChange={(event) => setResults({ ...results, [item.id]: { ...result, score: event.target.value } })}><option value="">{item.scorePolicy === "REQUIRED" ? "امتیاز اجباری" : "بدون امتیاز"}</option><option value="1">۱ — خیلی ضعیف</option><option value="2">۲ — ضعیف</option><option value="3">۳ — متوسط</option><option value="4">۴ — خوب</option><option value="5">۵ — خیلی خوب</option></ErpSelect>}<ErpInput placeholder={item.evidencePolicy === "EXPLANATION_REQUIRED" ? "توضیح الزامی" : "توضیح اختیاری"} value={result.explanation} onChange={(event) => setResults({ ...results, [item.id]: { ...result, explanation: event.target.value } })} />{item.evidencePolicy !== "NO_FILE" && <ErpInput type="file" onChange={(event) => setResults({ ...results, [item.id]: { ...result, file: event.target.files?.[0] } })} />}<ErpButton label="ثبت نتیجه" disabled={resultBlocked} onClick={() => { const data = new FormData(); data.append("effect", result.effect); data.append("score", result.score); data.append("explanation", result.explanation); if (result.file) data.append("file", result.file); void run(() => hiringAPI.recordCompanyEvaluationResult(applicationId, item.id, data), "نتیجه ارزیابی ثبت شد.").then(refresh); }} /></div>}
        {item.status === "PLANNED" && canPlan && <div className="mt-3"><ErpButton label="لغو ارزیابی" tone="danger" variant="ghost" disabled={busy} onClick={() => setCancelTarget(item)} /></div>}
        {item.status === "COMPLETED" && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><span><b>اثر: </b>{item.resultEffect === "POSITIVE" ? "مثبت" : item.resultEffect === "NEGATIVE" ? "منفی" : "خنثی"} · <b>امتیاز: </b>{item.resultScore ? `${item.resultScore} از ۵` : item.legacyWithoutScore ? "نسخه قدیمی — بدون امتیاز" : "بدون امتیاز"}{item.resultExplanation && ` · ${item.resultExplanation}`}</span>{item.resultOriginalName && canViewResults && <ErpButton label="دریافت مدرک نتیجه" variant="ghost" onClick={() => void downloadEvidence(item)} />}</div>}
      </ErpCard>;
    })}</div>
    <ErpSheet open={Boolean(cancelTarget)} onClose={() => { if (!busy) setCancelTarget(undefined); }} title="لغو ارزیابی" presentation="modal" dismissible={!busy}><ErpCard className="space-y-4 p-5"><p>لغو این نوبت بازگشت‌پذیر نیست و در سابقه پرونده ثبت می‌شود.</p><div className="flex gap-2"><ErpButton label="تأیید لغو" tone="danger" disabled={busy} onClick={() => { if (!cancelTarget) return; void run(() => hiringAPI.cancelCompanyEvaluation(applicationId, cancelTarget.id), "ارزیابی لغو شد.").then((succeeded) => { if (succeeded) setCancelTarget(undefined); return refresh(); }); }} /><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => setCancelTarget(undefined)} /></div></ErpCard></ErpSheet>
  </ErpSection>;
}

function PreIdentitySection({
  phase,
  application,
  actionPermissions,
  busy,
  applicationId,
  run,
  download,
}: {
  phase: "INITIAL_HR_REVIEW" | "COMPANY_EVALUATION_PLAN";
  application: any;
  actionPermissions: string[];
  busy: boolean;
  applicationId: string;
  run: CaseActionRunner;
  download: (request: () => Promise<any>, fileName: string) => Promise<void>;
}) {
  const hasAction = (...values: string[]) => values.some((value) => actionPermissions.includes(value));
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, any>>({});
  const [hasPendingCompanyEvaluations, setHasPendingCompanyEvaluations] = useState(false);
  const [editingInterviewRevision, setEditingInterviewRevision] = useState(false);
  const [requirement, setRequirement] = useState({
    title: "",
    instructions: "",
    evidencePolicy: "NOTE_REQUIRED",
    dueAt: "",
  });
  const [results, setResults] = useState<Record<string, any>>({});
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [preIdentityAction, setPreIdentityAction] = useState<null | { kind: "correct" | "resolve"; item: any; resolution?: string }>(null);
  const [preIdentityActionReason, setPreIdentityActionReason] = useState("");
  const decisions = application.hiringDecisions || [];
  const latest = (kind: string) =>
    decisions
      .filter((item: any) => item.kind === kind)
      .sort((a: any, b: any) => b.version - a.version)[0];
  const decisionDefinitions = phase === "INITIAL_HR_REVIEW"
    ? [
        ["HR_PRELIMINARY_APPROVAL", "تأیید اولیه HR", "RECORD_PRELIMINARY_DECISION"],
      ]
    : [["COMPANY_APPROVAL", "تأیید مدیریت شرکت", "RECORD_FINAL_MANAGEMENT_DECISION"]];
  const latestInterview = latest("HR_INTERVIEW");
  return (
    <ErpSection
      title={phase === "INITIAL_HR_REVIEW" ? "بررسی اولیه منابع انسانی" : "برنامه ارزیابی مدیریت شرکت"}
      description={phase === "INITIAL_HR_REVIEW" ? "مصاحبه و تأیید اولیه پیش از تصمیم ارزیابی‌های رسمی ثبت می‌شود." : "فعالیت‌های مدیریتی جدا از ارزیابی‌های رسمی برنامه‌ریزی و پیگیری می‌شوند."}
    >
      {(phase === "INITIAL_HR_REVIEW" || phase === "COMPANY_EVALUATION_PLAN") && hasAction("VIEW_INITIAL_INTERVIEW_REPORT") && latestInterview?.evidenceJson && (
        <ProductionInterviewReport
          payload={latestInterview.evidenceJson as InterviewEvidencePayload}
          version={latestInterview.version}
          outcome={latestInterview.outcome}
          explanation={latestInterview.explanation}
          history={decisions.filter((item: any) => item.kind === "HR_INTERVIEW" && item.version !== latestInterview.version)}
        />
      )}
      {phase === "COMPANY_EVALUATION_PLAN" && latest("HR_PRELIMINARY_APPROVAL") && (
        <ErpCard className="p-4">
          <b>تصمیم مقدماتی منابع انسانی</b>
          <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{latest("HR_PRELIMINARY_APPROVAL").outcome === "POSITIVE" ? "تأیید" : "رد"} · {latest("HR_PRELIMINARY_APPROVAL").explanation || "بدون توضیح"}</p>
        </ErpCard>
      )}
      {phase === "INITIAL_HR_REVIEW" && latestInterview && hasAction("RECORD_INITIAL_INTERVIEW") && !editingInterviewRevision && (
        <div className="flex justify-end"><ErpButton label="ثبت نسخه اصلاحی مصاحبه" variant="ghost" onClick={() => setEditingInterviewRevision(true)} /></div>
      )}
      {phase === "INITIAL_HR_REVIEW" && hasAction("RECORD_INITIAL_INTERVIEW") && (!latestInterview || editingInterviewRevision) && (
        <ProductionHrInterview
          initialPayload={application.initialInterviewDraft?.dataJson as InterviewEvidencePayload | null}
          initialVersion={application.initialInterviewDraft?.version || 0}
          history={decisions.filter((item: any) => item.kind === "HR_INTERVIEW")}
          busy={busy}
          onSaveDraft={async (payload, expectedVersion) => {
            const response = await hiringAPI.saveInitialInterviewDraft(applicationId, payload, expectedVersion);
            return response.data.data;
          }}
          onReloadDraft={async () => {
            const response = await hiringAPI.getInitialInterview(applicationId);
            const draft = response.data.data.draft;
            return {
              payload: draft.dataJson as InterviewEvidencePayload,
              version: draft.version as number,
            };
          }}
          onComplete={async (payload) => { await run(
            () => hiringAPI.recordDecision(applicationId, "HR_INTERVIEW", {
              outcome: payload.state.decision,
              explanation: payload.state.decisionReason,
              guidedInterview: payload,
              changeReason: latest("HR_INTERVIEW") ? "ثبت نسخه اصلاحی مصاحبه" : "",
            }),
            "نسخه مصاحبه هدایت‌شده ثبت شد.",
            { propagateActionError: true, awaitRefresh: false },
          ); }}
        />
      )}
      <div className="grid gap-3 xl:grid-cols-3">
        {decisionDefinitions.map(([kind, label, authority]) => {
          const current = latest(kind);
          const draft = decisionDrafts[kind] || {
            outcome: "POSITIVE",
            explanation: "",
            changeReason: "",
          };
          return (
            <div key={kind} className="space-y-3 border-t border-[var(--sds-border-default)] pt-4">
              <div className="flex items-center justify-between gap-2">
                <b>{label}</b>
                <ErpBadge
                  tone={
                    current?.outcome === "POSITIVE"
                      ? "success"
                      : current?.outcome === "NEGATIVE"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {current?.outcome === "POSITIVE"
                    ? "تأیید"
                    : current?.outcome === "NEGATIVE"
                      ? "رد"
                      : "ثبت نشده"}
                </ErpBadge>
              </div>
              {current && (
                <div className="rounded-lg bg-[var(--sds-surface-subtle)] p-2 text-xs dark:bg-[var(--sds-surface-raised)]">
                  <p>{current.explanation || "بدون توضیح"}</p>
                  <small>نسخه {current.version.toLocaleString("fa-IR")}</small>
                </div>
              )}
              {hasAction(authority) && (kind !== "HR_PRELIMINARY_APPROVAL" || Boolean(latest("HR_INTERVIEW"))) && (
                <>
                  <ErpSelect
                    value={draft.outcome}
                    onChange={(event) =>
                      setDecisionDrafts({
                        ...decisionDrafts,
                        [kind]: { ...draft, outcome: event.target.value },
                      })
                    }
                  >
                    <option value="POSITIVE">تأیید</option>
                    <option value="NEGATIVE">رد</option>
                  </ErpSelect>
                  <ErpTextarea
                    placeholder={
                      kind === "COMPANY_APPROVAL" &&
                      draft.outcome === "POSITIVE"
                        ? "توضیح اختیاری"
                        : "توضیح تصمیم (الزامی)"
                    }
                    value={draft.explanation}
                    onChange={(event) =>
                      setDecisionDrafts({
                        ...decisionDrafts,
                        [kind]: { ...draft, explanation: event.target.value },
                      })
                    }
                  />
                  {current && (
                    <ErpInput
                      placeholder="دلیل تغییر تصمیم قبلی"
                      value={draft.changeReason}
                      onChange={(event) =>
                        setDecisionDrafts({
                          ...decisionDrafts,
                          [kind]: {
                            ...draft,
                            changeReason: event.target.value,
                          },
                        })
                      }
                    />
                  )}
                  <ErpButton
                    label="ثبت نسخه تصمیم"
                    disabled={
                      busy ||
                      (kind === "COMPANY_APPROVAL" && hasPendingCompanyEvaluations) ||
                      ((kind !== "COMPANY_APPROVAL" ||
                        draft.outcome === "NEGATIVE") &&
                        !draft.explanation.trim()) ||
                      Boolean(current && !draft.changeReason.trim())
                    }
                    onClick={() =>
                      run(
                        () =>
                          hiringAPI.recordDecision(applicationId, kind, draft),
                        "تصمیم با سابقه حسابرسی ثبت شد.",
                      )
                    }
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {shouldLoadCompanyEvaluationPlan(phase, actionPermissions) && <CompanyEvaluationPlan applicationId={applicationId} actionPermissions={actionPermissions} busy={busy} run={run} onPendingChange={setHasPendingCompanyEvaluations} />}
      {phase === "COMPANY_EVALUATION_PLAN" && false && <ErpCard className="mt-4 space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b>چک‌لیست الزامات مدیریت شرکت</b>
          <ErpBadge
            tone={
              application.preIdentityRequirementsFinalizedAt
                ? "success"
                : "warning"
            }
          >
            {application.preIdentityRequirementsFinalizedAt
              ? "نهایی شده"
              : "در حال تنظیم"}
          </ErpBadge>
        </div>
        {hasAction("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") && (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              <ErpSelect
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">انتخاب قالب نسخه‌دار</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · نسخه{" "}
                    {template.version.toLocaleString("fa-IR")}
                  </option>
                ))}
              </ErpSelect>
              <ErpButton
                label="اعمال قالب به پرونده"
                disabled={busy || !templateId}
                onClick={() =>
                  run(
                    () =>
                      hiringAPI.applyPreIdentityTemplate(
                        applicationId,
                        templateId,
                      ),
                    "قالب چک‌لیست به پرونده اعمال شد.",
                  )
                }
              />
              <div className="flex gap-2">
                <ErpInput
                  placeholder="نام قالب جدید"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
                <ErpButton
                  label="ذخیره اقلام فعلی به‌عنوان قالب جایگاه"
                  disabled={
                    busy ||
                    !templateName.trim() ||
                    !(application.preIdentityChecklistItems || []).length
                  }
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.createPreIdentityTemplate({
                          name: templateName,
                          scopeType: "POSITION",
                          scopeId: application.positionId,
                          items: (
                            application.preIdentityChecklistItems || []
                          ).map((item: any) => ({
                            title: item.title,
                            instructions: item.instructions,
                            evidencePolicy: item.evidencePolicy,
                          })),
                        }),
                      "نسخه جدید قالب برای این جایگاه ذخیره شد.",
                    )
                  }
                />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <ErpInput
                placeholder="عنوان الزام یا ارزیابی سفارشی"
                value={requirement.title}
                onChange={(event) =>
                  setRequirement({ ...requirement, title: event.target.value })
                }
              />
              <ErpInput
                placeholder="شرح و دستور پیگیری"
                value={requirement.instructions}
                onChange={(event) =>
                  setRequirement({
                    ...requirement,
                    instructions: event.target.value,
                  })
                }
              />
              <ErpSelect
                value={requirement.evidencePolicy}
                onChange={(event) =>
                  setRequirement({
                    ...requirement,
                    evidencePolicy: event.target.value,
                  })
                }
              >
                <option value="NOTE_REQUIRED">توضیح الزامی</option>
                <option value="FILE_REQUIRED">فایل الزامی</option>
                <option value="FILE_OPTIONAL">فایل اختیاری</option>
                <option value="NO_FILE">بدون فایل</option>
              </ErpSelect>
              <ErpField label="مهلت انجام" hint="تاریخ و ساعت شمسی">
                <HrPersianCalendar
                  value={requirement.dueAt}
                  onChange={(dueAt) =>
                    setRequirement({ ...requirement, dueAt })
                  }
                  placeholder="انتخاب مهلت انجام"
                  showTime
                  clearable
                />
              </ErpField>
              <ErpButton
                label="افزودن به چک‌لیست"
                disabled={busy || !requirement.title.trim()}
                onClick={() =>
                  run(
                    () =>
                      hiringAPI.addPreIdentityItem(applicationId, {
                        ...requirement,
                        dueAt: requirement.dueAt
                          ? toIsoDateTime(requirement.dueAt)
                          : "",
                      }),
                    "الزام جدید به چک‌لیست افزوده شد.",
                  )
                }
              />
              <ErpButton
                label="نهایی‌سازی الزامات"
                tone="success"
                disabled={
                  busy ||
                  Boolean(application.preIdentityRequirementsFinalizedAt)
                }
                onClick={() =>
                  run(
                    () => hiringAPI.finalizePreIdentity(applicationId),
                    "الزامات توسط مدیریت شرکت نهایی شد.",
                  )
                }
              />
            </div>
          </div>
        )}

        <div className="space-y-3">
          {(application.preIdentityChecklistItems || []).map((item: any) => {
            const draft = results[item.id] || {
              status: item.status === "PENDING" ? "IN_PROGRESS" : item.status,
              resultExplanation: item.resultExplanation || "",
              resultSource: item.resultSource || "",
              file: null,
            };
            return (
              <div key={item.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <b>{item.title}</b>
                    <p className="text-xs text-[var(--sds-text-secondary)]">
                      {item.instructions}
                    </p>
                  </div>
                  <ErpBadge
                    tone={
                      item.status === "POSITIVE"
                        ? "success"
                        : item.status === "NEGATIVE"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {hrDisplayLabel(item.status)}
                  </ErpBadge>
                </div>
                {item.resultExplanation && (
                  <p className="mt-2 rounded-lg bg-[var(--sds-surface-subtle)] p-2 text-xs dark:bg-[var(--sds-surface-raised)]">
                    {item.resultExplanation}
                  </p>
                )}
                {hasAction("VIEW_COMPANY_EVALUATION_RESULTS", "MANAGE_RECRUITMENT_CASE", "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") &&
                  item.originalName && (
                    <ErpPressable
                      type="submit"
                      className="mt-2 rounded-lg border px-3 py-1 text-xs"
                      onClick={() =>
                        download(
                          () =>
                            hiringAPI.downloadPreIdentityEvidence(
                              applicationId,
                              item.id,
                            ),
                          item.originalName,
                        )
                      }
                    >
                      دریافت گزارش محرمانه
                    </ErpPressable>
                  )}
                {hasAction("MANAGE_RECRUITMENT_CASE") &&
                  !["POSITIVE", "NEGATIVE"].includes(item.status) && (
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <ErpSelect
                        value={draft.status}
                        onChange={(event) =>
                          setResults({
                            ...results,
                            [item.id]: { ...draft, status: event.target.value },
                          })
                        }
                      >
                        <option value="PENDING">در انتظار</option>
                        <option value="IN_PROGRESS">در حال پیگیری</option>
                        <option value="POSITIVE">مثبت</option>
                        <option value="NEGATIVE">منفی</option>
                      </ErpSelect>
                      <ErpInput
                        placeholder="توضیح نتیجه HR"
                        value={draft.resultExplanation}
                        onChange={(event) =>
                          setResults({
                            ...results,
                            [item.id]: {
                              ...draft,
                              resultExplanation: event.target.value,
                            },
                          })
                        }
                      />
                      <ErpInput
                        placeholder="منبع گزارش"
                        value={draft.resultSource}
                        onChange={(event) =>
                          setResults({
                            ...results,
                            [item.id]: {
                              ...draft,
                              resultSource: event.target.value,
                            },
                          })
                        }
                      />
                      <ErpInput
                        type="file"
                        onChange={(event) =>
                          setResults({
                            ...results,
                            [item.id]: {
                              ...draft,
                              file: event.target.files?.[0],
                            },
                          })
                        }
                      />
                      <ErpButton
                        label="ثبت نتیجه HR"
                        disabled={
                          busy ||
                          (["POSITIVE", "NEGATIVE"].includes(draft.status) &&
                            !draft.resultExplanation.trim())
                        }
                        onClick={() => {
                          const payload = new FormData();
                          payload.append("status", draft.status);
                          payload.append(
                            "resultExplanation",
                            draft.resultExplanation,
                          );
                          payload.append("resultSource", draft.resultSource);
                          if (draft.file) payload.append("file", draft.file);
                          return run(
                            () =>
                              hiringAPI.recordPreIdentityResult(
                                applicationId,
                                item.id,
                                payload,
                              ),
                            "نتیجه چک‌لیست توسط HR ثبت شد.",
                          );
                        }}
                      />
                    </div>
                  )}
                {hasAction("MANAGE_RECRUITMENT_CASE") &&
                  ["POSITIVE", "NEGATIVE"].includes(item.status) && (
                    <ErpPressable
                      type="button"
                      className="mt-3 rounded-lg border border-[var(--sds-warning-border)] px-3 py-2 text-xs font-bold text-[var(--sds-warning)]"
                      onClick={() => { setPreIdentityActionReason(""); setPreIdentityAction({ kind: "correct", item }); }}
                    >
                      ایجاد نسخه اصلاحی
                    </ErpPressable>
                  )}
                {hasAction("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") &&
                  item.status === "NEGATIVE" &&
                  !item.managementResolution && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["CONTINUE", "REPEAT", "RESERVE"].map((resolution) => (
                        <ErpPressable
                          type="submit"
                          key={resolution}
                          className="rounded-lg border px-3 py-2 text-xs font-bold"
                          onClick={() => { setPreIdentityActionReason(""); setPreIdentityAction({ kind: "resolve", item, resolution }); }}
                        >
                          {resolution === "CONTINUE"
                            ? "ادامه با دلیل"
                            : resolution === "REPEAT"
                              ? "تکرار الزام"
                              : "رد/ذخیره"}
                        </ErpPressable>
                      ))}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
        {hasAction("MANAGE_RECRUITMENT_CASE") && application.preIdentityManagementApprovedAt && (
          <ErpButton
            label="ارسال پرونده به احراز هویت"
            tone="success"
            disabled={busy || Boolean(application.preIdentityReleasedAt)}
            onClick={() =>
              run(
                () => hiringAPI.releasePreIdentity(applicationId),
                "چک‌لیست اداری تکمیل و مرحله احراز هویت باز شد.",
              )
            }
          />
        )}
      </ErpCard>}
      <ErpSheet
        open={Boolean(preIdentityAction)}
        onClose={() => { if (!busy) { setPreIdentityAction(null); setPreIdentityActionReason(""); } }}
        title={preIdentityAction?.kind === "correct" ? "ایجاد نسخه اصلاحی نتیجه" : "تعیین تکلیف نتیجه منفی"}
        presentation="modal"
        pending={busy}
        footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => { setPreIdentityAction(null); setPreIdentityActionReason(""); }} /><ErpButton label="تأیید و ثبت" tone="warning" variant="solid" disabled={busy || !preIdentityActionReason.trim()} onClick={() => { if (!preIdentityAction) return; const request = preIdentityAction.kind === "correct" ? () => hiringAPI.correctPreIdentityItem(applicationId, preIdentityAction.item.id, preIdentityActionReason.trim()) : () => hiringAPI.resolvePreIdentityNegative(applicationId, preIdentityAction.item.id, { resolution: preIdentityAction.resolution, reason: preIdentityActionReason.trim() }); void run(request, preIdentityAction.kind === "correct" ? "نسخه اصلاحی جدید ایجاد شد." : "نتیجه منفی توسط مدیریت شرکت تعیین تکلیف شد.").then((succeeded) => { if (succeeded) { setPreIdentityAction(null); setPreIdentityActionReason(""); } }); }} /></div>}
      >
        <ErpField label="دلیل اقدام" required><ErpTextarea value={preIdentityActionReason} onChange={(event) => setPreIdentityActionReason(event.target.value)} /></ErpField>
      </ErpSheet>
    </ErpSection>
  );
}

const formalAssessmentLabels: Record<string, string> = {
  DISC: "DISC (الگوی رفتاری)",
  EQ: "EQ (هوش هیجانی)",
  BIG_FIVE: "BIG FIVE (پنج عامل شخصیت)",
};
const formalAssessmentFields: Record<string, Array<{ key: string; label: string }>> = {
  DISC: [
    { key: "dominance", label: "تسلط‌گرایی (D)" },
    { key: "influence", label: "تأثیرگذاری (I)" },
    { key: "steadiness", label: "ثبات (S)" },
    { key: "conscientiousness", label: "وظیفه‌شناسی (C)" },
  ],
  EQ: [{ key: "score", label: "امتیاز کل هوش هیجانی" }],
  BIG_FIVE: [
    { key: "openness", label: "پذیرش تجربه‌های جدید" },
    { key: "conscientiousness", label: "وظیفه‌شناسی" },
    { key: "extraversion", label: "برون‌گرایی" },
    { key: "agreeableness", label: "توافق‌پذیری" },
    { key: "neuroticism", label: "روان‌رنجوری" },
  ],
};

function FormalAssessmentPlanPanel({
  application,
  actionPermissions,
  busy,
  applicationId,
  run,
}: {
  application: any;
  actionPermissions: string[];
  busy: boolean;
  applicationId: string;
  run: CaseActionRunner;
}) {
  const plans = application.formalAssessmentPlans || [];
  const activePlan = plans.find((plan: any) => plan.status === "ACTIVE");
  const [explicitlyNoAssessment, setExplicitlyNoAssessment] = useState(
    Boolean(activePlan?.explicitlyNoAssessment),
  );
  const [selections, setSelections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(["DISC", "EQ", "BIG_FIVE"].map((kind) => {
      const current = activePlan?.selections?.find((item: any) => item.assessmentKind === kind);
      return [kind, Boolean(current?.selected)];
    })),
  );
  const [executionMethod, setExecutionMethod] = useState<"APPLICANT" | "COMPANY">(
    activePlan?.executionMethod
      || activePlan?.selections?.find((item: any) => item.selected)?.executionMethod
      || "COMPANY",
  );
  const [repeatKinds, setRepeatKinds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [resultDrafts, setResultDrafts] = useState<Record<string, Record<string, string>>>({});
  const [resultExplanations, setResultExplanations] = useState<Record<string, string>>({});
  const [resultFiles, setResultFiles] = useState<Record<string, File[]>>({});
  const [correctionReasons, setCorrectionReasons] = useState<Record<string, string>>({});
  const [historyKind, setHistoryKind] = useState<string | null>(null);
  const canManagePlan = actionPermissions.includes("MANAGE_COMPANY_EVALUATION_PLAN");
  const canRecord = actionPermissions.includes("RECORD_COMPANY_EVALUATION_RESULT");
  const selected = Object.entries(selections).filter(([, value]) => value);
  const resultsForKind = (kind: string) => plans.flatMap((plan: any) => plan.results || [])
    .filter((result: any) => result.assessmentKind === kind)
    .sort((left: any, right: any) => right.resultVersion - left.resultVersion);
  const latestValidResultForKind = (kind: string) => resultsForKind(kind)
    .find((result: any) => result.status === "COMPLETED" && !result.invalidatedAt);
  const isKindActive = (kind: string) => Boolean(activePlan?.selections?.some((selection: any) => selection.selected && selection.assessmentKind === kind));
  const downloadFormalEvidence = async (link: any) => {
    const response = await hiringAPI.downloadFormalAssessmentEvidence(applicationId, link.id);
    const href = URL.createObjectURL(response.data);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = link.hiringDocument.originalName;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <ErpSection
      title="ارزیابی‌های رسمی اختیاری"
      description="نبود داده به‌معنای بدون ارزیابی نیست؛ مدیریت شرکت باید انتخاب صریح و نسخه‌دار ثبت کند."
    >
      {canManagePlan && (
        <ErpCard className="space-y-4 p-4">
          <ErpCheckbox
            checked={explicitlyNoAssessment}
            onChange={(event) => {
              setExplicitlyNoAssessment(event.target.checked);
              if (event.target.checked) setSelections(Object.fromEntries(Object.keys(selections).map((kind) => [kind, false])));
            }}
            label="برای این پرونده ارزیابی رسمی لازم نیست"
          />
          {!explicitlyNoAssessment && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--sds-text-primary)]">روش اجرای مشترک برای همهٔ آزمون‌های انتخاب‌شده</p>
                <ErpSegmentedControl
                  value={executionMethod}
                  onChange={setExecutionMethod}
                  options={[
                    { value: "APPLICANT", label: "تکمیل توسط متقاضی در /apply" },
                    { value: "COMPANY", label: "اجرا در شرکت" },
                  ]}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(selections).map(([kind, isSelected]) => (
                <ErpCard key={kind} className="space-y-3 p-3">
                  <ErpCheckbox
                    checked={isSelected}
                    onChange={(event) => setSelections({ ...selections, [kind]: event.target.checked })}
                    label={formalAssessmentLabels[kind]}
                  />
                  {activePlan && isSelected && (
                    <ErpCheckbox
                      checked={repeatKinds.includes(kind)}
                      onChange={(event) => setRepeatKinds(event.target.checked ? [...repeatKinds, kind] : repeatKinds.filter((item) => item !== kind))}
                      label="تکرار و ایجاد نسخه نتیجه جدید"
                    />
                  )}
                </ErpCard>
              ))}
              </div>
            </div>
          )}
          <ErpTextarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={activePlan ? "دلیل بازنگری برنامه (الزامی)" : "توضیح تصمیم (اختیاری)"}
          />
          <ErpButton
            label={activePlan ? "ثبت نسخه جدید برنامه" : "نهایی‌سازی برنامه ارزیابی"}
            tone="success"
            disabled={busy || (!explicitlyNoAssessment && selected.length === 0) || Boolean(activePlan && !reason.trim())}
            onClick={() => run(() => hiringAPI.createFormalAssessmentPlan(applicationId, {
              explicitlyNoAssessment,
              executionMethod,
              selections: selected.map(([assessmentKind]) => ({
                assessmentKind,
                executionMethod,
              })),
              repeatKinds,
              reason,
            }), "نسخه برنامه ارزیابی رسمی ثبت شد.")}
          />
        </ErpCard>
      )}

      <div className="mt-4 space-y-3">
        {!activePlan && <ErpCard className="p-4 text-sm text-[var(--sds-warning)]">تصمیم ارزیابی رسمی هنوز ثبت نشده است.</ErpCard>}
        {plans.map((plan: any) => (
          <ErpCard key={plan.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>نسخه {plan.version.toLocaleString("fa-IR")}</b>
              <ErpBadge tone={plan.status === "ACTIVE" ? "success" : "neutral"}>{plan.status === "ACTIVE" ? "جاری" : "جایگزین‌شده"}</ErpBadge>
            </div>
            <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
              {plan.explicitlyNoAssessment
                ? "بدون ارزیابی رسمی"
                : plan.selections.filter((item: any) => item.selected).map((item: any) =>
                  `${formalAssessmentLabels[item.assessmentKind]} · ${item.executionMethod === "APPLICANT" ? "تکمیل توسط متقاضی" : "اجرا در شرکت"}`
                ).join("، ")}
            </p>
            {plan.reason && <p className="mt-2 text-xs text-[var(--sds-text-muted)]">دلیل: {plan.reason}</p>}
            {plan.status === "ACTIVE" && plan.selections.filter((item: any) => item.selected).map((selection: any) => {
              const results = resultsForKind(selection.assessmentKind);
              const latest = latestValidResultForKind(selection.assessmentKind);
              const pending = results.find((result: any) => result.status === "PENDING");
              const maySubmit = canRecord && selection.executionMethod === "COMPANY";
              const resultValidation = Object.fromEntries(
                formalAssessmentFields[selection.assessmentKind].map(({ key }) => [
                  key,
                  parseLocalizedAssessmentScore(resultDrafts[selection.assessmentKind]?.[key]),
                ]),
              );
              return (
                <div key={selection.assessmentKind} className="mt-3 rounded-xl border border-[var(--sds-border-default)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <b>{formalAssessmentLabels[selection.assessmentKind]}</b>
                    <ErpBadge tone={pending ? "warning" : latest ? "success" : "warning"}>{pending ? (selection.executionMethod === "APPLICANT" ? "نسخه جدید در انتظار متقاضی" : "نسخه جدید در انتظار ثبت شرکت") : latest ? `تکمیل‌شده · نسخه ${latest.resultVersion}` : selection.executionMethod === "APPLICANT" ? "در انتظار متقاضی" : "در انتظار ثبت شرکت"}</ErpBadge>
                  </div>
                  {latest?.status === "COMPLETED" && (
                    <ErpCard className="mt-3 space-y-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <b>آخرین نتیجهٔ معتبر · نسخه {latest.resultVersion}</b>
                        {results.length > 1 && <ErpButton label={`تاریخچه نسخه‌ها (${results.length})`} variant="ghost" onClick={() => setHistoryKind(selection.assessmentKind)} />}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(latest.resultJson || {}).map(([key, value]) => <Metric key={key} label={formalAssessmentFields[selection.assessmentKind]?.find((field) => field.key === key)?.label || key} value={String(value)} />)}
                      </div>
                      {latest.resultExplanation && <p className="text-sm text-[var(--sds-text-secondary)]"><b>توضیحات: </b>{latest.resultExplanation}</p>}
                      {latest.attempts?.flatMap((attempt: any) => attempt.evidenceLinks || []).map((link: any) => link.hiringDocument && (
                        <ErpButton key={link.id} label={`دریافت ${link.hiringDocument.originalName}`} variant="ghost" onClick={() => void downloadFormalEvidence(link)} />
                      ))}
                    </ErpCard>
                  )}
                  {maySubmit && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {formalAssessmentFields[selection.assessmentKind].map((item) => (
                        <label key={item.key} className="space-y-1">
                          <ErpInput
                            inputMode="decimal"
                            value={resultDrafts[selection.assessmentKind]?.[item.key] || ""}
                            onChange={(event) => setResultDrafts({
                              ...resultDrafts,
                              [selection.assessmentKind]: {
                                ...(resultDrafts[selection.assessmentKind] || {}),
                                [item.key]: normalizeNumericText(event.target.value, 2),
                              },
                            })}
                            placeholder={`${item.label} · ۰ تا ۱۰۰`}
                            aria-label={`امتیاز ${item.label}`}
                          />
                          {resultDrafts[selection.assessmentKind]?.[item.key] !== undefined && resultValidation[item.key]?.error && (
                            <span className="text-xs text-[var(--sds-danger)]">{resultValidation[item.key].error}</span>
                          )}
                        </label>
                      ))}
                      {latest && canRecord && (
                        <ErpInput
                          value={correctionReasons[selection.assessmentKind] || ""}
                          onChange={(event) => setCorrectionReasons({ ...correctionReasons, [selection.assessmentKind]: event.target.value })}
                          placeholder="دلیل نسخه اصلاحی"
                        />
                      )}
                      <ErpTextarea
                        className="md:col-span-2"
                        value={resultExplanations[selection.assessmentKind] || ""}
                        onChange={(event) => setResultExplanations({ ...resultExplanations, [selection.assessmentKind]: event.target.value })}
                        placeholder="توضیحات و جمع‌بندی نتیجه (اختیاری)"
                      />
                      <label className="space-y-1 text-sm font-semibold md:col-span-2">
                        <span>نمودارها و گزارش‌ها (اختیاری، حداکثر ۵ فایل)</span>
                        <ErpInput
                          type="file"
                          multiple
                          accept="image/png,image/jpeg,image/webp,application/pdf"
                          onChange={(event) => setResultFiles({
                            ...resultFiles,
                            [selection.assessmentKind]: Array.from(event.target.files || []).slice(0, 5),
                          })}
                        />
                      </label>
                      <ErpButton
                        label={latest ? "ثبت نسخه اصلاحی" : "ثبت نتیجه"}
                        disabled={busy || !formalAssessmentFields[selection.assessmentKind].every(({ key }) => resultValidation[key]?.value !== undefined) || Boolean(latest && !pending && !(correctionReasons[selection.assessmentKind] || "").trim())}
                        onClick={() => run(async () => {
                          await hiringAPI.recordFormalAssessmentResult(applicationId, selection.assessmentKind, {
                            result: Object.fromEntries(formalAssessmentFields[selection.assessmentKind].map(({ key }) => [key, resultValidation[key].value])),
                            explanation: resultExplanations[selection.assessmentKind] || "",
                            correctionReason: correctionReasons[selection.assessmentKind] || "",
                          });
                          if (resultFiles[selection.assessmentKind]?.length) {
                            await hiringAPI.uploadFormalAssessmentEvidence(applicationId, selection.assessmentKind, resultFiles[selection.assessmentKind]);
                          }
                        }, "نسخه نتیجه ارزیابی ثبت شد.")}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </ErpCard>
        ))}
      </div>
      {(["DISC", "EQ", "BIG_FIVE"] as const).some((kind) => resultsForKind(kind).length > 0) && (
        <ErpCard className="mt-4 flex flex-wrap items-center gap-2 p-4">
          <b className="w-full">تاریخچه نتایج رسمی</b>
          {(["DISC", "EQ", "BIG_FIVE"] as const).filter((kind) => resultsForKind(kind).length > 0).map((kind) => (
            <ErpButton key={kind} label={`${formalAssessmentLabels[kind]} · ${resultsForKind(kind).length.toLocaleString("fa-IR")} نسخه`} variant="ghost" onClick={() => setHistoryKind(kind)} />
          ))}
        </ErpCard>
      )}
      <ErpSheet open={Boolean(historyKind)} onClose={() => setHistoryKind(null)} title={`تاریخچه ${historyKind ? formalAssessmentLabels[historyKind] : "ارزیابی"}`} presentation="modal">
        <div className="space-y-3 p-4">
          {historyKind && resultsForKind(historyKind).map((result: any) => (
            <ErpCard key={result.id} className="p-3">
              <div className="flex items-center justify-between gap-2"><b>نسخه {result.resultVersion}</b><ErpBadge tone={isKindActive(historyKind) && latestValidResultForKind(historyKind)?.id === result.id ? "success" : "neutral"}>{isKindActive(historyKind) && latestValidResultForKind(historyKind)?.id === result.id ? "نتیجه جاری" : "سابقه قدیمی"}</ErpBadge></div>
              {result.status === "COMPLETED" ? <><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(result.resultJson || {}).map(([key, value]) => <Metric key={key} label={formalAssessmentFields[historyKind]?.find((field) => field.key === key)?.label || key} value={String(value)} />)}</div>{result.resultExplanation && <p className="mt-2 text-sm"><b>توضیحات: </b>{result.resultExplanation}</p>}{result.correctionReason && <p className="mt-1 text-xs text-[var(--sds-text-muted)]"><b>دلیل نسخه اصلاحی: </b>{result.correctionReason}</p>}{result.attempts?.flatMap((attempt: any) => attempt.evidenceLinks || []).map((link: any) => link.hiringDocument && <ErpButton key={link.id} label={`دریافت ${link.hiringDocument.originalName}`} variant="ghost" onClick={() => void downloadFormalEvidence(link)} />)}</> : <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">نتیجه این نسخه تکمیل نشده است.</p>}
            </ErpCard>
          ))}
        </div>
      </ErpSheet>
    </ErpSection>
  );
}

function AssessmentDecisionPanel({
  applicationId,
  currentDecision,
  busy,
  run,
}: {
  applicationId: string;
  currentDecision?: string;
  busy: boolean;
  run: CaseActionRunner;
}) {
  const [decision, setDecision] = useState("APPROVED");
  const [reason, setReason] = useState("");
  const [dueAt, setDueAt] = useState("");
  return (
    <div className="mt-4 grid gap-2 rounded-xl border p-3 md:grid-cols-3">
      <div className="md:col-span-3">
        <b>تصمیم مدیریت شرکت</b>
        {currentDecision && (
          <span className="mr-2 text-xs text-[var(--sds-text-secondary)]">
            وضعیت فعلی: {hrDisplayLabel(currentDecision)}
          </span>
        )}
      </div>
      <ErpSelect
        value={decision}
        onChange={(event) => setDecision(event.target.value)}
      >
        <option value="APPROVED">تأیید و تکمیل خودکار مرحله</option>
        <option value="REPEAT_REQUIRED">تکرار ارزیابی</option>
        <option value="RESERVE">رد/ذخیره</option>
        <option value="REJECTED">رد نهایی</option>
      </ErpSelect>
      <ErpInput
        placeholder={decision === "APPROVED" ? "توضیح اختیاری" : "دلیل الزامی"}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {decision === "REPEAT_REQUIRED" && (
        <HrPersianCalendar value={dueAt} onChange={setDueAt} showTime disablePastDates />
      )}
      <ErpButton
        label="ثبت تصمیم ارزیابی"
        tone="success"
        disabled={busy || (decision !== "APPROVED" && !reason.trim())}
        onClick={() =>
          run(
            () =>
              hiringAPI.decideAssessment(applicationId, {
                decision,
                reason,
                dueAt: dueAt ? toIsoDateTime(dueAt) : undefined,
              }),
            "تصمیم مدیریت شرکت درباره ارزیابی ثبت شد.",
          )
        }
      />
    </div>
  );
}

function CollateralRequirementPanel({
  applicationId,
  current,
  busy,
  run,
}: {
  applicationId: string;
  current?: any;
  busy: boolean;
  run: CaseActionRunner;
}) {
  const [draft, setDraft] = useState({
    type: current?.type || "PROMISSORY_NOTE",
    amountRials: current?.amountRials || "",
    dueTiming: current?.dueTiming || "",
    candidateExplanation: current?.candidateExplanation || "",
  });
  return (
    <ErpCard className="mb-4 space-y-3 p-4">
      <div>
        <b>الزام وثیقه پیشنهادی مدیریت شرکت</b>
        {current && (
          <p className="text-xs text-[var(--sds-text-secondary)]">
            نسخه فعال {current.version.toLocaleString("fa-IR")}
          </p>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <ErpSelect
          value={draft.type}
          onChange={(event) => setDraft({ ...draft, type: event.target.value })}
        >
          <option value="PROMISSORY_NOTE">سفته</option>
          <option value="CHEQUE">چک ضمانت</option>
          <option value="GUARANTEE">ضامن</option>
          <option value="UNDERTAKING">تعهدنامه</option>
          <option value="OTHER">سایر</option>
        </ErpSelect>
        <ErpRialInput
          aria-label="مبلغ وثیقه پیشنهادی به ریال"
          placeholder="مبلغ (ریال)"
          value={draft.amountRials}
          onValueChange={(amountRials) => setDraft({ ...draft, amountRials })}
        />
      </div>
      <p className="text-sm text-[var(--sds-text-secondary)]">
        متن اطلاع‌رسانی متقاضی پس از ثبت، به‌صورت خودکار از نوع وثیقه و مبلغ ساخته می‌شود.
      </p>
      <ErpButton
        label={current ? "ثبت نسخه جدید الزام وثیقه" : "ثبت الزام وثیقه"}
        disabled={busy}
        onClick={() =>
          run(
            () => hiringAPI.addCollateralRequirement(applicationId, draft),
            current
              ? "نسخه جدید الزام وثیقه ثبت شد؛ پیشنهاد باید دوباره پذیرفته شود."
              : "الزام وثیقه ثبت شد.",
          )
        }
      />
      <ErpButton
        label="وثیقه پیش از استخدام لازم نیست"
        variant="soft"
        disabled={busy || current?.type === "NO_PRE_HIRE_COLLATERAL"}
        onClick={() =>
          run(
            () => hiringAPI.markCollateralNotRequired(applicationId),
            "تصمیم «وثیقه لازم نیست» به‌صورت نسخه‌شده ثبت شد.",
          )
        }
      />
    </ErpCard>
  );
}

function CaseRecoveryPanel({
  application,
  actionPermissions,
  applicationId,
  busy,
  run,
}: {
  application: any;
  actionPermissions: string[];
  applicationId: string;
  busy: boolean;
  run: CaseActionRunner;
}) {
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState({ method: "PHONE", at: "", note: "" });
  const hasAction = (...values: string[]) =>
    values.some((value) => actionPermissions.includes(value));
  const authorized = (application.reopenings || []).some(
    (item: any) => item.status === "AUTHORIZED",
  );
  if (application.disposition) {
    const canReactivate =
      (application.disposition === "INITIAL_REJECTED" && hasAction("RECORD_PRELIMINARY_DECISION")) ||
      (application.disposition === "RESERVE" && hasAction("RECORD_FINAL_MANAGEMENT_DECISION"));
    return (
      <ErpSection title="فعال‌سازی مجدد پرونده متوقف‌شده">
        <ErpCard className="grid gap-2 p-4 md:grid-cols-3">
          <p className="text-sm">
            برچسب فعلی: {hrDisplayLabel(application.disposition)}
          </p>
          <ErpInput
            placeholder="دلیل فعال‌سازی مجدد"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {canReactivate && (
            <ErpButton
              label="فعال‌سازی مجدد"
              disabled={busy || !reason.trim()}
              onClick={() =>
                run(
                  () => hiringAPI.reactivateDisposition(applicationId, reason),
                  "پرونده در همان مرحله دوباره فعال شد.",
                )
              }
            />
          )}
        </ErpCard>
      </ErpSection>
    );
  }
  return (
    <ErpSection
      title="بازگشایی پرونده بسته"
      description="پرونده استخدام‌شده هرگز بازگشایی نمی‌شود؛ استخدام قبلی یا لغوشده باید Application جدید بگیرد."
    >
      <ErpCard className="grid gap-2 p-4 md:grid-cols-3">
        <ErpInput
          placeholder="دلیل بازگشایی"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {hasAction("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") && !authorized && (
          <ErpButton
            label="صدور مجوز مدیریت شرکت"
            disabled={busy || !reason.trim()}
            onClick={() =>
              run(
                () => hiringAPI.authorizeReopening(applicationId, reason),
                "مجوز بازگشایی صادر شد.",
              )
            }
          />
        )}
        {application.outcome === "WITHDRAWN" &&
          hasAction("MANAGE_RECRUITMENT_CASE") &&
          authorized && (
            <>
              <ErpSelect
                value={consent.method}
                onChange={(event) =>
                  setConsent({ ...consent, method: event.target.value })
                }
              >
                <option value="PHONE">رضایت تلفنی</option>
                <option value="IN_PERSON">رضایت حضوری</option>
              </ErpSelect>
              <HrPersianCalendar value={consent.at} onChange={(at) => setConsent({ ...consent, at })} showTime />
              <ErpInput
                placeholder="شرح رضایت جدید متقاضی"
                value={consent.note}
                onChange={(event) =>
                  setConsent({ ...consent, note: event.target.value })
                }
              />
            </>
          )}
        {hasAction("MANAGE_RECRUITMENT_CASE") && authorized && (
          <ErpButton
            label="اجرای بازگشایی توسط مدیر HR"
            tone="success"
            disabled={
              busy ||
              !reason.trim() ||
              (application.outcome === "WITHDRAWN" &&
                (!consent.at || !consent.note.trim()))
            }
            onClick={() =>
              run(
                () =>
                  hiringAPI.executeReopening(applicationId, {
                    reason,
                    candidateConsentMethod:
                      application.outcome === "WITHDRAWN"
                        ? consent.method
                        : undefined,
                    candidateConsentedAt:
                      application.outcome === "WITHDRAWN"
                        ? toIsoDateTime(consent.at)
                        : undefined,
                    candidateConsentNote:
                      application.outcome === "WITHDRAWN"
                        ? consent.note
                        : undefined,
                  }),
                "پرونده با حفظ شواهد در آخرین مرحله پیش از بسته‌شدن بازگشایی شد.",
              )
            }
          />
        )}
      </ErpCard>
    </ErpSection>
  );
}
