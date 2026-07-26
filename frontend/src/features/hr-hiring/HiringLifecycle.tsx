import type { ComponentType } from "react";
import {
  FaBan,
  FaCheck,
  FaCircle,
  FaClock,
  FaExclamation,
  FaLock,
} from "react-icons/fa";
import {
  hiringLifecycleStatusLabel,
  selectedHiringPhase,
  type HiringLifecyclePhase,
  type HiringLifecycleProjection,
  type HiringLifecycleStatus,
} from "./hiringLifecycleViewModel";

const statusStyle: Record<HiringLifecycleStatus, string> = {
  COMPLETED:
    "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  ACTION_REQUIRED:
    "border-teal-500 bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-100",
  WAITING:
    "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
  BLOCKED:
    "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100",
  PAUSED:
    "border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-100",
  UPCOMING:
    "border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
  ENDED:
    "border-slate-400 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const statusIcon: Record<
  HiringLifecycleStatus,
  ComponentType<{ className?: string }>
> = {
  COMPLETED: FaCheck,
  ACTION_REQUIRED: FaExclamation,
  WAITING: FaClock,
  BLOCKED: FaLock,
  PAUSED: FaBan,
  UPCOMING: FaCircle,
  ENDED: FaBan,
};

const PhaseButton = ({
  phase,
  selected,
  current,
  onSelect,
  compact = false,
}: {
  phase: HiringLifecyclePhase;
  selected: boolean;
  current: boolean;
  onSelect: (phaseId: string) => void;
  compact?: boolean;
}) => {
  const Icon = statusIcon[phase.status];
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      aria-pressed={selected}
      aria-label={`مرحله ${phase.number}: ${phase.title}، ${hiringLifecycleStatusLabel[phase.status]}`}
      onClick={() => onSelect(phase.id)}
      className={`group relative shrink-0 rounded-xl border text-right outline-none transition-[border-color,background-color,color,transform] duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${statusStyle[phase.status]} ${selected ? "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-slate-950" : ""} ${compact ? "w-36 p-3" : "min-h-32 w-full p-3"}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-black">{phase.number}</span>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="mt-3 block text-sm font-black leading-6">
        {phase.title}
      </span>
      <span className="mt-2 block text-[11px] font-bold">
        {hiringLifecycleStatusLabel[phase.status]}
      </span>
    </button>
  );
};

export function HiringLifecycle({
  projection,
  selectedPhaseId,
  onSelect,
}: {
  projection: HiringLifecycleProjection;
  selectedPhaseId: string;
  onSelect: (phaseId: string) => void;
}) {
  const focused = selectedHiringPhase(projection, selectedPhaseId);
  return (
    <section
      dir="rtl"
      aria-labelledby="hiring-lifecycle-title"
      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            id="hiring-lifecycle-title"
            className="text-base font-black text-slate-950 dark:text-white"
          >
            مسیر جذب و شروع همکاری
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            مرحله {projection.currentPhaseNumber.toLocaleString("fa-IR")} از{" "}
            {projection.totalPhases.toLocaleString("fa-IR")}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-bold ${statusStyle[focused.status]}`}
        >
          {hiringLifecycleStatusLabel[focused.status]}
        </span>
      </div>

      <div
        className="mt-4 hidden grid-cols-8 gap-2 md:grid"
        role="list"
        aria-label="مراحل جذب"
      >
        {projection.phases.map((phase) => (
          <div role="listitem" key={phase.id}>
            <PhaseButton
              phase={phase}
              selected={phase.id === focused.id}
              current={phase.id === projection.currentPhaseId}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>

      <div
        className="mt-4 flex snap-x gap-2 overflow-x-auto pb-2 md:hidden"
        role="list"
        aria-label="مراحل جذب"
      >
        {projection.phases.map((phase) => (
          <div role="listitem" className="snap-start" key={phase.id}>
            <PhaseButton
              compact
              phase={phase}
              selected={phase.id === focused.id}
              current={phase.id === projection.currentPhaseId}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>

      <div
        className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-black text-slate-950 dark:text-white">
            {focused.title}
          </h2>
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {focused.requiredComplete.toLocaleString("fa-IR")} از{" "}
            {focused.requiredTotal.toLocaleString("fa-IR")} مورد الزامی
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {focused.guidance}
        </p>
        {focused.responsibleFunction && (
          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            مسئول ادامه: {focused.responsibleFunction}
          </p>
        )}
        {focused.primaryAction && (
          <p className="mt-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100">
            گام بعدی: {focused.primaryAction.label}
          </p>
        )}
        {focused.blockers.map((item) => (
          <p
            key={item.code}
            className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {item.label}
          </p>
        ))}
        {focused.secondaryActions.length > 0 && (
          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="اقدام‌های مجاز دیگر"
          >
            {focused.secondaryActions.map((item) => (
              <span
                key={item.id}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {item.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
