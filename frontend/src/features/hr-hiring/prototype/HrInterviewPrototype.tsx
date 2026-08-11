"use client";

import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpInput,
  ErpPage,
  ErpPressable,
  ErpSelect,
  ErpSection,
  ErpSegmentedControl,
  ErpTextarea,
} from "@/components/erp";
import { useTheme } from "@/contexts/ThemeContext";
import { hiringAPI } from "@/lib/hiringApi";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaHistory,
  FaMoon,
  FaPlus,
  FaSun,
  FaTrash,
} from "react-icons/fa";
import {
  createInitialInterviewState,
  criterionIsComplete,
  initialManagementActivities,
  interviewCriteria,
  scoreLabels,
  type CriterionAnswer,
  type InterviewCriterion,
  type InterviewState,
  type Judgment,
  type ManagementActivity,
  type NumericScore,
  type Score,
} from "./interviewPrototypeData";

type Variant = "A" | "B" | "C";
type Surface = "interview" | "checklist" | "defaults" | "history";
export type CustomCriterion = {
  id: string;
  title: string;
  kind: "score" | "text" | "yes-no";
  score: Score;
  text: string;
  yesNo: "YES" | "NO" | null;
};

export type ProductionInterviewPayload = {
  schemaVersion: 2;
  state: InterviewState;
  customCriteria: CustomCriterion[];
  criteriaTemplateVersion?: number;
  criteriaSnapshot?: PublishedInterviewCriterion[];
};

type PublishedInterviewCriterion = {
  stableId: string;
  title: string;
  description?: string | null;
  answerType: string;
  isActive?: boolean;
  order?: number;
  allowUnassessed?: boolean;
};

const publishedCriteriaForInterview = (snapshot?: PublishedInterviewCriterion[]) => {
  if (!snapshot?.length) return interviewCriteria;
  const kindByAnswerType: Record<string, InterviewCriterion["kind"]> = {
    TEXT: "text",
    SCORE_1_TO_5: "score",
    YES_NO: "yesNo",
    ADDRESS: "address",
    STRENGTHS_WEAKNESSES: "strengthsWeaknesses",
    COMPANION: "companion",
  };
  return snapshot
    .filter((criterion) => criterion.isActive !== false)
    .map((criterion, index) => ({
      id: criterion.stableId,
      order: criterion.order ?? index + 1,
      title: criterion.title,
      prompt: criterion.description || undefined,
      kind: kindByAnswerType[criterion.answerType] ?? "text",
      allowUnassessed: criterion.allowUnassessed === true,
    }));
};

const hydrateInterviewState = (state: InterviewState | undefined, criteria: InterviewCriterion[]) => {
  const empty = createInitialInterviewState(criteria);
  if (!state) return empty;
  return { ...state, answers: { ...empty.answers, ...state.answers } };
};

const variantNames: Record<Variant, string> = {
  A: "مسیر هدایت‌شده",
  B: "کاربرگ کامل",
  C: "میز تصمیم",
};
const prototypeVariants: Variant[] = ["A", "B", "C"];

const judgmentLabels: Record<Exclude<Judgment, null>, string> = {
  POSITIVE: "مثبت",
  NEUTRAL: "خنثی",
  NEGATIVE: "منفی",
};

const surfaceOptions = [
  { value: "interview" as const, label: "مصاحبه اولیه HR" },
  { value: "checklist" as const, label: "بررسی‌های مدیریت شرکت" },
  { value: "defaults" as const, label: "معیارهای پیش‌فرض" },
  { value: "history" as const, label: "تاریخچه نسخه‌ها" },
];

function ScoreControl({
  value,
  onChange,
  allowUnassessed = true,
}: {
  value: Score;
  onChange: (score: Score) => void;
  allowUnassessed?: boolean;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
      role="group"
      aria-label="امتیاز معیار"
    >
      {(Object.entries(scoreLabels) as Array<[string, string]>).map(
        ([score, label]) => {
          const numericScore = Number(score) as NumericScore;
          return (
            <ErpButton
              key={score}
              label={`${Number(score).toLocaleString("fa-IR")} · ${label}`}
              onClick={() => onChange(numericScore)}
              variant={value === numericScore ? "solid" : "soft"}
              tone={value === numericScore ? "primary" : "neutral"}
              className="min-h-11"
            />
          );
        },
      )}
      {allowUnassessed && <ErpButton
        label="ارزیابی نشد"
        onClick={() => onChange("UNASSESSED")}
        variant={value === "UNASSESSED" ? "outline" : "ghost"}
        tone="neutral"
        className="min-h-11"
      />}
    </div>
  );
}

function JudgmentControl({
  value,
  onChange,
}: {
  value: Judgment;
  onChange: (value: Judgment) => void;
}) {
  return (
    <ErpSegmentedControl
      value={value ?? "UNSET"}
      onChange={(next) =>
        onChange(next === "UNSET" ? null : (next as Judgment))
      }
      options={[
        { value: "POSITIVE", label: "مثبت" },
        { value: "NEUTRAL", label: "خنثی" },
        { value: "NEGATIVE", label: "منفی" },
        { value: "UNSET", label: "ثبت نشده" },
      ]}
    />
  );
}

function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <span className="mb-2 block text-sm font-semibold text-[var(--sds-text-primary)]">
      {children}
      {required ? " *" : ""}
    </span>
  );
}

