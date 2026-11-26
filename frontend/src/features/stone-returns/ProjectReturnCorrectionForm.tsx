'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ErpButton, ErpInlineState, ErpSection } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { ProjectReturnMeasurement, ProjectReturnWidth } from './ProjectReturnMeasurement';
import { damagedProjectReturnAreaLabel, healthyProjectReturnAreaLabel } from './projectReturnAreaFacts';
import { emptyProjectReturnQuantity, resolveProjectReturnQuantity, resolveProjectReturnWidth, type ProjectReturnLinearCalculation } from './projectReturnQuantity';
import { findProjectReturnProduct, projectReturnReceiptApi, type ProjectReturnReceipt } from './projectReturnReceiptApi';
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
  const [manualWidth, setManualWidth] = useState(item.effectiveWidthMeters ?? '');
  const [suggestedWidth, setSuggestedWidth] = useState<string | null>(null);
  const [loadingWidth, setLoadingWidth] = useState(item.unit === 'meter');
  const [widthError, setWidthError] = useState('');
  const widthMeters = suggestedWidth ?? resolveProjectReturnWidth(manualWidth);
  const [pending, setPending] = useState(false);
  const [validate, setValidate] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const listProjects = useCallback(async (query: string) => {
    const options = await projectReturnReceiptApi.projects(receipt.customerId);
    return options.filter(option => !query || `${option.label} ${option.description ?? ''}`.includes(query));
  }, [receipt.customerId]);

  useEffect(() => {
    if (item.unit !== 'meter' || !projects.length) {
      setLoadingWidth(false);
      setSuggestedWidth(null);
      return;
    }
    let current = true;
    setLoadingWidth(true);
    setWidthError('');
    setSuggestedWidth(null);
    void findProjectReturnProduct(receipt.customerId, projects.map(project => project.id), item).then(product => {
      if (current) setSuggestedWidth(product?.suggestedWidthMeters ?? null);
    }).catch(failure => {
      if (current) setWidthError(userFacingError(failure, 'دریافت اطلاعات عرض محصول ناموفق بود.'));
    }).finally(() => {
      if (current) setLoadingWidth(false);
    });
    return () => { current = false; };
  }, [item, projects, receipt.customerId]);

  function changeProjects(next: StoneReturnOption[]) {
    setManualWidth('');
    setProjects(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || loadingWidth || widthError) return;
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
        onChange={project => { if (project) changeProjects([...projects, project]); }} />
      {!!projects.length && <ul className="space-y-2">
        {projects.map(project => <li className="flex flex-wrap items-center justify-between gap-2" key={project.id}>
          <span>{project.label}</span>
          <ErpButton type="button" label={`حذف پروژهٔ ${project.label}`} variant="ghost" tone="neutral" disabled={pending}
            onClick={() => changeProjects(projects.filter(option => option.id !== project.id))} />
        </li>)}
      </ul>}
      {item.unit === 'meter' && !loadingWidth && <ProjectReturnWidth recorded={suggestedWidth} manual={manualWidth}
        onChange={setManualWidth} validate={validate} />}
      <div className="grid gap-4 md:grid-cols-2">
        <ProjectReturnMeasurement label="مقدار سالم" productName={item.productName} unit={item.unit} draft={healthy}
          widthMeters={widthMeters} areaLabel={healthyProjectReturnAreaLabel}
          onChange={setHealthy} validate={validate} />
        <ProjectReturnMeasurement label="مقدار آسیب‌دیده" productName={item.productName} unit={item.unit} draft={damaged}
          widthMeters={widthMeters} areaLabel={damagedProjectReturnAreaLabel}
          onChange={setDamaged} validate={validate} />
      </div>
      {(widthError || error) && <ErpInlineState kind="error" title={widthError || error} />}
      <ErpButton type="submit" label={pending ? 'در حال ارسال…' : 'ارسال اصلاح به حسابداری'}
        tone="primary" variant="solid" disabled={pending || loadingWidth || !!widthError} />
    </form>
  </ErpSection>;
}
