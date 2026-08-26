'use client';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpPressable, ErpRialInput, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';
import { useEffect, useMemo, useState } from "react";
import { applicantHiringAPI, hiringError } from "@/lib/hiringApi";
import { normalizeIranianMobile } from "@/lib/phoneFormat";
import { ThemeToggle } from "@/components/ThemeToggle";
import PersianCalendarComponent from "@/components/PersianCalendar";
import PersianCalendar from "@/lib/persian-calendar";
import { toIsoDate } from "@/features/hr/hrUi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";
import { formatPrice, normalizeIdentifierDigits } from '@/lib/numberFormat';
import { ApplicantFormalAssessments } from "@/features/hr-hiring/ApplicantFormalAssessments";
import {
  ApplicantFieldError,
  EDUCATION_LEVEL_OPTIONS,
  applicantFormErrors,
  currentJalaliYear,
  nationalCodeCorrectionValidationError,
  nationalCodeValidationError,
  normalizeLegacyEducation,
} from "@/features/hr-hiring/applicantFormPolicy";

const questions = [
  "به چه فعالیت‌های هنری یا ورزشی علاقه دارید؟",
  "در چه زمینه‌هایی مهارت هنری یا ورزشی دارید؟",
  "آخرین کتاب‌هایی که مطالعه کرده‌اید چه بوده و کدام بیشتر بر شما تأثیر گذاشته است؟",
  "به کدام‌یک از دستاوردهای خود افتخار می‌کنید؟",
  "در طول زندگی چه چیزهایی بیشتر از همه برایتان مهم بوده است؟ چرا؟",
  "اگر هیچ محدودیتی از نظر پول و زمان نداشتید، وقتتان را صرف چه کاری می‌کردید؟",
  "اطرافیانتان شما را چگونه توصیف می‌کنند؟",
  "آخرین چالش جدی شما چه بوده و چگونه با آن کنار آمدید؟",
  "بزرگ‌ترین اشتباه کاری یا زندگی شما چه بوده و از آن چه آموختید؟",
  "ترجیح می‌دهید تیمی کار کنید یا مستقل؟ چرا؟",
  "وقتی هم‌تیمی شما اشتباه می‌کند، واکنش شما چیست؟",
  "در این موقعیت شغلی به دنبال چه چیزهایی هستید؟",
  "تا یک سال آینده چه هدفی برای خودتان در این شغل متصور هستید؟",
];

const snapshotAnswers = (answers: unknown) => questions.map((questionText, index) => {
  const current = Array.isArray(answers) ? answers[index] : undefined;
  return {
    questionId: `application-question-${index + 1}`,
    questionText,
    answer: current && typeof current === 'object'
      ? String((current as { answer?: unknown }).answer ?? '')
      : String(current ?? ''),
  };
});

const blank = {
  firstName: "",
  lastName: "",
  alias: "",
  birthDate: "",
  birthPlace: "",
  militaryStatus: "",
  fatherName: "",
  fatherOccupation: "",
  maritalStatus: "",
  childrenCount: "",
  spouseOccupation: "",
  address: "",
  postalCode: "",
  mobile: "",
  homePhone: "",
  email: "",
  socialMedia: "",
  educationLevel: "",
  educationLevelOther: "",
  fieldOfStudy: "",
  graduationYear: "",
  identityKind: "IRANIAN",
  nationalCode: "",
  foreignIdentityType: "",
  foreignIdentityNumber: "",
  hasSocialSecurityHistory: "",
  workHistory: [
    {
      organization: "",
      duration: "",
      lastPosition: "",
      lastSalaryBenefits: "",
    },
  ],
  skills: [{ name: "", familiarity: "", proficiency: "" }],
  languages: [{ name: "", level: "", proficiency: "" }],
  cooperationType: "FULL_TIME",
  cooperationDuration: "LONG_TERM",
  requestedPosition: "",
  desiredSalary: "",
  questions: snapshotAnswers([]),
};

const normalizeApplicantNumericDraft = (value: Record<string, any>) => ({
  ...value,
  ...Object.fromEntries([
    "childrenCount", "postalCode", "mobile", "homePhone", "graduationYear", "nationalCode",
  ].filter((field) => field in value).map((field) => [field, normalizeIdentifierDigits(String(value[field] ?? ""))])),
});

