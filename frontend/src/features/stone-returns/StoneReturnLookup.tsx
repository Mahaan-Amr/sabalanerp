'use client';

import { useEffect, useState } from 'react';
import { ErpField, ErpInlineState, ErpSearchableSelect } from '@/components/erp';
import { userFacingError } from '@/features/dispatch/userFacingError';
import type { StoneReturnOption } from './stoneReturnApi';

export function StoneReturnLookup<T extends StoneReturnOption>({ label, placeholder, fetchOptions, selected, onChange, enabled = true, disabled, required, excludedIds }: {
  label: string; placeholder: string; fetchOptions: (query: string) => Promise<T[]>;
  selected: T | null; onChange: (option: T | null) => void;
  enabled?: boolean; disabled: boolean; required?: boolean; excludedIds?: string[];
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void fetchOptions(query.trim()).then(rows => {
        if (current) setOptions(rows);
      }).catch(error => {
        if (current) {
          setOptions([]);
          setError(userFacingError(error, 'جست‌وجو ناموفق بود.'));
        }
      }).finally(() => {
        if (current) setLoading(false);
      });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [fetchOptions, query, enabled, retry]);

  const visible = excludedIds ? options.filter(option => !excludedIds.includes(option.id)) : options;
  const choices = selected && !visible.some(option => option.id === selected.id) ? [selected, ...visible] : visible;
  return <div>
    <ErpField label={label} required={required}>
      <ErpSearchableSelect value={selected?.id ?? ''} loading={loading && enabled}
        disabled={disabled || !enabled} required={required} onSearchChange={setQuery}
        onChange={event => onChange(choices.find(option => option.id === event.target.value) ?? null)}>
        <option value="">{placeholder}</option>
        {choices.map(option => <option key={option.id} value={option.id}>{[option.label, option.description].filter(Boolean).join(' · ')}</option>)}
      </ErpSearchableSelect>
    </ErpField>
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRetry(value => value + 1) }} />}
  </div>;
}
