import React from 'react';
import { FaCheck } from 'react-icons/fa';
import { ErpPressable } from '@/components/erp';

export interface WizardStep {
  id: number;
  title: string;
  titleEn: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface WizardProgressBarProps {
  currentStep: number;
  steps: WizardStep[];
  onStepClick?: (step: number) => void;
  clickable?: boolean;
}

export const WizardProgressBar: React.FC<WizardProgressBarProps> = ({
  currentStep,
  steps,
  onStepClick,
  clickable = false
}) => {
  if (!steps.length) return null;

  const currentIndex = Math.max(0, steps.findIndex(step => step.id === currentStep));
  const active = steps[currentIndex] ?? steps[0];
  const ActiveIcon = active.icon;
  const progress = ((currentIndex + 1) / steps.length) * 100;

  return (
    <nav aria-label="مراحل ایجاد قرارداد" className="mb-6">
      <div className="sds-workspace-surface p-4 sm:hidden">
        <div className="flex items-center gap-3">
          <span className="sds-tone-primary sds-tone-surface flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--sds-radius-control)]">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="sds-text-muted text-xs">
              مرحله {(currentIndex + 1).toLocaleString('fa-IR')} از {steps.length.toLocaleString('fa-IR')}
            </p>
            <h2 className="sds-text-primary mt-1 truncate text-base font-bold">{active.title}</h2>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--sds-border-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--sds-accent)] transition-[width] duration-[var(--sds-motion-standard)] motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ol className="hidden items-start sm:flex">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === currentIndex;
          const completed = index < currentIndex;
          return (
            <li key={step.id} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-1/2 right-[-50%] top-5 h-0.5 ${
                    completed || isActive
                      ? 'bg-[var(--sds-accent)]'
                      : 'bg-[var(--sds-border-default)]'
                  }`}
                />
              )}
              <ErpPressable
                type="button"
                aria-current={isActive ? 'step' : undefined}
                disabled={!clickable}
                onClick={() => onStepClick?.(step.id)}
                tone={isActive || completed ? 'primary' : 'neutral'}
                variant={isActive ? 'solid' : completed ? 'soft' : 'outline'}
                className="relative z-10 h-11 w-11 rounded-full p-0 disabled:cursor-default disabled:opacity-100"
              >
                {completed ? <FaCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span className="sr-only">{step.title}</span>
              </ErpPressable>
              <span className={`mt-2 max-w-24 text-center text-xs ${isActive ? 'font-bold text-[var(--sds-accent)]' : 'sds-text-muted'}`}>
                {step.title}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
