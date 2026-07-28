"use client";
import {
  ErpInput,
  ErpPressable,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { useEffect, useState } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import Link from "next/link";
import { FaCheck, FaFileUpload, FaSync } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { HiringLifecycle } from "@/features/hr-hiring/HiringLifecycle";
import {
  hiringTaskDetailVisible,
  resolveSelectedHiringPhase,
} from "@/features/hr-hiring/hiringLifecycleViewModel";
import { insuranceSubmissionBlocker } from "@/features/hr-hiring/insuranceViewModel";
import { parseLocalizedAssessmentScore } from "@/features/hr-hiring/assessmentScore";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import {
  dateTimeFa,
  dateFa,
  fromIsoDate,
  fromIsoDateTime,
  HrField,
  toIsoDate,
  toIsoDateTime,
} from "@/features/hr/hrUi";
import {
  assessmentTypeLabel,
  authorityLabel,
  hrDisplayLabel,
} from "@/features/hr/hrDisplay";

const field =
  "w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]";
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
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [correctionExplanations, setCorrectionExplanations] = useState<
    Record<string, string>
  >({});
  const [document, setDocument] = useState<any>({
    category: "BIRTH_CERTIFICATE_ALL_PAGES",
    side: "",
    inspectionSource: "ORIGINAL_SEEN",
    file: null,
  });
  const [components, setComponents] = useState([
    { label: "حقوق پایه", category: "BASE_SALARY", amountRials: "" },
    { label: "مزایا", category: "FIXED_BENEFIT", amountRials: "" },
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
      .myAuthorities()
      .then((result) => setAuthorities(result.data.data))
      .catch(() => setAuthorities([]));
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
  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setBusy(true);
      setError("");
      await action();
      setMessage(success);
      await load();
    } catch (e) {
      setError(hiringError(e));
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
  const hasAuthority = (...values: string[]) =>
    !data.readOnlyArchived &&
    values.some((value) => authorities.includes(value));
  const canHrSensitive = hasAuthority("HR_PROCESSOR", "HR_MANAGER");
  const canCompanyManager = hasAuthority("COMPANY_MANAGER");
  const canFinance = hasAuthority("FINANCE_RECORDER", "FINANCE_MANAGER");
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
  const uploadDocument = () => {
    const fd = new FormData();
    fd.append("category", document.category);
    if (document.side) fd.append("side", document.side);
    fd.append("inspectionSource", document.inspectionSource);
    fd.append("file", document.file);
    return run(() => hiringAPI.uploadDocument(id, fd), "سند هویتی ثبت شد.");
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
  return (
    <ErpPage
      eyebrow="منابع انسانی · پرونده استخدام"
      title={`${data.candidate.firstName} ${data.candidate.lastName}`}
      description={`${data.position.title} · ${data.candidate.mobile}`}
      backHref="/dashboard/hr/hiring"
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: load }]}
    >
      {error && (
        <p className="rounded-xl bg-[var(--sds-danger-surface)] p-3 text-[var(--sds-danger)]">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl bg-[var(--sds-success-surface)] p-3 text-[var(--sds-success)]">
          {message}
        </p>
      )}
      {data.readOnlyArchived && (
        <p className="rounded-xl border border-[var(--sds-warning)] bg-[var(--sds-warning-surface)] p-3 font-bold text-[var(--sds-warning)]">
          این پرونده بایگانی شده و تا زمان بازیابی فقط قابل مشاهده است.
        </p>
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
              <Link
                className="rounded-xl bg-[var(--sds-success)] px-4 py-2 text-sm font-bold text-[var(--sds-text-inverse)]"
                href={`/dashboard/hr/personnel?focus=${data.employmentRelationship.personnel.id}`}
              >
                مشاهده در پرسنل و روابط استخدامی
              </Link>
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
      {selectedLifecyclePhase === "PRE_IDENTITY" &&
        (canHrSensitive || canCompanyManager) && (
          <PreIdentitySection
            application={data}
            authorities={authorities}
            busy={busy}
            applicationId={id}
            run={run}
            download={download}
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
                  {hasAuthority("HR_PROCESSOR") && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <ErpSelect
                        className={field}
                        value={document.category}
                        onChange={(e) =>
                          setDocument({ ...document, category: e.target.value })
                        }
                      >
                        {documentCategories.map((x) => (
                          <option key={x} value={x}>
                            {hrDisplayLabel(x)}
                          </option>
                        ))}
                      </ErpSelect>
                      <ErpSelect
                        className={field}
                        value={document.inspectionSource}
                        onChange={(e) =>
                          setDocument({
                            ...document,
                            inspectionSource: e.target.value,
                          })
                        }
                      >
                        <option value="ORIGINAL_SEEN">اصل مشاهده شد</option>
                        <option value="COPY_RECEIVED">کپی دریافت شد</option>
                      </ErpSelect>
                      <ErpInput
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className={field}
                        onChange={(e) =>
                          setDocument({
                            ...document,
                            file: e.target.files?.[0],
                          })
                        }
                      />
                      <ErpButton
                        label="بارگذاری سند"
                        icon={FaFileUpload}
                        disabled={busy || !document.file}
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
                          {hrDisplayLabel(doc.category)} · نسخه {doc.version}
                        </span>
                        <span className="flex gap-2">
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
                    <div className="mt-3 rounded-xl bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
                      <p>
                        {data.formRevisions[0].correctionNotificationError ||
                          "ارسال پیامک درخواست اصلاح ناموفق بود."}
                      </p>
                      <ErpButton
                        className="mt-2"
                        label="ارسال مجدد پیامک درخواست اصلاح"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => hiringAPI.retryCorrectionNotification(id),
                            "پیامک درخواست اصلاح ارسال شد.",
                          )
                        }
                        tone="warning"
                      />
                    </div>
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
                            {hasAuthority("HR_PROCESSOR") && (
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
                  {hasAuthority("HR_PROCESSOR") &&
                    data.identityChecks.some((check: any) =>
                      ["MISMATCH", "UNREADABLE"].includes(check.status),
                    ) && (
                      <div className="mt-4 rounded-xl border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)]">
                        <h4 className="font-bold">درخواست اصلاح یکپارچه</h4>
                        <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                          برای هر مورد، توضیح فارسی قابل نمایش به متقاضی را وارد
                          کنید. با ثبت نهایی فقط یک پیامک ارسال می‌شود.
                        </p>
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
                                  className={field}
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
                      </div>
                    )}
                  {hasAuthority("HR_MANAGER") && (
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
                {(hasAuthority("HR_PROCESSOR") ||
                  (hasAuthority("HR_MANAGER") && editingAssessmentId)) && (
                  <>
                    <p className="mb-4 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                      امتیازهای درج‌شده در گزارش رسمی ارزیابی را وارد کنید. همه
                      امتیازها باید بین ۰ تا ۱۰۰ باشند.
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-sm font-medium">
                        نوع ارزیابی
                        <ErpSelect
                          className={`${field} mt-1`}
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
                            className={`${field} mt-1`}
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
                              className={`${field} mt-1`}
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
                              className={`${field} mt-1`}
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
                          className={`${field} mt-1`}
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
                          className={`${field} mt-1`}
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
                      {hasAuthority("HR_MANAGER") &&
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
                              onClick={() => {
                                const reason = window.prompt(
                                  "دلیل حذف ارزیابی را وارد کنید:",
                                );
                                if (reason?.trim()) {
                                  void run(
                                    () =>
                                      hiringAPI.voidAssessment(
                                        id,
                                        item.id,
                                        reason.trim(),
                                      ),
                                    "ارزیابی با حفظ سابقه باطل شد.",
                                  );
                                }
                              }}
                            >
                              حذف با حفظ سابقه
                            </ErpPressable>
                          </>
                        )}
                    </span>
                  ))}
                </div>
                {hasAuthority("HR_PROCESSOR") && (
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
                        "مرحله ارزیابی تکمیل شد و برای تصمیم مدیر استخدام‌کننده آماده است.",
                      )
                    }
                    tone="success"
                  />
                )}
                {hasAuthority("COMPANY_MANAGER") &&
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
                {hasAuthority("COMPANY_MANAGER") &&
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
        hasAuthority(
          "HIRING_MANAGER",
          "HR_PAYROLL_PROCESSOR",
          "HR_PAYROLL_MANAGER",
          "FINANCE_MANAGER",
          "HR_PROCESSOR",
          "HR_MANAGER",
          "COMPANY_MANAGER",
        ) && (
          <>
            <ErpSection title="پیشنهاد حقوق و مزایا">
              {hasAuthority("COMPANY_MANAGER") && (
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
                    <div key={i} className="grid gap-2 md:grid-cols-3">
                      <ErpInput
                        className={field}
                        value={item.label}
                        onChange={(e) =>
                          setComponents(
                            components.map((x, j) =>
                              j === i ? { ...x, label: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <ErpSelect
                        className={field}
                        value={item.category || ""}
                        onChange={(e) =>
                          setComponents(
                            components.map((x, j) =>
                              j === i ? { ...x, category: e.target.value } : x,
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
                      <ErpInput
                        className={field}
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
                  {hasAuthority("HIRING_MANAGER", "HR_PAYROLL_PROCESSOR") && (
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
                  {hasAuthority("HIRING_MANAGER") && (
                    <ErpButton
                      label="پیشنهاد Hiring Manager"
                      onClick={() =>
                        run(
                          () =>
                            hiringAPI.createCompensation(id, { components }),
                          "پیشنهاد ثبت شد.",
                        )
                      }
                      disabled={busy}
                    />
                  )}
                  {hasAuthority("HR_PAYROLL_PROCESSOR") && (
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
                      disabled={busy || !compensation}
                    />
                  )}
                  {hasAuthority("HR_PAYROLL_MANAGER") && (
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
                  {hasAuthority("FINANCE_MANAGER") && (
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
                          role: "مدیر استخدام‌کننده",
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
                      <div className="mt-3 rounded-xl bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
                        <p>
                          {compensation.candidateNotificationError ||
                            "ارسال پیامک پیشنهاد همکاری ناموفق بود."}
                        </p>
                        {hasAuthority("HR_PROCESSOR", "HR_MANAGER") && (
                          <ErpButton
                            className="mt-2"
                            label="ارسال مجدد پیامک پیشنهاد"
                            onClick={() =>
                              run(
                                () =>
                                  hiringAPI.retryOfferNotification(
                                    id,
                                    compensation.id,
                                  ),
                                "پیامک پیشنهاد همکاری ارسال شد.",
                              )
                            }
                            disabled={busy}
                          />
                        )}
                      </div>
                    )}
                    {hasAuthority("HR_PROCESSOR") &&
                      compensation.hrApprovedAt &&
                      compensation.financeApprovedAt &&
                      !compensation.candidateDecision && (
                        <div className="mt-4 grid gap-2 rounded-xl border p-3 md:grid-cols-2">
                          <h4 className="font-bold md:col-span-2">
                            ثبت تصمیم آفلاین متقاضی
                          </h4>
                          <ErpSelect
                            className={field}
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
                            className={field}
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
                          <HrField label="زمان اعلام تصمیم متقاضی" required>
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
                          </HrField>
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
                              className={field}
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
            {hasAuthority("FINANCE_RECORDER") && (
              <ErpCard className="mb-4 grid gap-2 p-4 md:grid-cols-3">
                <ErpSelect
                  className={field}
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
              {hasAuthority("FINANCE_RECORDER") && (
                <ErpCard className="grid gap-2 p-4 md:grid-cols-2">
                  <ErpSelect
                    className={field}
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
                    className={field}
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
                    className={field}
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
                    className={field}
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
                    className={field}
                    placeholder="محل نگهداری اصل"
                    value={collateral.custodyLocation}
                    onChange={(e) =>
                      setCollateral({
                        ...collateral,
                        custodyLocation: e.target.value,
                      })
                    }
                  />
                  <HrField label="تاریخ دریافت وثیقه" required>
                    <HrPersianCalendar
                      value={collateral.receivedAt}
                      onChange={(receivedAt) =>
                        setCollateral({
                          ...collateral,
                          receivedAt,
                        })
                      }
                    />
                  </HrField>
                  <ErpInput
                    type="file"
                    className={field}
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
                    className={field}
                    placeholder="دلیل هماهنگی قلم ناقص/ردشده"
                    value={collateralIssue}
                    onChange={(e) => setCollateralIssue(e.target.value)}
                  />
                  <ErpInput
                    className={field}
                    placeholder="تحویل‌گیرنده اصل وثیقه"
                    value={handover.returnedTo}
                    onChange={(e) =>
                      setHandover({ ...handover, returnedTo: e.target.value })
                    }
                  />
                  <ErpInput
                    className={field}
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
                      {hasAuthority("FINANCE_RECORDER") &&
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
                      {hasAuthority("FINANCE_MANAGER") && (
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
                      {hasAuthority("FINANCE_MANAGER") && (
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
                      {(hasAuthority("FINANCE_RECORDER") ||
                        hasAuthority("FINANCE_MANAGER")) &&
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
                      {hasAuthority("FINANCE_MANAGER") &&
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
                {hasAuthority("FINANCE_MANAGER") && (
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
        hasAuthority("HR_MANAGER") && (
          <>
            <ErpSection title="تبدیل به پرسنل برنامه‌ریزی‌شده">
              <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
                <HrField
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
                </HrField>
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
          {hasAuthority("HR_MANAGER") && (
            <ErpCard className="grid gap-2 p-4 md:grid-cols-4">
              <ErpInput
                className={field}
                placeholder="عنوان وظیفه"
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
              />
              <ErpSelect
                className={field}
                value={task.ownerAuthority}
                onChange={(e) =>
                  setTask({ ...task, ownerAuthority: e.target.value })
                }
              >
                <option value="HR_MANAGER">مدیر منابع انسانی</option>
                <option value="HIRING_MANAGER">مدیر استخدام‌کننده</option>
                <option value="HR_PROCESSOR">کارشناس منابع انسانی</option>
                <option value="FINANCE_MANAGER">مدیر مالی</option>
              </ErpSelect>
              <HrField label="مهلت انجام وظیفه" hint="اختیاری">
                <HrPersianCalendar
                  value={task.dueDate}
                  onChange={(dueDate) => setTask({ ...task, dueDate })}
                />
              </HrField>
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
                  hasAuthority(item.ownerAuthority) && (
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
              {hasAuthority("FINANCE_RECORDER") && (
                <>
                  <HrField label="شماره قرارداد" required>
                    <ErpInput
                      className={field}
                      value={contract.contractNumber}
                      onChange={(e) =>
                        setContract({
                          ...contract,
                          contractNumber: e.target.value,
                        })
                      }
                    />
                  </HrField>
                  <HrField label="تاریخ شروع اعتبار قرارداد" required>
                    <HrPersianCalendar
                      value={contract.effectiveFrom}
                      onChange={(effectiveFrom) =>
                        setContract({
                          ...contract,
                          effectiveFrom,
                        })
                      }
                    />
                  </HrField>
                  <HrField label="تاریخ پایان اعتبار قرارداد" required>
                    <HrPersianCalendar
                      value={contract.effectiveTo}
                      onChange={(effectiveTo) =>
                        setContract({
                          ...contract,
                          effectiveTo,
                        })
                      }
                    />
                  </HrField>
                  <HrField label="اسکن قرارداد امضاشده" required>
                    <ErpInput
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className={field}
                      onChange={(e) =>
                        setContract({ ...contract, file: e.target.files?.[0] })
                      }
                    />
                  </HrField>
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
              {hasAuthority("FINANCE_MANAGER") && latestContract?.canReview && (
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
                  <HrField label="دلیل بازگرداندن قرارداد">
                    <ErpTextarea
                      className={field}
                      value={contractReturnReason}
                      onChange={(event) =>
                        setContractReturnReason(event.target.value)
                      }
                    />
                  </HrField>
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
                      <p className="rounded-lg bg-[var(--sds-warning-surface)] p-2 text-sm font-bold text-[var(--sds-warning)]">
                        مهلت پیگیری ثبت بیمه توسط شرکت گذشته است.
                      </p>
                    )}
                    <HrField label="روش ثبت بیمه" required>
                      <ErpSelect
                        className={field}
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
                    </HrField>
                    {insurance.registrationPath === "COMPANY" ? (
                      <>
                        <HrField label="وضعیت عملیاتی بیمه" required>
                          <ErpSelect
                            className={field}
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
                        </HrField>
                        <HrField
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
                        </HrField>
                        <HrField
                          label="مهلت پیگیری ثبت بیمه"
                          hint="اختیاری و غیرمسدودکننده فعال‌سازی همکاری"
                        >
                          <HrPersianCalendar
                            value={insurance.dueDate}
                            onChange={(dueDate) =>
                              setInsurance({ ...insurance, dueDate })
                            }
                          />
                        </HrField>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                          با ثبت این انتخاب، پیگیری شرکت خاتمه می‌یابد و مدرک یا
                          تاریخ فعال‌سازی بعدی از شخص درخواست نمی‌شود.
                        </p>
                        <HrField label="روش اعلام درخواست شخص" required>
                          <ErpSelect
                            className={field}
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
                        </HrField>
                        <HrField label="زمان اعلام درخواست شخص" required>
                          <HrPersianCalendar
                            showTime
                            value={insurance.communicatedAt}
                            onChange={(communicatedAt) =>
                              setInsurance({ ...insurance, communicatedAt })
                            }
                          />
                        </HrField>
                      </>
                    )}
                    <ErpTextarea
                      className={field}
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
                    <HrField
                      label="تاریخ شروع مشارکت در حقوق و دستمزد"
                      required
                      hint="به‌صورت پیش‌فرض برابر تاریخ شروع برنامه‌ریزی‌شده است."
                    >
                      <HrPersianCalendar
                        value={payrollDate}
                        onChange={setPayrollDate}
                      />
                    </HrField>
                    {payrollDiffersFromPlanned && (
                      <HrField
                        label="دلیل تفاوت با تاریخ شروع برنامه‌ریزی‌شده"
                        required
                      >
                        <ErpTextarea
                          className={field}
                          value={payrollMismatchReason}
                          onChange={(event) =>
                            setPayrollMismatchReason(event.target.value)
                          }
                        />
                      </HrField>
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
                <ul className="space-y-1 rounded-xl bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                  {data.activationReadiness.blockers.map((blocker: any) => (
                    <li key={blocker.id}>• {blocker.message}</li>
                  ))}
                </ul>
              )}
              {data.activationReadiness.activatedAt ? (
                <p className="rounded-xl bg-[var(--sds-success-surface)] p-3 text-sm text-[var(--sds-success)]">
                  فعال‌سازی توسط{" "}
                  {data.activationReadiness.activatedBy || "مدیر منابع انسانی"}{" "}
                  در {dateTimeFa(data.activationReadiness.activatedAt)} انجام
                  شد.
                </p>
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
        hasAuthority("HR_MANAGER") && (
          <>
            <ErpSection
              title="بستن یا لغو پرونده"
              description="اطلاعات عادی در بانک متقاضیان قابل جست‌وجو می‌ماند؛ داده‌ها و اسناد حساس فقط تحت دسترسی محدود نگهداری می‌شوند."
            >
              <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
                <ErpSelect
                  className={field}
                  value={closure.outcome}
                  onChange={(e) =>
                    setClosure({ ...closure, outcome: e.target.value })
                  }
                >
                  <option value="REJECTED">رد شده</option>
                  <option value="WITHDRAWN">انصراف متقاضی</option>
                  <option value="REQUEST_CANCELLED">لغو درخواست</option>
                </ErpSelect>
                <ErpInput
                  className={field}
                  placeholder="دلیل الزامی"
                  value={closure.reason}
                  onChange={(e) =>
                    setClosure({ ...closure, reason: e.target.value })
                  }
                />
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
          authorities={authorities}
          applicationId={id}
          busy={busy}
          run={run}
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
) => Promise<void>;

function PreIdentitySection({
  application,
  authorities,
  busy,
  applicationId,
  run,
  download,
}: {
  application: any;
  authorities: string[];
  busy: boolean;
  applicationId: string;
  run: CaseActionRunner;
  download: (request: () => Promise<any>, fileName: string) => Promise<void>;
}) {
  const has = (...values: string[]) =>
    values.some((value) => authorities.includes(value));
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, any>>({});
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
  const decisions = application.hiringDecisions || [];
  const latest = (kind: string) =>
    decisions
      .filter((item: any) => item.kind === kind)
      .sort((a: any, b: any) => b.version - a.version)[0];
  const decisionDefinitions = [
    ["HR_INTERVIEW", "مصاحبه اولیه با HR", "HR_PROCESSOR"],
    ["HR_PRELIMINARY_APPROVAL", "تأیید اولیه HR", "HR_MANAGER"],
    ["COMPANY_APPROVAL", "تأیید مدیریت شرکت", "COMPANY_MANAGER"],
  ];
  useEffect(() => {
    if (!has("COMPANY_MANAGER")) return;
    void hiringAPI.preIdentityTemplates().then((response) => {
      setTemplates(response.data.data || []);
      setTemplateId(response.data.data?.[0]?.id || "");
    });
    // Authority membership is stable for the lifetime of this case view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ErpSection
      title="بررسی‌های پیش از احراز هویت"
      description="این چک‌لیست فقط در فضای داخلی پیگیری می‌شود و در صفحه متقاضی نمایش داده نمی‌شود."
    >
      <div className="grid gap-3 xl:grid-cols-3">
        {decisionDefinitions.map(([kind, label, authority]) => {
          const current = latest(kind);
          const draft = decisionDrafts[kind] || {
            outcome: "POSITIVE",
            explanation: "",
            changeReason: "",
          };
          return (
            <ErpCard key={kind} className="space-y-2 p-4">
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
              {has(authority) && (
                <>
                  <ErpSelect
                    className={field}
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
                    className={field}
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
                      className={field}
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
            </ErpCard>
          );
        })}
      </div>

      <ErpCard className="mt-4 space-y-3 p-4">
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
        {has("COMPANY_MANAGER") && (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-3">
              <ErpSelect
                className={field}
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
                  className={field}
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
                className={field}
                placeholder="عنوان الزام یا ارزیابی سفارشی"
                value={requirement.title}
                onChange={(event) =>
                  setRequirement({ ...requirement, title: event.target.value })
                }
              />
              <ErpInput
                className={field}
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
                className={field}
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
              <HrField label="مهلت انجام" hint="تاریخ و ساعت شمسی">
                <HrPersianCalendar
                  value={requirement.dueAt}
                  onChange={(dueAt) =>
                    setRequirement({ ...requirement, dueAt })
                  }
                  placeholder="انتخاب مهلت انجام"
                  showTime
                  clearable
                />
              </HrField>
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
                {has("HR_PROCESSOR", "HR_MANAGER", "COMPANY_MANAGER") &&
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
                {has("HR_PROCESSOR") &&
                  !["POSITIVE", "NEGATIVE"].includes(item.status) && (
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <ErpSelect
                        className={field}
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
                        className={field}
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
                        className={field}
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
                        className={field}
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
                {has("HR_MANAGER") &&
                  ["POSITIVE", "NEGATIVE"].includes(item.status) && (
                    <ErpPressable
                      type="button"
                      className="mt-3 rounded-lg border border-[var(--sds-warning-border)] px-3 py-2 text-xs font-bold text-[var(--sds-warning)]"
                      onClick={() => {
                        const reason = window.prompt(
                          "دلیل ایجاد نسخه اصلاحی نتیجه را وارد کنید:",
                        );
                        if (reason?.trim())
                          void run(
                            () =>
                              hiringAPI.correctPreIdentityItem(
                                applicationId,
                                item.id,
                                reason.trim(),
                              ),
                            "نسخه اصلاحی جدید ایجاد شد.",
                          );
                      }}
                    >
                      ایجاد نسخه اصلاحی
                    </ErpPressable>
                  )}
                {has("COMPANY_MANAGER") &&
                  item.status === "NEGATIVE" &&
                  !item.managementResolution && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["CONTINUE", "REPEAT", "RESERVE"].map((resolution) => (
                        <ErpPressable
                          type="submit"
                          key={resolution}
                          className="rounded-lg border px-3 py-2 text-xs font-bold"
                          onClick={() => {
                            const reason = window.prompt(
                              "دلیل تصمیم مدیریت شرکت را ثبت کنید:",
                            );
                            if (reason?.trim())
                              void run(
                                () =>
                                  hiringAPI.resolvePreIdentityNegative(
                                    applicationId,
                                    item.id,
                                    { resolution, reason: reason.trim() },
                                  ),
                                "نتیجه منفی توسط مدیریت شرکت تعیین تکلیف شد.",
                              );
                          }}
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
        {has("HR_PROCESSOR") && application.preIdentityManagementApprovedAt && (
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
      </ErpCard>
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
        className={field}
        value={decision}
        onChange={(event) => setDecision(event.target.value)}
      >
        <option value="APPROVED">تأیید و تکمیل خودکار مرحله</option>
        <option value="REPEAT_REQUIRED">تکرار ارزیابی</option>
        <option value="RESERVE">رد/ذخیره</option>
        <option value="REJECTED">رد نهایی</option>
      </ErpSelect>
      <ErpInput
        className={field}
        placeholder={decision === "APPROVED" ? "توضیح اختیاری" : "دلیل الزامی"}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {decision === "REPEAT_REQUIRED" && (
        <ErpInput
          className={field}
          type="datetime-local"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />
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
                dueAt: dueAt || undefined,
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
    obligation: current?.obligation || "",
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
      <div className="grid gap-2 md:grid-cols-5">
        <ErpSelect
          className={field}
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
          className={field}
          placeholder="مبلغ (ریال)"
          value={draft.amountRials}
          onChange={(event) =>
            setDraft({ ...draft, amountRials: event.target.value })
          }
        />
        <ErpInput
          className={field}
          placeholder="تعهد"
          value={draft.obligation}
          onChange={(event) =>
            setDraft({ ...draft, obligation: event.target.value })
          }
        />
        <ErpInput
          className={field}
          placeholder="زمان تحویل"
          value={draft.dueTiming}
          onChange={(event) =>
            setDraft({ ...draft, dueTiming: event.target.value })
          }
        />
        <ErpInput
          className={field}
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
  authorities,
  applicationId,
  busy,
  run,
}: {
  application: any;
  authorities: string[];
  applicationId: string;
  busy: boolean;
  run: CaseActionRunner;
}) {
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState({ method: "PHONE", at: "", note: "" });
  const has = (...values: string[]) =>
    values.some((value) => authorities.includes(value));
  const authorized = (application.reopenings || []).some(
    (item: any) => item.status === "AUTHORIZED",
  );
  if (application.disposition) {
    const canReactivate =
      (application.disposition === "INITIAL_REJECTED" && has("HR_MANAGER")) ||
      (application.disposition === "RESERVE" && has("COMPANY_MANAGER"));
    return (
      <ErpSection title="فعال‌سازی مجدد پرونده متوقف‌شده">
        <ErpCard className="grid gap-2 p-4 md:grid-cols-3">
          <p className="text-sm">
            برچسب فعلی: {hrDisplayLabel(application.disposition)}
          </p>
          <ErpInput
            className={field}
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
          className={field}
          placeholder="دلیل بازگشایی"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {has("COMPANY_MANAGER") && !authorized && (
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
          has("HR_MANAGER") &&
          authorized && (
            <>
              <ErpSelect
                className={field}
                value={consent.method}
                onChange={(event) =>
                  setConsent({ ...consent, method: event.target.value })
                }
              >
                <option value="PHONE">رضایت تلفنی</option>
                <option value="IN_PERSON">رضایت حضوری</option>
              </ErpSelect>
              <ErpInput
                className={field}
                type="datetime-local"
                value={consent.at}
                onChange={(event) =>
                  setConsent({ ...consent, at: event.target.value })
                }
              />
              <ErpInput
                className={field}
                placeholder="شرح رضایت جدید متقاضی"
                value={consent.note}
                onChange={(event) =>
                  setConsent({ ...consent, note: event.target.value })
                }
              />
            </>
          )}
        {has("HR_MANAGER") && authorized && (
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
                        ? consent.at
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