export default function ApplicantFormPage() {
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [verified, setVerified] = useState(false);
  const [data, setData] = useState<any>(blank);
  const [application, setApplication] = useState<any>();
  const [offerDecision, setOfferDecision] = useState("");
  const [offerAccepted, setOfferAccepted] = useState(false);
  const [decline, setDecline] = useState({ category: "", note: "" });
  const [declaration, setDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [formErrors, setFormErrors] = useState<ApplicantFieldError[]>([]);
  const [assessmentValidationRequested, setAssessmentValidationRequested] = useState(false);
  const jalaliYear = currentJalaliYear();

  const submitted = application?.revision?.status === "SUBMITTED";
  const correctionFields: string[] = Array.isArray(
    application?.revision?.correctionFieldsJson,
  )
    ? application.revision.correctionFieldsJson
    : [];
  const isCorrection = correctionFields.length > 0 && !submitted;
  const correctionDetails = Array.isArray(
    application?.revision?.correctionDetailsJson,
  )
    ? application.revision.correctionDetailsJson
    : [];
  const completion = useMemo(() => {
    const values = [
      data.firstName,
      data.lastName,
      data.birthDate,
      data.mobile,
      data.address,
      data.educationLevel,
      data.nationalCode,
    ];
    return Math.round((values.filter(Boolean).length / values.length) * 100);
  }, [data]);

  const load = async () => {
    let next: any;
    try {
      const result = await applicantHiringAPI.get();
      next = result.data.data;
    } catch (cause) {
      try {
        const closed = await applicantHiringAPI.getClosedState();
        next = closed.data.data;
      } catch {
        throw cause;
      }
    }
    setApplication(next);
    const revisionData = next.revision?.dataJson;
    if (revisionData) {
      const education = normalizeLegacyEducation(revisionData.educationLevel, revisionData.educationLevelOther);
      setData({
        ...blank,
        ...normalizeApplicantNumericDraft(revisionData),
        ...education,
        birthDate: revisionData.birthDate
          ? PersianCalendar.toPersian(revisionData.birthDate)
          : "",
        questions: snapshotAnswers(revisionData.questions),
      });
    }
  };

  useEffect(() => {
    const session = sessionStorage.getItem("hrApplicantSession");
    if (session) {
      setVerified(true);
      load().catch((err) => {
        sessionStorage.removeItem("hrApplicantSession");
        setVerified(false);
        setError(hiringError(err));
      });
    }
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty]);

  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setBusy(true);
      setError("");
      await action();
      setDirty(false);
      setMessage(success);
      await load();
    } catch (err) {
      setError(hiringError(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    try {
      setBusy(true);
      setError("");
      const result = await applicantHiringAPI.verify(normalizeIranianMobile(mobile), otp);
      sessionStorage.setItem("hrApplicantSession", result.data.data.session);
      await load();
      setVerified(true);
      setMessage("ورود با موفقیت انجام شد.");
    } catch (err: any) {
      setError(hiringError(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (key: string, value: any) => {
    setDirty(true);
    setData((old: any) => ({ ...old, [key]: value }));
    setFormErrors((current) => current.filter((item) => item.field !== key));
  };
  const saveApplicationDraft = () => {
    const normalizedData = {
      ...data,
      birthDate: data.birthDate ? toIsoDate(data.birthDate) : "",
    };
    const payload = isCorrection
      ? Object.fromEntries([
          ...correctionFields.map((field) => [field, normalizedData[field]]),
          ...(correctionFields.includes("educationLevel")
            ? [["educationLevelOther", normalizedData.educationLevelOther]]
            : []),
        ])
      : normalizedData;
    return applicantHiringAPI.saveDraft(payload);
  };
  const setCorrectionValue = (key: string, value: string) => {
    if (typeof data[key] === "boolean") return set(key, value === "true");
    if (typeof data[key] === "number") return set(key, Number(value));
    if (typeof data[key] !== "object") return set(key, value);
    try {
      set(key, JSON.parse(value));
    } catch {
      setError("مقدار فیلد ساختاریافته باید JSON معتبر باشد.");
    }
  };
  const updateList = (
    key: string,
    index: number,
    field: string,
    value: string,
  ) => {
    setDirty(true);
    setData((old: any) => ({
      ...old,
      [key]: old[key].map((item: any, i: number) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    }));
    setFormErrors((current) => current.filter((item) => item.field !== `${key}.${index}.${field}`));
  };

  const focusField = (field: string) => {
    const target = document.getElementById(`applicant-field-${field}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => target?.focus(), 250);
  };

  const validationErrors = () => {
    const base = applicantFormErrors(data, jalaliYear);
    const scoped = isCorrection
      ? base
        .filter((item) => correctionFields.some((field) => item.field === field || item.field.startsWith(`${field}.`) || (field === "educationLevel" && item.field === "educationLevelOther")))
        .filter((item) => item.field !== "nationalCode")
      : base;
    if (isCorrection && correctionFields.includes("nationalCode")) {
      const correctionError = nationalCodeCorrectionValidationError(data.nationalCode);
      if (correctionError) scoped.push({ field: "nationalCode", message: correctionError });
    }
    const assessmentErrors: ApplicantFieldError[] = (isCorrection ? [] : application?.formalAssessments?.selections || [])
      .filter((selection: any) => !selection.completed)
      .map((selection: any) => ({
        field: `assessment-${selection.assessmentKind}`,
        message: `ارزیابی ${selection.assessmentKind === "BIG_FIVE" ? "BIG FIVE" : selection.assessmentKind} باید تکمیل شود.`,
      }));
    return [...scoped, ...assessmentErrors];
  };

  const submitApplication = async () => {
    const nextErrors = validationErrors();
    if (!declaration) nextErrors.push({ field: "declaration", message: "تأیید صحت اطلاعات الزامی است." });
    setFormErrors(nextErrors);
    setAssessmentValidationRequested(true);
    if (nextErrors.length) {
      focusField(nextErrors[0].field);
      return;
    }
    await run(async () => {
      await saveApplicationDraft();
      await applicantHiringAPI.submit({ declarationAccepted: true });
    }, isCorrection ? "نسخه اصلاح‌شده ارسال شد." : "فرم نهایی ارسال و قفل شد.");
  };

  const inlineError = (field: string) => formErrors.find((item) => item.field === field)?.message;
  const postalCodeError = data.postalCode && !/^\d{10}$/.test(String(data.postalCode))
    ? "کد پستی باید دقیقاً ۱۰ رقم باشد."
    : inlineError("postalCode");
  const mobileError = data.mobile && !/^09\d{9}$/.test(String(data.mobile))
    ? "شماره همراه باید دقیقاً ۱۱ رقم باشد و با 09 شروع شود."
    : inlineError("mobile");
  const nationalCodeError = data.identityKind !== "FOREIGN" && data.nationalCode
    ? isCorrection
      ? nationalCodeCorrectionValidationError(data.nationalCode)
      : nationalCodeValidationError(data.nationalCode)
    : inlineError("nationalCode");

  const endSession = () => {
    sessionStorage.removeItem("hrApplicantSession");
    setVerified(false);
    setApplication(undefined);
    setMessage("");
    setError("");
    setDirty(false);
    setDiscardOpen(false);
  };

  if (!verified)
    return (
      <main dir="rtl" lang="fa" className="sds-workspace sds-neumorphic-applicant-shell hr-applicant-shell min-h-screen px-4 py-16 text-[var(--sds-text-primary)]">
        <section className="sds-neumorphic-applicant-card mx-auto max-w-md p-7">
          <div className="mb-4 flex justify-end"><ThemeToggle /></div>
          <h1 className="text-2xl font-black">فرم استخدام سبلان</h1>
          <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
            شماره همراهی که پیامک را دریافت کرده و کد شش‌رقمی همان پیامک را وارد کنید.
          </p>
          {error && <ErpInlineState className="mt-4" kind="error" title={error} />}
          <>
            <ErpField className="mt-6" label="شماره همراه">
              <ErpInput
                dir="ltr"
                className="mt-1 text-left"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09123456789"
                value={mobile}
                onChange={(e) => setMobile(normalizeIdentifierDigits(e.target.value))}
              />
            </ErpField>
            <ErpField className="mt-4" label="کد ورود شش‌رقمی">
            <ErpInput
              dir="ltr"
              className="mt-1 text-center text-xl tracking-[.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(normalizeIdentifierDigits(e.target.value))}
            />
            </ErpField>
            <ErpButton
              label="تأیید و ورود"
              className="mt-4 w-full"
              disabled={busy || !normalizeIranianMobile(mobile) || otp.length !== 6}
              onClick={verify}
            />
            <p className="mt-4 text-xs text-[var(--sds-text-secondary)]">اگر کد شما منقضی شده است، با واحد منابع انسانی تماس بگیرید.</p>
          </>
        </section>
      </main>
    );

  if (application?.closed) {
    const closedMessage = application.candidateMessageCode === "APPLICATION_HIRED"
      ? "فرایند استخدام شما با موفقیت تکمیل شده است."
      : application.candidateMessageCode === "APPLICATION_WITHDRAWN"
        ? "انصراف شما ثبت شده و این درخواست دیگر قابل تغییر نیست."
        : application.candidateMessageCode === "APPLICATION_CANCELLED"
          ? "این درخواست بسته شده و دیگر قابل تغییر نیست."
          : "بررسی این درخواست پایان یافته و پرونده در حالت فقط‌خواندنی قرار دارد.";
    return (
      <main dir="rtl" lang="fa" className="sds-workspace sds-neumorphic-applicant-shell hr-applicant-shell min-h-screen px-4 py-16 text-[var(--sds-text-primary)]">
        <ErpCard className="mx-auto max-w-xl space-y-5 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-[var(--sds-text-secondary)]">وضعیت درخواست همکاری</p>
              <h1 className="mt-1 text-2xl font-black">{application.positionTitle || "فرم استخدام سبلان"}</h1>
            </div>
            <ThemeToggle />
          </div>
          <ErpInlineState kind="empty" title={closedMessage} />
          <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">
            برای پرسش درباره ادامه فرایند با واحد منابع انسانی تماس بگیرید. دلایل و یادداشت‌های داخلی در این صفحه نمایش داده نمی‌شوند.
          </p>
          <ErpPressable
            type="button"
            onClick={() => {
              sessionStorage.removeItem("hrApplicantSession");
              setVerified(false);
              setApplication(undefined);
            }}
            className="min-h-11 w-full rounded-xl border border-[var(--sds-border-default)] px-4 py-2 font-bold"
          >
            خروج امن
          </ErpPressable>
        </ErpCard>
      </main>
    );
  }

  return (
    <main dir="rtl" lang="fa" className="sds-workspace sds-neumorphic-applicant-shell hr-applicant-shell min-h-screen px-3 py-6 text-[var(--sds-text-primary)] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="sds-neumorphic-applicant-card p-6 text-[var(--sds-text-primary)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-[var(--sds-success)]">پرسشنامه استخدام</p>
              <h1 className="mt-1 text-2xl font-black">
                {application?.position?.title || "فرم متقاضی"}
              </h1>
            </div>
            <ErpPressable
              type="button"
              onClick={() => dirty ? setDiscardOpen(true) : endSession()}
              className="rounded-xl border border-[var(--sds-border-strong)] px-4 py-2 text-sm font-bold hover:bg-[var(--sds-surface-raised)]"
            >
              خروج امن
            </ErpPressable>
            <ThemeToggle />
          </div>
          <div className="mt-5 h-2 rounded-full bg-[var(--sds-surface-raised)]">
            <div
              className="h-2 rounded-full bg-[var(--sds-success-surface)]"
              style={{ width: `${completion}%` }}
            />
          </div>
        </header>
        <ErpSheet
          open={discardOpen}
          onClose={() => setDiscardOpen(false)}
          title="خروج بدون ذخیره تغییرات"
          presentation="modal"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <ErpButton label="ادامه ویرایش" variant="ghost" onClick={() => setDiscardOpen(false)} />
              <ErpButton label="خروج و کنارگذاشتن" tone="danger" variant="solid" onClick={endSession} />
            </div>
          }
        >
          <ErpInlineState kind="stale" title="تغییرات ذخیره‌نشده با خروج از این صفحه از بین می‌روند." />
        </ErpSheet>
        {error && <ErpInlineState className="mt-4" kind="error" title={error} />}
        {message && <ErpInlineState className="mt-4" kind="success" title={message} />}
        {formErrors.length > 0 && (
          <div role="alert" aria-labelledby="applicant-error-summary-title">
          <ErpCard className="mt-4 p-4">
            <h2 id="applicant-error-summary-title" className="font-black text-[var(--sds-danger)]">موارد زیر را اصلاح کنید</h2>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {formErrors.map((item, index) => (
                <li key={`${item.field}-${index}`}>
                  <ErpPressable type="button" variant="ghost" tone="danger" className="h-auto min-h-0 p-0 text-right underline" onClick={() => focusField(item.field)}>
                    {item.message}
                  </ErpPressable>
                </li>
              ))}
            </ul>
          </ErpCard>
          </div>
        )}
        {isCorrection && (
          <ErpCard className="mt-4 p-4">
            <ErpInlineState kind="stale" title={`فرم برای اصلاح بازگردانده شده است: ${application.revision.correctionReason}`} />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {correctionFields.map((key) => {
                const detail = correctionDetails.find(
                  (item: any) => item.fieldKey === key,
                );
                return (
                <ErpField
                  key={key}
                  error={key === "mobile" ? mobileError : key === "postalCode" ? postalCodeError : key === "nationalCode" ? nationalCodeError : formErrors.find((item) => item.field === key)?.message}
                  label={`${detail?.label || "فیلد نیازمند اصلاح"}${detail?.explanation ? ` — ${detail.explanation}` : ""}`}
                >
                  {key === "nationalCode" || key === "mobile" || key === "postalCode" ? (
                    <ErpInput
                      id={`applicant-field-${key}`}
                      inputMode={key === "mobile" ? "tel" : "numeric"}
                      maxLength={key === "mobile" ? 11 : 10}
                      value={String(data[key] ?? "")}
                      onChange={(event) => set(key, normalizeIdentifierDigits(event.target.value))}
                    />
                  ) : key === "graduationYear" ? (
                    <PersianCalendarComponent
                      id="applicant-field-graduationYear"
                      yearOnly
                      enableYearSelection
                      minYear={1300}
                      maxYear={jalaliYear}
                      value={String(data.graduationYear ?? "")}
                      onChange={(value) => set("graduationYear", normalizeIdentifierDigits(value))}
                    />
                  ) : key === "educationLevel" ? (
                    <div className="space-y-3">
                      <ErpSelect id="applicant-field-educationLevel" value={String(data.educationLevel ?? "")} onChange={(event) => {
                        set("educationLevel", event.target.value);
                        if (event.target.value !== "OTHER") set("educationLevelOther", "");
                      }}>
                        <option value="">انتخاب</option>
                        {EDUCATION_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </ErpSelect>
                      {data.educationLevel === "OTHER" && (
                        <ErpField label="عنوان مقطع" required error={inlineError("educationLevelOther")}>
                          <ErpInput id="applicant-field-educationLevelOther" value={String(data.educationLevelOther ?? "")} onChange={(event) => set("educationLevelOther", event.target.value)} />
                        </ErpField>
                      )}
                    </div>
                  ) : (
                    <ErpTextarea
                      id={`applicant-field-${key}`}
                      value={typeof data[key] === "object" ? JSON.stringify(data[key]) : String(data[key] ?? "")}
                      onChange={(e) => setCorrectionValue(key, e.target.value)}
                    />
                  )}
                </ErpField>
                );
              })}
            </div>
            <div id="applicant-field-declaration" tabIndex={-1}>
              <ErpCheckbox className="mt-4" label="صحت نسخه اصلاح‌شده را تأیید می‌کنم." checked={declaration} onChange={(e) => { setDeclaration(e.target.checked); setFormErrors((current) => current.filter((item) => item.field !== "declaration")); }} />
              {formErrors.some((item) => item.field === "declaration") && <p className="mt-2 text-sm text-[var(--sds-danger)]">تأیید صحت نسخه اصلاح‌شده الزامی است.</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <ErpButton
                label="ذخیره پیش‌نویس"
                disabled={busy}
                onClick={() =>
                  run(
                    saveApplicationDraft,
                    "پیش‌نویس اصلاحات ذخیره شد.",
                  )
                }
                variant="outline"
              />
              <ErpButton
                label="ذخیره و ارسال اصلاحات"
                disabled={busy}
                onClick={submitApplication}
                tone="success"
              />
            </div>
          </ErpCard>
        )}
        <fieldset
          disabled={submitted || busy || isCorrection}
          className="mt-5 space-y-5 disabled:opacity-70"
        >
          <Section title="مشخصات فردی" emphasis="neumorphic">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <ErpField label="نام">
                <ErpInput
                  id="applicant-field-firstName"
                  value={data.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
              </ErpField>
              <ErpField label="نام خانوادگی">
                <ErpInput
                  id="applicant-field-lastName"
                  value={data.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </ErpField>
              <ErpField label="نام مستعار یا ندارم">
                <ErpInput
                  id="applicant-field-alias"
                  value={data.alias}
                  onChange={(e) => set("alias", e.target.value)}
                />
              </ErpField>
              <ErpField label="تاریخ تولد">
                <PersianCalendarComponent
                  id="applicant-field-birthDate"
                  value={data.birthDate}
                  onChange={(value) => set("birthDate", value)}
                  enableYearSelection
                  minYear={1300}
                />
              </ErpField>
              <ErpField label="محل تولد">
                <ErpInput
                  id="applicant-field-birthPlace"
                  value={data.birthPlace}
                  onChange={(e) => set("birthPlace", e.target.value)}
                />
              </ErpField>
              <ErpField label="وضعیت نظام وظیفه">
                <ErpSelect
                  id="applicant-field-militaryStatus"
                  value={data.militaryStatus}
                  onChange={(e) => set("militaryStatus", e.target.value)}
                >
                  <option value="">انتخاب</option>
                  <option>پایان خدمت</option>
                  <option>معاف</option>
                  <option>مشمول</option>
                  <option>غیرقابل اعمال</option>
                </ErpSelect>
              </ErpField>
              <ErpField label="نام پدر">
                <ErpInput
                  id="applicant-field-fatherName"
                  value={data.fatherName}
                  onChange={(e) => set("fatherName", e.target.value)}
                />
              </ErpField>
              <ErpField label="شغل پدر یا وضعیت">
                <ErpInput
                  id="applicant-field-fatherOccupation"
                  value={data.fatherOccupation}
                  onChange={(e) => set("fatherOccupation", e.target.value)}
                />
              </ErpField>
              <ErpField label="وضعیت تأهل">
                <ErpSelect
                  id="applicant-field-maritalStatus"
                  value={data.maritalStatus}
                  onChange={(e) => set("maritalStatus", e.target.value)}
                >
                  <option value="">انتخاب</option>
                  <option value="SINGLE">مجرد</option>
                  <option value="MARRIED">متأهل</option>
                </ErpSelect>
              </ErpField>
              {data.maritalStatus === "MARRIED" && (
                <>
                  <ErpField label="تعداد فرزندان">
                    <ErpInput
                      id="applicant-field-childrenCount"
                      inputMode="numeric"
                      min="0"
                      value={data.childrenCount}
                      onChange={(e) => set("childrenCount", normalizeIdentifierDigits(e.target.value))}
                    />
                  </ErpField>
                  <ErpField label="شغل همسر">
                    <ErpInput
                      id="applicant-field-spouseOccupation"
                      value={data.spouseOccupation}
                      onChange={(e) => set("spouseOccupation", e.target.value)}
                    />
                  </ErpField>
                </>
              )}
              <ErpField label="نوع هویت">
                <ErpSelect
                  id="applicant-field-identityKind"
                  value={data.identityKind}
                  onChange={(e) => set("identityKind", e.target.value)}
                >
                  <option value="IRANIAN">ایرانی</option>
                  <option value="FOREIGN">اتباع خارجی</option>
                </ErpSelect>
              </ErpField>
              {data.identityKind === "IRANIAN" ? (
                <ErpField label="کد ملی" error={submitted || isCorrection ? undefined : nationalCodeError}>
                  <ErpInput
                    id="applicant-field-nationalCode"
                    inputMode="numeric"
                    maxLength={10}
                    value={data.nationalCode}
                    onChange={(e) =>
                      set("nationalCode", normalizeIdentifierDigits(e.target.value))
                    }
                  />
                </ErpField>
              ) : (
                <>
                  <ErpField label="نوع مدرک هویتی">
                    <ErpInput
                      id="applicant-field-foreignIdentityType"
                      value={data.foreignIdentityType}
                      onChange={(e) =>
                        set("foreignIdentityType", e.target.value)
                      }
                    />
                  </ErpField>
                  <ErpField label="شماره مدرک">
                    <ErpInput
                      id="applicant-field-foreignIdentityNumber"
                      value={data.foreignIdentityNumber}
                      onChange={(e) =>
                        set("foreignIdentityNumber", e.target.value)
                      }
                    />
                  </ErpField>
                </>
              )}
            </div>
          </Section>
          <Section title="تماس و سکونت">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <ErpField label="نشانی محل سکونت">
                <ErpTextarea
                  id="applicant-field-address"
                  value={data.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </ErpField>
              <ErpField label="کد پستی" error={postalCodeError}>
                <ErpInput
                  id="applicant-field-postalCode"
                  inputMode="numeric"
                  maxLength={10}
                  value={data.postalCode}
                  onChange={(e) =>
                    set("postalCode", normalizeIdentifierDigits(e.target.value))
                  }
                />
              </ErpField>
              <ErpField label="شماره همراه" error={mobileError}>
                <ErpInput
                  id="applicant-field-mobile"
                  inputMode="tel"
                  maxLength={11}
                  value={data.mobile}
                  onChange={(e) => set("mobile", normalizeIdentifierDigits(e.target.value))}
                />
              </ErpField>
              <ErpField label="تلفن منزل یا ندارم">
                <ErpInput
                  id="applicant-field-homePhone"
                  value={data.homePhone}
                  onChange={(e) => set("homePhone", normalizeIdentifierDigits(e.target.value))}
                />
              </ErpField>
              <ErpField label="ایمیل" required={false}>
                <ErpInput
                  type="email"
                  value={data.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </ErpField>
              <ErpField label="شبکه‌های اجتماعی یا ندارم">
                <ErpInput
                  id="applicant-field-socialMedia"
                  value={data.socialMedia}
                  onChange={(e) => set("socialMedia", e.target.value)}
                />
              </ErpField>
            </div>
          </Section>
          <Section title="تحصیلات و بیمه">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <ErpField label="آخرین مقطع">
                <ErpSelect
                  id="applicant-field-educationLevel"
                  value={data.educationLevel}
                  onChange={(e) => {
                    set("educationLevel", e.target.value);
                    if (e.target.value !== "OTHER") set("educationLevelOther", "");
                  }}
                >
                  <option value="">انتخاب</option>
                  {EDUCATION_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </ErpSelect>
              </ErpField>
              {data.educationLevel === "OTHER" && (
                <ErpField label="عنوان مقطع" error={formErrors.find((item) => item.field === "educationLevelOther")?.message}>
                  <ErpInput
                    id="applicant-field-educationLevelOther"
                    value={data.educationLevelOther}
                    onChange={(e) => set("educationLevelOther", e.target.value)}
                  />
                </ErpField>
              )}
              <ErpField label="رشته تحصیلی">
                <ErpInput
                  id="applicant-field-fieldOfStudy"
                  value={data.fieldOfStudy}
                  onChange={(e) => set("fieldOfStudy", e.target.value)}
                />
              </ErpField>
              <ErpField label="سال اخذ مدرک" error={formErrors.find((item) => item.field === "graduationYear")?.message}>
                <PersianCalendarComponent
                  id="applicant-field-graduationYear"
                  yearOnly
                  enableYearSelection
                  minYear={1300}
                  maxYear={jalaliYear}
                  value={data.graduationYear}
                  onChange={(value) => set("graduationYear", normalizeIdentifierDigits(value))}
                />
              </ErpField>
              <ErpField label="سابقه بیمه تأمین اجتماعی">
                <ErpSelect
                  id="applicant-field-hasSocialSecurityHistory"
                  value={String(data.hasSocialSecurityHistory)}
                  onChange={(e) =>
                    set("hasSocialSecurityHistory", e.target.value === "true")
                  }
                >
                  <option value="">انتخاب</option>
                  <option value="true">دارم</option>
                  <option value="false">ندارم</option>
                </ErpSelect>
              </ErpField>
            </div>
          </Section>
          <Repeater
            title="سوابق کار حرفه‌ای"
            rows={data.workHistory}
            remove={(index) => set("workHistory", data.workHistory.filter((_: any, rowIndex: number) => rowIndex !== index))}
            add={() =>
              set("workHistory", [...data.workHistory, blank.workHistory[0]])
            }
            render={(row: any, i: number) => (
              <div className="grid gap-3 md:grid-cols-4">
                <ErpField label="نام سازمان/شرکت">
                  <ErpInput
                    id={`applicant-field-workHistory.${i}.organization`}
                    value={row.organization}
                    onChange={(e) => updateList("workHistory", i, "organization", e.target.value)}
                  />
                </ErpField>
                <ErpField label="مدت همکاری">
                  <ErpInput
                    id={`applicant-field-workHistory.${i}.duration`}
                    value={row.duration}
                    onChange={(e) => updateList("workHistory", i, "duration", e.target.value)}
                  />
                </ErpField>
                <ErpField label="آخرین سمت">
                  <ErpInput
                    id={`applicant-field-workHistory.${i}.lastPosition`}
                    value={row.lastPosition}
                    onChange={(e) => updateList("workHistory", i, "lastPosition", e.target.value)}
                  />
                </ErpField>
                <ErpField label="آخرین حقوق و مزایا (ریال)">
                  <ErpRialInput
                    id={`applicant-field-workHistory.${i}.lastSalaryBenefits`}
                    value={row.lastSalaryBenefits}
                    onValueChange={(lastSalaryBenefits) => updateList("workHistory", i, "lastSalaryBenefits", lastSalaryBenefits)}
                  />
                </ErpField>
              </div>
            )}
          />
          <Repeater
            title="مهارت‌های فنی، حرفه‌ای و عمومی"
            rows={data.skills}
            remove={(index) => set("skills", data.skills.filter((_: any, rowIndex: number) => rowIndex !== index))}
            add={() => set("skills", [...data.skills, blank.skills[0]])}
            render={(row: any, i: number) => (
              <div className="grid gap-3 md:grid-cols-3">
                <ErpField label="نام مهارت">
                  <ErpInput
                    id={`applicant-field-skills.${i}.name`}
                    value={row.name}
                    onChange={(e) => updateList("skills", i, "name", e.target.value)}
                  />
                </ErpField>
                <ErpField label="مدت آشنایی">
                  <ErpInput
                    id={`applicant-field-skills.${i}.familiarity`}
                    value={row.familiarity}
                    onChange={(e) => updateList("skills", i, "familiarity", e.target.value)}
                  />
                </ErpField>
                <ErpField label="سطح تسلط">
                  <ErpSelect
                    id={`applicant-field-skills.${i}.proficiency`}
                    value={row.proficiency}
                    onChange={(e) => updateList("skills", i, "proficiency", e.target.value)}
                  >
                    <option value="">انتخاب</option>
                    <option value="BEGINNER">مقدماتی</option>
                    <option value="INTERMEDIATE">متوسط</option>
                    <option value="ADVANCED">پیشرفته</option>
                  </ErpSelect>
                </ErpField>
              </div>
            )}
          />
          <Repeater
            title="زبان‌های خارجی"
            rows={data.languages}
            remove={(index) => set("languages", data.languages.filter((_: any, rowIndex: number) => rowIndex !== index))}
            add={() =>
              set("languages", [...data.languages, blank.languages[0]])
            }
            render={(row: any, i: number) => (
              <div className="grid gap-3 md:grid-cols-3">
                <ErpField label="نام زبان">
                  <ErpInput
                    id={`applicant-field-languages.${i}.name`}
                    value={row.name}
                    onChange={(e) => updateList("languages", i, "name", e.target.value)}
                  />
                </ErpField>
                <ErpField label="سطح خواندن/نوشتن">
                  <ErpSelect
                    id={`applicant-field-languages.${i}.level`}
                    value={row.level}
                    onChange={(e) => updateList("languages", i, "level", e.target.value)}
                  >
                    <option value="">انتخاب</option>
                    <option value="BEGINNER">مقدماتی</option>
                    <option value="INTERMEDIATE">متوسط</option>
                    <option value="ADVANCED">پیشرفته</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="سطح مکالمه">
                  <ErpSelect
                    id={`applicant-field-languages.${i}.proficiency`}
                    value={row.proficiency}
                    onChange={(e) => updateList("languages", i, "proficiency", e.target.value)}
                  >
                    <option value="">انتخاب</option>
                    <option value="BEGINNER">مقدماتی</option>
                    <option value="INTERMEDIATE">متوسط</option>
                    <option value="ADVANCED">پیشرفته</option>
                  </ErpSelect>
                </ErpField>
              </div>
            )}
          />
          <Section title="ترجیحات همکاری">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <ErpField label="نوع همکاری">
                <ErpSelect
                  value={data.cooperationType}
                  onChange={(e) => set("cooperationType", e.target.value)}
                >
                  <option value="FULL_TIME">تمام‌وقت</option>
                  <option value="PART_TIME">پاره‌وقت</option>
                </ErpSelect>
              </ErpField>
              <ErpField label="مدت همکاری">
                <ErpSelect
                  value={data.cooperationDuration}
                  onChange={(e) => set("cooperationDuration", e.target.value)}
                >
                  <option value="LONG_TERM">بلندمدت</option>
                  <option value="SHORT_TERM">کوتاه‌مدت</option>
                </ErpSelect>
              </ErpField>
              <ErpField label="شغل و سمت مورد تقاضا">
                <ErpInput
                  value={data.requestedPosition}
                  onChange={(e) => set("requestedPosition", e.target.value)}
                />
              </ErpField>
              <ErpField label="حقوق پیشنهادی (ریال)">
                <ErpRialInput
                  aria-label="حقوق پیشنهادی به ریال"
                  value={data.desiredSalary}
                  onValueChange={(desiredSalary) => set("desiredSalary", desiredSalary)}
                />
              </ErpField>
            </div>
          </Section>
          <Section title="پرسش‌های مصاحبه اولیه">
            <div className="space-y-4">
              {questions.map((question, i) => (
                <ErpField key={question} label={`${i + 1}. ${question}`}>
                  <ErpTextarea
                    rows={3}
                    value={data.questions[i]?.answer || ""}
                    onChange={(e) => {
                      const next = [...data.questions];
                      next[i] = { ...next[i], answer: e.target.value };
                      set("questions", next);
                    }}
                  />
                </ErpField>
              ))}
            </div>
          </Section>
          <section className="rounded-3xl bg-[var(--sds-surface-raised)] p-5 shadow-sm">
            <div id="applicant-field-declaration" tabIndex={-1}>
              <ErpCheckbox
                label="صحت اطلاعات فوق را تأیید می‌کنم و اطلاعیه نگهداری اطلاعات پرونده و جست‌وجوی پروفایل عادی در بانک متقاضیان را پذیرفته‌ام."
                checked={declaration}
                onChange={(e) => { setDeclaration(e.target.checked); setFormErrors((current) => current.filter((item) => item.field !== "declaration")); }}
              />
              {formErrors.some((item) => item.field === "declaration") && <p className="mt-2 text-sm text-[var(--sds-danger)]">تأیید صحت اطلاعات الزامی است.</p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <ErpButton label="ذخیره پیش‌نویس" variant="outline" onClick={() => run(saveApplicationDraft, "پیش‌نویس ذخیره شد.")} />
              <ErpButton
                label="ارسال نهایی"
                tone="success"
                disabled={busy}
                onClick={submitApplication}
              />
            </div>
          </section>
        </fieldset>
        {submitted && <ErpInlineState className="mt-5" kind="success" title="فرم نهایی ثبت شده و تا زمان درخواست اصلاح منابع انسانی قفل است." />}
        <ApplicantFormalAssessments
          assessments={application?.formalAssessments}
          busy={busy}
          run={run}
          showValidationErrors={assessmentValidationRequested}
          onAssessmentValid={(kind) => setFormErrors((current) => current.filter((item) => item.field !== `assessment-${kind}`))}
        />
        {application?.compensation && (
          <section className="mt-5 rounded-3xl bg-[var(--sds-surface-raised)] p-5 shadow-sm">
            <h2 className="text-lg font-black">حقوق و مزایا</h2>
            <div className="mt-3 divide-y">
              {(application.compensation.componentsJson || []).map(
                (item: any) => (
                  <div key={item.label} className="flex justify-between py-2">
                    <span>{item.label}</span>
                    <b>
                      {formatPrice(Number(item.amountRials), 'ریال')}
                    </b>
                  </div>
                ),
              )}
              <div className="flex justify-between py-3 text-lg">
                <b>جمع</b>
                <b>
                  {formatPrice(Number(application.compensation.totalRials), 'ریال')}
                </b>
              </div>
            </div>
            {application.compensation.collateralRequirement && (
              <ErpCard className="mt-4 p-4">
                <ErpInlineState kind="stale" title="شرایط وثیقه این پیشنهاد" />
                <div className="mt-3 space-y-2">
                  {(application.compensation.collateralRequirement.lines?.length
                    ? application.compensation.collateralRequirement.lines
                    : [application.compensation.collateralRequirement]
                  ).map((line: any, index: number) => (
                    <div key={line.lineKey || line.id || index} className="rounded-xl border border-[var(--sds-border-subtle)] p-3 text-sm">
                      <b>{line.type === "OTHER" ? line.customTitle : hrDisplayLabel(line.type)}</b>
                      {line.amountRials && <span className="me-2">— {formatPrice(Number(line.amountRials), 'ریال')}</span>}
                      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{line.candidateExplanation}</p>
                    </div>
                  ))}
                </div>
              </ErpCard>
            )}
            {application.compensation.candidateDecision === "ACCEPTED" && (
              <ErpInlineState className="mt-4" kind="success" title="پذیرش پیشنهاد همکاری با موفقیت ثبت شد." />
            )}
            {application.compensation.candidateDecision === "DECLINED" && (
              <ErpCard className="mt-4 space-y-2 p-4">
                <ErpInlineState kind="error" title="رد پیشنهاد همکاری با موفقیت ثبت شد." />
                <p className="text-sm">دسته دلیل: {hrDisplayLabel(application.compensation.candidateDeclineCategory)}</p>
                {application.compensation.candidateDecisionNote && (
                  <p className="text-sm text-[var(--sds-text-secondary)]">توضیح شما: {application.compensation.candidateDecisionNote}</p>
                )}
              </ErpCard>
            )}
            {!application.compensation.candidateDecision && (
              <div className="mt-4 space-y-3 border-t pt-4">
                <ErpField label="تصمیم درباره پیشنهاد همکاری">
                  <ErpSelect
                    value={offerDecision}
                    onChange={(event) => { setOfferDecision(event.target.value); setOfferAccepted(false); }}
                  >
                    <option value="">انتخاب کنید</option>
                    <option value="ACCEPTED">پذیرش پیشنهاد</option>
                    <option value="DECLINED">رد پیشنهاد</option>
                  </ErpSelect>
                </ErpField>
                {offerDecision === "ACCEPTED" && (
                  <div className="space-y-3">
                    <ErpCheckbox
                      label="پیشنهاد همکاری را مطالعه کرده‌ام و می‌پذیرم."
                      checked={offerAccepted}
                      onChange={(event) => setOfferAccepted(event.target.checked)}
                    />
                    <ErpButton
                      label="پذیرش پیشنهاد"
                      tone="success"
                      disabled={busy || !offerAccepted}
                      onClick={() => run(() => applicantHiringAPI.acceptCompensation(), "پیشنهاد همکاری پذیرفته شد.")}
                    />
                  </div>
                )}
                {offerDecision === "DECLINED" && (
                  <div className="grid gap-2 border-t pt-3 md:grid-cols-2">
                    <ErpSelect
                      value={decline.category}
                      onChange={(event) => setDecline({ ...decline, category: event.target.value })}
                    >
                      <option value="">دلیل رد پیشنهاد</option>
                      <option value="COMPENSATION">حقوق و مزایا</option>
                      <option value="ROLE">شرح نقش یا مسئولیت‌ها</option>
                      <option value="START_DATE">تاریخ شروع همکاری</option>
                      <option value="PERSONAL">شرایط شخصی</option>
                      <option value="OTHER">سایر</option>
                    </ErpSelect>
                    <ErpInput
                      placeholder="توضیح تکمیلی (اختیاری)"
                      value={decline.note}
                      onChange={(event) => setDecline({ ...decline, note: event.target.value })}
                    />
                    <ErpButton
                      label="رد پیشنهاد"
                      tone="danger"
                      disabled={busy || !decline.category}
                    onClick={() =>
                      run(
                        () =>
                          applicantHiringAPI.declineCompensation(
                            decline.category,
                            decline.note,
                          ),
                        "رد پیشنهاد همکاری ثبت شد.",
                      )
                    }
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Section({
  title,
  children,
  emphasis = "default",
}: {
  title: string;
  children: React.ReactNode;
  emphasis?: "default" | "neumorphic";
}) {
  return (
    <section className={emphasis === "neumorphic" ? "sds-neumorphic-applicant-card p-5 sm:p-6" : "rounded-3xl bg-[var(--sds-surface-raised)] p-5 shadow-sm"}>
      <h2 className="mb-4 text-lg font-black">{title}</h2>
      {children}
    </section>
  );
}
function Repeater({
  title,
  rows,
  add,
  remove,
  render,
}: {
  title: string;
  rows: any[];
  add: () => void;
  remove: (index: number) => void;
  render: (row: any, index: number) => React.ReactNode;
}) {
  return (
    <Section title={title}>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={index} className="space-y-2 rounded-xl border border-[var(--sds-border-default)] p-3">
            {render(row, index)}
            <ErpButton label="حذف ردیف" variant="ghost" tone="danger" onClick={() => remove(index)} />
          </div>
        ))}
      </div>
      <ErpPressable
        type="button"
        onClick={add}
        className="mt-3 rounded-lg border px-3 py-1 text-sm"
      >
        افزودن ردیف
      </ErpPressable>
    </Section>
  );
}
