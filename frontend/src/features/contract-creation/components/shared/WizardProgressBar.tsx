// Wizard Progress Bar Component
// Displays the progress indicator with step icons

import React from 'react';
import { FaCheck } from 'react-icons/fa';

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
}

export const WizardProgressBar: React.FC<WizardProgressBarProps> = ({ currentStep, steps }) => {
  if (!steps.length) return null;

  const currentStepInfo = steps.find((step) => step.id === currentStep) || steps[0];
  const CurrentIcon = currentStepInfo.icon;

  return (
    <div className="mb-8">
      <div className="sm:hidden">
        <div className="mb-4 rounded-lg border border-slate-700/70 bg-slate-900/70 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/15 text-teal-300">
              <CurrentIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-teal-300">
                مرحله {currentStep.toLocaleString('fa-IR')} از {steps.length.toLocaleString('fa-IR')}
              </p>
              <h2 className="mt-1 text-base font-bold text-white">{currentStepInfo.title}</h2>
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-300 transition-all duration-500 ease-out"
              style={{ width: `${(currentStep / steps.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex min-w-max items-stretch gap-2">
            {steps.map((step) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;

              return (
                <div
                  key={step.id}
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex w-20 flex-shrink-0 flex-col items-center rounded-lg border px-2 py-3 text-center transition ${
                    isActive
                      ? 'border-teal-500 bg-teal-500/15 text-teal-200'
                      : isCompleted
                        ? 'border-teal-700/60 bg-teal-900/20 text-teal-300'
                        : 'border-slate-700 bg-slate-900/60 text-slate-400'
                  }`}
                >
                  <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full ${
                    isActive ? 'bg-teal-500 text-white' : isCompleted ? 'bg-teal-700 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isCompleted ? <FaCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span className="line-clamp-2 text-[11px] font-semibold leading-4">{step.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative z-0 hidden items-center justify-between sm:flex">
        {/* Progress Line */}
        <div className="absolute top-6 left-6 right-6 h-0.5 bg-gray-200 dark:bg-gray-700 -z-10">
          <div 
            className="h-full bg-gradient-to-r from-teal-500 to-teal-400 transition-all duration-500 ease-out"
            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
          />
        </div>
        
        {steps.map((step) => {
          const Icon = step.icon;
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;
          const isUpcoming = currentStep < step.id;
          
          return (
            <div key={step.id} className="flex flex-col items-center relative z-0">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-all duration-300 transform ${
                isCompleted 
                  ? 'bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/25 scale-105' 
                  : isActive 
                    ? 'bg-gradient-to-br from-teal-100 to-teal-200 dark:from-teal-900/50 dark:to-teal-800/50 text-teal-600 dark:text-teal-400 border-2 border-teal-500 shadow-lg shadow-teal-500/20 scale-110' 
                    : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-2 border-gray-200 dark:border-gray-600 shadow-sm hover:shadow-md transition-shadow'
              }`}>
                {isCompleted ? (
                  <FaCheck className="w-5 h-5" />
                ) : (
                  <Icon className={`w-5 h-5 ${isActive ? 'animate-pulse' : ''}`} />
                )}
              </div>
              <span className={`text-xs font-medium text-center max-w-20 leading-tight ${
                isActive 
                  ? 'text-teal-600 dark:text-teal-400 font-semibold' 
                  : isCompleted
                    ? 'text-teal-500 dark:text-teal-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}>
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

