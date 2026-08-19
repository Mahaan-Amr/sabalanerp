"use client";
import {
  ErpInput,
  ErpCheckbox,
  ErpField,
  ErpInlineState,
  ErpPressable,
  ErpSegmentedControl,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { useCallback, useEffect, useState } from "react";
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
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSheet,
} from "@/components/erp";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { HiringLifecycle } from "@/features/hr-hiring/HiringLifecycle";
import {
  hiringTaskDetailVisible,
  resolveSelectedHiringPhase,
} from "@/features/hr-hiring/hiringLifecycleViewModel";
import { insuranceSubmissionBlocker } from "@/features/hr-hiring/insuranceViewModel";
import { parseLocalizedAssessmentScore } from "@/features/hr-hiring/assessmentScore";
import { ApplicantCaseOverview } from "@/features/hr-hiring/ApplicantCaseOverview";
import { ProductionHrInterview, ProductionInterviewReport, type ProductionInterviewPayload } from "@/features/hr-hiring/prototype/HrInterviewPrototype";
import { FinalHiringRejection } from "@/features/hr-hiring/FinalHiringRejection";
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
  hrDisplayLabel,
} from "@/features/hr/hrDisplay";

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
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<any>(null);
  const [retentionTarget, setRetentionTarget] = useState<any>(null);
  const [actionPermissions, setActionPermissions] = useState<string[]>([]);
  const [correctionExplanations, setCorrectionExplanations] = useState<
    Record<string, string>
  >({});
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
    { label: "مزایای ثابت", category: "FIXED_BENEFIT", amountRials: "" },
  ]);
  const [collateral, setCollateral] = useState<any>({
    itemId: "",
    type: "PROMISSORY_NOTE",
    amountRials: "",
    identifier: "",
    issuerOrGuarantor: "",
    custodyLocation: "",
    receivedAt: "",
    file: null,
  });
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState("");
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
    communicatedAt: "",
    offlineReason: "",
    confirmedCandidateInformation: "",
    note: "",
  });
  const [handover, setHandover] = useState({
    returnedTo: "",
    returnEvidenceNote: "",
    file: null as File | null,
  });
  const [collateralIssue, setCollateralIssue] = useState("");
  const [closure, setClosure] = useState({ outcome: "REJECTED", reason: "" });
  const [task, setTask] = useState({
    title: "",
    ownerAuthority: "HR_MANAGER",
    dueDate: "",
    activationBlocker: false,
    assignToHire: true,
  });
  const [conversion, setConversion] = useState({
    scheduledStartDate: "",
  });
  const [contract, setContract] = useState<any>({
    contractNumber: "",
    effectiveFrom: "",
    effectiveTo: "",
    file: null,
  });
  const [contractReturnReason, setContractReturnReason] = useState("");
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
    void hiringAPI
      .collateralTemplates()
      .then((result) => {
        setTemplates(result.data.data);
        setTemplateId(result.data.data[0]?.id || "");
      })
      .catch(() => undefined);
    // `load` intentionally follows the route id; recreating it is harmless but would retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async (
    action: () => Promise<any>,
    success: string,
    options: CaseActionOptions = {},
  ) => {
    const { propagateActionError = false, awaitRefresh = true } = options;
    try {
      setBusy(true);
      setError("");
      await action();
    } catch (e) {
      if (propagateActionError) throw e;
      setError(hiringError(e));
      return;
    } finally {
      setBusy(false);
    }
    setMessage(success);
    if (awaitRefresh) await load();
    else void load();
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
  const hasActionPermission = (...values: string[]) =>
    !data.readOnlyArchived && values.some((value) => actionPermissions.includes(value));
  const canHrSensitive = hasActionPermission("MANAGE_RECRUITMENT_CASE");
  const canCompanyManager = hasActionPermission("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS", "MANAGE_COMPANY_EVALUATION_PLAN", "RECORD_FINAL_MANAGEMENT_DECISION");
  const canFinallyReject = hasActionPermission("RECORD_PRELIMINARY_DECISION", "RECORD_FINAL_MANAGEMENT_DECISION");
  const canFinance = hasActionPermission("MANAGE_FINANCE_EVIDENCE");
  const canViewContractTask = hiringTaskDetailVisible(
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
  const selectedLifecyclePhase = data.lifecycle
    ? resolveSelectedHiringPhase(data.lifecycle, searchParams.get("phase"))
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
    components.length > 0 &&
    components.every(
      (item) =>
        Boolean(item.category) &&
        /^\d+$/.test(String(item.amountRials || "")) &&
        (item.category !== "OTHER" || Boolean(item.label.trim())),
    );
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
  const addCollateral = () => {
    const fd = new FormData();
    Object.entries(collateral).forEach(([key, value]) => {
      if (key !== "file" && value != null) {
        fd.append(
          key,
          key === "receivedAt" ? toIsoDate(String(value)) : String(value),
        );
      }
    });
    if (collateral.file) fd.append("file", collateral.file);
    return run(() => hiringAPI.addCollateral(id, fd), "وثیقه ثبت شد.");
  };
  const returnCollateral = (itemId: string) => {
    const fd = new FormData();
    fd.append("returnedTo", handover.returnedTo);
    fd.append("returnEvidenceNote", handover.returnEvidenceNote);
    if (handover.file) fd.append("file", handover.file);
    return hiringAPI.returnCollateral(id, itemId, fd);
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
      ).then(() => setEditingAssessmentId(""));
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
      {(canHrSensitive || canCompanyManager || canFinance) && (
        <ErpSection
          title="فهرست اسناد و فایل‌های پرونده"
          description="دسترسی هر فایل بر اساس مسئولیت سازمانی شما کنترل و ثبت می‌شود."
        >
          <div className="space-y-2">
            {(data.documentIndex || []).length === 0 && (
              <ErpCard className="p-4 text-sm text-[var(--sds-text-secondary)]">
                هنوز سند یا فایل قابل نمایش برای این پرونده ثبت نشده است.
              </ErpCard>
            )}
            {(data.documentIndex || []).map((item: any) => (
              <ErpCard
                key={`${item.category}-${item.id}-${item.version}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-bold">{item.title}</p>
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                    {item.safeOwner} · نسخه {item.version} ·{" "}
                    {hrDisplayLabel(item.reviewStatus)}
                  </p>
                  {!item.restricted && (
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                      {item.originalName || "بدون فایل پیوست"} ·{" "}
                      {dateTimeFa(item.date)}
                    </p>
                  )}
                </div>
                {item.canOpen ? (
                  <ErpPressable
                    type="submit"
                    className="rounded-lg border px-3 py-2 text-sm"
                    onClick={() => downloadIndexedEvidence(item)}
                  >
                    دریافت فایل
                  </ErpPressable>
                ) : (
                  <span className="rounded-lg bg-[var(--sds-surface-subtle)] px-3 py-2 text-xs dark:bg-[var(--sds-surface-raised)]">
                    جزئیات برای نقش شما محدود است
                  </span>
                )}
              </ErpCard>
            ))}
          </div>
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
        (canHrSensitive || canCompanyManager) && (
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
      {canFinallyReject && data.stage !== "CLOSED" && !data.convertedAt && data.outcome !== "HIRED" && (
        <FinalHiringRejection
          applicationId={id}
          plans={data.formalAssessmentPlans || []}
          busy={busy}
          run={run}
        />
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
                    onClick={() =>
                      run(
                        () => hiringAPI.invite(id),
                        "OTP جدید ارسال شد؛ OTP قبلی تا اولین استفاده موفق از کد جدید، پایان اعتبار خودش یا ۳۰ دقیقه موقتاً معتبر می‌ماند.",
                      )
                    }
                  />
                </div>
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
                  {hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
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
                          <ErpBadge>{hrDisplayLabel(doc.status)}</ErpBadge>
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
                        <div
                          key={key}
                          className="flex items-center justify-between rounded-lg border p-2 text-sm"
                        >
                          <span>{identityFieldLabels[key]}</span>
                          <div className="flex gap-1">
                            {hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
                              <>
                                <ErpPressable
                                  type="submit"
                                  onClick={() =>
                                    run(
                                      () =>
                                        hiringAPI.setIdentityCheck(id, key, {
                                          status: "VERIFIED",
                                        }),
                                      `${identityFieldLabels[key]} تأیید شد.`,
                                    )
                                  }
                                  className="rounded bg-[var(--sds-success-surface)] px-2 py-1"
                                >
                                  مطابق
                                </ErpPressable>
                                <ErpPressable
                                  type="submit"
                                  onClick={() =>
                                    run(
                                      () =>
                                        hiringAPI.setIdentityCheck(id, key, {
                                          status: "MISMATCH",
                                          note: "نیازمند اصلاح متقاضی",
                                        }),
                                      `${identityFieldLabels[key]} مغایر ثبت شد.`,
                                    )
                                  }
                                  className="rounded bg-[var(--sds-danger-surface)] px-2 py-1"
                                >
                                  مغایرت
                                </ErpPressable>
                                {[
                                  "militaryStatus",
                                  "birthCertificateExplanations",
                                ].includes(key) && (
                                  <ErpPressable
                                    type="submit"
                                    onClick={() =>
                                      run(
                                        () =>
                                          hiringAPI.setIdentityCheck(id, key, {
                                            status: "NOT_APPLICABLE",
                                          }),
                                        `${identityFieldLabels[key]} غیرقابل اعمال ثبت شد.`,
                                      )
                                    }
                                    className="rounded bg-[var(--sds-surface-subtle)] px-2 py-1"
                                  >
                                    ندارد/نامرتبط
                                  </ErpPressable>
                                )}
                              </>
                            )}
                            <small>
                              {check?.status === "VERIFIED"
                                ? "مطابق"
                                : check?.status === "MISMATCH"
                                  ? "مغایرت"
                                  : check?.status === "UNREADABLE"
                                    ? "ناخوانا"
                                    : check?.status === "NOT_APPLICABLE"
                                      ? "نامرتبط"
                                      : "بررسی‌نشده"}
                            </small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {hasActionPermission("MANAGE_RECRUITMENT_CASE") &&
                    data.identityChecks.some((check: any) =>
                      ["MISMATCH", "UNREADABLE"].includes(check.status),
                    ) && (
                      <ErpCard className="mt-4 p-3">
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
                      </ErpCard>
                    )}
                  {hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
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
            <ErpSection title="ارزیابی‌های DISC / BIG FIVE / EQ">
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
                                  [key]: e.target.value,
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
                        {assessmentTypeLabel(item.assessmentType)} · نسخه{" "}
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
          "MANAGE_FINANCE_EVIDENCE",
          "MANAGE_RECRUITMENT_CASE",
        ) && (
          <>
            <ErpSection title="پیشنهاد حقوق و مزایا">
              {hasActionPermission("MANAGE_PRE_EMPLOYMENT_REQUIREMENTS") && (
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
                      <ErpInput
                        inputMode="numeric"
                        placeholder="مبلغ ریال"
                        value={item.amountRials}
                        onChange={(e) =>
                          setComponents(
                            components.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    amountRials: e.target.value.replace(
                                      /\D/g,
                                      "",
                                    ),
                                  }
                                : x,
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
                  {hasActionPermission("MANAGE_PAYROLL") && (
                    <ErpButton
                      label="آماده‌سازی منابع انسانی و حقوق و دستمزد"
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.prepareCompensation(id, compensation.id, {
                              components,
                            }),
                          "نسخه توسط کارشناس حقوق و دستمزد آماده شد.",
                        )
                      }
                      disabled={busy || !compensation || !compensationRowsValid}
                    />
                  )}
                  {hasActionPermission("MANAGE_PAYROLL") && (
                    <ErpButton
                      label="تأیید مدیر حقوق و دستمزد"
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.approveCompensationHr(
                              id,
                              compensation.id,
                            ),
                          "تأیید منابع انسانی انجام شد.",
                        )
                      }
                      disabled={busy || !compensation}
                      tone="success"
                    />
                  )}
                  {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
                    <ErpButton
                      label="تأیید مدیر مالی"
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.approveCompensationFinance(
                              id,
                              compensation.id,
                            ),
                          "تأیید مالی انجام شد.",
                        )
                      }
                      disabled={busy || !compensation}
                      tone="success"
                    />
                  )}
                </div>
                {compensation && (
                  <>
                    <p className="mt-3 font-black">
                      جمع:{" "}
                      {Number(compensation.totalRials).toLocaleString("fa-IR")}{" "}
                      ریال
                    </p>
                    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                      {[
                        {
                          title: "ثبت پیشنهاد",
                          role: "مدیریت شرکت",
                          actor: compensation.proposedBy,
                          at: compensation.createdAt,
                        },
                        {
                          title: "آماده‌سازی حقوق و مزایا",
                          role: "کارشناس حقوق و دستمزد",
                          actor: compensation.preparedBy,
                          at: compensation.preparedAt,
                        },
                        {
                          title: "تأیید منابع انسانی و حقوق",
                          role: "مدیر حقوق و دستمزد",
                          actor: compensation.hrApprovedBy,
                          at: compensation.hrApprovedAt,
                        },
                        {
                          title: "تأیید مالی",
                          role: "مدیر امور مالی",
                          actor: compensation.financeApprovedBy,
                          at: compensation.financeApprovedAt,
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
                      compensation.hrApprovedAt &&
                      compensation.financeApprovedAt &&
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
                          <ErpField label="زمان اعلام تصمیم متقاضی" required>
                            <HrPersianCalendar
                              showTime
                              value={offlineDecision.communicatedAt}
                              onChange={(communicatedAt) =>
                                setOfflineDecision({
                                  ...offlineDecision,
                                  communicatedAt,
                                })
                              }
                            />
                          </ErpField>
                          {[
                            ["offlineReason", "دلیل استفاده از مسیر آفلاین"],
                            [
                              "confirmedCandidateInformation",
                              "نام کامل متقاضی که تأیید شد",
                            ],
                            ["note", "شرح گفت‌وگو و تصمیم"],
                          ].map(([key, placeholder]) => (
                            <ErpInput
                              key={key}
                              placeholder={placeholder}
                              value={(offlineDecision as any)[key]}
                              onChange={(event) =>
                                setOfflineDecision({
                                  ...offlineDecision,
                                  [key]: event.target.value,
                                })
                              }
                            />
                          ))}
                          <ErpButton
                            label="ثبت نهایی تصمیم آفلاین"
                            disabled={
                              busy ||
                              !offlineDecision.communicatedAt ||
                              !offlineDecision.offlineReason.trim() ||
                              !offlineDecision.confirmedCandidateInformation.trim() ||
                              !offlineDecision.note.trim()
                            }
                            onClick={() =>
                              run(
                                () =>
                                  hiringAPI.recordOfflineOfferDecision(
                                    id,
                                    compensation.id,
                                    {
                                      ...offlineDecision,
                                      communicatedAt: toIsoDateTime(
                                        offlineDecision.communicatedAt,
                                      ),
                                    },
                                  ),
                                "تصمیم آفلاین متقاضی با سابقه حسابرسی ثبت شد.",
                              )
                            }
                            tone="warning"
                          />
                        </div>
                      )}
                  </>
                )}
              </ErpCard>
            </ErpSection>
          </>
        )}
      {selectedLifecyclePhase === "CONVERSION" && canFinance && (
        <>
          <ErpSection title="وثیقه و تعهدات امور مالی">
            {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
              <ErpCard className="mb-4 grid gap-2 p-4 md:grid-cols-3">
                <ErpSelect
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">انتخاب قالب چک‌لیست</option>
                  {templates
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · نسخه {item.version}
                      </option>
                    ))}
                </ErpSelect>
                <ErpButton
                  label="اعمال قالب پس از پذیرش پیشنهاد"
                  disabled={
                    !templateId || busy || data.collateralItems.length > 0
                  }
                  onClick={() =>
                    run(
                      () => hiringAPI.applyCollateralTemplate(id, templateId),
                      "چک‌لیست وثیقه ایجاد شد.",
                    )
                  }
                />
              </ErpCard>
            )}
            <div className="grid gap-4 xl:grid-cols-2">
              {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
                <ErpCard className="grid gap-2 p-4 md:grid-cols-2">
                  <ErpSelect
                    value={collateral.type}
                    onChange={(e) =>
                      setCollateral({ ...collateral, type: e.target.value })
                    }
                  >
                    <option value="PROMISSORY_NOTE">سفته</option>
                    <option value="CHEQUE">چک</option>
                    <option value="GUARANTEE">ضمانت‌نامه</option>
                    <option value="UNDERTAKING">تعهدنامه</option>
                    <option value="OTHER">سایر</option>
                  </ErpSelect>
                  <ErpInput
                    placeholder="مبلغ ریال"
                    value={collateral.amountRials}
                    onChange={(e) =>
                      setCollateral({
                        ...collateral,
                        amountRials: e.target.value.replace(/\D/g, ""),
                      })
                    }
                  />
                  <ErpInput
                    placeholder="شناسه/سریال"
                    value={collateral.identifier}
                    onChange={(e) =>
                      setCollateral({
                        ...collateral,
                        identifier: e.target.value,
                      })
                    }
                  />
                  <ErpInput
                    placeholder="صادرکننده/ضامن"
                    value={collateral.issuerOrGuarantor}
                    onChange={(e) =>
                      setCollateral({
                        ...collateral,
                        issuerOrGuarantor: e.target.value,
                      })
                    }
                  />
                  <ErpInput
                    placeholder="محل نگهداری اصل"
                    value={collateral.custodyLocation}
                    onChange={(e) =>
                      setCollateral({
                        ...collateral,
                        custodyLocation: e.target.value,
                      })
                    }
                  />
                  <ErpField label="تاریخ دریافت وثیقه" required>
                    <HrPersianCalendar
                      value={collateral.receivedAt}
                      onChange={(receivedAt) =>
                        setCollateral({
                          ...collateral,
                          receivedAt,
                        })
                      }
                    />
                  </ErpField>
                  <ErpInput
                    type="file"
                    onChange={(e) =>
                      setCollateral({
                        ...collateral,
                        file: e.target.files?.[0],
                      })
                    }
                  />
                  <ErpButton
                    label="ثبت توسط امور مالی"
                    onClick={addCollateral}
                    disabled={
                      busy ||
                      !collateral.type ||
                      !collateral.file ||
                      !collateral.receivedAt ||
                      !collateral.custodyLocation
                    }
                  />
                </ErpCard>
              )}
              <ErpCard className="p-4">
                <div className="mb-3 grid gap-2 md:grid-cols-4">
                  <ErpInput
                    placeholder="دلیل هماهنگی قلم ناقص/ردشده"
                    value={collateralIssue}
                    onChange={(e) => setCollateralIssue(e.target.value)}
                  />
                  <ErpInput
                    placeholder="تحویل‌گیرنده اصل وثیقه"
                    value={handover.returnedTo}
                    onChange={(e) =>
                      setHandover({ ...handover, returnedTo: e.target.value })
                    }
                  />
                  <ErpInput
                    placeholder="مدرک/شرح تحویل"
                    value={handover.returnEvidenceNote}
                    onChange={(e) =>
                      setHandover({
                        ...handover,
                        returnEvidenceNote: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  {data.collateralItems.map((item: any) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex justify-between">
                        <b>{hrDisplayLabel(item.type)}</b>
                        <ErpBadge>{hrDisplayLabel(item.status)}</ErpBadge>
                      </div>
                      <p className="text-xs">
                        {item.identifier} · {item.custodyLocation}
                      </p>
                      {item.originalName && (
                        <ErpPressable
                          type="submit"
                          className="mt-2 rounded bg-[var(--sds-surface-subtle)] px-2 py-1 text-xs"
                          onClick={() =>
                            download(
                              () => hiringAPI.downloadCollateral(id, item.id),
                              item.originalName,
                            )
                          }
                        >
                          دریافت اسکن
                        </ErpPressable>
                      )}
                      {hasActionPermission("MANAGE_FINANCE_EVIDENCE") &&
                        ["MISSING", "MISMATCH", "UNREADABLE"].includes(
                          item.status,
                        ) && (
                          <ErpPressable
                            type="submit"
                            className="mt-2 rounded bg-[var(--sds-info-surface)] px-2 py-1 text-xs"
                            onClick={() =>
                              setCollateral({
                                ...collateral,
                                itemId: item.id,
                                type: item.type,
                                amountRials: item.amountRials || "",
                              })
                            }
                          >
                            {item.status === "MISSING"
                              ? "ثبت دریافت این قلم"
                              : "ثبت نسخه جایگزین"}
                          </ErpPressable>
                        )}
                      {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
                        <ErpPressable
                          type="submit"
                          className="mt-2 rounded bg-[var(--sds-success-surface)] px-2 py-1 text-xs"
                          onClick={() =>
                            run(
                              () =>
                                hiringAPI.reviewCollateral(id, item.id, {
                                  status: "VERIFIED",
                                }),
                              "قلم وثیقه تأیید شد.",
                            )
                          }
                        >
                          تأیید مدیر مالی
                        </ErpPressable>
                      )}
                      {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
                        <ErpPressable
                          type="submit"
                          className="mr-2 mt-2 rounded bg-[var(--sds-danger-surface)] px-2 py-1 text-xs"
                          disabled={!collateralIssue}
                          onClick={() =>
                            run(
                              () =>
                                hiringAPI.reviewCollateral(id, item.id, {
                                  status: "MISMATCH",
                                  coordinationReason: collateralIssue,
                                }),
                              "قلم برای پیگیری رد شد.",
                            )
                          }
                        >
                          نیازمند پیگیری
                        </ErpPressable>
                      )}
                      {(hasActionPermission("MANAGE_FINANCE_EVIDENCE") ||
                        hasActionPermission("MANAGE_FINANCE_EVIDENCE")) &&
                        item.receivedAt &&
                        !item.returnedAt && (
                          <ErpPressable
                            type="submit"
                            className="mr-2 mt-2 rounded bg-[var(--sds-warning-surface)] px-2 py-1 text-xs"
                            disabled={
                              !handover.returnedTo ||
                              !handover.returnEvidenceNote ||
                              !handover.file
                            }
                            onClick={() =>
                              run(
                                () => returnCollateral(item.id),
                                "بازگشت وثیقه ثبت شد.",
                              )
                            }
                          >
                            ثبت تحویل اصل
                          </ErpPressable>
                        )}
                      {hasActionPermission("MANAGE_FINANCE_EVIDENCE") &&
                        item.returnedAt &&
                        !item.returnConfirmedAt && (
                          <ErpPressable
                            type="submit"
                            className="mr-2 mt-2 rounded bg-[var(--sds-info-surface)] px-2 py-1 text-xs"
                            onClick={() =>
                              run(
                                () =>
                                  hiringAPI.confirmCollateralReturn(
                                    id,
                                    item.id,
                                  ),
                                "بازگشت توسط مدیر مالی تأیید شد.",
                              )
                            }
                          >
                            تأیید مدیر مالی بازگشت
                          </ErpPressable>
                        )}
                      {item.returnEvidenceOriginalName && (
                        <ErpPressable
                          type="submit"
                          className="mr-2 mt-2 rounded bg-[var(--sds-surface-subtle)] px-2 py-1 text-xs"
                          onClick={() =>
                            download(
                              () =>
                                hiringAPI.downloadCollateralReturnEvidence(
                                  id,
                                  item.id,
                                ),
                              item.returnEvidenceOriginalName,
                            )
                          }
                        >
                          دریافت مدرک تحویل
                        </ErpPressable>
                      )}
                    </div>
                  ))}
                </div>
                {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
                  <ErpButton
                    className="mt-3"
                    label="تأیید نهایی وثیقه"
                    onClick={() =>
                      run(
                        () => hiringAPI.approveCollateral(id),
                        "وثیقه نهایی تأیید شد.",
                      )
                    }
                    tone="success"
                  />
                )}
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
                  label="تبدیل متقاضی به پرسنل"
                  disabled={
                    busy || !conversion.scheduledStartDate || !!data.convertedAt
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
      {selectedLifecyclePhase === "ONBOARDING" && (
        <ErpSection
          title="وظایف موقت پیش از فعال‌سازی"
          description="وظیفه به پرسنل برنامه‌ریزی‌شده متصل می‌شود و هیچ کاربر یا شناسه ورود ایجاد نمی‌کند."
        >
          {hasActionPermission("MANAGE_RECRUITMENT_CASE") && (
            <ErpCard className="grid gap-2 p-4 md:grid-cols-4">
              <ErpInput
                placeholder="عنوان وظیفه"
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
              />
              <ErpSelect
                value={task.ownerAuthority}
                onChange={(e) =>
                  setTask({ ...task, ownerAuthority: e.target.value })
                }
              >
                <option value="HR_MANAGER">مدیر منابع انسانی</option>
                <option value="COMPANY_MANAGER">مدیریت شرکت</option>
                <option value="HR_PROCESSOR">کارشناس منابع انسانی</option>
                <option value="FINANCE_MANAGER">مدیر مالی</option>
              </ErpSelect>
              <ErpField label="مهلت انجام وظیفه" hint="اختیاری">
                <HrPersianCalendar
                  value={task.dueDate}
                  onChange={(dueDate) => setTask({ ...task, dueDate })}
                />
              </ErpField>
              <ErpButton
                label="واگذاری وظیفه"
                disabled={!task.title || !data.convertedAt}
                onClick={() =>
                  run(
                    () =>
                      hiringAPI.addOnboardingTask(id, {
                        ...task,
                        dueDate: toIsoDate(task.dueDate),
                      }),
                    "وظیفه به پرسنل برنامه‌ریزی‌شده واگذار شد.",
                  )
                }
              />
            </ErpCard>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(data.onboardingTasks || []).map((item: any) => (
              <ErpCard
                key={item.id}
                className="flex items-center justify-between p-3"
              >
                <span>
                  <b>{item.title}</b>
                  <small className="block text-[var(--sds-text-secondary)]">
                    {authorityLabel(item.ownerAuthority)} ·{" "}
                    {hrDisplayLabel(item.status)}
                  </small>
                </span>
                {item.status !== "COMPLETE" &&
                  hasActionPermission(({
                    HR_PROCESSOR: "MANAGE_RECRUITMENT_CASE",
                    HR_MANAGER: "MANAGE_RECRUITMENT_CASE",
                    COMPANY_MANAGER: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS",
                    HR_PAYROLL_PROCESSOR: "MANAGE_PAYROLL",
                    HR_PAYROLL_MANAGER: "MANAGE_PAYROLL",
                    FINANCE_RECORDER: "MANAGE_FINANCE_EVIDENCE",
                    FINANCE_MANAGER: "MANAGE_FINANCE_EVIDENCE",
                  } as Record<string, string>)[item.ownerAuthority] || item.ownerAuthority) && (
                    <ErpPressable
                      type="submit"
                      className="rounded bg-[var(--sds-success-surface)] px-2 py-1 text-xs"
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.updateOnboardingTask(id, item.id, {
                              status: "COMPLETE",
                              evidenceNote: "تکمیل و مشاهده شد",
                            }),
                          "وظیفه تکمیل شد.",
                        )
                      }
                    >
                      تکمیل
                    </ErpPressable>
                  )}
              </ErpCard>
            ))}
          </div>
        </ErpSection>
      )}
      {selectedLifecyclePhase === "ONBOARDING" && canViewContractTask && (
        <>
          <ErpSection title="قرارداد کاغذی">
            <div className="grid gap-3 md:grid-cols-4">
              {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && (
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
                </>
              )}
              {hasActionPermission("MANAGE_FINANCE_EVIDENCE") && latestContract?.canReview && (
                <div className="space-y-2 md:col-span-2">
                  <div className="flex flex-wrap gap-2">
                    <ErpButton
                      label="تأیید قرارداد"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.approveContract(id, latestContract.id),
                          "قرارداد تأیید شد.",
                        )
                      }
                      tone="success"
                    />
                  </div>
                  <ErpField label="دلیل بازگرداندن قرارداد">
                    <ErpTextarea
                      value={contractReturnReason}
                      onChange={(event) =>
                        setContractReturnReason(event.target.value)
                      }
                    />
                  </ErpField>
                  <ErpButton
                    label="بازگرداندن برای اصلاح"
                    disabled={busy || !contractReturnReason.trim()}
                    onClick={() =>
                      run(
                        () =>
                          hiringAPI.returnContract(
                            id,
                            latestContract.id,
                            contractReturnReason.trim(),
                          ),
                        "قرارداد برای اصلاح بازگردانده شد.",
                      )
                    }
                    tone="danger"
                  />
                </div>
              )}
              {latestContract && (
                <ErpCard className="p-3 text-sm md:col-span-2">
                  <p className="font-bold">وضعیت آخرین نسخه</p>
                  <p className="mt-1">
                    {{
                      DRAFT: "ثبت‌شده؛ در انتظار ارسال",
                      SUBMITTED: "ارسال‌شده؛ در انتظار بررسی مدیر مالی",
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
              title="بستن یا لغو پرونده"
              description="اطلاعات عادی در بانک متقاضیان قابل جست‌وجو می‌ماند؛ داده‌ها و اسناد حساس فقط تحت دسترسی محدود نگهداری می‌شوند."
            >
              <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
                <ErpField label="نتیجه بستن پرونده" required>
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
                  label="بستن پرونده توسط مدیر منابع انسانی"
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
        footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => { setAssessmentVoidTarget(null); setAssessmentVoidReason(""); }} /><ErpButton label="تأیید حذف" tone="danger" variant="solid" disabled={busy || !assessmentVoidReason.trim()} onClick={() => void run(() => hiringAPI.voidAssessment(id, assessmentVoidTarget.id, assessmentVoidReason.trim()), "ارزیابی با حفظ سابقه باطل شد.").then(() => { setAssessmentVoidTarget(null); setAssessmentVoidReason(""); })} /></div>}
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
) => Promise<void>;

type CaseActionOptions = {
  propagateActionError?: boolean;
  awaitRefresh?: boolean;
};

function CompanyEvaluationPlan({ applicationId, actionPermissions, busy, run, onPendingChange }: { applicationId: string; actionPermissions: string[]; busy: boolean; run: CaseActionRunner; onPendingChange: (pending: boolean) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [draft, setDraft] = useState({ type: "MANAGEMENT_INTERVIEW", subject: "", instructions: "", evidencePolicy: "EXPLANATION_REQUIRED" });
  const [results, setResults] = useState<Record<string, { effect: string; explanation: string; file?: File }>>({});
  const [cancelTarget, setCancelTarget] = useState<any>();
  const canPlan = actionPermissions.includes("MANAGE_COMPANY_EVALUATION_PLAN");
  const canResult = actionPermissions.includes("RECORD_COMPANY_EVALUATION_RESULT");
  const canViewResults = actionPermissions.includes("VIEW_COMPANY_EVALUATION_RESULTS");
  const downloadEvidence = async (item: any) => {
    const response = await hiringAPI.downloadCompanyEvaluationEvidence(applicationId, item.id);
    const href = URL.createObjectURL(response.data);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = item.resultOriginalName || "company-evaluation-evidence";
    anchor.click();
    URL.revokeObjectURL(href);
  };
  const refresh = useCallback(() => hiringAPI.companyEvaluations(applicationId).then(({ data }) => {
    const rows = data.data || [];
    setItems(rows);
    onPendingChange(rows.some((item: any) => item.status === "PLANNED"));
  }), [applicationId, onPendingChange]);
  useEffect(() => { void refresh(); }, [refresh]);
  const types = [["MANAGEMENT_INTERVIEW", "مصاحبه با مدیریت"], ["HR_MANAGER_INTERVIEW", "مصاحبه با مدیر منابع انسانی"], ["DEPARTMENT_SUPERVISOR_INTERVIEW", "مصاحبه با سرپرست بخش"], ["THERAPIST_CONSULTATION", "مراجعه به مشاور و تراپیست"], ["OTHER", "سایر"]];
  return <ErpSection title="برنامه ارزیابی شرکت" description="هر ارزیابی یک نوبت پایدار دارد و نتیجه منفی به‌تنهایی پرونده را رد نمی‌کند.">
    {canPlan && <ErpCard className="mb-4 space-y-3 p-4"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4"><ErpSelect value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect><ErpSelect value={draft.evidencePolicy} onChange={(event) => setDraft({ ...draft, evidencePolicy: event.target.value })}><option value="EXPLANATION_REQUIRED">توضیح الزامی</option><option value="FILE_REQUIRED">فایل الزامی</option><option value="FILE_OPTIONAL">فایل اختیاری</option><option value="NO_FILE">بدون فایل</option></ErpSelect>{draft.type === "OTHER" && <><ErpInput placeholder="موضوع" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /><ErpInput placeholder="شرح و دستور پیگیری" value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></>}</div><ErpButton label="افزودن ارزیابی" variant="solid" disabled={busy || (draft.type === "OTHER" && (!draft.subject.trim() || !draft.instructions.trim()))} onClick={() => void run(() => hiringAPI.addCompanyEvaluation(applicationId, draft), "ارزیابی به برنامه افزوده شد.").then(refresh)} /></ErpCard>}
    <div className="space-y-3">{items.map((item) => { const result = results[item.id] || { effect: "NEUTRAL", explanation: "" }; const label = types.find(([value]) => value === item.type)?.[1] || item.type; return <ErpCard key={item.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{label} · نوبت {Number(item.occurrenceNumber).toLocaleString("fa-IR")}</b>{item.subject && <p className="text-sm text-[var(--sds-text-secondary)]">{item.subject}</p>}</div><ErpBadge tone={item.status === "COMPLETED" ? "success" : item.status === "CANCELLED" ? "neutral" : "warning"}>{item.status === "COMPLETED" ? "تکمیل‌شده" : item.status === "CANCELLED" ? "لغوشده" : "در انتظار نتیجه"}</ErpBadge></div>{item.status === "PLANNED" && canResult && <div className="mt-3 grid gap-2 md:grid-cols-4"><ErpSelect value={result.effect} onChange={(event) => setResults({ ...results, [item.id]: { ...result, effect: event.target.value } })}><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="NEGATIVE">منفی</option></ErpSelect><ErpInput placeholder={item.evidencePolicy === "EXPLANATION_REQUIRED" ? "توضیح الزامی" : "توضیح اختیاری"} value={result.explanation} onChange={(event) => setResults({ ...results, [item.id]: { ...result, explanation: event.target.value } })} />{item.evidencePolicy !== "NO_FILE" && <ErpInput type="file" onChange={(event) => setResults({ ...results, [item.id]: { ...result, file: event.target.files?.[0] } })} />}<ErpButton label="ثبت نتیجه" disabled={busy || (item.evidencePolicy === "EXPLANATION_REQUIRED" && !result.explanation.trim()) || (item.evidencePolicy === "FILE_REQUIRED" && !result.file)} onClick={() => { const data = new FormData(); data.append("effect", result.effect); data.append("explanation", result.explanation); if (result.file) data.append("file", result.file); void run(() => hiringAPI.recordCompanyEvaluationResult(applicationId, item.id, data), "نتیجه ارزیابی ثبت شد.").then(refresh); }} /></div>}{item.status === "PLANNED" && canPlan && <div className="mt-3"><ErpButton label="لغو ارزیابی" tone="danger" variant="ghost" disabled={busy} onClick={() => setCancelTarget(item)} /></div>}{item.status === "COMPLETED" && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><span><b>اثر: </b>{item.resultEffect === "POSITIVE" ? "مثبت" : item.resultEffect === "NEGATIVE" ? "منفی" : "خنثی"}{item.resultExplanation && ` · ${item.resultExplanation}`}</span>{item.resultOriginalName && canViewResults && <ErpButton label="دریافت مدرک نتیجه" variant="ghost" onClick={() => void downloadEvidence(item)} />}</div>}</ErpCard>; })}</div>
    <ErpSheet open={Boolean(cancelTarget)} onClose={() => { if (!busy) setCancelTarget(undefined); }} title="لغو ارزیابی" presentation="modal" dismissible={!busy}>
      <ErpCard className="space-y-4 p-5"><p>لغو این نوبت بازگشت‌پذیر نیست و در سابقه پرونده ثبت می‌شود.</p><div className="flex gap-2"><ErpButton label="تأیید لغو" tone="danger" disabled={busy} onClick={() => { if (!cancelTarget) return; void run(() => hiringAPI.cancelCompanyEvaluation(applicationId, cancelTarget.id), "ارزیابی لغو شد.").then(() => { setCancelTarget(undefined); return refresh(); }); }} /><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => setCancelTarget(undefined)} /></div></ErpCard>
    </ErpSheet>
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
          payload={latestInterview.evidenceJson as ProductionInterviewPayload}
          version={latestInterview.version}
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
          initialPayload={application.initialInterviewDraft?.dataJson as ProductionInterviewPayload | null}
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
              payload: draft.dataJson as ProductionInterviewPayload,
              version: draft.version as number,
            };
          }}
          onComplete={(payload) => run(
            () => hiringAPI.recordDecision(applicationId, "HR_INTERVIEW", {
              outcome: payload.state.decision,
              explanation: payload.state.decisionReason,
              guidedInterview: payload,
              changeReason: latest("HR_INTERVIEW") ? "ثبت نسخه اصلاحی مصاحبه" : "",
            }),
            "نسخه مصاحبه هدایت‌شده ثبت شد.",
            { propagateActionError: true, awaitRefresh: false },
          )}
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

      {phase === "COMPANY_EVALUATION_PLAN" && <CompanyEvaluationPlan applicationId={applicationId} actionPermissions={actionPermissions} busy={busy} run={run} onPendingChange={setHasPendingCompanyEvaluations} />}
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
        footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={busy} onClick={() => { setPreIdentityAction(null); setPreIdentityActionReason(""); }} /><ErpButton label="تأیید و ثبت" tone="warning" variant="solid" disabled={busy || !preIdentityActionReason.trim()} onClick={() => { if (!preIdentityAction) return; const request = preIdentityAction.kind === "correct" ? () => hiringAPI.correctPreIdentityItem(applicationId, preIdentityAction.item.id, preIdentityActionReason.trim()) : () => hiringAPI.resolvePreIdentityNegative(applicationId, preIdentityAction.item.id, { resolution: preIdentityAction.resolution, reason: preIdentityActionReason.trim() }); void run(request, preIdentityAction.kind === "correct" ? "نسخه اصلاحی جدید ایجاد شد." : "نتیجه منفی توسط مدیریت شرکت تعیین تکلیف شد.").then(() => { setPreIdentityAction(null); setPreIdentityActionReason(""); }); }} /></div>}
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
  const [resultFiles, setResultFiles] = useState<Record<string, File[]>>({});
  const [correctionReasons, setCorrectionReasons] = useState<Record<string, string>>({});
  const canManagePlan = actionPermissions.includes("MANAGE_COMPANY_EVALUATION_PLAN");
  const canRecord = actionPermissions.includes("RECORD_COMPANY_EVALUATION_RESULT");
  const selected = Object.entries(selections).filter(([, value]) => value);

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
              const results = plans.flatMap((item: any) => item.results || []).filter((item: any) => item.assessmentKind === selection.assessmentKind).sort((a: any, b: any) => b.resultVersion - a.resultVersion);
              const latest = results[0];
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
                    <ErpBadge tone={latest?.status === "COMPLETED" ? "success" : "warning"}>{latest?.status === "COMPLETED" ? `تکمیل‌شده · نسخه ${latest.resultVersion}` : selection.executionMethod === "APPLICANT" ? "در انتظار متقاضی" : "در انتظار ثبت شرکت"}</ErpBadge>
                  </div>
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
                                [item.key]: event.target.value,
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
                      {latest?.status === "COMPLETED" && canRecord && (
                        <ErpInput
                          value={correctionReasons[selection.assessmentKind] || ""}
                          onChange={(event) => setCorrectionReasons({ ...correctionReasons, [selection.assessmentKind]: event.target.value })}
                          placeholder="دلیل نسخه اصلاحی"
                        />
                      )}
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
                        label={latest?.status === "COMPLETED" ? "ثبت نسخه اصلاحی" : "ثبت نتیجه"}
                        disabled={busy || !formalAssessmentFields[selection.assessmentKind].every(({ key }) => resultValidation[key]?.value !== undefined) || Boolean(latest?.status === "COMPLETED" && !(correctionReasons[selection.assessmentKind] || "").trim())}
                        onClick={() => run(async () => {
                          await hiringAPI.recordFormalAssessmentResult(applicationId, selection.assessmentKind, {
                            result: Object.fromEntries(formalAssessmentFields[selection.assessmentKind].map(({ key }) => [key, resultValidation[key].value])),
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
        <ErpInput
          placeholder="مبلغ (ریال)"
          value={draft.amountRials}
          onChange={(event) =>
            setDraft({ ...draft, amountRials: event.target.value })
          }
        />
        <ErpInput
          placeholder="زمان تحویل"
          value={draft.dueTiming}
          onChange={(event) =>
            setDraft({ ...draft, dueTiming: event.target.value })
          }
        />
        <ErpInput
          placeholder="توضیح قابل نمایش به متقاضی"
          value={draft.candidateExplanation}
          onChange={(event) =>
            setDraft({ ...draft, candidateExplanation: event.target.value })
          }
        />
      </div>
      <ErpButton
        label={current ? "ثبت نسخه جدید الزام وثیقه" : "ثبت الزام وثیقه"}
        disabled={busy || !draft.candidateExplanation.trim()}
        onClick={() =>
          run(
            () => hiringAPI.addCollateralRequirement(applicationId, draft),
            current
              ? "نسخه جدید الزام وثیقه ثبت شد؛ پیشنهاد باید دوباره پذیرفته شود."
              : "الزام وثیقه ثبت شد.",
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
