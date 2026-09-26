'use client';

import { useMemo, useState } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpField, ErpInlineState,
  ErpInput, ErpRialInput, ErpSection, ErpSelect, ErpSheet } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa, money } from './accountingUi';
import { hashAccountingPeriodEvidence } from './accountingPeriodEvidence';

type AssetComponent = { componentIdentity: string; titlePersian: string; bookCostRials: string;
  taxCostRials: string; residualValueRials: string; usefulLifeMonths: string };
type PolicyForm = { classCode: string; titlePersian: string; effectiveFrom: string; effectiveTo: string;
  capitalizationThresholdRials: string; bookMethod: string; taxMethod: string;
  usefulLifeMonths: string; residualValueBasisPoints: string; decliningRateBasisPoints: string;
  assetAccountId: string; cipAccountId: string; depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string; impairmentExpenseAccountId: string;
  impairmentAllowanceAccountId: string; disposalGainAccountId: string; disposalLossAccountId: string;
  changeReason: string };

const blankPolicy: PolicyForm = {
  classCode: '', titlePersian: '', effectiveFrom: '', effectiveTo: '', capitalizationThresholdRials: '',
  bookMethod: 'STRAIGHT_LINE', taxMethod: 'STRAIGHT_LINE', usefulLifeMonths: '60',
  residualValueBasisPoints: '0', decliningRateBasisPoints: '', assetAccountId: '', cipAccountId: '',
  depreciationExpenseAccountId: '', accumulatedDepreciationAccountId: '', impairmentExpenseAccountId: '',
  impairmentAllowanceAccountId: '', disposalGainAccountId: '', disposalLossAccountId: '', changeReason: '',
};
const blankComponent = (): AssetComponent => ({ componentIdentity: crypto.randomUUID(), titlePersian: '',
  bookCostRials: '', taxCostRials: '', residualValueRials: '0', usefulLifeMonths: '' });
const isoDate = (value: string) => `${value}T12:00:00.000Z`;
const methodFa: Record<string, string> = { STRAIGHT_LINE: 'خط مستقیم', DECLINING_BALANCE: 'نزولی',
  UNITS_OF_PRODUCTION: 'بر مبنای میزان تولید' };
const statusFa: Record<string, string> = { ACTIVE: 'آماده بهره‌برداری', UNDER_CONSTRUCTION: 'در جریان تکمیل',
  DISPOSED: 'خارج‌شده از دفاتر', LOST: 'مفقود' };

