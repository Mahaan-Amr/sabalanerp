'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ErpButton, ErpField, ErpInlineState, ErpInput, ErpSearchableSelect, ErpSection, ErpSelect, ErpTextarea,
} from '@/components/erp';
import { LogisticsPage } from '@/features/logistics/LogisticsWorkspace';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { normalizeDigits } from '@/lib/numberFormat';
import { displayStoneReturnQuantity, stoneReturnApi, stoneReturnUnitLabels, type StoneReturnOption } from './stoneReturnApi';

const listHref = '/dashboard/logistics/returns';

function Lookup({ label, placeholder, fetchOptions, selected, onChange, enabled = true, disabled, required }: {
  label: string; placeholder: string; fetchOptions: (query: string) => Promise<StoneReturnOption[]>;
  selected: StoneReturnOption | null; onChange: (option: StoneReturnOption | null) => void;
  enabled?: boolean; disabled: boolean; required?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<StoneReturnOption[]>([]);
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

  const choices = selected && !options.some(option => option.id === selected.id) ? [selected, ...options] : options;
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

function normalizedQuantity(value: string) {
  return normalizeDigits(value).trim().replace(/,/g, '').replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function StoneReturnIntake() {
  const [customer, setCustomer] = useState<StoneReturnOption | null>(null);
  const [product, setProduct] = useState<StoneReturnOption | null>(null);
  const [guard, setGuard] = useState<StoneReturnOption | null>(null);
  const [unit, setUnit] = useState('');
  const [received, setReceived] = useState('');
  const [accepted, setAccepted] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const busy = useRef(false);
  const requestId = useRef('');
  const customerId = customer?.id ?? '';
  const lookupGuard = useCallback((query: string) => stoneReturnApi.guard(customerId, query), [customerId]);
  const editable = !pending && !uncertain;
  const receivedQuantity = normalizedQuantity(received);
  const acceptedQuantity = normalizedQuantity(accepted);
  const reasonRequired = !!receivedQuantity && !!acceptedQuantity && receivedQuantity !== acceptedQuantity;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || success) return;
    if (!customer || !product || !unit) {
      setError('مشتری، سنگ و واحد را انتخاب کنید.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const { data } = await stoneReturnApi.record({
        requestId: requestId.current, customerId: customer.id, productId: product.id, unit,
        receivedQuantity, acceptedQuantity, rejectionReason: reasonRequired ? reason : '',
        guardReturnMovementId: guard?.id ?? null,
      });
      const quantity = displayStoneReturnQuantity(data.acceptedQuantity, data.unit);
      setSuccess(data.inventoryIdentityId ? `رسید ثبت شد. ${quantity} به موجودی قابل فروش اضافه شد.` : 'رسید ثبت شد. تمام مقدار دریافتی رد شد.');
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (!status || status >= 500) setUncertain(true);
      setError(userFacingError(error, 'نتیجه ثبت مشخص نیست. برای پیگیری همین درخواست دوباره تلاش کنید.'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <LogisticsPage eyebrow="لجستیک" title="ثبت دریافت سنگ مرجوعی" backHref={listHref}>
    {success ? <ErpInlineState kind="success" title={success} action={{ label: 'مشاهده مرجوعی‌ها', href: listHref }} /> :
      <ErpSection>
        <form className="space-y-5" onSubmit={submit}>
          {error && <ErpInlineState kind="error" title={error} />}
          <div className="grid gap-4 md:grid-cols-2">
            <Lookup label="مشتری" placeholder="انتخاب مشتری" selected={customer} onChange={option => { setCustomer(option); setGuard(null); }}
              fetchOptions={stoneReturnApi.customers} required disabled={!editable} />
            <Lookup label="سنگ" placeholder="انتخاب سنگ" selected={product} onChange={setProduct}
              fetchOptions={stoneReturnApi.products} required disabled={!editable} />
            <Lookup key={customerId} label="شاهد ورود گارد" placeholder="بدون شاهد ورود" selected={guard} onChange={setGuard}
              fetchOptions={lookupGuard} enabled={!!customerId} disabled={!editable} />
            <ErpField label="واحد" required>
              <ErpSelect required value={unit} disabled={!editable} onChange={event => setUnit(event.target.value)}>
                <option value="">انتخاب واحد</option>
                {Object.entries(stoneReturnUnitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </ErpSelect>
            </ErpField>
            <ErpField label="مقدار دریافتی" required>
              <ErpInput required inputMode="decimal" maxLength={100} value={received} disabled={!editable} onChange={event => setReceived(event.target.value)} />
            </ErpField>
            <ErpField label="مقدار پذیرفته‌شده" required>
              <ErpInput required inputMode="decimal" maxLength={100} value={accepted} disabled={!editable} onChange={event => setAccepted(event.target.value)} />
            </ErpField>
          </div>
          {reasonRequired && <ErpField label="علت رد" required>
            <ErpTextarea required maxLength={2000} value={reason} disabled={!editable} onChange={event => setReason(event.target.value)} />
          </ErpField>}
          <ErpButton type="submit" tone="primary" variant="solid" disabled={pending}
            label={pending ? 'در حال ثبت…' : uncertain ? 'تلاش دوباره برای ثبت' : 'ثبت دریافت و پذیرش'} />
        </form>
      </ErpSection>}
  </LogisticsPage>;
}
