'use client';

import { useEffect, useRef, useState } from 'react';
import { ErpButton, ErpDisclosure, ErpInlineState, ErpSection, ErpSheet, ErpSkeleton, ErpStatus } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { LogisticsPage } from '@/features/logistics/LogisticsWorkspace';
import {
  projectReturnReceiptApi, projectReturnListHref, projectReturnReceiptStatus,
  type ProjectReturnReceipt, type ProjectReturnReceiptDetails,
} from './projectReturnReceiptApi';
import { ProjectReturnFacts } from './ProjectReturnFacts';
import { ProjectReturnIntake } from './ProjectReturnIntake';
import { projectReturnDriverLabel } from './projectReturnVisitApi';
import { displayExactDecimal, displayStoneReturnQuantity } from './stoneReturnApi';
import { ProjectReturnCorrectionForm } from './ProjectReturnCorrectionForm';
import { projectReturnLinearFields } from './ProjectReturnMeasurement';
import type { ProjectReturnLinearCalculation } from './projectReturnQuantity';

function ProjectReturnRecordedCalculation({ label, calculation }: { label: string; calculation: ProjectReturnLinearCalculation }) {
  return <ErpDisclosure title={label} className="mt-2">
    <ProjectReturnFacts className="grid-cols-2 sm:grid-cols-4" items={projectReturnLinearFields.map(({ key, label }) => ({
      label, value: displayExactDecimal(calculation[key]),
    }))} />
  </ErpDisclosure>;
}

const operationLabels = {
  EDITED: 'ثبت اصلاح',
  CANCELLED: 'لغو پرونده',
  REWORK_REQUESTED: 'درخواست بررسی وابستگی‌ها',
  RETURNED_TO_LOGISTICS: 'بازگشت به لجستیک',
} as const;
const dateText = (value: string) => new Date(value).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });

