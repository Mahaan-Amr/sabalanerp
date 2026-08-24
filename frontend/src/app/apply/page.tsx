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
  const [fullName, setFullName] = useState("");
  const [offerFullName, setOfferFullName] = useState("");
  const [offerAccepted, setOfferAccepted] = useState(false);
  const [decline, setDecline] = useState({ category: "", note: "" });
  const [declaration, setDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

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
    if (revisionData)
      setData({
        ...blank,
        ...normalizeApplicantNumericDraft(revisionData),
        birthDate: revisionData.birthDate
          ? PersianCalendar.toPersian(revisionData.birthDate)
          : "",
        questions: snapshotAnswers(revisionData.questions),
      });
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
  };
  const saveApplicationDraft = () => {
    const normalizedData = {
      ...data,
      birthDate: data.birthDate ? toIsoDate(data.birthDate) : "",
    };
    const payload = isCorrection
      ? Object.fromEntries(
          correctionFields.map((field) => [field, normalizedData[field]]),
        )
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
  };

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
                  label={`${detail?.label || "فیلد نیازمند اصلاح"}${detail?.explanation ? ` — ${detail.explanation}` : ""}`}
                >
                  <ErpTextarea
                    value={
                      typeof data[key] === "object"
                        ? JSON.stringify(data[key])
                        : String(data[key] ?? "")
                    }
                    onChange={(e) => setCorrectionValue(key, e.target.value)}
                  />
                </ErpField>
                );
              })}
            </div>
            <ErpCheckbox className="mt-4" label="صحت نسخه اصلاح‌شده را تأیید می‌کنم." checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
            <ErpField className="mt-3" label="نام و نام خانوادگی" required><ErpInput value={fullName} onChange={(e) => setFullName(e.target.value)} /></ErpField>
            <div className="mt-3 flex gap-2">
              <ErpButton
                label="ذخیره اصلاحات"
                disabled={busy}
                onClick={() =>
                  run(
                    saveApplicationDraft,
                    "اصلاحات ذخیره شد.",
                  )
                }
                variant="outline"
              />
              <ErpButton
                label="ارسال مجدد"
                disabled={busy || !declaration || !fullName}
                onClick={() =>
                  run(async () => {
                    await saveApplicationDraft();
                    await applicantHiringAPI.submit({
                      declarationAccepted: declaration,
                      declarationFullName: fullName,
                    });
                  }, "نسخه اصلاح‌شده ارسال شد.")
                }
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
                  value={data.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
              </ErpField>
              <ErpField label="نام خانوادگی">
                <ErpInput
                  value={data.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </ErpField>
              <ErpField label="نام مستعار یا ندارم">
                <ErpInput
                  value={data.alias}
                  onChange={(e) => set("alias", e.target.value)}
                />
              </ErpField>
              <ErpField label="تاریخ تولد">
                <PersianCalendarComponent
                  value={data.birthDate}
                  onChange={(value) => set("birthDate", value)}
                  enableYearSelection
                  minYear={1300}
                />
              </ErpField>
              <ErpField label="محل تولد">
                <ErpInput
                  value={data.birthPlace}
                  onChange={(e) => set("birthPlace", e.target.value)}
                />
              </ErpField>
              <ErpField label="وضعیت نظام وظیفه">
                <ErpSelect
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
                  value={data.fatherName}
                  onChange={(e) => set("fatherName", e.target.value)}
                />
              </ErpField>
              <ErpField label="شغل پدر یا وضعیت">
                <ErpInput
                  value={data.fatherOccupation}
                  onChange={(e) => set("fatherOccupation", e.target.value)}
                />
              </ErpField>
              <ErpField label="وضعیت تأهل">
                <ErpSelect
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
                      inputMode="numeric"
                      min="0"
                      value={data.childrenCount}
                      onChange={(e) => set("childrenCount", normalizeIdentifierDigits(e.target.value))}
                    />
                  </ErpField>
                  <ErpField label="شغل همسر">
                    <ErpInput
                      value={data.spouseOccupation}
                      onChange={(e) => set("spouseOccupation", e.target.value)}
                    />
                  </ErpField>
                </>
              )}
              <ErpField label="نوع هویت">
                <ErpSelect
                  value={data.identityKind}
                  onChange={(e) => set("identityKind", e.target.value)}
                >
                  <option value="IRANIAN">ایرانی</option>
                  <option value="FOREIGN">اتباع خارجی</option>
                </ErpSelect>
              </ErpField>
              {data.identityKind === "IRANIAN" ? (
                <ErpField label="کد ملی">
                  <ErpInput
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
                      value={data.foreignIdentityType}
                      onChange={(e) =>
                        set("foreignIdentityType", e.target.value)
                      }
                    />
                  </ErpField>
                  <ErpField label="شماره مدرک">
                    <ErpInput
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
                  value={data.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </ErpField>
              <ErpField label="کد پستی">
                <ErpInput
                  inputMode="numeric"
                  maxLength={10}
                  value={data.postalCode}
                  onChange={(e) =>
                    set("postalCode", normalizeIdentifierDigits(e.target.value))
                  }
                />
              </ErpField>
              <ErpField label="شماره همراه">
                <ErpInput
                  value={data.mobile}
                  onChange={(e) => set("mobile", normalizeIdentifierDigits(e.target.value))}
                />
              </ErpField>
              <ErpField label="تلفن منزل یا ندارم">
                <ErpInput
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
                  value={data.socialMedia}
                  onChange={(e) => set("socialMedia", e.target.value)}
                />
              </ErpField>
            </div>
          </Section>
          <Section title="تحصیلات و بیمه">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <ErpField label="آخرین مقطع">
                <ErpInput
                  value={data.educationLevel}
                  onChange={(e) => set("educationLevel", e.target.value)}
                />
              </ErpField>
              <ErpField label="رشته تحصیلی">
                <ErpInput
                  value={data.fieldOfStudy}
                  onChange={(e) => set("fieldOfStudy", e.target.value)}
                />
              </ErpField>
              <ErpField label="سال اخذ مدرک">
                <ErpInput
                  value={data.graduationYear}
                  onChange={(e) => set("graduationYear", normalizeIdentifierDigits(e.target.value))}
                />
              </ErpField>
              <ErpField label="سابقه بیمه تأمین اجتماعی">
                <ErpSelect
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
            add={() =>
              set("workHistory", [...data.workHistory, blank.workHistory[0]])
            }
            render={(row: any, i: number) => (
              <div className="grid gap-3 md:grid-cols-4">
                <ErpInput
                  placeholder="نام سازمان/شرکت"
                  value={row.organization}
                  onChange={(e) =>
                    updateList("workHistory", i, "organization", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="مدت همکاری"
                  value={row.duration}
                  onChange={(e) =>
                    updateList("workHistory", i, "duration", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="آخرین سمت"
                  value={row.lastPosition}
                  onChange={(e) =>
                    updateList("workHistory", i, "lastPosition", e.target.value)
                  }
                />
                <ErpRialInput
                  aria-label="آخرین حقوق و مزایا به ریال"
                  placeholder="آخرین حقوق و مزایا (ریال)"
                  value={row.lastSalaryBenefits}
                  onValueChange={(lastSalaryBenefits) => updateList("workHistory", i, "lastSalaryBenefits", lastSalaryBenefits)}
                />
              </div>
            )}
          />
          <Repeater
            title="مهارت‌های فنی، حرفه‌ای و عمومی"
            rows={data.skills}
            add={() => set("skills", [...data.skills, blank.skills[0]])}
            render={(row: any, i: number) => (
              <div className="grid gap-3 md:grid-cols-3">
                <ErpInput
                  placeholder="نام مهارت"
                  value={row.name}
                  onChange={(e) =>
                    updateList("skills", i, "name", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="مدت آشنایی"
                  value={row.familiarity}
                  onChange={(e) =>
                    updateList("skills", i, "familiarity", e.target.value)
                  }
                />
                <ErpSelect
                  value={row.proficiency}
                  onChange={(e) =>
                    updateList("skills", i, "proficiency", e.target.value)
                  }
                >
                  <option value="">سطح تسلط</option>
                  <option value="BEGINNER">مقدماتی</option>
                  <option value="INTERMEDIATE">متوسط</option>
                  <option value="ADVANCED">پیشرفته</option>
                </ErpSelect>
              </div>
            )}
          />
          <Repeater
            title="زبان‌های خارجی"
            rows={data.languages}
            add={() =>
              set("languages", [...data.languages, blank.languages[0]])
            }
            render={(row: any, i: number) => (
              <div className="grid gap-3 md:grid-cols-3">
                <ErpInput
                  placeholder="نام زبان"
                  value={row.name}
                  onChange={(e) =>
                    updateList("languages", i, "name", e.target.value)
                  }
                />
                <ErpSelect
                  value={row.level}
                  onChange={(e) =>
                    updateList("languages", i, "level", e.target.value)
                  }
                >
                  <option value="">سطح خواندن/نوشتن</option>
                  <option value="BEGINNER">مقدماتی</option>
                  <option value="INTERMEDIATE">متوسط</option>
                  <option value="ADVANCED">پیشرفته</option>
                </ErpSelect>
                <ErpSelect
                  value={row.proficiency}
                  onChange={(e) =>
                    updateList("languages", i, "proficiency", e.target.value)
                  }
                >
                  <option value="">سطح مکالمه</option>
                  <option value="BEGINNER">مقدماتی</option>
                  <option value="INTERMEDIATE">متوسط</option>
                  <option value="ADVANCED">پیشرفته</option>
                </ErpSelect>
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
            <label className="flex gap-3 text-sm">
              <ErpInput
                type="checkbox"
                checked={declaration}
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              <span>
                صحت اطلاعات فوق را تأیید می‌کنم و اطلاعیه نگهداری اطلاعات پرونده
                و جست‌وجوی پروفایل عادی در بانک متقاضیان را پذیرفته‌ام.
              </span>
            </label>
            <ErpInput
              className="mt-3"
              placeholder="نام و نام خانوادگی برای اظهارنامه"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <ErpButton label="ذخیره پیش‌نویس" variant="outline" onClick={() => run(saveApplicationDraft, "پیش‌نویس ذخیره شد.")} />
              <ErpButton
                label="ارسال نهایی"
                tone="success"
                disabled={!declaration || !fullName}
                onClick={() =>
                  run(async () => {
                    await saveApplicationDraft();
                    await applicantHiringAPI.submit({
                      declarationAccepted: declaration,
                      declarationFullName: fullName,
                    });
                  }, "فرم نهایی ارسال و قفل شد.")
                }
              />
            </div>
          </section>
        </fieldset>
        {submitted && <ErpInlineState className="mt-5" kind="success" title="فرم نهایی ثبت شده و تا زمان درخواست اصلاح منابع انسانی قفل است." />}
        <ApplicantFormalAssessments
          assessments={application?.formalAssessments}
          busy={busy}
          run={run}
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
                <p className="mt-2 text-sm">
                  {application.compensation.collateralRequirement.candidateExplanation}
                </p>
                <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                  <span>نوع: {hrDisplayLabel(application.compensation.collateralRequirement.type)}</span>
                  {application.compensation.collateralRequirement.amountRials && (
                    <span>
                      مبلغ: {formatPrice(Number(application.compensation.collateralRequirement.amountRials), 'ریال')}
                    </span>
                  )}
                </div>
              </ErpCard>
            )}
            {!application.compensation.candidateDecision && (
              <div className="mt-4 space-y-3 border-t pt-4">
                <label className="flex gap-2 text-sm">
                  <ErpInput
                    type="checkbox"
                    checked={offerAccepted}
                    onChange={(event) => setOfferAccepted(event.target.checked)}
                  />
                  پیشنهاد همکاری را مطالعه کرده‌ام و می‌پذیرم.
                </label>
                <ErpInput
                  placeholder="نام کامل برای پذیرش پیشنهاد"
                  value={offerFullName}
                  onChange={(event) => setOfferFullName(event.target.value)}
                />
                <ErpPressable type="submit"
                  disabled={!offerAccepted || !offerFullName.trim()}
                  onClick={() =>
                    run(
                      () =>
                        applicantHiringAPI.acceptCompensation(offerFullName),
                      "پیشنهاد همکاری پذیرفته شد.",
                    )
                  }
                  className="rounded-xl bg-[var(--sds-surface-raised)] px-5 py-2 font-bold text-[var(--sds-text-primary)] disabled:opacity-50"
                >
                  پذیرش پیشنهاد
                </ErpPressable>
                <div className="grid gap-2 border-t pt-3 md:grid-cols-2">
                  <ErpSelect
                    value={decline.category}
                    onChange={(event) =>
                      setDecline({ ...decline, category: event.target.value })
                    }
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
                    onChange={(event) =>
                      setDecline({ ...decline, note: event.target.value })
                    }
                  />
                  <ErpPressable type="submit"
                    disabled={!decline.category}
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
                    className="rounded-xl border border-[var(--sds-danger-border)] px-5 py-2 font-bold text-[var(--sds-danger)] disabled:opacity-50"
                  >
                    رد پیشنهاد
                  </ErpPressable>
                </div>
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
  render,
}: {
  title: string;
  rows: any[];
  add: () => void;
  render: (row: any, index: number) => React.ReactNode;
}) {
  return (
    <Section title={title}>
      <div className="space-y-3">{rows.map(render)}</div>
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
