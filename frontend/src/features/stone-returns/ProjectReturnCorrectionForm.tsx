'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ErpButton, ErpInlineState, ErpSection } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { ProjectReturnMeasurement, ProjectReturnWidth } from './ProjectReturnMeasurement';
import { damagedProjectReturnAreaLabel, healthyProjectReturnAreaLabel } from './projectReturnAreaFacts';
import { emptyProjectReturnQuantity, resolveProjectReturnQuantity, resolveProjectReturnWidth, type ProjectReturnLinearCalculation } from './projectReturnQuantity';
import { projectReturnReceiptApi, type ProjectReturnReceipt } from './projectReturnReceiptApi';
import { StoneReturnLookup } from './StoneReturnLookup';
import type { StoneReturnOption } from './stoneReturnApi';

function quantityDraft(direct: string, linear?: ProjectReturnLinearCalculation | null) {
  const initial = { ...emptyProjectReturnQuantity(), direct };
  return linear ? { ...initial, mode: 'linear' as const, linear } : initial;
}

export function ProjectReturnCorrectionForm({ receipt, onSubmitted }: {
  receipt: ProjectReturnReceipt;
  onSubmitted: () => void;
}) {
  const item = receipt.version.items[0];
  const [projects, setProjects] = useState<StoneReturnOption[]>(() =>
    receipt.version.projects.map(project => ({ id: project.projectId, label: project.projectName })));
  const [healthy, setHealthy] = useState(() => quantityDraft(item.healthyQuantity, item.healthyCalculation));
  const [damaged, setDamaged] = useState(() => quantityDraft(item.damagedQuantity, item.damagedCalculation));
  const [manualWidth, setManualWidth] = useState('');
  const widthMeters = item.effectiveWidthMeters ?? resolveProjectReturnWidth(manualWidth);
  const [pending, setPending] = useState(false);
  const [validate, setValidate] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const listProjects = useCallback(async (query: string) => {
    const options = await projectReturnReceiptApi.projects(receipt.customerId);
    return options.filter(option => !query || `${option.label} ${option.description ?? ''}`.includes(query));
  }, [receipt.customerId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError('');
    setValidate(true);
    if (!projects.length) return setError('حداقل یک پروژهٔ این مشتری را انتخاب کنید.');
    const accepted = resolveProjectReturnQuantity(healthy, item.unit);
    const rejected = resolveProjectReturnQuantity(damaged, item.unit);
    if (!accepted || !rejected || [accepted.value, rejected.value].every(value => /^0(?:\.0+)?$/.test(value))) {
      return setError('مقدار سالم یا آسیب‌دیده را وارد کنید.');
    }
    if (manualWidth.trim() && !widthMeters) return setError('عرض واقعی سنگ باید بزرگ‌تر از صفر باشد.');
    busy.current = true;
    setPending(true);
    try {
      await projectReturnReceiptApi.submitCorrection(receipt.id, {
        expectedVersionId: receipt.version.id, projectIds: projects.map(project => project.id),
        items: [{
          productId: item.productId, unit: item.unit,
          ...(widthMeters && { effectiveWidthMeters: widthMeters }),
          ...(item.partnerContractId && { partnerContractId: item.partnerContractId }),
          ...(accepted.calculation ? { healthyCalculation: accepted.calculation } : { healthyQuantity: accepted.value }),
          ...(rejected.calculation ? { damagedCalculation: rejected.calculation } : { damagedQuantity: rejected.value }),
        }],
      });
      onSubmitted();
    } catch (failure) {
      setError(userFacingError(failure, 'ارسال نسخهٔ اصلاحی ناموفق بود.'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <ErpSection title="اصلاح مقدار" description={item.productName}>
    <form className="space-y-4" onSubmit={submit} noValidate>
      <StoneReturnLookup label="افزودن پروژه" placeholder="انتخاب پروژهٔ مشتری" selected={null}
        fetchOptions={listProjects} excludedIds={projects.map(project => project.id)} disabled={pending}
        onChange={project => { if (project) setProjects(previous => [...previous, project]); }} />
      {!!projects.length && <ul className="space-y-2">
        {projects.map(project => <li className="flex flex-wrap items-center justify-between gap-2" key={project.id}>
          <span>{project.label}</span>
          <ErpButton type="button" label={`حذف پروژهٔ ${project.label}`} variant="ghost" tone="neutral" disabled={pending}
            onClick={() => setProjects(previous => previous.filter(option => option.id !== project.id))} />
        </li>)}
      </ul>}
      {item.unit === 'meter' && <ProjectReturnWidth recorded={item.effectiveWidthMeters} manual={manualWidth}
        onChange={setManualWidth} validate={validate} />}
      <div className="grid gap-4 md:grid-cols-2">
        <ProjectReturnMeasurement label="مقدار سالم" productName={item.productName} unit={item.unit} draft={healthy}
          widthMeters={widthMeters} areaLabel={healthyProjectReturnAreaLabel}
          onChange={setHealthy} validate={validate} />
        <ProjectReturnMeasurement label="مقدار آسیب‌دیده" productName={item.productName} unit={item.unit} draft={damaged}
          widthMeters={widthMeters} areaLabel={damagedProjectReturnAreaLabel}
          onChange={setDamaged} validate={validate} />
      </div>
      {error && <ErpInlineState kind="error" title={error} />}
      <ErpButton type="submit" label={pending ? 'در حال ارسال…' : 'ارسال اصلاح به حسابداری'}
        tone="primary" variant="solid" disabled={pending} />
    </form>
  </ErpSection>;
}
