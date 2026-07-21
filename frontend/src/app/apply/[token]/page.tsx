"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { applicantHiringAPI, hiringError } from "@/lib/hiringApi";

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
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

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
    <label className="block text-sm font-medium text-slate-700">
      <span>
        {label}
        {required && <b className="mr-1 text-rose-600">*</b>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function ApplicantFormPage() {
  const { token } = useParams<{ token: string }>();
  const [otp, setOtp] = useState("");
  const [verified, setVerified] = useState(false);
  const [data, setData] = useState<any>(blank);
  const [application, setApplication] = useState<any>();
  const [fullName, setFullName] = useState("");
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
        questions: revisionData.questions || blank.questions,
      });
  };

  useEffect(() => {
    if (sessionStorage.getItem("hrApplicantSession")) {
      setVerified(true);
      load().catch(() => sessionStorage.removeItem("hrApplicantSession"));
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

  const verify = () =>
    run(async () => {
      const result = await applicantHiringAPI.verify(token, otp);
      sessionStorage.setItem("hrApplicantSession", result.data.data.session);
      setVerified(true);
    }, "ورود با موفقیت انجام شد.");

  const set = (key: string, value: any) =>
    setData((old: any) => ({ ...old, [key]: value }));
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
      <main dir="rtl" className="min-h-screen bg-slate-100 px-4 py-16">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-7 shadow-xl">
          <h1 className="text-2xl font-black">فرم استخدام سبلان</h1>
          <p className="mt-2 text-sm text-slate-500">
            کد شش‌رقمی موجود در پیامک دعوت را وارد کنید.
          </p>
          {error && (
            <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          )}
          <input
            className={`${inputClass} mt-6 text-center text-xl tracking-[.5em]`}
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          />
          <button
            disabled={busy || otp.length !== 6}
            onClick={verify}
            className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            تأیید و ورود
          </button>
        </section>
      </main>
    );

  return (
    <main dir="rtl" className="min-h-screen bg-slate-100 px-3 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-3xl bg-slate-900 p-6 text-white shadow-xl">
          <p className="text-xs text-emerald-300">پرسشنامه استخدام</p>
          <h1 className="mt-1 text-2xl font-black">
            {application?.position?.title || "فرم متقاضی"}
          </h1>
          <div className="mt-5 h-2 rounded-full bg-slate-700">
            <div
              className="h-2 rounded-full bg-emerald-400"
              style={{ width: `${completion}%` }}
            />
          </div>
        </header>
        {error && (
          <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
            {message}
          </p>
        )}
        {isCorrection && (
          <section className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            فرم برای اصلاح بازگردانده شده است:{" "}
            {application.revision.correctionReason}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {correctionFields.map((key) => (
                <Field key={key} label={key}>
                  <textarea
                    className={inputClass}
                    value={
                      typeof data[key] === "object"
                        ? JSON.stringify(data[key])
                        : String(data[key] ?? "")
                    }
                    onChange={(e) => setCorrectionValue(key, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <label className="mt-4 flex gap-2">
              <input
                type="checkbox"
                checked={declaration}
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              صحت نسخه اصلاح‌شده را تأیید می‌کنم.
            </label>
            <input
              className={`${inputClass} mt-3`}
              placeholder="نام و نام خانوادگی"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  run(
                    () => applicantHiringAPI.saveDraft(data),
                    "اصلاحات ذخیره شد.",
                  )
                }
                className="rounded-xl border px-4 py-2"
              >
                ذخیره اصلاحات
              </button>
              <button
                disabled={busy || !declaration || !fullName}
                onClick={() =>
                  run(async () => {
                    await applicantHiringAPI.saveDraft(data);
                    await applicantHiringAPI.submit({
                      declarationAccepted: declaration,
                      declarationFullName: fullName,
                    });
                  }, "نسخه اصلاح‌شده ارسال شد.")
                }
                className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                ارسال مجدد
              </button>
            </div>
          </section>
        )}
        <fieldset
          disabled={submitted || busy || isCorrection}
          className="mt-5 space-y-5 disabled:opacity-70"
        >
          <Section title="مشخصات فردی">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="نام">
                <input
                  className={inputClass}
                  value={data.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
              </Field>
              <Field label="نام خانوادگی">
                <input
                  className={inputClass}
                  value={data.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </Field>
              <Field label="نام مستعار یا ندارم">
                <input
                  className={inputClass}
                  value={data.alias}
                  onChange={(e) => set("alias", e.target.value)}
                />
              </Field>
              <Field label="تاریخ تولد">
                <input
                  type="date"
                  className={inputClass}
                  value={data.birthDate}
                  onChange={(e) => set("birthDate", e.target.value)}
                />
              </Field>
              <Field label="محل تولد">
                <input
                  className={inputClass}
                  value={data.birthPlace}
                  onChange={(e) => set("birthPlace", e.target.value)}
                />
              </Field>
              <Field label="وضعیت نظام وظیفه">
                <select
                  className={inputClass}
                  value={data.militaryStatus}
                  onChange={(e) => set("militaryStatus", e.target.value)}
                >
                  <option value="">انتخاب</option>
                  <option>پایان خدمت</option>
                  <option>معاف</option>
                  <option>مشمول</option>
                  <option>غیرقابل اعمال</option>
                </select>
              </Field>
              <Field label="نام پدر">
                <input
                  className={inputClass}
                  value={data.fatherName}
                  onChange={(e) => set("fatherName", e.target.value)}
                />
              </Field>
              <Field label="شغل پدر یا وضعیت">
                <input
                  className={inputClass}
                  value={data.fatherOccupation}
                  onChange={(e) => set("fatherOccupation", e.target.value)}
                />
              </Field>
              <Field label="وضعیت تأهل">
                <select
                  className={inputClass}
                  value={data.maritalStatus}
                  onChange={(e) => set("maritalStatus", e.target.value)}
                >
                  <option value="">انتخاب</option>
                  <option value="SINGLE">مجرد</option>
                  <option value="MARRIED">متأهل</option>
                </select>
              </Field>
              {data.maritalStatus === "MARRIED" && (
                <>
                  <Field label="تعداد فرزندان">
                    <input
                      type="number"
                      min="0"
                      className={inputClass}
                      value={data.childrenCount}
                      onChange={(e) => set("childrenCount", e.target.value)}
                    />
                  </Field>
                  <Field label="شغل همسر">
                    <input
                      className={inputClass}
                      value={data.spouseOccupation}
                      onChange={(e) => set("spouseOccupation", e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="نوع هویت">
                <select
                  className={inputClass}
                  value={data.identityKind}
                  onChange={(e) => set("identityKind", e.target.value)}
                >
                  <option value="IRANIAN">ایرانی</option>
                  <option value="FOREIGN">اتباع خارجی</option>
                </select>
              </Field>
              {data.identityKind === "IRANIAN" ? (
                <Field label="کد ملی">
                  <input
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
                    <input
                      className={inputClass}
                      value={data.foreignIdentityType}
                      onChange={(e) =>
                        set("foreignIdentityType", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="شماره مدرک">
                    <input
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
                <textarea
                  className={inputClass}
                  value={data.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </Field>
              <Field label="کد پستی">
                <input
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
                <input
                  className={inputClass}
                  value={data.mobile}
                  onChange={(e) => set("mobile", e.target.value)}
                />
              </Field>
              <Field label="تلفن منزل یا ندارم">
                <input
                  className={inputClass}
                  value={data.homePhone}
                  onChange={(e) => set("homePhone", e.target.value)}
                />
              </Field>
              <Field label="ایمیل" required={false}>
                <input
                  type="email"
                  className={inputClass}
                  value={data.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
              <Field label="شبکه‌های اجتماعی یا ندارم">
                <input
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
                <input
                  className={inputClass}
                  value={data.educationLevel}
                  onChange={(e) => set("educationLevel", e.target.value)}
                />
              </Field>
              <Field label="رشته تحصیلی">
                <input
                  className={inputClass}
                  value={data.fieldOfStudy}
                  onChange={(e) => set("fieldOfStudy", e.target.value)}
                />
              </Field>
              <Field label="سال اخذ مدرک">
                <input
                  className={inputClass}
                  value={data.graduationYear}
                  onChange={(e) => set("graduationYear", e.target.value)}
                />
              </Field>
              <Field label="سابقه بیمه تأمین اجتماعی">
                <select
                  className={inputClass}
                  value={String(data.hasSocialSecurityHistory)}
                  onChange={(e) =>
                    set("hasSocialSecurityHistory", e.target.value === "true")
                  }
                >
                  <option value="">انتخاب</option>
                  <option value="true">دارم</option>
                  <option value="false">ندارم</option>
                </select>
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
                <input
                  placeholder="نام سازمان/شرکت"
                  className={inputClass}
                  value={row.organization}
                  onChange={(e) =>
                    updateList("workHistory", i, "organization", e.target.value)
                  }
                />
                <input
                  placeholder="مدت همکاری"
                  className={inputClass}
                  value={row.duration}
                  onChange={(e) =>
                    updateList("workHistory", i, "duration", e.target.value)
                  }
                />
                <input
                  placeholder="آخرین سمت"
                  className={inputClass}
                  value={row.lastPosition}
                  onChange={(e) =>
                    updateList("workHistory", i, "lastPosition", e.target.value)
                  }
                />
                <input
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
                <input
                  placeholder="نام مهارت"
                  className={inputClass}
                  value={row.name}
                  onChange={(e) =>
                    updateList("skills", i, "name", e.target.value)
                  }
                />
                <input
                  placeholder="مدت آشنایی"
                  className={inputClass}
                  value={row.familiarity}
                  onChange={(e) =>
                    updateList("skills", i, "familiarity", e.target.value)
                  }
                />
                <select
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
                </select>
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
                <input
                  placeholder="نام زبان"
                  className={inputClass}
                  value={row.name}
                  onChange={(e) =>
                    updateList("languages", i, "name", e.target.value)
                  }
                />
                <select
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
                </select>
                <select
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
                </select>
              </div>
            )}
          />
          <Section title="ترجیحات همکاری">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="نوع همکاری">
                <select
                  className={inputClass}
                  value={data.cooperationType}
                  onChange={(e) => set("cooperationType", e.target.value)}
                >
                  <option value="FULL_TIME">تمام‌وقت</option>
                  <option value="PART_TIME">پاره‌وقت</option>
                </select>
              </Field>
              <Field label="مدت همکاری">
                <select
                  className={inputClass}
                  value={data.cooperationDuration}
                  onChange={(e) => set("cooperationDuration", e.target.value)}
                >
                  <option value="LONG_TERM">بلندمدت</option>
                  <option value="SHORT_TERM">کوتاه‌مدت</option>
                </select>
              </Field>
              <Field label="شغل و سمت مورد تقاضا">
                <input
                  className={inputClass}
                  value={data.requestedPosition}
                  onChange={(e) => set("requestedPosition", e.target.value)}
                />
              </Field>
              <Field label="حقوق پیشنهادی">
                <input
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
                  <textarea
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
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <label className="flex gap-3 text-sm">
              <input
                type="checkbox"
                checked={declaration}
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              <span>
                صحت اطلاعات فوق را تأیید می‌کنم و اطلاعیه نگهداری اطلاعات پرونده
                و جست‌وجوی پروفایل عادی در بانک متقاضیان را پذیرفته‌ام.
              </span>
            </label>
            <input
              className={`${inputClass} mt-3`}
              placeholder="نام و نام خانوادگی برای اظهارنامه"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  run(
                    () => applicantHiringAPI.saveDraft(data),
                    "پیش‌نویس ذخیره شد.",
                  )
                }
                className="rounded-xl border px-5 py-2 font-bold"
              >
                ذخیره پیش‌نویس
              </button>
              <button
                type="button"
                disabled={!declaration || !fullName}
                onClick={() =>
                  run(async () => {
                    await applicantHiringAPI.saveDraft(data);
                    await applicantHiringAPI.submit({
                      declarationAccepted: declaration,
                      declarationFullName: fullName,
                    });
                  }, "فرم نهایی ارسال و قفل شد.")
                }
                className="rounded-xl bg-emerald-600 px-5 py-2 font-bold text-white disabled:opacity-50"
              >
                ارسال نهایی
              </button>
            </div>
          </section>
        </fieldset>
        {submitted && (
          <p className="mt-5 rounded-2xl bg-emerald-50 p-5 text-emerald-800">
            فرم نهایی ثبت شده و تا زمان درخواست اصلاح HR قفل است.
          </p>
        )}
        {application?.compensation && (
          <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm">
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
            {!application.compensation.candidateAcceptedAt && (
              <button
                onClick={() =>
                  run(
                    () => applicantHiringAPI.acceptCompensation(fullName),
                    "پیشنهاد جبران خدمات پذیرفته شد.",
                  )
                }
                className="mt-3 rounded-xl bg-slate-900 px-5 py-2 font-bold text-white"
              >
                پذیرش پیشنهاد
              </button>
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">
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
      <button
        type="button"
        onClick={add}
        className="mt-3 rounded-lg border px-3 py-1 text-sm"
      >
        افزودن ردیف
      </button>
    </Section>
  );
}
