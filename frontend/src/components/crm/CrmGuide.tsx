'use client';

import { useMemo, useState } from 'react';
import { FaChevronLeft, FaChevronRight, FaQuestionCircle, FaTimes } from 'react-icons/fa';
import { ErpButton } from '@/components/erp';

export type CrmGuideStep = {
  targetId: string;
  title: string;
  body: string;
  fields?: string[];
  mistakes?: string[];
};

export function CrmGuide({ steps }: { steps: CrmGuideStep[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const step = steps[index];

  const targetRect = useMemo(() => {
    if (!open || !step || typeof document === 'undefined') return null;
    const element = document.querySelector(`[data-crm-guide="${step.targetId}"]`);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      top: Math.max(rect.top - 8, 8),
      right: Math.max(window.innerWidth - rect.right - 8, 8),
      bottom: Math.max(window.innerHeight - rect.bottom - 8, 8),
      left: Math.max(rect.left - 8, 8),
    };
  }, [open, step]);

  const next = () => setIndex((current) => Math.min(current + 1, steps.length - 1));
  const previous = () => setIndex((current) => Math.max(current - 1, 0));
  const close = () => {
    setOpen(false);
    setIndex(0);
  };

  return (
    <>
      <ErpButton label="راهنما" icon={FaQuestionCircle} tone="info" variant="outline" onClick={() => setOpen(true)} />
      {open && step ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" />
          {targetRect && (
            <div
              className="pointer-events-none absolute rounded-xl border-2 border-teal-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.52)]"
              style={{
                top: targetRect.top,
                right: targetRect.right,
                bottom: targetRect.bottom,
                left: targetRect.left,
              }}
            />
          )}
          <div className="absolute inset-x-3 bottom-3 mx-auto max-w-xl rounded-lg border border-teal-200 bg-white p-4 text-right shadow-2xl dark:border-teal-700 dark:bg-slate-900 sm:bottom-6 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#074747] dark:text-teal-200">
                  مرحله {(index + 1).toLocaleString('fa-IR')} از {steps.length.toLocaleString('fa-IR')}
                </p>
                <h2 className="mt-1 text-base font-bold text-slate-950 dark:text-white">{step.title}</h2>
              </div>
              <button
                type="button"
                onClick={close}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="بستن راهنما"
              >
                <FaTimes className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">{step.body}</p>
            {step.fields?.length ? (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">فیلدهای مهم</p>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
                  {step.fields.map((field) => <li key={field}>{field}</li>)}
                </ul>
              </div>
            ) : null}
            {step.mistakes?.length ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-200">اشتباه‌های رایج</p>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-800 dark:text-amber-100">
                  {step.mistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={previous}
                disabled={index === 0}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#074747]/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
              >
                <FaChevronRight className="h-3 w-3" />
                قبلی
              </button>
              <button
                type="button"
                onClick={index === steps.length - 1 ? close : next}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#074747] bg-[#074747] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0b5c5c]"
              >
                {index === steps.length - 1 ? 'پایان' : 'بعدی'}
                {index !== steps.length - 1 && <FaChevronLeft className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