export function ProjectReturnReceiptPage({ receiptId }: { receiptId: string }) {
  const [receipt, setReceipt] = useState<ProjectReturnReceiptDetails>();
  const [historical, setHistorical] = useState<ProjectReturnReceipt>();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'request-rework'>();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const busy = useRef(false);
  const versionRequest = useRef(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    setReceipt(undefined);
    versionRequest.current += 1;
    setHistorical(undefined);
    setActionError('');
    setError('');
    void projectReturnReceiptApi.read(receiptId).then(row => {
      if (current) setReceipt(row);
    }).catch(reason => {
      if (current) setError(userFacingError(reason, 'دریافت رسید مرجوعی ناموفق بود.'));
    });
    return () => { current = false; };
  }, [receiptId, retry]);

  async function submit() {
    if (!confirm || !receipt || busy.current) return;
    busy.current = true;
    setPending(true);
    setActionError('');
    try {
      setReceipt(await projectReturnReceiptApi.change(receipt.id, confirm, receipt.version.id));
      setConfirm(undefined);
    } catch (reason) {
      setActionError(userFacingError(reason, 'انجام عملیات مرجوعی ناموفق بود.'));
      setConfirm(undefined);
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  async function selectVersion(versionId: string) {
    const request = ++versionRequest.current;
    setActionError('');
    if (versionId === receipt?.version.id) {
      setHistorical(undefined);
      return;
    }
    try {
      const previous = await projectReturnReceiptApi.readVersion(receiptId, versionId);
      if (versionRequest.current === request) setHistorical(previous);
    } catch (reason) {
      if (versionRequest.current === request) setActionError(userFacingError(reason, 'دریافت نسخهٔ مرجوعی ناموفق بود.'));
    }
  }

  if (editing && receipt) return <ProjectReturnIntake revision={receipt} onClose={() => {
    setEditing(false);
    setRetry(value => value + 1);
  }} onRevised={next => {
    setReceipt(next);
    setEditing(false);
  }} />;

  const shown = historical ?? receipt;
  const operational = receipt?.operational;
  return <LogisticsPage title={receipt?.legacyFinalizationId ? 'اصلاح مرجوعی قطعی' : 'رسید مرجوعی پروژه'} backHref={projectReturnListHref}>
    {error ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />
      : !receipt || !shown ? <ErpSkeleton label="دریافت رسید مرجوعی" />
      : <div className="space-y-3">
        <ErpSection className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ErpStatus {...projectReturnReceiptStatus(receipt)} />
            <span className="text-sm sds-text-secondary">نسخهٔ {shown.version.number.toLocaleString('fa-IR')}</span>
          </div>
          <ProjectReturnFacts className="grid-cols-2 lg:grid-cols-4" items={[
            { label: 'مشتری', value: shown.customerName },
            { label: 'پروژه', value: shown.version.projects.map(project => project.projectName).join('، ') },
            ...(receipt.visit ? [{ label: 'راننده و خودرو', value: projectReturnDriverLabel(receipt.visit) }] : []),
            { label: shown.version.assignedAt ? 'زمان ارجاع' : 'زمان ثبت',
              value: dateText(shown.version.submittedAt ?? shown.version.assignedAt ?? shown.createdAt) },
          ]} />
        {!historical && receipt.canManage && operational && <>
          {operational.stockBlock && <ErpInlineState kind="stale" title={operational.stockBlock} />}
          {operational.canRequestRework && <ErpInlineState kind="stale"
            title="پرونده تخصیص یا رزرو فعال دارد. ابتدا آن را برای بررسی به حسابداری ارجاع دهید." />}
          {(operational.canEdit || operational.canRequestRework) && <div className="flex flex-wrap gap-2 border-t border-[var(--sds-border-subtle)] pt-2">
            {operational.canEdit && <>
              <ErpButton label="ویرایش رسید" tone="primary" onClick={() => setEditing(true)} />
              <ErpButton label="لغو پرونده" tone="danger" variant="outline" onClick={() => setConfirm('cancel')} />
            </>}
            {operational.canRequestRework && <ErpButton label="درخواست بررسی حسابداری" tone="primary"
              onClick={() => setConfirm('request-rework')} />}
          </div>}
        </>}
        </ErpSection>
        {actionError && <ErpInlineState kind="error" title={actionError}
          action={{ label: 'بارگذاری دوباره', onClick: () => setRetry(value => value + 1) }} />}
        {receipt.canSubmitCorrection && <ProjectReturnCorrectionForm key={receipt.version.id} receipt={receipt}
          onSubmitted={() => setRetry(value => value + 1)} />}
        {!receipt.canSubmitCorrection && <ErpSection title="اقلام مرجوعی">
          <ul className="divide-y divide-[var(--sds-border-subtle)]">
            {shown.version.items.map(item => <li key={item.id} className="py-2 first:pt-0 last:pb-0">
              <div className="grid min-w-0 gap-2 sm:grid-cols-2 sm:items-center">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold">{item.productName}</h3>
                  <bdi className="break-all text-xs sds-text-secondary" dir="ltr">{item.productCode}</bdi>
                </div>
                <ProjectReturnFacts className="grid-cols-2" items={[
                  { label: 'مقدار سالم', value: displayStoneReturnQuantity(item.healthyQuantity, item.unit) },
                  { label: 'مقدار آسیب‌دیده', value: displayStoneReturnQuantity(item.damagedQuantity, item.unit) },
                ]} />
              </div>
              {item.healthyCalculation && <ProjectReturnRecordedCalculation label="خط راس مقدار سالم" calculation={item.healthyCalculation} />}
              {item.damagedCalculation && <ProjectReturnRecordedCalculation label="خط راس مقدار آسیب‌دیده" calculation={item.damagedCalculation} />}
            </li>)}
          </ul>
        </ErpSection>}
        {(receipt.versions.length > 1 || receipt.operations.length > 0) && <ErpSection title="سابقهٔ پرونده">
          {receipt.versions.length > 1 && <div className="flex flex-wrap gap-2">
            {receipt.versions.map(version => <ErpButton key={version.id}
              label={`مشاهده نسخهٔ ${version.number.toLocaleString('fa-IR')}`}
              variant={version.id === shown.version.id ? 'soft' : 'outline'}
              disabled={version.id === shown.version.id} onClick={() => void selectVersion(version.id)} />)}
          </div>}
          {receipt.operations.length > 0 && <ul className="mt-3 space-y-2 text-sm">
            {receipt.operations.map(operation => <li key={operation.id}>
              {operationLabels[operation.kind]} · {dateText(operation.occurredAt)}
            </li>)}
          </ul>}
        </ErpSection>}
        <ErpSheet open={Boolean(confirm)} onClose={() => setConfirm(undefined)} presentation="modal" pending={pending}
          title={confirm === 'cancel' ? 'لغو پروندهٔ مرجوعی' : 'درخواست بررسی حسابداری'}
          footer={<>
            <ErpButton label="بازگشت" variant="ghost" disabled={pending} onClick={() => setConfirm(undefined)} />
            <ErpButton label={confirm === 'cancel' ? 'تأیید لغو' : 'ارسال درخواست'}
              tone={confirm === 'cancel' ? 'danger' : 'primary'} disabled={pending} onClick={() => void submit()} />
          </>}>
          <p>{confirm === 'cancel'
            ? 'با لغو پرونده، مقدار سالم از موجودی قابل استفاده خارج می‌شود. رسید و سابقهٔ مراجعه باقی می‌مانند.'
            : 'حسابداری باید تخصیص و رزرو مرتبط را بررسی کند تا پرونده به لجستیک برگردد.'}</p>
        </ErpSheet>
      </div>}
  </LogisticsPage>;
}
