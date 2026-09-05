'use client';

import React from 'react';
import { ErpInlineState } from '@/components/erp';
import type { CommandFeedback } from './commandSession';

export function CommandFeedbackView({ feedback, pending, onRetry, onRefresh }: {
  feedback: CommandFeedback | null; pending: boolean; onRetry: () => void; onRefresh: () => void;
}) {
  if (!feedback) return null;
  if (feedback.kind === 'success') {
    const successes = feedback.batch?.outcomes.filter(outcome => outcome.ok).length;
    const failures = feedback.batch?.outcomes.filter(outcome => !outcome.ok).length;
    return <ErpInlineState kind={failures ? 'stale' : 'success'} className="flex-col items-start"
      title={feedback.batch ? `${successes} ردیف ثبت شد؛ ${failures} ردیف نیازمند بررسی است.` : 'تصمیم ثبت شد.'} />;
  }
  if (feedback.kind === 'uncertain' || feedback.kind === 'blocked') return <ErpInlineState kind="stale" className="flex-col items-start"
    title={feedback.message} action={feedback.kind === 'uncertain' ? { label: 'بررسی همان درخواست', onClick: onRetry, disabled: pending } : undefined} />;
  return <ErpInlineState kind={feedback.error.status === 403 || feedback.error.status === 404 ? 'permission' : 'error'}
    className="flex-col items-start" title={feedback.error.message}
    action={{ label: 'دریافت وضعیت تازه', onClick: onRefresh, disabled: pending }} />;
}
