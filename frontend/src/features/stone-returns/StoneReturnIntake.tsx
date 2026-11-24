'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ErpButton, ErpField, ErpInlineState, ErpInput, ErpSearchableSelect, ErpSection, ErpSelect, ErpSkeleton, ErpTextarea,
} from '@/components/erp';
import { useAuth } from '@/contexts/AuthContext';
import { LogisticsPage } from '@/features/logistics/LogisticsWorkspace';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { normalizeStoneReturnQuantity, stoneReturnQuantityAtoms } from './stoneReturnQuantityInput';
import { createStoneReturnIntakeClient } from './stoneReturnIntakeRecovery';
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

export function StoneReturnIntake() {
  const { user, loading } = useAuth();
  if (loading || !user) return <ErpSkeleton />;
  return <ActorStoneReturnIntake key={user.id} actorId={user.id} />;
}

function ActorStoneReturnIntake({ actorId }: { actorId: string }) {
  const [customer, setCustomer] = useState<StoneReturnOption | null>(null);
  const [product, setProduct] = useState<StoneReturnOption | null>(null);
  const [guard, setGuard] = useState<StoneReturnOption | null>(null);
  const [unit, setUnit] = useState('');
  const [received, setReceived] = useState('');
  const [accepted, setAccepted] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [recovery, setRecovery] = useState<'loading' | 'ready' | 'pending' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const busy = useRef(false);
  const client = useCallback(() => createStoneReturnIntakeClient(actorId, window.sessionStorage, stoneReturnApi.record), [actorId]);
  const checkRecovery = useCallback(() => {
    try { setRecovery(client().hasPending() ? 'pending' : 'ready'); }
    catch { setRecovery('unavailable'); }
  }, [client]);
  useEffect(checkRecovery, [checkRecovery]);
  const customerId = customer?.id ?? '';
  const lookupGuard = useCallback((query: string) => stoneReturnApi.guard(customerId, query), [customerId]);
  const editable = !pending && recovery === 'ready';
  const receivedQuantity = normalizeStoneReturnQuantity(received, true);
  const acceptedQuantity = normalizeStoneReturnQuantity(accepted, true);
  const receivedAtoms = stoneReturnQuantityAtoms(receivedQuantity, unit);
  const acceptedAtoms = stoneReturnQuantityAtoms(acceptedQuantity, unit);
  const receivedError = !receivedAtoms
    ? (unit === 'count' ? 'مقدار دریافتی باید عدد صحیح مثبت باشد.' : 'مقدار دریافتی معتبر و بزرگ‌تر از صفر وارد کنید.') : undefined;
  const acceptedError = acceptedAtoms === null
    ? (unit === 'count' ? 'مقدار پذیرفته‌شده باید عدد صحیح باشد.' : 'مقدار پذیرفته‌شده معتبر وارد کنید.')
    : receivedAtoms !== null && acceptedAtoms > receivedAtoms
      ? 'مقدار پذیرفته‌شده نمی‌تواند از مقدار دریافتی بیشتر باشد.' : undefined;
  const reasonRequired = receivedAtoms !== null && acceptedAtoms !== null && receivedAtoms > acceptedAtoms;
  const reasonError = reasonRequired && !reason.trim() ? 'علت رد را وارد کنید.' : undefined;

  async function send() {
    if (busy.current || success) return;
    const resume = recovery === 'pending';
    if (!resume) {
      if (!editable) return;
      setAttempted(true);
      if (!customer || !product || !unit) {
        setError('مشتری، سنگ و واحد را انتخاب کنید.');
        return;
      }
      if (receivedError || acceptedError || reasonError) return;
    }
    setError('');
    busy.current = true;
    setPending(true);
    try {
      const { data } = resume ? await client().resume() : await client().submit({
        customerId: customer!.id, productId: product!.id, unit,
        receivedQuantity, acceptedQuantity, rejectionReason: reasonRequired ? reason : '',
        guardReturnMovementId: guard?.id ?? null,
      });
      const quantity = displayStoneReturnQuantity(data.acceptedQuantity, data.unit);
      setSuccess(data.inventoryIdentityId ? `رسید ثبت شد. ${quantity} به موجودی قابل فروش اضافه شد.` : 'رسید ثبت شد. تمام مقدار دریافتی رد شد.');
    } catch (error) {
      checkRecovery();
      setError(userFacingError(error, 'ثبت دریافت کامل نشد. دسترسی به حافظه مرورگر و اتصال را بررسی کنید.'));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <LogisticsPage eyebrow="لجستیک" title="ثبت دریافت سنگ مرجوعی" backHref={listHref}>
    {success ? <ErpInlineState kind="success" title={success} action={{ label: 'مشاهده مرجوعی‌ها', href: listHref }} /> :
      recovery === 'loading' ? <ErpSkeleton /> :
      recovery === 'unavailable' ? <ErpInlineState kind="error" title="برای پیگیری رسید، دسترسی به حافظه این زبانه لازم است."
        action={{ label: 'تلاش دوباره', onClick: checkRecovery }} /> :
      recovery === 'pending' ? <ErpSection>
        {error && <ErpInlineState kind="error" title={error} />}
        <ErpInlineState kind="stale" title="نتیجه ثبت دریافت هنوز مشخص نیست." />
        <ErpButton label={pending ? 'در حال پیگیری…' : 'پیگیری همان دریافت'} disabled={pending} onClick={() => void send()} />
      </ErpSection> :
      <ErpSection>
        <form className="space-y-5" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(); }} noValidate>
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
            <ErpField label="مقدار دریافتی" required error={attempted ? receivedError : undefined}>
              <ErpInput required inputMode="decimal" maxLength={100} value={received} disabled={!editable} onChange={event => setReceived(event.target.value)} />
            </ErpField>
            <ErpField label="مقدار پذیرفته‌شده" required error={attempted ? acceptedError : undefined}>
              <ErpInput required inputMode="decimal" maxLength={100} value={accepted} disabled={!editable} onChange={event => setAccepted(event.target.value)} />
            </ErpField>
          </div>
          {reasonRequired && <ErpField label="علت رد" required error={attempted ? reasonError : undefined}>
            <ErpTextarea required maxLength={2000} value={reason} disabled={!editable} onChange={event => setReason(event.target.value)} />
          </ErpField>}
          <ErpButton type="submit" tone="primary" variant="solid" disabled={pending}
            label={pending ? 'در حال ثبت…' : 'ثبت دریافت و پذیرش'} />
        </form>
      </ErpSection>}
  </LogisticsPage>;
}