export function AccountingFixedAssetsPanel({ book, years, policies, assets, accessProfile, onRefresh }: {
  book: any; years: any[]; policies: any[]; assets: any[];
  accessProfile: string; onRefresh: () => Promise<void>;
}) {
  const canWrite = accessProfile === 'ACCOUNTANT' || accessProfile === 'ACCOUNTING_MANAGER';
  const canManage = accessProfile === 'ACCOUNTING_MANAGER';
  const [sheet, setSheet] = useState<'policy' | 'asset' | 'cost' | 'ready' | 'depreciation' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicyForm>(blankPolicy);
  const [asset, setAsset] = useState({ registerNumber: '', classPolicyId: '', titlePersian: '',
    acquisitionAt: '', bookCostRials: '', taxCostRials: '', serialNumber: '', location: '' });
  const [components, setComponents] = useState<AssetComponent[]>(() => [blankComponent()]);
  const [targetId, setTargetId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [readyAt, setReadyAt] = useState('');
  const [archiveId, setArchiveId] = useState('');
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const [proofs, setProofs] = useState<any[]>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [periodUnits, setPeriodUnits] = useState('');
  const [totalExpectedUnits, setTotalExpectedUnits] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [costCreditAccountId, setCostCreditAccountId] = useState('');
  const [costDate, setCostDate] = useState('');
  const accounts = (book.accounts || []).filter((row: any) => row.level === 'MOIN');
  const periods = years.flatMap((year: any) => (year.periods || []).filter((period: any) => period.status === 'OPEN')
    .map((period: any) => ({ ...period, fiscalYearId: year.id, yearTitle: year.titlePersian })));
  const target = assets.find((row: any) => row.id === targetId);
  const targetPolicy = policies.find((row: any) => row.id === target?.classPolicyId);
  const proofType = sheet === 'cost' ? 'ASSET_COST' : 'ASSET_READY_FOR_USE';
  const validProofs = proofs.filter((row: any) => row.sourceEntityId === targetId
    && row.evidenceType === proofType && row.malwareScanStatus === 'CLEAN');
  const targetArchive = validProofs.find((row: any) => row.id === archiveId);
  const selectedPolicy = policies.find((row: any) => row.id === asset.classPolicyId);
  const componentTotalValid = useMemo(() => {
    try { return components.length > 0 && components.every(row => row.titlePersian.trim() && row.bookCostRials && row.taxCostRials
      && row.residualValueRials)
      && components.reduce((total, row) => total + BigInt(row.bookCostRials), BigInt(0)) === BigInt(asset.bookCostRials || '-1')
      && components.reduce((total, row) => total + BigInt(row.taxCostRials), BigInt(0)) === BigInt(asset.taxCostRials || '-1');
    } catch { return false; }
  }, [asset.bookCostRials, asset.taxCostRials, components]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await action() as { data?: { data?: { kind?: string; reasonPersian?: string } } };
      if (result?.data?.data?.kind === 'EXCEPTION') throw new Error(result.data.data.reasonPersian || 'مدرک وارد صف استثنا شد.');
      await onRefresh(); setSheet(null); setNotice(success);
    }
    catch (failure) { setError(failure instanceof Error && /[\u0600-\u06ff]/.test(failure.message)
      ? failure.message : accountingFailureMessage(failure, 'عملیات دارایی ثبت نشد؛ اطلاعات و مدارک را بررسی کنید.')); }
    finally { setSaving(false); }
  };
  const chooseTarget = (kind: 'cost' | 'ready' | 'depreciation', id: string) => {
    setTargetId(id); setPeriodId(''); setReadyAt(''); setArchiveId('');
    setReadyFile(null);
    setCostAmount(''); setCostCreditAccountId(''); setCostDate('');
    setPeriodUnits(''); setTotalExpectedUnits(''); setError(null); setProofs([]); setSheet(kind);
    if (kind === 'depreciation') return;
    setProofsLoading(true);
    void accountingAPI.getAssetEvidence(id, book.id).then((response) => setProofs(response.data.data || []))
      .catch((failure) => setError(accountingFailureMessage(failure, 'خواندن مدارک این دارایی انجام نشد.')))
      .finally(() => setProofsLoading(false));
  };
  const accountSelect = (key: keyof PolicyForm, label: string) => <ErpField key={key} label={label} required>
    <ErpSelect value={policy[key]} onChange={event => setPolicy(current => ({ ...current, [key]: event.target.value }))}>
      <option value="">انتخاب حساب معین</option>
      {accounts.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}
    </ErpSelect>
  </ErpField>;
  const selectedPeriod = periods.find((row: any) => row.id === periodId);
  const needsUnits = targetPolicy && (targetPolicy.bookMethod === 'UNITS_OF_PRODUCTION' || targetPolicy.taxMethod === 'UNITS_OF_PRODUCTION');
  const uploadProof = async () => {
    if (!target || !readyFile || (sheet !== 'cost' && sheet !== 'ready')) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await accountingAPI.uploadAssetEvidence(target.id, book.id, sheet === 'cost' ? 'COST' : 'READY', readyFile);
      const row = response.data.data;
      setProofs(current => [row, ...current]); setArchiveId(row.id); setReadyFile(null);
      setNotice('مدرک دارایی ثبت شد؛ اطلاعات عملیات را تکمیل کنید.');
    } catch (failure) { setError(accountingFailureMessage(failure, 'ثبت مدرک دارایی انجام نشد.')); }
    finally { setSaving(false); }
  };
  const proofUpload = <div className="mb-3 flex flex-wrap items-end gap-3">
    <ErpField label="بارگذاری مدرک دارایی"><ErpInput key={archiveId || 'new'} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
      onChange={event => setReadyFile(event.target.files?.[0] || null)} /></ErpField>
    <ErpButton label="ثبت مدرک" variant="outline" disabled={saving || !target || !readyFile} onClick={() => void uploadProof()} />
  </div>;

  return <ErpSection title="دارایی‌های ثابت">
    {notice && <ErpInlineState kind="success" title={notice} />}
    {error && !sheet && <ErpInlineState kind="error" title={error} />}
    <div className="mb-3 flex flex-wrap gap-2">
      {canManage && <ErpButton label="تعریف سیاست طبقه" variant="outline" onClick={() => { setPolicy(blankPolicy); setError(null); setSheet('policy'); }} />}
      {canWrite && <ErpButton label="ثبت دارایی" onClick={() => { setError(null); setSheet('asset'); }} />}
    </div>
    {!assets.length ? <ErpEmptyState title="دارایی ثابتی ثبت نشده است." /> : <div className="space-y-2">{assets.map((row: any) =>
      <ErpCard key={row.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div>
          <strong className="sds-text-primary">{row.registerNumber} · {row.titlePersian}</strong>
          <p className="sds-text-secondary mt-1 text-sm">{row.location || 'محل ثبت نشده'} · {row.components?.length?.toLocaleString('fa-IR') || '۰'} جزء</p>
        </div><ErpBadge tone={row.status === 'ACTIVE' ? 'success' : 'warning'}>{statusFa[row.status] || 'نیازمند بررسی'}</ErpBadge></div>
        <div className="sds-text-secondary mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>بهای دفتری: {money(row.bookCostRials, 'IRR')}</span><span>مبنای مالیاتی: {money(row.taxCostRials, 'IRR')}</span>
          <span>آماده‌به‌کار: {dateFa(row.readyForUseAt)}</span>
        </div>
        {canWrite && <div className="mt-3 flex flex-wrap gap-2">
          {row.status === 'UNDER_CONSTRUCTION' && <ErpButton label="ثبت بهای دارایی" variant="outline" onClick={() => chooseTarget('cost', row.id)} />}
          {row.status === 'UNDER_CONSTRUCTION' && <ErpButton label="ثبت آماده‌به‌کار" variant="outline" onClick={() => chooseTarget('ready', row.id)} />}
          {row.status === 'ACTIVE' && <ErpButton label="ثبت استهلاک دوره" variant="outline" onClick={() => chooseTarget('depreciation', row.id)} />}
        </div>}
      </ErpCard>)}</div>}

    <ErpSheet open={sheet === 'policy'} onClose={() => !saving && setSheet(null)} title="سیاست طبقه دارایی" presentation="modal" pending={saving}
      footer={<ErpButton label="ثبت سیاست" disabled={saving || !policy.classCode || !policy.titlePersian || !policy.effectiveFrom
        || !policy.capitalizationThresholdRials || !policy.usefulLifeMonths || !policy.changeReason.trim()
        || !['assetAccountId', 'cipAccountId', 'depreciationExpenseAccountId', 'accumulatedDepreciationAccountId',
          'impairmentExpenseAccountId', 'impairmentAllowanceAccountId', 'disposalGainAccountId', 'disposalLossAccountId']
          .every(key => Boolean(policy[key as keyof PolicyForm]))}
        onClick={() => void run(() => accountingAPI.createAssetClassPolicy({ ...policy, bookId: book.id,
          version: 1 + Math.max(0, ...policies.filter((row: any) => row.classCode === policy.classCode).map((row: any) => Number(row.version))),
          effectiveFrom: isoDate(policy.effectiveFrom), effectiveTo: policy.effectiveTo ? isoDate(policy.effectiveTo) : undefined,
          decliningRateBasisPoints: policy.decliningRateBasisPoints || undefined,
          changeReason: policy.changeReason.trim() }), 'سیاست طبقه دارایی ثبت شد.')} />}>
      {error && <ErpInlineState kind="error" title={error} />}
      <div className="grid gap-3 md:grid-cols-2">
        <ErpField label="کد طبقه" required><ErpInput value={policy.classCode} onChange={event => setPolicy({ ...policy, classCode: event.target.value })} /></ErpField>
        <ErpField label="عنوان طبقه" required><ErpInput value={policy.titlePersian} onChange={event => setPolicy({ ...policy, titlePersian: event.target.value })} /></ErpField>
        <ErpField label="تاریخ اثر" required><ErpInput type="date" value={policy.effectiveFrom} onChange={event => setPolicy({ ...policy, effectiveFrom: event.target.value })} /></ErpField>
        <ErpField label="پایان اعتبار، در صورت تعیین"><ErpInput type="date" value={policy.effectiveTo} onChange={event => setPolicy({ ...policy, effectiveTo: event.target.value })} /></ErpField>
        <ErpField label="حد سرمایه‌ای به ریال" required><ErpRialInput value={policy.capitalizationThresholdRials} onValueChange={value => setPolicy({ ...policy, capitalizationThresholdRials: value })} /></ErpField>
        <ErpField label="عمر مفید به ماه" required><ErpInput inputMode="numeric" value={policy.usefulLifeMonths} onChange={event => setPolicy({ ...policy, usefulLifeMonths: event.target.value })} /></ErpField>
        <ErpField label="ارزش اسقاط به صدم درصد"><ErpInput inputMode="numeric" value={policy.residualValueBasisPoints} onChange={event => setPolicy({ ...policy, residualValueBasisPoints: event.target.value })} /></ErpField>
        <ErpField label="روش استهلاک دفتری"><ErpSelect value={policy.bookMethod} onChange={event => setPolicy({ ...policy, bookMethod: event.target.value })}>{Object.entries(methodFa).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect></ErpField>
        <ErpField label="روش استهلاک مالیاتی"><ErpSelect value={policy.taxMethod} onChange={event => setPolicy({ ...policy, taxMethod: event.target.value })}>{Object.entries(methodFa).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect></ErpField>
        {(policy.bookMethod === 'DECLINING_BALANCE' || policy.taxMethod === 'DECLINING_BALANCE') && <ErpField label="نرخ نزولی به صدم درصد"><ErpInput inputMode="numeric" value={policy.decliningRateBasisPoints} onChange={event => setPolicy({ ...policy, decliningRateBasisPoints: event.target.value })} /></ErpField>}
      </div>
      <ErpSection title="نگاشت حساب‌ها"><div className="grid gap-3 md:grid-cols-2">
        {accountSelect('assetAccountId', 'حساب دارایی')}{accountSelect('cipAccountId', 'دارایی در جریان تکمیل')}
        {accountSelect('depreciationExpenseAccountId', 'هزینه استهلاک')}{accountSelect('accumulatedDepreciationAccountId', 'استهلاک انباشته')}
        {accountSelect('impairmentExpenseAccountId', 'هزینه کاهش ارزش')}{accountSelect('impairmentAllowanceAccountId', 'ذخیره کاهش ارزش')}
        {accountSelect('disposalGainAccountId', 'سود واگذاری')}{accountSelect('disposalLossAccountId', 'زیان واگذاری')}
      </div></ErpSection>
      <ErpField label="دلیل تعریف یا تغییر سیاست" required><ErpInput value={policy.changeReason} onChange={event => setPolicy({ ...policy, changeReason: event.target.value })} /></ErpField>
    </ErpSheet>

    <ErpSheet open={sheet === 'asset'} onClose={() => !saving && setSheet(null)} title="ثبت دارایی ثابت" presentation="modal" pending={saving}
      footer={<ErpButton label="ثبت دارایی" disabled={saving || !asset.registerNumber || !asset.titlePersian || !asset.classPolicyId || !asset.acquisitionAt || !componentTotalValid}
        onClick={() => void run(() => accountingAPI.createFixedAsset({ ...asset, bookId: book.id,
          acquisitionAt: isoDate(asset.acquisitionAt), components: components.map(row => ({ ...row,
            usefulLifeMonths: row.usefulLifeMonths || selectedPolicy?.usefulLifeMonths })) }), 'دارایی و اجزای آن ثبت شدند؛ آماده‌به‌کار شدن نیازمند مدرک مستقل است.')} />}>
      {error && <ErpInlineState kind="error" title={error} />}
      <div className="grid gap-3 md:grid-cols-2">
        <ErpField label="شماره ثبت دارایی" required><ErpInput value={asset.registerNumber} onChange={event => setAsset({ ...asset, registerNumber: event.target.value })} /></ErpField>
        <ErpField label="عنوان دارایی" required><ErpInput value={asset.titlePersian} onChange={event => setAsset({ ...asset, titlePersian: event.target.value })} /></ErpField>
        <ErpField label="سیاست طبقه" required><ErpSelect value={asset.classPolicyId} onChange={event => setAsset({ ...asset, classPolicyId: event.target.value })}><option value="">انتخاب طبقه</option>{policies.map((row: any) => <option key={row.id} value={row.id}>{row.titlePersian} · نسخه {Number(row.version).toLocaleString('fa-IR')}</option>)}</ErpSelect></ErpField>
        <ErpField label="تاریخ تحصیل" required><ErpInput type="date" value={asset.acquisitionAt} onChange={event => setAsset({ ...asset, acquisitionAt: event.target.value })} /></ErpField>
        <ErpField label="بهای دفتری به ریال" required><ErpRialInput value={asset.bookCostRials} onValueChange={value => setAsset({ ...asset, bookCostRials: value })} /></ErpField>
        <ErpField label="مبنای مالیاتی به ریال" required><ErpRialInput value={asset.taxCostRials} onValueChange={value => setAsset({ ...asset, taxCostRials: value })} /></ErpField>
        <ErpField label="شماره سریال"><ErpInput value={asset.serialNumber} onChange={event => setAsset({ ...asset, serialNumber: event.target.value })} /></ErpField>
        <ErpField label="محل نگهداری"><ErpInput value={asset.location} onChange={event => setAsset({ ...asset, location: event.target.value })} /></ErpField>
      </div>
      <ErpSection title="اجزای دارایی"><div className="space-y-3">{components.map((row, index) => <ErpCard key={row.componentIdentity} className="p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <ErpField label={`عنوان جزء ${Number(index + 1).toLocaleString('fa-IR')}`} required><ErpInput value={row.titlePersian} onChange={event => setComponents(current => current.map((item, offset) => offset === index ? { ...item, titlePersian: event.target.value } : item))} /></ErpField>
          <ErpField label="عمر مفید به ماه"><ErpInput inputMode="numeric" value={row.usefulLifeMonths} onChange={event => setComponents(current => current.map((item, offset) => offset === index ? { ...item, usefulLifeMonths: event.target.value } : item))} /></ErpField>
          {(['bookCostRials', 'taxCostRials', 'residualValueRials'] as const).map((field) => <ErpField key={field} label={({ bookCostRials: 'بهای دفتری جزء', taxCostRials: 'مبنای مالیاتی جزء', residualValueRials: 'ارزش اسقاط جزء' })[field]} required><ErpRialInput value={row[field]} onValueChange={value => setComponents(current => current.map((item, offset) => offset === index ? { ...item, [field]: value } : item))} /></ErpField>)}
        </div>
        {components.length > 1 && <ErpButton label="حذف این جزء" tone="danger" variant="outline" onClick={() => setComponents(current => current.filter((_, offset) => offset !== index))} />}
      </ErpCard>)}</div><div className="mt-3"><ErpButton label="افزودن جزء" variant="outline" onClick={() => setComponents(current => [...current, blankComponent()])} /></div>
        {!componentTotalValid && <ErpInlineState kind="stale" title="جمع بهای دفتری و مالیاتی اجزا باید دقیقاً با مبلغ دارایی برابر باشد." />}
      </ErpSection>
    </ErpSheet>

    <ErpSheet open={sheet === 'cost'} onClose={() => !saving && setSheet(null)} title="ثبت بهای دارایی در جریان تکمیل" presentation="modal" pending={saving}
      footer={<ErpButton label="ثبت بهای مستند" disabled={saving || !target || !targetPolicy || !selectedPeriod || !targetArchive || !costAmount || !costCreditAccountId || !costDate}
        onClick={() => { if (!target || !targetPolicy || !selectedPeriod || !targetArchive) return;
          void run(async () => {
            const evidence = { kind: 'ASSET_COST', sourceId: targetArchive.id, sourceVersion: 1,
              occurredAt: isoDate(costDate), assetId: target.id, costKind: 'PURCHASE', amountRials: costAmount,
              constructionInProgressAccountId: targetPolicy.cipAccountId, creditAccountId: costCreditAccountId,
              documentIds: [targetArchive.id] };
            return accountingAPI.submitPeriodEndEvidence({ bookId: book.id, fiscalYearId: selectedPeriod.fiscalYearId,
              periodId: selectedPeriod.id, evidence: { ...evidence, sourceHash: await hashAccountingPeriodEvidence(evidence) } });
          }, 'بهای مستند دارایی در جریان تکمیل ثبت شد.'); }} />}>
      {error && <ErpInlineState kind="error" title={error} />}
      <p className="sds-text-secondary mb-3 text-sm">{target?.registerNumber} · {target?.titlePersian}</p>
      {notice && <ErpInlineState kind="success" title={notice} />}
      {proofsLoading && <ErpInlineState kind="stale" title="در حال خواندن مدارک این دارایی…" />}
      {!proofsLoading && !validProofs.length && <ErpInlineState kind="stale" title="مدرک بهای همین دارایی را بارگذاری کنید." />}
      {proofUpload}
      <div className="grid gap-3 md:grid-cols-2">
        <ErpField label="مدرک بهای دارایی" required><ErpSelect value={archiveId} onChange={event => setArchiveId(event.target.value)}><option value="">انتخاب مدرک</option>{validProofs.map((row: any) => <option key={row.id} value={row.id}>{row.evidenceIdentity}</option>)}</ErpSelect></ErpField>
        <ErpField label="دوره مالی باز" required><ErpSelect value={periodId} onChange={event => setPeriodId(event.target.value)}><option value="">انتخاب دوره</option>{periods.map((row: any) => <option key={row.id} value={row.id}>{row.yearTitle} · {row.titlePersian}</option>)}</ErpSelect></ErpField>
        <ErpField label="تاریخ بهای مستند" required><ErpInput type="date" value={costDate} onChange={event => setCostDate(event.target.value)} /></ErpField>
        <ErpField label="مبلغ به ریال" required><ErpRialInput value={costAmount} onValueChange={setCostAmount} /></ErpField>
        <ErpField label="حساب بستانکار" required><ErpSelect value={costCreditAccountId} onChange={event => setCostCreditAccountId(event.target.value)}><option value="">انتخاب حساب معین</option>{accounts.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}</ErpSelect></ErpField>
      </div>
    </ErpSheet>

    <ErpSheet open={sheet === 'ready'} onClose={() => !saving && setSheet(null)} title="آماده‌به‌کار شدن دارایی" presentation="modal" pending={saving}
      footer={<ErpButton label="ثبت آماده‌به‌کار" disabled={saving || !target || !targetPolicy || !selectedPeriod || !readyAt || !targetArchive}
        onClick={() => { if (!target || !targetPolicy || !selectedPeriod || !targetArchive) return;
          void run(async () => {
            const evidence = { kind: 'ASSET_READY_FOR_USE', sourceId: targetArchive.id, sourceVersion: 1,
              occurredAt: isoDate(readyAt), asset: {
                id: target.id, registerNumber: target.registerNumber, classPolicyVersionId: targetPolicy.id,
                readyForUseAt: isoDate(readyAt), costRials: target.bookCostRials,
                assetAccountId: targetPolicy.assetAccountId, constructionInProgressAccountId: targetPolicy.cipAccountId,
                components: target.components.map((component: any) => ({ id: component.id, titlePersian: component.titlePersian,
                  costRials: component.bookCostRials, usefulLifeMonths: component.usefulLifeMonths,
                  residualValueRials: component.residualValueRials })),
                bookMethod: targetPolicy.bookMethod, taxBasis: { costRials: target.taxCostRials,
                  method: targetPolicy.taxMethod, rateBasisPoints: targetPolicy.decliningRateBasisPoints || undefined },
              } };
            const sourceHash = await hashAccountingPeriodEvidence(evidence);
            return accountingAPI.submitPeriodEndEvidence({ bookId: book.id,
              fiscalYearId: selectedPeriod.fiscalYearId, periodId: selectedPeriod.id,
              evidence: { ...evidence, sourceHash } });
          }, 'مدرک آماده‌به‌کار پذیرفته و اثر حسابداری آن ثبت شد.'); }} />}>
      {error && <ErpInlineState kind="error" title={error} />}
      <p className="sds-text-secondary mb-3 text-sm">{target?.registerNumber} · {target?.titlePersian}</p>
      {notice && <ErpInlineState kind="success" title={notice} />}
      {proofsLoading && <ErpInlineState kind="stale" title="در حال خواندن مدارک این دارایی…" />}
      {!proofsLoading && !validProofs.length && <ErpInlineState kind="stale" title="مدرک مستقل آماده‌به‌کار همین دارایی را بارگذاری کنید." />}
      {proofUpload}
      <div className="grid gap-3 md:grid-cols-2">
        <ErpField label="مدرک آماده‌به‌کار" required><ErpSelect value={archiveId} onChange={event => setArchiveId(event.target.value)}><option value="">انتخاب مدرک</option>{validProofs.map((row: any) => <option key={row.id} value={row.id}>{row.evidenceIdentity}</option>)}</ErpSelect></ErpField>
        <ErpField label="دوره مالی باز" required><ErpSelect value={periodId} onChange={event => setPeriodId(event.target.value)}><option value="">انتخاب دوره</option>{periods.map((row: any) => <option key={row.id} value={row.id}>{row.yearTitle} · {row.titlePersian}</option>)}</ErpSelect></ErpField>
        <ErpField label="تاریخ آماده‌به‌کار" required><ErpInput type="date" value={readyAt} onChange={event => setReadyAt(event.target.value)} /></ErpField>
      </div>
    </ErpSheet>

    <ErpSheet open={sheet === 'depreciation'} onClose={() => !saving && setSheet(null)} title="استهلاک دوره‌ای" presentation="modal" pending={saving}
      footer={<ErpButton label="ثبت استهلاک" disabled={saving || !target || !periodId || (needsUnits && (!periodUnits || !totalExpectedUnits))}
        onClick={() => { if (!target) return; void run(() => accountingAPI.postAssetDepreciation(target.id, {
          periodId, ...(needsUnits ? { periodUnits, totalExpectedUnits } : {}),
        }), 'استهلاک دوره‌ای با سند قطعی ثبت شد.'); }} />}>
      {error && <ErpInlineState kind="error" title={error} />}
      <p className="sds-text-secondary mb-3 text-sm">{target?.registerNumber} · {target?.titlePersian}</p>
      <ErpField label="دوره مالی باز" required><ErpSelect value={periodId} onChange={event => setPeriodId(event.target.value)}><option value="">انتخاب دوره</option>{periods.map((row: any) => <option key={row.id} value={row.id}>{row.yearTitle} · {row.titlePersian}</option>)}</ErpSelect></ErpField>
      {needsUnits && <div className="mt-3 grid gap-3 md:grid-cols-2">
        <ErpField label="تولید دوره" required><ErpInput inputMode="numeric" value={periodUnits} onChange={event => setPeriodUnits(event.target.value)} /></ErpField>
        <ErpField label="کل تولید برآوردی" required><ErpInput inputMode="numeric" value={totalExpectedUnits} onChange={event => setTotalExpectedUnits(event.target.value)} /></ErpField>
      </div>}
      {targetPolicy && <p className="sds-text-secondary mt-3 text-sm">روش دفتری: {methodFa[targetPolicy.bookMethod] || 'طبق سیاست ثبت‌شده'} · روش مالیاتی: {methodFa[targetPolicy.taxMethod] || 'طبق سیاست ثبت‌شده'}</p>}
    </ErpSheet>
  </ErpSection>;
}
