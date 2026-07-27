import { ErpPressable } from '@/components/erp';
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
    "border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] text-[var(--sds-success)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]",
  ACTION_REQUIRED:
    "border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]",
  WAITING:
    "border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] text-[var(--sds-warning)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]",
  BLOCKED:
    "border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]",
  PAUSED:
    "border-[var(--sds-info-border)] bg-[var(--sds-info-surface)] text-[var(--sds-info)] dark:bg-[var(--sds-info-surface)] dark:text-[var(--sds-info)]",
  UPCOMING:
    "border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-muted)]",
  ENDED:
    "border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-muted)]",
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
    <ErpPressable
      type="button"
      aria-current={current ? "step" : undefined}
      aria-pressed={selected}
      aria-label={`مرحله ${phase.number}: ${phase.title}، ${hiringLifecycleStatusLabel[phase.status]}`}
      onClick={() => onSelect(phase.id)}
      className={`group relative shrink-0 rounded-xl border text-right outline-none transition-[border-color,background-color,color,transform] duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${statusStyle[phase.status]} ${selected ? "ring-2 ring-[var(--sds-focus-ring)] ring-offset-2 dark:ring-offset-slate-950" : ""} ${compact ? "w-36 p-3" : "min-h-32 w-full p-3"}`}
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
    </ErpPressable>
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
      className="rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            id="hiring-lifecycle-title"
            className="text-base font-black text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
          >
            مسیر جذب و شروع همکاری
          </p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
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
        className="mt-4 border-t border-[var(--sds-border-default)] pt-4 dark:border-[var(--sds-border-strong)]"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-black text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
            {focused.title}
          </h2>
          <span className="text-xs font-bold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
            {focused.requiredComplete.toLocaleString("fa-IR")} از{" "}
            {focused.requiredTotal.toLocaleString("fa-IR")} مورد الزامی
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
          {focused.guidance}
        </p>
        {focused.responsibleFunction && (
          <p className="mt-2 text-xs font-bold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
            مسئول ادامه: {focused.responsibleFunction}
          </p>
        )}
        {focused.primaryAction && (
          <p className="mt-3 rounded-xl border border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] px-3 py-2 text-sm font-bold text-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]">
            گام بعدی: {focused.primaryAction.label}
          </p>
        )}
        {focused.blockers.map((item) => (
          <p
            key={item.code}
            className="mt-2 rounded-xl border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] px-3 py-2 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]"
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
                className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-xs font-bold text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
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
