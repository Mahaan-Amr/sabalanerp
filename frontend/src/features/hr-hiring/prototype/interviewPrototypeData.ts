export type NumericScore = 1 | 2 | 3 | 4 | 5;
export type Score = NumericScore | "UNASSESSED" | null;
export type Judgment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
export type CriterionKind =
  "score" | "text" | "address" | "strengthsWeaknesses" | "companion";

export type InterviewCriterion = {
  id: string;
  order: number;
  title: string;
  prompt?: string;
  kind: CriterionKind;
};

export type CriterionAnswer = {
  score: Score;
  text: string;
  note: string;
  judgment: Judgment;
  companionPresent: "YES" | "NO" | null;
  strengths: string[];
  weaknesses: string[];
};

export type InterviewState = {
  answers: Record<string, CriterionAnswer>;
  decision: "POSITIVE" | "NEGATIVE" | null;
  decisionReason: string;
};

export type ManagementActivity = {
  id: string;
  title: string;
  selected: boolean;
  custom: boolean;
  criteria: string[];
};

export const scoreLabels: Record<NumericScore, string> = {
  1: "بسیار ضعیف",
  2: "ضعیف",
  3: "قابل قبول",
  4: "خوب",
  5: "عالی",
};

export const interviewCriteria: InterviewCriterion[] = [
  { id: "appearance", order: 1, title: "نوع پوشش", kind: "score" },
  { id: "grooming", order: 2, title: "آراستگی", kind: "score" },
  { id: "resume", order: 3, title: "رزومه", kind: "score" },
  {
    id: "address",
    order: 4,
    title: "آدرس منزل",
    prompt: "دوری یا نزدیکی و همچنین نوع و فرهنگ محله",
    kind: "address",
  },
  { id: "responsibility", order: 5, title: "مسئولیت‌پذیری", kind: "score" },
  { id: "honesty", order: 6, title: "صداقت", kind: "score" },
  { id: "teamwork", order: 7, title: "روحیه کار تیمی", kind: "score" },
  { id: "resilience", order: 8, title: "تاب‌آوری و تحمل فشار", kind: "score" },
  { id: "communication", order: 9, title: "مهارت ارتباطی", kind: "score" },
  {
    id: "motivation",
    order: 10,
    title: "انگیزه شغلی",
    prompt: "آیا دنبال کسب مهارت و یادگیری است یا صرفاً به دنبال حقوق است؟",
    kind: "text",
  },
  { id: "previousJob", order: 11, title: "علت ترک شغل قبلی", kind: "text" },
  {
    id: "stability",
    order: 12,
    title: "ثبات شغلی",
    prompt: "اگر علت ترک کار منطقی باشد، نکته منفی به حساب نمی‌آید.",
    kind: "score",
  },
  {
    id: "selfView",
    order: 13,
    title: "پنج نقطه مثبت و پنج نقطه منفی",
    prompt: "پاسخ‌های خود متقاضی را بدون ترکیب با تحلیل مصاحبه‌گر ثبت کنید.",
    kind: "strengthsWeaknesses",
  },
  {
    id: "workplaceValues",
    order: 14,
    title: "ویژگی‌ها و ارزش‌های محیط کار مطلوب",
    prompt: "دوست دارید محیط کار شما چه ویژگی‌ها و چه ارزش‌هایی داشته باشد؟",
    kind: "text",
  },
  {
    id: "createdValues",
    order: 15,
    title: "ارزش قابل ایجاد برای سازمان",
    prompt:
      "فکر می‌کنید چه ارزش‌هایی در محیط کاری و با کار خود در سازمان می‌توانید ایجاد کنید؟",
    kind: "text",
  },
  {
    id: "achievement",
    order: 16,
    title: "دستاورد شغلی مورد انتظار",
    prompt: "در شغل خود دوست دارید چه دستاوردی داشته باشید؟",
    kind: "text",
  },
  {
    id: "companion",
    order: 17,
    title: "حضور با همراه برای مصاحبه",
    kind: "companion",
  },
];

const emptyAnswer = (): CriterionAnswer => ({
  score: null,
  text: "",
  note: "",
  judgment: null,
  companionPresent: null,
  strengths: Array.from({ length: 5 }, () => ""),
  weaknesses: Array.from({ length: 5 }, () => ""),
});

export const createInitialInterviewState = (): InterviewState => ({
  answers: Object.fromEntries(
    interviewCriteria.map((criterion) => [criterion.id, emptyAnswer()]),
  ),
  decision: null,
  decisionReason: "",
});

export const initialManagementActivities: ManagementActivity[] = [
  {
    id: "company-manager",
    title: "مصاحبه مدیریت شرکت",
    selected: true,
    custom: false,
    criteria: [
      "تناسب تجربه متقاضی با نیاز جایگاه",
      "انتظار متقابل متقاضی و سازمان",
      "جمع‌بندی مدیریت درباره ادامه فرایند",
    ],
  },
  {
    id: "hr-manager",
    title: "مصاحبه مدیر منابع انسانی",
    selected: false,
    custom: false,
    criteria: [
      "مرور نتیجه مصاحبه اولیه HR",
      "بررسی ثبات و انگیزه شغلی",
      "ثبت تأیید اولیه HR با دلیل",
    ],
  },
  {
    id: "supervisor",
    title: "مصاحبه سرپرست شغل",
    selected: true,
    custom: false,
    criteria: [
      "دانش و تجربه مرتبط با کار",
      "سناریوی عملی یا پرسش تخصصی",
      "نظر سرپرست درباره آمادگی شروع کار",
    ],
  },
  {
    id: "consultant",
    title: "ارجاع به مشاور یا درمانگر",
    selected: false,
    custom: false,
    criteria: [
      "هدف و محدوده ارجاع",
      "گزارش شغلی مجاز برای مدیریت",
      "نتیجه قابل استفاده در تصمیم استخدام",
    ],
  },
];

export const criterionIsComplete = (
  criterion: InterviewCriterion,
  answer: CriterionAnswer,
) => {
  if (criterion.kind === "score") {
    if (answer.score === "UNASSESSED") return true;
    return answer.score !== null && (criterion.id !== "stability" || answer.note.trim().length > 0);
  }
  if (criterion.kind === "address") {
    return (
      answer.text.trim().length > 0 &&
      answer.judgment !== null &&
      (answer.judgment !== "NEGATIVE" || answer.note.trim().length > 0)
    );
  }
  if (criterion.kind === "companion") {
    return (
      answer.companionPresent !== null &&
      answer.judgment !== null &&
      (answer.judgment !== "NEGATIVE" || answer.note.trim().length > 0)
    );
  }
  if (criterion.kind === "strengthsWeaknesses") {
    return (
      answer.strengths.every((item) => item.trim().length > 0) &&
      answer.weaknesses.every((item) => item.trim().length > 0)
    );
  }
  return answer.text.trim().length > 0;
};
