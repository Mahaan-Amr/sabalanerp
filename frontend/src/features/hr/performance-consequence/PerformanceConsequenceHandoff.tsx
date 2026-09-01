"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErpButton, ErpCard, ErpCheckbox, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpPage, ErpSelect, ErpTextarea } from '@/components/erp';
import { personnelPerformanceAPI } from '@/lib/api';
import { apiError, dateFa } from '@/features/hr/hrUi';

const consequenceLabels: Record<string, string> = {
  COMPENSATION_REVIEW: 'بازبینی جبران خدمت', DISCRETIONARY_BONUS_REVIEW: 'بازبینی پاداش اختیاری',
  PROMOTION_REVIEW: 'بررسی ارتقا', PERFORMANCE_IMPROVEMENT_REVIEW: 'بررسی برنامه بهبود عملکرد', DEMOTION_REVIEW: 'بررسی تنزل',
};

export default function PerformanceConsequenceHandoff() {
  const router = useRouter();
  const params = useSearchParams();
  const personnelId = String(params.get('personnelId') || '');
  const relationshipId = String(params.get('relationshipId') || '');
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [consequenceType, setConsequenceType] = useState('COMPENSATION_REVIEW');
  const [policyCycleKey, setPolicyCycleKey] = useState('');
  const [reasonCategory, setReasonCategory] = useState('PERFORMANCE_REVIEW');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  useEffect(() => {
    if (!personnelId || !relationshipId) { setError('پرونده پرسنل یا رابطه استخدامی مشخص نیست.'); setLoading(false); return; }
    personnelPerformanceAPI.eligibleConsequenceResults(personnelId, consequenceType)
      .then((response) => setResults(response.data.results || []))
      .catch((cause) => setError(apiError(cause)))
      .finally(() => setLoading(false));
  }, [personnelId, relationshipId, consequenceType]);
  const evidenceReferences = useMemo(() => evidence.split(/[،,\n]/).map((item) => item.trim()).filter(Boolean), [evidence]);
  const submit = async () => {
    try {
      setPending(true); setError('');
      await personnelPerformanceAPI.createConsequenceHandoff({ personnelId, employmentRelationshipId: relationshipId, consequenceType, policyCycleKey, resultIds: selected, reasonCategory, reason, independentEvidenceReferences: evidenceReferences });
      router.push('/dashboard/hr/personnel/performance/insights');
    } catch (cause) { setError(apiError(cause)); }
    finally { setPending(false); }
  };
  if (loading) return <ErpLoading />;
  return <ErpPage eyebrow="منابع انسانی · عملکرد محرمانه" title="ارجاع پیامد عملکرد" description="این ارجاع فقط یک بازبینی مستقل می‌سازد و هیچ تغییر خودکار حقوقی، استخدامی یا انضباطی انجام نمی‌دهد." backHref="/dashboard/hr/personnel">
    {error && <ErpInlineState kind="error" title={error} />}
    {!results.length ? <ErpEmptyState title="نتیجه مصوبی برای ارجاع وجود ندارد" /> : <div className="space-y-4">
      <ErpCard className="space-y-3 p-4"><h2 className="font-bold">نتیجه‌های مبنا</h2>{results.map((result) => {
        return <ErpCheckbox key={result.id} label={`${result.labelFa} · پایان بازه ${dateFa(result.measurementTo)}`} checked={selected.includes(result.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, result.id] : current.filter((id) => id !== result.id))} />;
      })}</ErpCard>
      <ErpCard className="grid gap-3 p-4 md:grid-cols-2">
        <ErpField label="نوع بازبینی" required><ErpSelect value={consequenceType} onChange={(event) => setConsequenceType(event.target.value)}>{Object.entries(consequenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect></ErpField>
        <ErpField label="چرخه سیاستی" required hint="برای نمونه: نیمه نخست ۱۴۰۵"><ErpInput value={policyCycleKey} onChange={(event) => setPolicyCycleKey(event.target.value)} /></ErpField>
        <ErpField label="دسته دلیل" required><ErpSelect value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)}><option value="PERFORMANCE_REVIEW">بازبینی عملکرد</option><option value="SUSTAINED_CONTRIBUTION">مشارکت پایدار</option><option value="ADVERSE_REVIEW">بازبینی اقدام نامساعد</option></ErpSelect></ErpField>
        <ErpField label="ارجاع شاهد مستقل" required hint="شماره یا مرجع شاهدها را با ویرگول جدا کنید."><ErpInput value={evidence} onChange={(event) => setEvidence(event.target.value)} /></ErpField>
        <div className="md:col-span-2"><ErpField label="دلیل انسانی" required><ErpTextarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></ErpField></div>
      </ErpCard>
      <ErpButton label="ارسال برای بازبینی مستقل" onClick={submit} disabled={pending || !selected.length || !policyCycleKey.trim() || reason.trim().length < 20 || !evidenceReferences.length} />
    </div>}
  </ErpPage>;
}
