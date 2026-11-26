'use client';

import { useId } from 'react';
import { ErpField, ErpFieldView, ErpInput, ErpSegmentedControl } from '@/components/erp';
import { displayStoneReturnQuantity, stoneReturnUnitLabels } from './stoneReturnApi';
import {
  resolveProjectReturnArea, resolveProjectReturnQuantity, resolveProjectReturnWidth, type ProjectReturnLinearCalculation, type ProjectReturnQuantityDraft,
} from './projectReturnQuantity';

export const projectReturnLinearFields = [
  { key: 'khatRas', label: 'خط راس', inputMode: 'decimal' },
  { key: 'pieceCount', label: 'تعداد', inputMode: 'numeric' },
  { key: 'plus', label: 'اضافه', inputMode: 'decimal' },
  { key: 'minus', label: 'کسر', inputMode: 'decimal' },
] as const;

export function ProjectReturnWidth({ recorded, manual, onChange, validate }: {
  recorded?: string | null;
  manual: string;
  onChange: (width: string) => void;
  validate: boolean;
}) {
  return <div className="max-w-xs">
    {recorded
      ? <ErpFieldView label="عرض سنگ" value={displayStoneReturnQuantity(recorded, 'متر')} />
      : <ErpField label="عرض واقعی سنگ (متر)"
          error={validate && manual.trim() && !resolveProjectReturnWidth(manual) ? 'عرض بزرگ‌تر از صفر وارد کنید.' : undefined}>
        <ErpInput inputMode="decimal" maxLength={100} value={manual} onChange={event => onChange(event.target.value)} />
      </ErpField>}
  </div>;
}

export function ProjectReturnMeasurement({ label, productName, unit, draft, widthMeters, areaLabel, onChange, validate }: {
  label: string;
  productName: string;
  unit: string;
  draft: ProjectReturnQuantityDraft;
  widthMeters: string | null;
  areaLabel: string;
  onChange: (draft: ProjectReturnQuantityDraft) => void;
  validate: boolean;
}) {
  const errorId = useId();
  const resolved = resolveProjectReturnQuantity(draft, unit);
  const area = resolved ? resolveProjectReturnArea(resolved.value, unit, widthMeters) : null;
  const invalid = validate && !resolved;
  const changeLinear = (key: keyof ProjectReturnLinearCalculation, value: string) =>
    onChange({ ...draft, linear: { ...draft.linear, [key]: value } });

  return <div role="group" aria-label={`${label} ${productName}`} aria-describedby={invalid && draft.mode === 'linear' ? errorId : undefined} className="min-w-0 space-y-2">
    {unit === 'meter' && <>
      <p className="text-sm font-semibold">{label} ({stoneReturnUnitLabels[unit]})</p>
      <ErpSegmentedControl<ProjectReturnQuantityDraft['mode']> value={draft.mode} onChange={mode => onChange({ ...draft, mode })} options={[
        { value: 'direct', label: 'مقدار مستقیم' },
        { value: 'linear', label: 'خط راس' },
      ]} />
    </>}
    {draft.mode === 'linear' ? <>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        {projectReturnLinearFields.map(({ key, label: inputLabel, inputMode }) => <ErpField key={key} label={inputLabel}>
          <ErpInput inputMode={inputMode} maxLength={100} value={draft.linear[key]} onChange={event => changeLinear(key, event.target.value)} />
        </ErpField>)}
      </div>
      {invalid
        ? <p id={errorId} className="text-sm sds-text-danger">خط راس، تعداد، اضافه و کسر را بررسی کنید.</p>
        : resolved && <p className="text-sm sds-text-secondary">
          مقدار محاسبه‌شده {displayStoneReturnQuantity(resolved.value, unit)}
        </p>}
    </> : <ErpField label={`${label} (${stoneReturnUnitLabels[unit]})`}
      error={invalid ? unit === 'count' ? 'مقدار را به عدد صحیح وارد کنید.' : 'مقدار را بررسی کنید.' : undefined}>
      <ErpInput inputMode={unit === 'count' ? 'numeric' : 'decimal'} maxLength={100} value={draft.direct} placeholder="۰"
        onChange={event => onChange({ ...draft, direct: event.target.value })} />
    </ErpField>}
    {(unit === 'meter' || unit === 'squareMeter') && <ErpFieldView label={areaLabel}
      value={area === null ? '—' : displayStoneReturnQuantity(area, 'squareMeter')} />}
  </div>;
}
