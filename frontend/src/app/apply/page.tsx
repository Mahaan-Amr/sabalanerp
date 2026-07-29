'use client';
import { ErpInput, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';
import { useEffect, useMemo, useState } from "react";
import { applicantHiringAPI, hiringError } from "@/lib/hiringApi";
import { normalizeIranianMobile } from "@/lib/phoneFormat";
import { ThemeToggle } from "@/components/ThemeToggle";
import PersianCalendarComponent from "@/components/PersianCalendar";
import PersianCalendar from "@/lib/persian-calendar";
import { toIsoDate } from "@/features/hr/hrUi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";

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
  questions: questions.map(() => ""),
};

const inputClass =
  "w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] placeholder:text-[var(--sds-text-secondary)] outline-none focus:border-[var(--sds-success-border)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:placeholder:text-[var(--sds-text-muted)]";

function Field({
  label,
  children,
  required = true,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
      <span>
        {label}
        {required && <b className="mr-1 text-[var(--sds-danger)]">*</b>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

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
    const result = await applicantHiringAPI.get();
    const next = result.data.data;
    setApplication(next);
    const revisionData = next.revision?.dataJson;
    if (revisionData)
      setData({
        ...blank,
        ...revisionData,
        birthDate: revisionData.birthDate
          ? PersianCalendar.toPersian(revisionData.birthDate)
          : "",
        questions: revisionData.questions || blank.questions,
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

  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setBusy(true);
      setError("");
      await action();
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

  const set = (key: string, value: any) =>
    setData((old: any) => ({ ...old, [key]: value }));
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
  ) =>
    setData((old: any) => ({
      ...old,
      [key]: old[key].map((item: any, i: number) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    }));

  if (!verified)
    return (
      <main dir="rtl" lang="fa" className="sds-workspace sds-neumorphic-applicant-shell hr-applicant-shell min-h-screen px-4 py-16 text-[var(--sds-text-primary)]">
        <section className="sds-neumorphic-applicant-card mx-auto max-w-md p-7">
          <div className="mb-4 flex justify-end"><ThemeToggle /></div>
          <h1 className="text-2xl font-black">فرم استخدام سبلان</h1>
          <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
            شماره همراهی که پیامک را دریافت کرده و کد شش‌رقمی همان پیامک را وارد کنید.
          </p>
          {error && (
            <p className="mt-4 rounded-xl bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)]">
              {error}
            </p>
          )}
          <>
            <label className="mt-6 block text-sm font-medium text-[var(--sds-text-primary)]">
              شماره همراه
              <ErpInput
                dir="ltr"
                className={`${inputClass} mt-1 text-left`}
                inputMode="tel"
                autoComplete="tel"
                placeholder="09123456789"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-[var(--sds-text-primary)]">
              کد ورود شش‌رقمی
            <ErpInput
              dir="ltr"
              className={`${inputClass} mt-1 text-center text-xl tracking-[.5em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9۰-۹٠-٩]/g, ""))}
            />
            </label>
            <ErpPressable type="submit"
              disabled={busy || !normalizeIranianMobile(mobile) || otp.length !== 6}
              onClick={verify}
              className="mt-4 w-full rounded-xl bg-[var(--sds-success)] px-4 py-3 font-bold text-[var(--sds-text-inverse)] disabled:opacity-50"
            >
              تأیید و ورود
            </ErpPressable>
            <p className="mt-4 text-xs text-[var(--sds-text-secondary)]">اگر کد شما منقضی شده است، با واحد منابع انسانی تماس بگیرید.</p>
          </>
        </section>
      </main>
    );

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
              onClick={() => {
                sessionStorage.removeItem("hrApplicantSession");
                setVerified(false);
                setApplication(undefined);
                setMessage("");
                setError("");
              }}
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
        {error && (
          <p className="mt-4 rounded-xl bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)]">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-4 rounded-xl bg-[var(--sds-success-surface)] p-3 text-sm text-[var(--sds-success)]">
            {message}
          </p>
        )}
        {isCorrection && (
          <section className="mt-4 rounded-xl bg-[var(--sds-warning-surface)] p-4 text-sm text-[var(--sds-warning)]">
            فرم برای اصلاح بازگردانده شده است:{" "}
            {application.revision.correctionReason}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {correctionFields.map((key) => {
                const detail = correctionDetails.find(
                  (item: any) => item.fieldKey === key,
                );
                return (
                <Field
                  key={key}
                  label={`${detail?.label || "فیلد نیازمند اصلاح"}${detail?.explanation ? ` — ${detail.explanation}` : ""}`}
                >
                  <ErpTextarea
                    className={inputClass}
                    value={
                      typeof data[key] === "object"
                        ? JSON.stringify(data[key])
                        : String(data[key] ?? "")
                    }
                    onChange={(e) => setCorrectionValue(key, e.target.value)}
                  />
                </Field>
                );
              })}
            </div>
            <label className="mt-4 flex gap-2">
              <ErpInput
                type="checkbox"
                checked={declaration}
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              صحت نسخه اصلاح‌شده را تأیید می‌کنم.
            </label>
            <ErpInput
              className={`${inputClass} mt-3`}
              placeholder="نام و نام خانوادگی"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <ErpPressable type="submit"
                disabled={busy}
                onClick={() =>
                  run(
                    saveApplicationDraft,
                    "اصلاحات ذخیره شد.",
                  )
                }
                className="rounded-xl border px-4 py-2"
              >
                ذخیره اصلاحات
              </ErpPressable>
              <ErpPressable type="submit"
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
                className="rounded-xl bg-[var(--sds-success)] px-4 py-2 font-bold text-[var(--sds-text-inverse)] disabled:opacity-50"
              >
                ارسال مجدد
              </ErpPressable>
            </div>
          </section>
        )}
        <fieldset
          disabled={submitted || busy || isCorrection}
          className="mt-5 space-y-5 disabled:opacity-70"
        >
          <Section title="مشخصات فردی" emphasis="neumorphic">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="نام">
                <ErpInput
                  className={inputClass}
                  value={data.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
              </Field>
              <Field label="نام خانوادگی">
                <ErpInput
                  className={inputClass}
                  value={data.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </Field>
              <Field label="نام مستعار یا ندارم">
                <ErpInput
                  className={inputClass}
                  value={data.alias}
                  onChange={(e) => set("alias", e.target.value)}
                />
              </Field>
              <Field label="تاریخ تولد">
                <PersianCalendarComponent
                  value={data.birthDate}
                  onChange={(value) => set("birthDate", value)}
                  enableYearSelection
                  minYear={1300}
                />
              </Field>
              <Field label="محل تولد">
                <ErpInput
                  className={inputClass}
                  value={data.birthPlace}
                  onChange={(e) => set("birthPlace", e.target.value)}
                />
              </Field>
              <Field label="وضعیت نظام وظیفه">
                <ErpSelect
                  className={inputClass}
                  value={data.militaryStatus}
                  onChange={(e) => set("militaryStatus", e.target.value)}
                >
                  <option value="">انتخاب</option>
                  <option>پایان خدمت</option>
                  <option>معاف</option>
                  <option>مشمول</option>
                  <option>غیرقابل اعمال</option>
                </ErpSelect>
              </Field>
              <Field label="نام پدر">
                <ErpInput
                  className={inputClass}
                  value={data.fatherName}
                  onChange={(e) => set("fatherName", e.target.value)}
                />
              </Field>
              <Field label="شغل پدر یا وضعیت">
                <ErpInput
                  className={inputClass}
                  value={data.fatherOccupation}
                  onChange={(e) => set("fatherOccupation", e.target.value)}
                />
              </Field>
              <Field label="وضعیت تأهل">
                <ErpSelect
                  className={inputClass}
                  value={data.maritalStatus}
                  onChange={(e) => set("maritalStatus", e.target.value)}
                >
                  <option value="">انتخاب</option>
                  <option value="SINGLE">مجرد</option>
                  <option value="MARRIED">متأهل</option>
                </ErpSelect>
              </Field>
              {data.maritalStatus === "MARRIED" && (
                <>
                  <Field label="تعداد فرزندان">
                    <ErpInput
                      type="number"
                      min="0"
                      className={inputClass}
                      value={data.childrenCount}
                      onChange={(e) => set("childrenCount", e.target.value)}
                    />
                  </Field>
                  <Field label="شغل همسر">
                    <ErpInput
                      className={inputClass}
                      value={data.spouseOccupation}
                      onChange={(e) => set("spouseOccupation", e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="نوع هویت">
                <ErpSelect
                  className={inputClass}
                  value={data.identityKind}
                  onChange={(e) => set("identityKind", e.target.value)}
                >
                  <option value="IRANIAN">ایرانی</option>
                  <option value="FOREIGN">اتباع خارجی</option>
                </ErpSelect>
              </Field>
              {data.identityKind === "IRANIAN" ? (
                <Field label="کد ملی">
                  <ErpInput
                    inputMode="numeric"
                    maxLength={10}
                    className={inputClass}
                    value={data.nationalCode}
                    onChange={(e) =>
                      set("nationalCode", e.target.value.replace(/\D/g, ""))
                    }
                  />
                </Field>
              ) : (
                <>
                  <Field label="نوع مدرک هویتی">
                    <ErpInput
                      className={inputClass}
                      value={data.foreignIdentityType}
                      onChange={(e) =>
                        set("foreignIdentityType", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="شماره مدرک">
                    <ErpInput
                      className={inputClass}
                      value={data.foreignIdentityNumber}
                      onChange={(e) =>
                        set("foreignIdentityNumber", e.target.value)
                      }
                    />
                  </Field>
                </>
              )}
            </div>
          </Section>
          <Section title="تماس و سکونت">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="نشانی محل سکونت">
                <ErpTextarea
                  className={inputClass}
                  value={data.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </Field>
              <Field label="کد پستی">
                <ErpInput
                  inputMode="numeric"
                  maxLength={10}
                  className={inputClass}
                  value={data.postalCode}
                  onChange={(e) =>
                    set("postalCode", e.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <Field label="شماره همراه">
                <ErpInput
                  className={inputClass}
                  value={data.mobile}
                  onChange={(e) => set("mobile", e.target.value)}
                />
              </Field>
              <Field label="تلفن منزل یا ندارم">
                <ErpInput
                  className={inputClass}
                  value={data.homePhone}
                  onChange={(e) => set("homePhone", e.target.value)}
                />
              </Field>
              <Field label="ایمیل" required={false}>
                <ErpInput
                  type="email"
                  className={inputClass}
                  value={data.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
              <Field label="شبکه‌های اجتماعی یا ندارم">
                <ErpInput
                  className={inputClass}
                  value={data.socialMedia}
                  onChange={(e) => set("socialMedia", e.target.value)}
                />
              </Field>
            </div>
          </Section>
          <Section title="تحصیلات و بیمه">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="آخرین مقطع">
                <ErpInput
                  className={inputClass}
                  value={data.educationLevel}
                  onChange={(e) => set("educationLevel", e.target.value)}
                />
              </Field>
              <Field label="رشته تحصیلی">
                <ErpInput
                  className={inputClass}
                  value={data.fieldOfStudy}
                  onChange={(e) => set("fieldOfStudy", e.target.value)}
                />
              </Field>
              <Field label="سال اخذ مدرک">
                <ErpInput
                  className={inputClass}
                  value={data.graduationYear}
                  onChange={(e) => set("graduationYear", e.target.value)}
                />
              </Field>
              <Field label="سابقه بیمه تأمین اجتماعی">
                <ErpSelect
                  className={inputClass}
                  value={String(data.hasSocialSecurityHistory)}
                  onChange={(e) =>
                    set("hasSocialSecurityHistory", e.target.value === "true")
                  }
                >
                  <option value="">انتخاب</option>
                  <option value="true">دارم</option>
                  <option value="false">ندارم</option>
                </ErpSelect>
              </Field>
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
                  className={inputClass}
                  value={row.organization}
                  onChange={(e) =>
                    updateList("workHistory", i, "organization", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="مدت همکاری"
                  className={inputClass}
                  value={row.duration}
                  onChange={(e) =>
                    updateList("workHistory", i, "duration", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="آخرین سمت"
                  className={inputClass}
                  value={row.lastPosition}
                  onChange={(e) =>
                    updateList("workHistory", i, "lastPosition", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="آخرین حقوق و مزایا"
                  className={inputClass}
                  value={row.lastSalaryBenefits}
                  onChange={(e) =>
                    updateList(
                      "workHistory",
                      i,
                      "lastSalaryBenefits",
                      e.target.value,
                    )
                  }
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
                  className={inputClass}
                  value={row.name}
                  onChange={(e) =>
                    updateList("skills", i, "name", e.target.value)
                  }
                />
                <ErpInput
                  placeholder="مدت آشنایی"
                  className={inputClass}
                  value={row.familiarity}
                  onChange={(e) =>
                    updateList("skills", i, "familiarity", e.target.value)
                  }
                />
                <ErpSelect
                  className={inputClass}
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
                  className={inputClass}
                  value={row.name}
                  onChange={(e) =>
                    updateList("languages", i, "name", e.target.value)
                  }
                />
                <ErpSelect
                  className={inputClass}
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
                  className={inputClass}
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
              <Field label="نوع همکاری">
                <ErpSelect
                  className={inputClass}
                  value={data.cooperationType}
                  onChange={(e) => set("cooperationType", e.target.value)}
                >
                  <option value="FULL_TIME">تمام‌وقت</option>
                  <option value="PART_TIME">پاره‌وقت</option>
                </ErpSelect>
              </Field>
              <Field label="مدت همکاری">
                <ErpSelect
                  className={inputClass}
                  value={data.cooperationDuration}
                  onChange={(e) => set("cooperationDuration", e.target.value)}
                >
                  <option value="LONG_TERM">بلندمدت</option>
                  <option value="SHORT_TERM">کوتاه‌مدت</option>
                </ErpSelect>
              </Field>
              <Field label="شغل و سمت مورد تقاضا">
                <ErpInput
                  className={inputClass}
                  value={data.requestedPosition}
                  onChange={(e) => set("requestedPosition", e.target.value)}
                />
              </Field>
              <Field label="حقوق پیشنهادی">
                <ErpInput
                  inputMode="numeric"
                  className={inputClass}
                  value={data.desiredSalary}
                  onChange={(e) =>
                    set("desiredSalary", e.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
            </div>
          </Section>
          <Section title="پرسش‌های مصاحبه اولیه">
            <div className="space-y-4">
              {questions.map((question, i) => (
                <Field key={question} label={`${i + 1}. ${question}`}>
                  <ErpTextarea
                    rows={3}
                    className={inputClass}
                    value={data.questions[i] || ""}
                    onChange={(e) => {
                      const next = [...data.questions];
                      next[i] = e.target.value;
                      set("questions", next);
                    }}
                  />
                </Field>
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
              className={`${inputClass} mt-3`}
              placeholder="نام و نام خانوادگی برای اظهارنامه"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <ErpPressable
                type="button"
                onClick={() =>
                  run(
                    saveApplicationDraft,
                    "پیش‌نویس ذخیره شد.",
                  )
                }
                className="rounded-xl border px-5 py-2 font-bold"
              >
                ذخیره پیش‌نویس
              </ErpPressable>
              <ErpPressable
                type="button"
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
                className="rounded-xl bg-[var(--sds-success)] px-5 py-2 font-bold text-[var(--sds-text-inverse)] disabled:opacity-50"
              >
                ارسال نهایی
              </ErpPressable>
            </div>
          </section>
        </fieldset>
        {submitted && (
          <p className="mt-5 rounded-2xl bg-[var(--sds-success-surface)] p-5 text-[var(--sds-success)]">
            فرم نهایی ثبت شده و تا زمان درخواست اصلاح منابع انسانی قفل است.
          </p>
        )}
        {application?.compensation && (
          <section className="mt-5 rounded-3xl bg-[var(--sds-surface-raised)] p-5 shadow-sm">
            <h2 className="text-lg font-black">حقوق و مزایا</h2>
            <div className="mt-3 divide-y">
              {(application.compensation.componentsJson || []).map(
                (item: any) => (
                  <div key={item.label} className="flex justify-between py-2">
                    <span>{item.label}</span>
                    <b>
                      {Number(item.amountRials).toLocaleString("fa-IR")} ریال
                    </b>
                  </div>
                ),
              )}
              <div className="flex justify-between py-3 text-lg">
                <b>جمع</b>
                <b>
                  {Number(application.compensation.totalRials).toLocaleString(
                    "fa-IR",
                  )}{" "}
                  ریال
                </b>
              </div>
            </div>
            {application.compensation.collateralRequirement && (
              <div className="mt-4 rounded-2xl border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-4 text-[var(--sds-warning)]">
                <h3 className="font-black">شرایط وثیقه این پیشنهاد</h3>
                <p className="mt-2 text-sm">
                  {application.compensation.collateralRequirement.candidateExplanation}
                </p>
                <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                  <span>نوع: {hrDisplayLabel(application.compensation.collateralRequirement.type)}</span>
                  {application.compensation.collateralRequirement.amountRials && (
                    <span>
                      مبلغ: {Number(application.compensation.collateralRequirement.amountRials).toLocaleString("fa-IR")} ریال
                    </span>
                  )}
                  {application.compensation.collateralRequirement.dueTiming && (
                    <span>زمان تحویل: {application.compensation.collateralRequirement.dueTiming}</span>
                  )}
                </div>
              </div>
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
                  className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
