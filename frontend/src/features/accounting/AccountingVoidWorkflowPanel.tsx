'use client';

import React from 'react';
import { FaBan, FaCheckCircle, FaExclamationTriangle, FaTimesCircle } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard } from '@/components/erp';
import { dateFa } from './accountingUi';

type VoidAction = { kind: string; targetId: string; href: string; labelFa: string };
type VoidStep = {
  id: string;
  titleFa: string;
  state: 'DONE' | 'ACTIONABLE' | 'WAITING' | 'BLOCKED';
  messageFa: string;
  action?: VoidAction;
};
export type AccountingVoidWorkflowView = {
  id: string;
  sourceRecordId: string;
  status: 'OPEN' | 'CANCELLED' | 'COMPLETED';
  reasonKind: string;
  reason: string;
  effectiveAt: string;
  retainedRecordId?: string | null;
  steps: VoidStep[];
  blockers: Array<{ code: string; messageFa: string; responsibleRoleFa: string }>;
  nextAction?: VoidAction | null;
  canCancel: boolean;
};

const stateLabel = (state: VoidStep['state']) => ({
  DONE: 'انجام شده', ACTIONABLE: 'اقدام بعدی', WAITING: 'منتظر مرحله قبل', BLOCKED: 'مسدود',
}[state]);

export default function AccountingVoidWorkflowPanel({ workflows, busy, onResolveTax, onVoidReceivable, onVoidRecord, onCancel }: {
  workflows: AccountingVoidWorkflowView[];
  busy?: boolean;
  onResolveTax: (workflow: AccountingVoidWorkflowView, taxRecordId: string) => void;
  onVoidReceivable: (workflow: AccountingVoidWorkflowView, receivableId: string) => void;
  onVoidRecord: (workflow: AccountingVoidWorkflowView, recordId: string) => void;
  onCancel: (workflow: AccountingVoidWorkflowView) => void;
}) {
  if (!workflows.length) return null;
  return (
    <div className="space-y-4">
      {workflows.map(workflow => (
        <ErpCard key={workflow.id} tone={workflow.status === 'OPEN' ? 'warning' : workflow.status === 'COMPLETED' ? 'success' : 'neutral'} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-[var(--sds-text-primary)]">
                {workflow.reasonKind === 'DUPLICATE_ISSUE' ? 'ابطال رکورد تکراری' : 'پرونده ابطال رکورد مالی'}
              </h3>
              <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{workflow.reason} · تاریخ مؤثر {dateFa(workflow.effectiveAt)}</p>
            </div>
            <ErpBadge tone={workflow.status === 'OPEN' ? 'warning' : workflow.status === 'COMPLETED' ? 'success' : 'neutral'}>
              {workflow.status === 'OPEN' ? 'در حال انجام' : workflow.status === 'COMPLETED' ? 'تکمیل شده' : 'لغو شده'}
            </ErpBadge>
          </div>
          {workflow.status === 'OPEN' && workflow.blockers.length > 0 && (
            <div className="mt-4 space-y-2" aria-label="راهنمای رفع موانع">
              {workflow.blockers.map(blocker => (
                <div key={blocker.code} className="rounded-[var(--sds-radius-card)] border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-sm">
                  <p className="font-semibold text-[var(--sds-text-primary)]">راه‌حل: {blocker.messageFa}</p>
                  <p className="mt-1 text-[var(--sds-text-secondary)]">مسئول انجام: {blocker.responsibleRoleFa}</p>
                </div>
              ))}
            </div>
          )}
          <ol className="mt-4 space-y-2">
            {workflow.steps.map((step, index) => {
              const actionable = workflow.status === 'OPEN' && step.state === 'ACTIONABLE' && step.action;
              const Icon = step.state === 'DONE' ? FaCheckCircle : step.state === 'BLOCKED' ? FaTimesCircle : FaExclamationTriangle;
              return (
                <li key={step.id} className={`rounded-[var(--sds-radius-card)] border p-3 ${step.state === 'ACTIONABLE'
                  ? 'border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)]'
                  : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)]'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <Icon className="mt-1 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-semibold text-[var(--sds-text-primary)]">{index + 1}. {step.titleFa}</p>
                        <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{step.messageFa}</p>
                        <p className="mt-1 text-xs text-[var(--sds-text-muted)]">{stateLabel(step.state)}</p>
                      </div>
                    </div>
                    {actionable && (step.action!.kind === 'RESOLVE_TAX' ? (
                      <ErpButton label={step.action!.labelFa} tone="warning" variant="solid" disabled={busy}
                        onClick={() => onResolveTax(workflow, step.action!.targetId)} />
                    ) : step.action!.kind === 'VOID_RECEIVABLE' ? (
                      <ErpButton label={step.action!.labelFa} tone="danger" variant="outline" disabled={busy}
                        onClick={() => onVoidReceivable(workflow, step.action!.targetId)} />
                    ) : step.action!.kind === 'VOID_FINANCIAL_RECORD' ? (
                      <ErpButton label={step.action!.labelFa} tone="danger" variant="solid" disabled={busy}
                        onClick={() => onVoidRecord(workflow, step.action!.targetId)} />
                    ) : (
                      <ErpButton label={step.action!.labelFa} href={step.action!.href} tone="primary" variant="solid" />
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          {workflow.status === 'OPEN' && workflow.canCancel && (
            <div className="mt-4 flex justify-end">
              <ErpButton label="لغو پرونده ابطال" icon={FaBan} tone="neutral" variant="outline" disabled={busy}
                onClick={() => onCancel(workflow)} />
            </div>
          )}
        </ErpCard>
      ))}
    </div>
  );
}