function CriterionEditor({
  criterion,
  answer,
  onChange,
  onScoreChange,
  compact = false,
}: {
  criterion: InterviewCriterion;
  answer: CriterionAnswer;
  onChange: (answer: CriterionAnswer) => void;
  onScoreChange?: (score: Score) => void;
  compact?: boolean;
}) {
  const update = <K extends keyof CriterionAnswer>(
    key: K,
    value: CriterionAnswer[K],
  ) => onChange({ ...answer, [key]: value });

  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      {criterion.prompt ? (
        <p className="text-sm leading-6 text-[var(--sds-text-secondary)]">
          {criterion.prompt}
        </p>
      ) : null}

      {criterion.kind === "score" ? (
        <>
          <div>
            <FieldLabel required>امتیاز مصاحبه‌گر</FieldLabel>
            <ScoreControl
              value={answer.score}
              allowUnassessed={criterion.allowUnassessed !== false}
              onChange={(score) => {
                update("score", score);
                onScoreChange?.(score);
              }}
            />
          </div>
          <div>
            <FieldLabel>
              یادداشت مصاحبه‌گر
            </FieldLabel>
            <ErpTextarea
              rows={compact ? 2 : 3}
              value={answer.note}
              onChange={(event) => update("note", event.target.value)}
              placeholder="یادداشت مصاحبه‌گر (اختیاری)"
            />
          </div>
        </>
      ) : null}

      {criterion.kind === "text" ? (
        <div>
          <FieldLabel required>پاسخ ثبت‌شده</FieldLabel>
          <ErpTextarea
            rows={compact ? 3 : 5}
            value={answer.text}
            onChange={(event) => update("text", event.target.value)}
            placeholder="پاسخ متقاضی را ثبت کنید"
          />
        </div>
      ) : null}

      {criterion.kind === "yesNo" ? (
        <div className="space-y-4">
          <div>
            <FieldLabel required>پاسخ</FieldLabel>
            <ErpSegmentedControl
              value={answer.companionPresent ?? "UNSET"}
              onChange={(value) => update("companionPresent", value === "UNSET" ? null : value as "YES" | "NO")}
              options={[
                { value: "YES", label: "بله" },
                { value: "NO", label: "خیر" },
                { value: "UNSET", label: "ثبت نشده" },
              ]}
            />
          </div>
          <div><FieldLabel required>اثر این پاسخ بر متقاضی</FieldLabel><JudgmentControl value={answer.judgment} onChange={(value) => update("judgment", value)} /></div>
          {answer.judgment === "NEGATIVE" && <div><FieldLabel required>دلیل اثر منفی</FieldLabel><ErpTextarea value={answer.note} onChange={(event) => update("note", event.target.value)} /></div>}
        </div>
      ) : null}

      {criterion.kind === "address" ? (
        <>
          <div>
            <FieldLabel required>آدرس و توضیح مصاحبه‌گر</FieldLabel>
            <ErpTextarea
              rows={compact ? 3 : 4}
              value={answer.text}
              onChange={(event) => update("text", event.target.value)}
              placeholder="فاصله، شرایط رفت‌وآمد، نوع و فرهنگ محله"
            />
          </div>
          <div>
            <FieldLabel required>اثر در تصمیم</FieldLabel>
            <JudgmentControl
              value={answer.judgment}
              onChange={(value) => update("judgment", value)}
            />
          </div>
          <div>
            <FieldLabel required={answer.judgment === "NEGATIVE"}>
              دلیل ارزیابی
            </FieldLabel>
            <ErpTextarea
              rows={2}
              value={answer.note}
              onChange={(event) => update("note", event.target.value)}
            />
          </div>
        </>
      ) : null}

      {criterion.kind === "companion" ? (
        <>
          <div>
            <FieldLabel required>
              آیا متقاضی با همراه حضور پیدا کرده است؟
            </FieldLabel>
            <ErpSegmentedControl
              value={answer.companionPresent ?? "UNSET"}
              onChange={(value) =>
                update(
                  "companionPresent",
                  value === "UNSET" ? null : (value as "YES" | "NO"),
                )
              }
              options={[
                { value: "YES", label: "بله" },
                { value: "NO", label: "خیر" },
                { value: "UNSET", label: "ثبت نشده" },
              ]}
            />
          </div>
          <div>
            <FieldLabel required>اثر در تصمیم</FieldLabel>
            <JudgmentControl
              value={answer.judgment}
              onChange={(value) => update("judgment", value)}
            />
          </div>
          <div>
            <FieldLabel required={answer.judgment === "NEGATIVE"}>
              دلیل ارزیابی
            </FieldLabel>
            <ErpTextarea
              rows={2}
              value={answer.note}
              onChange={(event) => update("note", event.target.value)}
            />
          </div>
        </>
      ) : null}

      {criterion.kind === "strengthsWeaknesses" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <FieldLabel required>پنج نقطه مثبت از زبان متقاضی</FieldLabel>
            {answer.strengths.map((item, index) => (
              <ErpInput
                key={`strength-${index}`}
                value={item}
                onChange={(event) => {
                  const next = [...answer.strengths];
                  next[index] = event.target.value;
                  update("strengths", next);
                }}
                aria-label={`نقطه مثبت ${index + 1}`}
                placeholder={`نقطه مثبت ${(index + 1).toLocaleString("fa-IR")}`}
              />
            ))}
          </div>
          <div className="space-y-3">
            <FieldLabel required>پنج نقطه منفی از زبان متقاضی</FieldLabel>
            {answer.weaknesses.map((item, index) => (
              <ErpInput
                key={`weakness-${index}`}
                value={item}
                onChange={(event) => {
                  const next = [...answer.weaknesses];
                  next[index] = event.target.value;
                  update("weaknesses", next);
                }}
                aria-label={`نقطه منفی ${index + 1}`}
                placeholder={`نقطه منفی ${(index + 1).toLocaleString("fa-IR")}`}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DecisionEditor({
  state,
  onChange,
}: {
  state: InterviewState;
  onChange: (state: InterviewState) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel required>نتیجه مستقل مصاحبه‌گر</FieldLabel>
        <ErpSegmentedControl
          value={state.decision ?? "UNSET"}
          onChange={(value) =>
            onChange({
              ...state,
              decision:
                value === "UNSET" ? null : (value as "POSITIVE" | "NEGATIVE"),
            })
          }
          options={[
            { value: "POSITIVE", label: "مثبت" },
            { value: "NEGATIVE", label: "منفی" },
            { value: "UNSET", label: "ثبت نشده" },
          ]}
        />
      </div>
      <div>
        <FieldLabel required>دلیل تصمیم</FieldLabel>
        <ErpTextarea
          value={state.decisionReason}
          onChange={(event) =>
            onChange({ ...state, decisionReason: event.target.value })
          }
          placeholder="دلیل نتیجه مثبت یا منفی را ثبت کنید"
        />
      </div>
    </div>
  );
}

function ProgressSummary({ state, criteria = interviewCriteria }: { state: InterviewState; criteria?: InterviewCriterion[] }) {
  const complete = criteria.filter((criterion) =>
    criterionIsComplete(criterion, state.answers[criterion.id]),
  ).length;
  const scores = criteria
    .map((criterion) => state.answers[criterion.id].score)
    .filter((score): score is NumericScore => typeof score === "number");
  const average = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <ErpCard className="p-3">
        <p className="text-xs text-[var(--sds-text-muted)]">تکمیل معیارها</p>
        <p className="mt-1 text-xl font-bold text-[var(--sds-text-primary)]">
          {complete.toLocaleString("fa-IR")} از ۱۷
        </p>
      </ErpCard>
      <ErpCard className="p-3">
        <p className="text-xs text-[var(--sds-text-muted)]">میانگین امتیاز</p>
        <p className="mt-1 text-xl font-bold text-[var(--sds-text-primary)]">
          {average === null
            ? "—"
            : average.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}
        </p>
      </ErpCard>
    </div>
  );
}

function GuidedVariant({
  state,
  onChange,
  criteria = interviewCriteria,
}: {
  state: InterviewState;
  onChange: (state: InterviewState) => void;
  criteria?: InterviewCriterion[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const criterion = criteria[Math.min(activeIndex, criteria.length - 1)];
  return (
    <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      <ErpSection
        title="مسیر مصاحبه"
        description="هر معیار را جداگانه بررسی کنید."
      >
        <div className="max-h-[65vh] space-y-1 overflow-y-auto pe-1">
          {criteria.map((item, index) => {
            const complete = criterionIsComplete(item, state.answers[item.id]);
            return (
              <ErpPressable
                key={item.id}
                onClick={() => setActiveIndex(index)}
                variant={activeIndex === index ? "soft" : "ghost"}
                tone={activeIndex === index ? "primary" : "neutral"}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-right text-sm"
              >
                <span>
                  {item.order.toLocaleString("fa-IR")}. {item.title}
                </span>
                {complete ? (
                  <FaCheck
                    className="shrink-0 text-[var(--sds-success)]"
                    aria-label="تکمیل شده"
                  />
                ) : null}
              </ErpPressable>
            );
          })}
        </div>
      </ErpSection>

      <ErpSection
        title={`${criterion.order.toLocaleString("fa-IR")}. ${criterion.title}`}
      >
        <CriterionEditor
          criterion={criterion}
          answer={state.answers[criterion.id]}
          onChange={(answer) =>
            onChange({
              ...state,
              answers: { ...state.answers, [criterion.id]: answer },
            })
          }
          onScoreChange={() =>
            setActiveIndex((value) =>
              Math.min(value + 1, criteria.length - 1),
            )
          }
        />
        <div className="mt-6 flex items-center justify-between gap-2 border-t border-[var(--sds-border-default)] pt-4">
          <ErpButton
            label="معیار قبلی"
            icon={FaArrowRight}
            disabled={activeIndex === 0}
            onClick={() => setActiveIndex((value) => value - 1)}
            tone="neutral"
          />
          <ErpBadge
            tone={
              criterionIsComplete(criterion, state.answers[criterion.id])
                ? "success"
                : "warning"
            }
          >
            {criterionIsComplete(criterion, state.answers[criterion.id])
              ? "تکمیل شده"
              : "نیازمند تکمیل"}
          </ErpBadge>
          <ErpButton
            label="معیار بعدی"
            icon={FaArrowLeft}
            disabled={activeIndex === criteria.length - 1}
            onClick={() => setActiveIndex((value) => value + 1)}
          />
        </div>
      </ErpSection>

      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <ProgressSummary state={state} criteria={criteria} />
        <ErpSection title="جمع‌بندی مصاحبه">
          <DecisionEditor state={state} onChange={onChange} />
        </ErpSection>
      </div>
    </div>
  );
}

const worksheetGroups = [
  {
    title: "مشاهده و سابقه",
    ids: ["appearance", "grooming", "resume", "address"],
  },
  {
    title: "شایستگی‌های رفتاری",
    ids: [
      "responsibility",
      "honesty",
      "teamwork",
      "resilience",
      "communication",
    ],
  },
  {
    title: "انگیزه و مسیر شغلی",
    ids: ["motivation", "previousJob", "stability"],
  },
  {
    title: "شناخت فرد و انتظارها",
    ids: [
      "selfView",
      "workplaceValues",
      "createdValues",
      "achievement",
      "companion",
    ],
  },
];

function WorksheetVariant({
  state,
  onChange,
}: {
  state: InterviewState;
  onChange: (state: InterviewState) => void;
}) {
  return (
    <div className="space-y-4">
      <ProgressSummary state={state} />
      {worksheetGroups.map((group) => (
        <ErpSection key={group.title} title={group.title}>
          <div className="grid gap-4 xl:grid-cols-2">
            {group.ids.map((id) => {
              const criterion = interviewCriteria.find(
                (item) => item.id === id,
              )!;
              return (
                <ErpCard
                  key={id}
                  className={
                    criterion.kind === "strengthsWeaknesses"
                      ? "p-4 xl:col-span-2"
                      : "p-4"
                  }
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-[var(--sds-text-primary)]">
                      {criterion.order.toLocaleString("fa-IR")}.{" "}
                      {criterion.title}
                    </h3>
                    <ErpBadge
                      tone={
                        criterionIsComplete(criterion, state.answers[id])
                          ? "success"
                          : "neutral"
                      }
                    >
                      {criterionIsComplete(criterion, state.answers[id])
                        ? "کامل"
                        : "باز"}
                    </ErpBadge>
                  </div>
                  <CriterionEditor
                    compact
                    criterion={criterion}
                    answer={state.answers[id]}
                    onChange={(answer) =>
                      onChange({
                        ...state,
                        answers: { ...state.answers, [id]: answer },
                      })
                    }
                  />
                </ErpCard>
              );
            })}
          </div>
        </ErpSection>
      ))}
      <ErpSection title="نتیجه مصاحبه">
        <DecisionEditor state={state} onChange={onChange} />
      </ErpSection>
    </div>
  );
}

function DecisionDeskVariant({
  state,
  onChange,
}: {
  state: InterviewState;
  onChange: (state: InterviewState) => void;
}) {
  const [selectedId, setSelectedId] = useState(interviewCriteria[0].id);
  const selected = interviewCriteria.find(
    (criterion) => criterion.id === selectedId,
  )!;
  const buckets = useMemo(
    () => ({
      complete: interviewCriteria.filter((criterion) =>
        criterionIsComplete(criterion, state.answers[criterion.id]),
      ),
      scored: interviewCriteria.filter(
        (criterion) =>
          typeof state.answers[criterion.id].score === "number" &&
          !criterionIsComplete(criterion, state.answers[criterion.id]),
      ),
      open: interviewCriteria.filter(
        (criterion) =>
          state.answers[criterion.id].score === null &&
          !criterionIsComplete(criterion, state.answers[criterion.id]),
      ),
    }),
    [state.answers],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ErpSection
          title="شواهد مصاحبه"
          description="معیارها بر اساس وضعیت ثبت مرتب شده‌اند."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {(
              [
                ["open", "ثبت نشده", "warning"],
                ["scored", "نیمه‌کامل", "info"],
                ["complete", "تکمیل شده", "success"],
              ] as const
            ).map(([key, title, tone]) => (
              <div
                key={key}
                className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--sds-text-primary)]">
                    {title}
                  </h3>
                  <ErpBadge tone={tone}>
                    {buckets[key].length.toLocaleString("fa-IR")}
                  </ErpBadge>
                </div>
                <div className="space-y-2">
                  {buckets[key].map((criterion) => (
                    <ErpPressable
                      key={criterion.id}
                      onClick={() => setSelectedId(criterion.id)}
                      variant={selectedId === criterion.id ? "soft" : "ghost"}
                      tone={selectedId === criterion.id ? "primary" : "neutral"}
                      className="min-h-11 w-full rounded-lg px-3 text-right text-sm"
                    >
                      {criterion.order.toLocaleString("fa-IR")}.{" "}
                      {criterion.title}
                    </ErpPressable>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ErpSection>
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <ProgressSummary state={state} />
          <ErpSection title="تصمیم فعلی">
            <DecisionEditor state={state} onChange={onChange} />
          </ErpSection>
        </div>
      </div>
      <ErpSection
        title={`${selected.order.toLocaleString("fa-IR")}. ${selected.title}`}
        description={selected.prompt}
      >
        <CriterionEditor
          criterion={selected}
          answer={state.answers[selected.id]}
          onChange={(answer) =>
            onChange({
              ...state,
              answers: { ...state.answers, [selected.id]: answer },
            })
          }
        />
      </ErpSection>
    </div>
  );
}

function CaseSpecificCriteria({
  criteria,
  onChange,
}: {
  criteria: CustomCriterion[];
  onChange: (criteria: CustomCriterion[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CustomCriterion["kind"]>("text");
  const update = (id: string, next: Partial<CustomCriterion>) =>
    onChange(
      criteria.map((criterion) =>
        criterion.id === id ? { ...criterion, ...next } : criterion,
      ),
    );

  return (
    <ErpSection
      title="معیارهای اختصاصی این متقاضی"
      description="این موارد فقط به همین پرونده افزوده می‌شوند و فهرست پیش‌فرض را تغییر نمی‌دهند."
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <ErpInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="عنوان معیار جدید"
          aria-label="عنوان معیار اختصاصی"
        />
        <ErpSelect
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as CustomCriterion["kind"])
          }
          aria-label="نوع پاسخ معیار اختصاصی"
        >
          <option value="text">پاسخ تشریحی</option>
          <option value="score">امتیاز ۱ تا ۵</option>
          <option value="yes-no">بله یا خیر</option>
        </ErpSelect>
        <ErpButton
          label="افزودن معیار"
          icon={FaPlus}
          disabled={!title.trim()}
          onClick={() => {
            onChange([
              ...criteria,
              {
                id: `extra-${Date.now()}`,
                title: title.trim(),
                kind,
                score: null,
                text: "",
                yesNo: null,
              },
            ]);
            setTitle("");
          }}
        />
      </div>

      {criteria.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {criteria.map((criterion) => (
            <ErpCard key={criterion.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--sds-text-primary)]">
                    {criterion.title}
                  </h3>
                  <ErpBadge tone="purple">
                    {criterion.kind === "score"
                      ? "امتیازی"
                      : criterion.kind === "yes-no"
                        ? "بله یا خیر"
                        : "تشریحی"}
                  </ErpBadge>
                </div>
                <ErpButton
                  label="حذف معیار اختصاصی"
                  icon={FaTrash}
                  tone="danger"
                  variant="ghost"
                  onClick={() =>
                    onChange(
                      criteria.filter((item) => item.id !== criterion.id),
                    )
                  }
                />
              </div>
              {criterion.kind === "score" ? (
                <ScoreControl
                  value={criterion.score}
                  onChange={(score) => update(criterion.id, { score })}
                />
              ) : null}
              {criterion.kind === "text" ? (
                <ErpTextarea
                  value={criterion.text}
                  onChange={(event) =>
                    update(criterion.id, { text: event.target.value })
                  }
                  placeholder="پاسخ یا مشاهده مصاحبه‌گر"
                  aria-label={`پاسخ ${criterion.title}`}
                />
              ) : null}
              {criterion.kind === "yes-no" ? (
                <ErpSegmentedControl
                  value={criterion.yesNo ?? "UNSET"}
                  onChange={(value) =>
                    update(criterion.id, {
                      yesNo:
                        value === "UNSET" ? null : (value as "YES" | "NO"),
                    })
                  }
                  options={[
                    { value: "YES", label: "بله" },
                    { value: "NO", label: "خیر" },
                    { value: "UNSET", label: "ثبت نشده" },
                  ]}
                />
              ) : null}
            </ErpCard>
          ))}
        </div>
      ) : null}
    </ErpSection>
  );
}

function customCriterionIsComplete(criterion: CustomCriterion) {
  if (criterion.kind === "score") return criterion.score !== null;
  if (criterion.kind === "yes-no") return criterion.yesNo !== null;
  return criterion.text.trim().length > 0;
}

function InterviewCompletion({
  state,
  customCriteria,
  completed,
  onCompletedChange,
}: {
  state: InterviewState;
  customCriteria: CustomCriterion[];
  completed: boolean;
  onCompletedChange: (completed: boolean) => void;
}) {
  const defaultsComplete = interviewCriteria.every((criterion) =>
    criterionIsComplete(criterion, state.answers[criterion.id]),
  );
  const extrasComplete = customCriteria.every(customCriterionIsComplete);
  const canComplete =
    defaultsComplete &&
    extrasComplete &&
    state.decision !== null &&
    state.decisionReason.trim().length > 0;

  return (
    <ErpSection title="تکمیل مصاحبه">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <ErpBadge tone={completed ? "success" : canComplete ? "info" : "warning"}>
            {completed
              ? "نسخه تکمیل‌شده"
              : canComplete
                ? "آماده تکمیل"
                : "اطلاعات ناقص"}
          </ErpBadge>
          <span className="text-sm text-[var(--sds-text-secondary)]">
            نتیجه و دلیل مستقل مصاحبه‌گر برای تکمیل اجباری است.
          </span>
        </div>
        {completed ? (
          <ErpButton
            label="ایجاد نسخه اصلاحی"
            icon={FaHistory}
            variant="outline"
            onClick={() => onCompletedChange(false)}
          />
        ) : (
          <ErpButton
            label="ثبت و تکمیل مصاحبه"
            icon={FaCheck}
            variant="solid"
            disabled={!canComplete}
            onClick={() => onCompletedChange(true)}
          />
        )}
      </div>
    </ErpSection>
  );
}

function DefaultCriteriaEditor({
  titles,
  onChange,
}: {
  titles: string[];
  onChange: (titles: string[]) => void;
}) {
  return (
    <ErpSection
      title="معیارهای پیش‌فرض مصاحبه اولیه HR"
      description="فقط مدیر منابع انسانی می‌تواند این فهرست واحد را تغییر دهد. تغییرات برای مصاحبه‌های جدید است و پرونده‌های شروع‌شده نسخه خود را حفظ می‌کنند."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {interviewCriteria.map((criterion, index) => (
          <ErpCard key={criterion.id} className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--sds-text-primary)]">
                معیار {criterion.order.toLocaleString("fa-IR")}
              </span>
              <ErpBadge tone="neutral">
                {criterion.kind === "score"
                  ? "امتیازی"
                  : criterion.kind === "companion"
                    ? "بله/خیر + ارزیابی"
                    : criterion.kind === "address"
                      ? "تشریحی + ارزیابی"
                      : "تشریحی"}
              </ErpBadge>
            </div>
            <ErpInput
              value={titles[index]}
              onChange={(event) => {
                const next = [...titles];
                next[index] = event.target.value;
                onChange(next);
              }}
              aria-label={`عنوان معیار پیش‌فرض ${criterion.order}`}
            />
          </ErpCard>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <ErpButton
          label="ذخیره برای مصاحبه‌های جدید"
          icon={FaCheck}
          variant="solid"
          disabled={titles.some((title) => !title.trim())}
        />
      </div>
    </ErpSection>
  );
}

function ManagementChecklist({
  activities,
  onChange,
  noExtraReview,
  onNoExtraReviewChange,
  noExtraReason,
  onNoExtraReasonChange,
}: {
  activities: ManagementActivity[];
  onChange: (activities: ManagementActivity[]) => void;
  noExtraReview: boolean;
  onNoExtraReviewChange: (value: boolean) => void;
  noExtraReason: string;
  onNoExtraReasonChange: (value: string) => void;
}) {
  const [customTitle, setCustomTitle] = useState("");
  const updateActivity = (id: string, next: Partial<ManagementActivity>) =>
    onChange(
      activities.map((activity) =>
        activity.id === id ? { ...activity, ...next } : activity,
      ),
    );

  return (
    <div className="space-y-4">
      <ErpSection
        title="انتخاب بررسی‌های تکمیلی"
        description="صفر یا چند فعالیت را برای همین متقاضی مشخص کنید."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {activities.map((activity) => (
            <ErpCard key={activity.id} className="p-4">
              <ErpCheckbox
                checked={activity.selected}
                disabled={noExtraReview}
                onChange={(event) =>
                  updateActivity(activity.id, {
                    selected: event.target.checked,
                  })
                }
                label={
                  <span className="font-semibold text-[var(--sds-text-primary)]">
                    {activity.title}
                  </span>
                }
              />
              {activity.selected && !noExtraReview ? (
                <div className="mt-3 space-y-2 border-t border-[var(--sds-border-default)] pt-3">
                  {activity.criteria.map((criterion, index) => (
                    <ErpInput
                      key={`${activity.id}-${index}`}
                      value={criterion}
                      onChange={(event) => {
                        const criteria = [...activity.criteria];
                        criteria[index] = event.target.value;
                        updateActivity(activity.id, { criteria });
                      }}
                      aria-label={`معیار ${activity.title} ${index + 1}`}
                    />
                  ))}
                  <ErpButton
                    label="افزودن معیار"
                    icon={FaPlus}
                    tone="neutral"
                    variant="ghost"
                    onClick={() =>
                      updateActivity(activity.id, {
                        criteria: [...activity.criteria, ""],
                      })
                    }
                  />
                </div>
              ) : null}
            </ErpCard>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <ErpInput
            value={customTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
            placeholder="عنوان فعالیت سفارشی"
          />
          <ErpButton
            label="افزودن فعالیت سفارشی"
            icon={FaPlus}
            disabled={!customTitle.trim() || noExtraReview}
            onClick={() => {
              onChange([
                ...activities,
                {
                  id: `custom-${activities.length}`,
                  title: customTitle.trim(),
                  selected: true,
                  custom: true,
                  criteria: [""],
                },
              ]);
              setCustomTitle("");
            }}
          />
        </div>
      </ErpSection>
      <ErpSection title="بدون بررسی تکمیلی">
        <ErpCheckbox
          checked={noExtraReview}
          onChange={(event) => onNoExtraReviewChange(event.target.checked)}
          label="هیچ فعالیت تکمیلی برای این متقاضی لازم نیست"
        />
        {noExtraReview ? (
          <div className="mt-3">
            <FieldLabel required>دلیل</FieldLabel>
            <ErpTextarea
              value={noExtraReason}
              onChange={(event) => onNoExtraReasonChange(event.target.value)}
            />
          </div>
        ) : null}
      </ErpSection>
      <div className="flex justify-end">
        <ErpButton
          label="نهایی‌کردن فهرست بررسی‌ها"
          icon={FaCheck}
          variant="solid"
          disabled={
            noExtraReview
              ? !noExtraReason.trim()
              : !activities.some((activity) => activity.selected)
          }
        />
      </div>
    </div>
  );
}

function VersionHistory() {
  return (
    <ErpSection
      title="تاریخچه غیرقابل‌حذف"
      description="این داده نمونه است و رفتار نسخه‌بندی را نشان می‌دهد."
    >
      <div className="space-y-3">
        <ErpCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-[var(--sds-text-primary)]">
                نسخه ۲ · نسخه جاری
              </h3>
              <ErpBadge tone="success">معتبر</ErpBadge>
            </div>
            <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
              اصلاح امتیاز ثبات شغلی پس از دریافت توضیح تکمیلی متقاضی
            </p>
          </div>
          <p className="text-xs text-[var(--sds-text-muted)]">
            سارا احمدی · ۱۴۰۵/۰۵/۱۵، ۱۱:۴۲
          </p>
        </ErpCard>
        <ErpCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-[var(--sds-text-primary)]">
                نسخه ۱ · تکمیل اولیه
              </h3>
              <ErpBadge tone="neutral">جایگزین شده</ErpBadge>
            </div>
            <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
              نتیجه مثبت با دلیل و ۱۷ معیار ثبت‌شده
            </p>
          </div>
          <p className="text-xs text-[var(--sds-text-muted)]">
            سارا احمدی · ۱۴۰۵/۰۵/۱۵، ۱۰:۱۸
          </p>
        </ErpCard>
      </div>
      <div className="mt-4 flex justify-end">
        <ErpButton
          label="ایجاد نسخه اصلاحی"
          icon={FaHistory}
          variant="outline"
        />
      </div>
    </ErpSection>
  );
}

function PrototypeSwitcher({
  variant,
  onVariantChange,
}: {
  variant: Variant;
  onVariantChange: (variant: Variant) => void;
}) {
  const cycle = useCallback(
    (direction: -1 | 1) => {
      const index = prototypeVariants.indexOf(variant);
      onVariantChange(
        prototypeVariants[
          (index + direction + prototypeVariants.length) %
            prototypeVariants.length
        ],
      );
    },
    [onVariantChange, variant],
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']"))
        return;
      if (event.key === "ArrowLeft") cycle(1);
      if (event.key === "ArrowRight") cycle(-1);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [cycle]);

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-surface-raised)] p-2 shadow-[var(--sds-shadow-raised)]">
      <ErpButton
        label="طرح قبلی"
        icon={FaArrowRight}
        onClick={() => cycle(-1)}
        variant="ghost"
        tone="neutral"
        className="min-h-11"
      />
      <span className="min-w-36 text-center text-sm font-bold text-[var(--sds-text-primary)]">
        {variant} · {variantNames[variant]}
      </span>
      <ErpButton
        label="طرح بعدی"
        icon={FaArrowLeft}
        onClick={() => cycle(1)}
        variant="ghost"
        tone="neutral"
        className="min-h-11"
      />
    </div>
  );
}

export function ProductionHrInterview({
  initialPayload,
  initialVersion = 0,
  history = [],
  busy,
  onSaveDraft,
  onComplete,
}: {
  initialPayload?: ProductionInterviewPayload | null;
  initialVersion?: number;
  history?: Array<{ version: number; decidedAt?: string; outcome?: string }>;
  busy: boolean;
  onSaveDraft: (payload: ProductionInterviewPayload, expectedVersion: number) => Promise<{ version: number }>;
  onComplete: (payload: ProductionInterviewPayload) => Promise<void>;
}) {
  const [criteriaSnapshot, setCriteriaSnapshot] = useState<PublishedInterviewCriterion[] | undefined>(() => initialPayload?.criteriaSnapshot);
  const [criteriaTemplateVersion, setCriteriaTemplateVersion] = useState(initialPayload?.criteriaTemplateVersion ?? 0);
  const [criteria, setCriteria] = useState<InterviewCriterion[]>(() => publishedCriteriaForInterview(initialPayload?.criteriaSnapshot));
  const [state, setState] = useState<InterviewState>(() => hydrateInterviewState(initialPayload?.state, publishedCriteriaForInterview(initialPayload?.criteriaSnapshot)));
  const [customCriteria, setCustomCriteria] = useState<CustomCriterion[]>(() => initialPayload?.customCriteria || []);
  const [version, setVersion] = useState(initialVersion);
  const versionRef = useRef(initialVersion);
  const saveDraftRef = useRef(onSaveDraft);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const initialRender = useRef(true);
  const payload = useMemo<ProductionInterviewPayload>(() => ({ schemaVersion: 2, state, customCriteria, criteriaTemplateVersion, criteriaSnapshot }), [criteriaSnapshot, criteriaTemplateVersion, customCriteria, state]);
  const canComplete = criteria.every((criterion) => criterionIsComplete(criterion, state.answers[criterion.id]))
    && customCriteria.every(customCriterionIsComplete)
    && state.decision !== null
    && state.decisionReason.trim().length > 0;
  useEffect(() => { saveDraftRef.current = onSaveDraft; }, [onSaveDraft]);

  useEffect(() => {
    if (initialPayload?.criteriaSnapshot?.length) return;
    let active = true;
    void hiringAPI.interviewCriteria().then(({ data }) => {
      if (!active) return;
      const snapshot = data.data.criteriaJson as PublishedInterviewCriterion[];
      const nextCriteria = publishedCriteriaForInterview(snapshot);
      setCriteriaSnapshot(snapshot);
      setCriteriaTemplateVersion(Number(data.data.version || 0));
      setCriteria(nextCriteria);
      setState((current) => hydrateInterviewState(current, nextCriteria));
    }).catch(() => setSaveStatus("error"));
    return () => { active = false; };
  }, [initialPayload?.criteriaSnapshot]);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        setSaveStatus("saving");
        const saved = await saveDraftRef.current(payload, versionRef.current);
        versionRef.current = saved.version;
        setVersion(saved.version);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [payload]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ErpBadge tone={saveStatus === "error" ? "danger" : saveStatus === "saving" ? "warning" : "success"}>
          {saveStatus === "error" ? "ذخیره پیش‌نویس ناموفق" : saveStatus === "saving" ? "در حال ذخیره…" : version ? `پیش‌نویس نسخه ${version.toLocaleString("fa-IR")}` : "پیش‌نویس جدید"}
        </ErpBadge>
        <span className="text-xs text-[var(--sds-text-muted)]">تغییرها به‌صورت خودکار ذخیره می‌شوند.</span>
      </div>
      <GuidedVariant state={state} onChange={setState} criteria={criteria} />
      <CaseSpecificCriteria criteria={customCriteria} onChange={setCustomCriteria} />
      <ErpSection title="تکمیل مصاحبه">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ErpBadge tone={canComplete ? "info" : "warning"}>{canComplete ? "آماده تکمیل" : "اطلاعات ناقص"}</ErpBadge>
          <ErpButton
            label="ثبت و تکمیل مصاحبه"
            icon={FaCheck}
            tone="success"
            disabled={busy || !canComplete || saveStatus === "saving"}
            onClick={() => onComplete(payload)}
          />
        </div>
      </ErpSection>
      {history.length > 0 && (
        <ErpSection title="تاریخچه نسخه‌ها">
          <ErpButton label={historyOpen ? "بستن تاریخچه" : "نمایش نسخه‌های قبلی"} variant="ghost" onClick={() => setHistoryOpen((open) => !open)} />
          {historyOpen && <div className="mt-3 space-y-2">
            {history.map((item) => (
              <ErpCard key={item.version} className="flex items-center justify-between gap-3 p-3 text-sm">
                <b>نسخه {item.version.toLocaleString("fa-IR")}</b>
                <ErpBadge tone={item.outcome === "POSITIVE" ? "success" : "danger"}>{item.outcome === "POSITIVE" ? "مثبت" : "منفی"}</ErpBadge>
              </ErpCard>
            ))}
          </div>}
        </ErpSection>
      )}
    </div>
  );
}

export function ProductionInterviewReport({
  payload,
  version,
  history = [],
}: {
  payload: ProductionInterviewPayload;
  version: number;
  history?: Array<{ version: number; outcome?: string; evidenceJson?: ProductionInterviewPayload }>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const criteria = publishedCriteriaForInterview(payload.criteriaSnapshot);
  const state = hydrateInterviewState(payload.state, criteria);
  const judgment = (value: Judgment) => value ? judgmentLabels[value] : "ثبت نشده";
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <ErpBadge tone={state.decision === "POSITIVE" ? "success" : "danger"}>{state.decision === "POSITIVE" ? "نتیجه مثبت" : "نتیجه منفی"}</ErpBadge>
      <span className="text-sm text-[var(--sds-text-secondary)]">گزارش نسخه {version.toLocaleString("fa-IR")}</span>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      {criteria.map((criterion) => {
        const answer = state.answers[criterion.id];
        return <ErpCard key={criterion.id} className="space-y-2 p-4">
          <b>{criterion.order.toLocaleString("fa-IR")}. {criterion.title}</b>
          {criterion.prompt && <p className="text-sm text-[var(--sds-text-secondary)]">{criterion.prompt}</p>}
          {criterion.kind === "score" && <p>{answer.score === "UNASSESSED" ? "ارزیابی نشد" : `امتیاز ${answer.score?.toLocaleString("fa-IR")}`}</p>}
          {criterion.kind === "text" && <p className="whitespace-pre-wrap">{answer.text}</p>}
          {criterion.kind === "yesNo" && <><p>{answer.companionPresent === "YES" ? "بله" : "خیر"} · {judgment(answer.judgment)}</p></>}
          {criterion.kind === "address" && <><p className="whitespace-pre-wrap">{answer.text}</p><p>{judgment(answer.judgment)}</p></>}
          {criterion.kind === "companion" && <p>{answer.companionPresent === "YES" ? "با همراه" : "بدون همراه"} · {judgment(answer.judgment)}</p>}
          {criterion.kind === "strengthsWeaknesses" && <div className="grid gap-2 sm:grid-cols-2"><div><b>نقاط قوت</b>{answer.strengths.map((item, index) => <p key={`s-${index}`}>{item}</p>)}</div><div><b>نقاط ضعف</b>{answer.weaknesses.map((item, index) => <p key={`w-${index}`}>{item}</p>)}</div></div>}
          {answer.note && <p className="whitespace-pre-wrap text-sm text-[var(--sds-text-secondary)]">یادداشت: {answer.note}</p>}
        </ErpCard>;
      })}
    </div>
    <ErpSection title="جمع‌بندی مصاحبه"><p className="whitespace-pre-wrap">{state.decisionReason}</p></ErpSection>
    {history.length > 0 && <ErpSection title="تاریخچه نسخه‌ها">
      <ErpButton label={historyOpen ? "بستن تاریخچه" : "نمایش نسخه‌های قبلی"} variant="ghost" onClick={() => setHistoryOpen((open) => !open)} />
      {historyOpen && <div className="mt-3 space-y-4">{history.map((item) => <ErpCard key={item.version} className="p-4">{item.evidenceJson ? <ProductionInterviewReport payload={item.evidenceJson} version={item.version} /> : <div className="flex items-center justify-between gap-3"><b>نسخه {item.version.toLocaleString("fa-IR")}</b><ErpBadge tone={item.outcome === "POSITIVE" ? "success" : "danger"}>{item.outcome === "POSITIVE" ? "مثبت" : "منفی"}</ErpBadge></div>}</ErpCard>)}</div>}
    </ErpSection>}
  </div>;
}

export default function HrInterviewPrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const requestedVariant = searchParams.get("variant")?.toUpperCase();
  const variant: Variant =
    requestedVariant === "B" || requestedVariant === "C"
      ? requestedVariant
      : "A";
  const requestedSurface = searchParams.get("surface");
  const surface: Surface =
    requestedSurface === "checklist" ||
    requestedSurface === "defaults" ||
    requestedSurface === "history"
      ? requestedSurface
      : "interview";
  const [state, setState] = useState(createInitialInterviewState);
  const [customCriteria, setCustomCriteria] = useState<CustomCriterion[]>([]);
  const [interviewCompleted, setInterviewCompleted] = useState(false);
  const [defaultTitles, setDefaultTitles] = useState(() =>
    interviewCriteria.map((criterion) => criterion.title),
  );
  const [activities, setActivities] = useState(initialManagementActivities);
  const [noExtraReview, setNoExtraReview] = useState(false);
  const [noExtraReason, setNoExtraReason] = useState("");

  const setQuery = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div dir="rtl" className="pb-24">
      <ErpPage
        eyebrow="نمونه آزمایشی · اطلاعات ذخیره نمی‌شود"
        title="مصاحبه اولیه HR و بررسی‌های مدیریت"
        description={`طرح ${variant}: ${variantNames[variant]} · متقاضی نمونه: مریم رضایی · کارشناس فروش`}
        backHref="/dashboard/hr/hiring"
        actions={[
          {
            label: theme === "dark" ? "حالت روشن" : "حالت تیره",
            icon: theme === "dark" ? FaSun : FaMoon,
            onClick: () => setTheme(theme === "dark" ? "light" : "dark"),
            tone: "neutral",
            variant: "outline",
          },
        ]}
      >
        <div className="mb-4">
          <ErpSegmentedControl
            options={surfaceOptions}
            value={surface}
            onChange={(value) => setQuery("surface", value)}
          />
        </div>

        {surface === "interview" && variant === "A" ? (
          <GuidedVariant state={state} onChange={setState} />
        ) : null}
        {surface === "interview" && variant === "B" ? (
          <WorksheetVariant state={state} onChange={setState} />
        ) : null}
        {surface === "interview" && variant === "C" ? (
          <DecisionDeskVariant state={state} onChange={setState} />
        ) : null}
        {surface === "interview" ? (
          <div className="mt-4 space-y-4">
            <CaseSpecificCriteria
              criteria={customCriteria}
              onChange={setCustomCriteria}
            />
            <InterviewCompletion
              state={state}
              customCriteria={customCriteria}
              completed={interviewCompleted}
              onCompletedChange={setInterviewCompleted}
            />
          </div>
        ) : null}
        {surface === "checklist" ? (
          <ManagementChecklist
            activities={activities}
            onChange={setActivities}
            noExtraReview={noExtraReview}
            onNoExtraReviewChange={(value) => {
              setNoExtraReview(value);
              if (value)
                setActivities((current) =>
                  current.map((activity) => ({ ...activity, selected: false })),
                );
            }}
            noExtraReason={noExtraReason}
            onNoExtraReasonChange={setNoExtraReason}
          />
        ) : null}
        {surface === "defaults" ? (
          <DefaultCriteriaEditor
            titles={defaultTitles}
            onChange={setDefaultTitles}
          />
        ) : null}
        {surface === "history" ? <VersionHistory /> : null}
      </ErpPage>
      <PrototypeSwitcher
        variant={variant}
        onVariantChange={(next) => setQuery("variant", next)}
      />
    </div>
  );
}
