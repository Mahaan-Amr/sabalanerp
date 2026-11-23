'use client';

import { useEffect, useState } from 'react';
import { ErpField, ErpInlineState, ErpSearchableSelect } from '@/components/erp';
import { crmAPI, type CrmCustomerOption } from '@/lib/api';
import { crmPersonName } from '@/lib/crmPipeline';

type SearchResult = { query: string; rows: CrmCustomerOption[]; failed?: boolean };

export function CrmCustomerPicker({ value, onChange, label = 'مخاطب CRM' }: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<SearchResult>();
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<{ id: string; row?: CrmCustomerOption }>();
  const query = search.trim();

  useEffect(() => {

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await crmAPI.getCustomerOptions({ search: query || undefined }, controller.signal);
        if (controller.signal.aborted) return;
        setResult({ query, rows: data.data ?? [], failed: !data.success });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ query, rows: [], failed: true });
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 401 || status === 403) setSelection(previous => previous && { id: previous.id });
      }
    }, query ? 200 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, retry]);

  const latest = result?.query === query ? result : undefined;
  const matches = latest?.rows ?? [];
  const selectedMatch = matches.find(customer => customer.id === value);
  const selected = selection?.id === value ? selection : undefined;

  useEffect(() => {
    if (!value) return;
    if (selectedMatch && selectedMatch !== selected?.row) {
      setSelection({ id: value, row: selectedMatch });
      return;
    }
    if (selected) return;

    const controller = new AbortController();
    crmAPI.getCustomerOptions({ id: value }, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setSelection({ id: value, row: data.data?.find(row => row.id === value) });
    }).catch(() => {
      if (!controller.signal.aborted) setSelection({ id: value });
    });
    return () => controller.abort();
  }, [value, selected, selectedMatch]);

  const restoreOption = Boolean(value && !selectedMatch);
  return (
    <div className="min-w-0 space-y-2">
      <ErpField label={label} required>
        <ErpSearchableSelect aria-label={label} value={value} required onSearchChange={setSearch}
          filterLocally={false} loading={!latest}
          onChange={event => {
            const id = event.target.value;
            const row = matches.find(customer => customer.id === id);
            if (row) setSelection({ id, row });
            if (!id) setSelection(undefined);
            onChange(id);
          }}>
          <option value="">انتخاب مخاطب</option>
          {restoreOption && <option value={value} disabled>{selected?.row ? crmPersonName(selected.row) : 'مخاطب انتخاب‌شده'}</option>}
          {matches.map(customer => <option key={customer.id} value={customer.id}>
            {crmPersonName(customer)}{customer.phone ? ' · ' + customer.phone : ''}
          </option>)}
        </ErpSearchableSelect>
      </ErpField>
      {selection?.id === value && !selection.row && !selectedMatch &&
        <ErpInlineState kind="stale" title="مخاطب انتخاب‌شده در دسترس نیست." />}
      {latest?.failed && <ErpInlineState kind="error" title="جست‌وجوی مخاطب انجام نشد." action={{
        label: 'تلاش دوباره',
        onClick: () => { setResult(undefined); setRetry(previous => previous + 1); },
      }} />}
    </div>
  );
}
