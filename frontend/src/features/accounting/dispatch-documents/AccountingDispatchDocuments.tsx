'use client';

import React, { useState } from 'react';
import { FaCheck, FaDownload, FaFileAlt, FaHistory, FaPrint, FaRedo, FaTimes } from 'react-icons/fa';
import {
  ErpActionMenu,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpFieldView,
  ErpInlineState,
  ErpLoading,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpSheet,
  ErpSummaryGrid,
  ErpTextarea,
  ErpTwoColumn,
} from '@/components/erp';
import type { DispatchDocumentHandoff, DispatchDocumentsClient } from './dispatchDocumentsClient';
import {
  canRunDispatchDocumentCommand,
  formatDisplayedMoney,
  hasCompletePrimaryBundle,
  type DispatchDocumentArtifact,
  type DispatchDocumentCase,
  type DispatchDocumentFilter,
  type DispatchDocumentWorkspace,
} from './dispatchDocumentsViewModel';
import { useAccountingDispatchDocuments } from './useAccountingDispatchDocuments';

type DetailSheet = 'ARTIFACTS' | 'PRINT_HISTORY' | 'REPLACE' | 'ERROR' | null;

const filterLabels: Record<DispatchDocumentFilter, string> = { READY: 'آماده', BLOCKED: 'مسدود', ISSUED: 'صادرشده' };
const stateTone = { READY: 'warning', BLOCKED: 'danger', ISSUED: 'success' } as const;
const printActionLabels = { WAYBILL: 'چاپ بارنامه', STATEMENT: 'چاپ صورت‌حساب', BOTH: 'چاپ هر دو' };

const faDate = (value: string) => new Date(value).toLocaleString('fa-IR');

function ArtifactList({ artifacts }: { artifacts: DispatchDocumentArtifact[] }) {
  if (!artifacts.length) return <ErpEmptyState title="فایل نگهداری‌شده‌ای برای این سابقه قابل اثبات نیست" description="تحویل سند از این نما غیرفعال است؛ شواهد اصلی باید از مسیر بازیابی بررسی شود." />;
  return <div className="space-y-3">
    {artifacts.map((item) => <ErpCard key={item.id} className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <strong className="text-sm text-[var(--sds-text-primary)]">{item.kind === 'WAYBILL' ? 'بارنامه' : item.kind === 'STATEMENT' ? 'صورت‌حساب محموله' : 'اصلاحیه صورت‌حساب'}</strong>
        <ErpBadge tone="success">فایل نگهداری‌شده</ErpBadge>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="sds-text-secondary">نام فایل</dt><dd className="break-all" dir="ltr">{item.fileName}</dd></div>
        <div><dt className="sds-text-secondary">checksum</dt><dd className="break-all font-mono text-xs" dir="ltr">{item.checksum}</dd></div>
        <div><dt className="sds-text-secondary">اندازه</dt><dd>{item.byteSize.toLocaleString('fa-IR')} بایت</dd></div>
      </dl>
    </ErpCard>)}
  </div>;
}

function QueueCase({ item, selected, onSelect }: { item: DispatchDocumentCase; selected: boolean; onSelect: () => void }) {
  return <ErpPressable
    onClick={onSelect}
    aria-pressed={selected}
    className={`min-h-11 w-full rounded-xl border p-3 text-right ${selected ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-soft)]' : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]'}`}
  >
    <span className="flex items-start justify-between gap-2">
      <span className="min-w-0"><strong className="block truncate text-sm text-[var(--sds-text-primary)]">{item.loadingNumber} · {item.customerName}</strong><span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{item.destination} · {formatDisplayedMoney(item.total)}</span></span>
      <ErpBadge tone={stateTone[item.state]}>{filterLabels[item.state]}</ErpBadge>
    </span>
  </ErpPressable>;
}

export default function AccountingDispatchDocuments({ client }: { client: DispatchDocumentsClient }) {
  const [sheet, setSheet] = useState<DetailSheet>(null);
  const session = useAccountingDispatchDocuments(client);
  const { workspace, filter, selectFilter, setSelectedId, rejectionReason, setRejectionReason, replacementReason, setReplacementReason, loading, stale, pending, notice, errorDetail, queueRef, persist, load, runCommand, view, selected } = session;

  const handoff = async (kind: DispatchDocumentHandoff['kind']) => {
    if (!selected || !canRunDispatchDocumentCommand(kind.startsWith('PRINT') ? 'PRINT' : 'DOWNLOAD', workspace, selected, stale || pending)) return;
    const printWindow = kind.startsWith('PRINT') ? window.open('about:blank', '_blank') : null;
    await runCommand(async () => {
      let result;
      try { result = await client.handoff(selected.id, { kind }); }
      catch (error) { printWindow?.close(); throw error; }
      if (kind.startsWith('DOWNLOAD')) {
        const retained = result.artifacts[0];
        if (!retained || result.artifacts.length !== 1) throw new Error('پاسخ دانلود با سند درخواستی منطبق نیست.');
        const link = document.createElement('a'); link.href = retained.url; link.download = retained.fileName; document.body.appendChild(link); link.click(); link.remove();
      } else {
        const expectedKinds = kind === 'PRINT_BOTH' ? ['WAYBILL', 'STATEMENT'] : [kind.endsWith('WAYBILL') ? 'WAYBILL' : 'STATEMENT'];
        if (result.artifacts.length !== expectedKinds.length || result.artifacts.some((artifact, index) => artifact.kind !== expectedKinds[index])) throw new Error('ترتیب فایل‌های چاپ با فرمان درخواستی منطبق نیست.');
        if (!printWindow) throw new Error('مرورگر پنجره تحویل چاپ را مسدود کرد.');
        printWindow.opener = null;
        printWindow.document.title = `تحویل چاپ ${selected.bundle?.number || ''}`;
        printWindow.document.body.style.margin = '0';
        result.artifacts.forEach((artifact, index) => {
          const frame = printWindow.document.createElement('iframe');
          frame.src = artifact.url; frame.title = artifact.kind === 'WAYBILL' ? 'بارنامه' : 'صورت‌حساب محموله';
          frame.style.width = '100%'; frame.style.height = '100vh'; frame.style.border = '0';
          if (index > 0) frame.style.breakBefore = 'page';
          printWindow.document.body.appendChild(frame);
        });
      }
    }, kind.startsWith('PRINT') ? 'تحویل فایل چاپ ثبت شد؛ موفقیت چاپ فیزیکی ادعا نمی‌شود.' : 'فایل نگهداری‌شده برای دانلود تحویل شد.');
  };

  if (loading && !workspace.retrievedAt) return <ErpLoading />;
  if (workspace.permission === 'UNAUTHORIZED') return <ErpInlineState kind="permission" title="دسترسی به اسناد ارسال حسابداری برای این نقش مجاز نیست." />;

  const selectedFirst = selected ? <CaseReview item={selected} workspace={workspace} stale={stale} pending={pending} rejectionReason={rejectionReason} onRejectionReason={setRejectionReason} onAccept={() => void runCommand(() => client.decide(selected.id, { action: 'ACCEPT', reason: '', idempotencyKey: crypto.randomUUID() }), 'شماره دائمی، تصویر ثابت، بارنامه و صورت‌حساب به‌صورت اتمیک صادر شدند.', () => { selectFilter('ISSUED'); setSelectedId(selected.id); })} onReject={() => void runCommand(() => client.decide(selected.id, { action: 'REJECT', reason: rejectionReason, idempotencyKey: crypto.randomUUID() }), 'پرونده برای اصلاح به منبع مالک بازگردانده شد.', () => setSelectedId(null))} onHandoff={(kind) => void handoff(kind)} onMore={setSheet} /> : <ErpEmptyState title={workspace.cases.length ? 'در این فیلتر موردی وجود ندارد' : 'صف اسناد ارسال خالی است'} description={workspace.cases.length ? 'فیلتر دیگری را انتخاب کنید یا فیلتر را به «آماده» برگردانید.' : 'پرونده‌های معتبر پس از نهایی‌سازی لجستیک اینجا ظاهر می‌شوند.'} action={workspace.cases.length && filter !== 'READY' ? { label: 'بازنشانی فیلتر', onClick: () => selectFilter('READY') } : undefined} />;

  return <ErpSection title="بسته‌های بارنامه و صورت‌حساب محموله" description="هر تصمیم روی یک بسته تغییرناپذیر انجام می‌شود؛ اصلاح اطلاعات فقط در منبع مالک آن ممکن است." actions={[{ label: 'تازه‌سازی', icon: FaRedo, onClick: () => void load(), variant: 'outline', disabled: loading || pending }]}>
    <div aria-live="polite" className="space-y-3">
      {notice && <ErpInlineState kind={notice.kind} title={notice.text} actions={notice.kind === 'error' ? [{ label: 'تلاش دوباره', icon: FaRedo, onClick: () => void load() }, { label: 'جزئیات خطا', variant: 'ghost', onClick: () => setSheet('ERROR') }] : []} />}
      {stale && <ErpInlineState kind="stale" title="نمای زنده در دسترس نیست؛ آخرین نمایش موفق، فیلتر، انتخاب و دلیل رد حفظ شده‌اند. فرمان‌های ناامن غیرفعال‌اند." />}
      {workspace.permission === 'VIEW' && <ErpInlineState kind="permission" title="دسترسی شما فقط برای مشاهده و دریافت اسناد صادرشده است؛ فرمان‌های تصمیم و جایگزینی نمایش داده نمی‌شوند." />}
    </div>
    <div className="mt-4"><ErpTwoColumn main={selectedFirst} aside={<ErpCard className="min-w-0 p-4">
        <ErpSegmentedControl options={(Object.keys(filterLabels) as DispatchDocumentFilter[]).map((value) => ({ value, label: `${filterLabels[value]} · ${view.counts[value].toLocaleString('fa-IR')}` }))} value={filter} onChange={selectFilter} />
        <div ref={queueRef} onScroll={() => persist({ scrollTop: queueRef.current?.scrollTop || 0 })} className="mt-3 max-h-[34rem] space-y-2 overflow-y-auto" aria-label="صف پرونده‌های اسناد ارسال">
          {view.visibleCases.map((item) => <QueueCase key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />)}
          {!view.visibleCases.length && <p className="py-5 text-center text-sm text-[var(--sds-text-secondary)]">موردی در فیلتر «{filterLabels[filter]}» نیست.</p>}
        </div>
      </ErpCard>} /></div>
    <ErpSheet open={Boolean(sheet)} onClose={() => setSheet(null)} title={sheet === 'ARTIFACTS' ? 'جزئیات فایل و checksum' : sheet === 'PRINT_HISTORY' ? 'سابقه تحویل برای چاپ' : sheet === 'REPLACE' ? 'جایگزینی بسته اسناد' : 'جزئیات خطا'}>
      {sheet === 'ARTIFACTS' && selected?.bundle && <ArtifactList artifacts={selected.bundle.artifacts} />}
      {sheet === 'PRINT_HISTORY' && selected?.bundle && <div className="space-y-3">{selected.bundle.printHistory.length ? selected.bundle.printHistory.map((event) => <ErpCard key={event.id} className="p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{printActionLabels[event.action]}</strong><ErpBadge tone={event.outcome === 'SUCCEEDED' ? 'success' : 'danger'}>{event.outcome === 'SUCCEEDED' ? 'تحویل موفق فایل' : 'تلاش ناموفق'}</ErpBadge></div><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{event.actorName} · {faDate(event.occurredAt)}</p></ErpCard>) : <ErpEmptyState title="سابقه چاپی ثبت نشده است" />}</div>}
      {sheet === 'REPLACE' && selected && <div className="space-y-4"><ErpInlineState kind="stale" title="جایگزینی کل بسته را با شماره تازه صادر می‌کند؛ بسته و فایل‌های قبلی در سابقه می‌مانند." /><ErpTextarea aria-label="دلیل جایگزینی بسته اسناد" value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} rows={4} /><ErpButton label="جایگزینی بسته اسناد" icon={FaRedo} tone="warning" disabled={!replacementReason.trim() || pending || stale} className="min-h-11" onClick={() => void runCommand(() => client.replace(selected.id, { reason: replacementReason, idempotencyKey: crypto.randomUUID() }), 'بسته جایگزین صادر و بسته قبلی به سابقه تغییرناپذیر منتقل شد.', () => { setReplacementReason(''); setSheet(null); })} /></div>}
      {sheet === 'ERROR' && <ErpCard className="p-4"><p className="break-words text-sm text-[var(--sds-text-primary)]">{errorDetail || 'جزئیات بیشتری ثبت نشده است.'}</p></ErpCard>}
    </ErpSheet>
  </ErpSection>;
}

export function CaseReview({ item, workspace, stale, pending, rejectionReason, onRejectionReason, onAccept, onReject, onHandoff, onMore }: {
  item: DispatchDocumentCase; workspace: DispatchDocumentWorkspace; stale: boolean; pending: boolean; rejectionReason: string; onRejectionReason: (value: string) => void; onAccept: () => void; onReject: () => void; onHandoff: (kind: DispatchDocumentHandoff['kind']) => void; onMore: (sheet: DetailSheet) => void;
}) {
  const unsafe = stale || pending;
  const canAccept = canRunDispatchDocumentCommand('ACCEPT', workspace, item, unsafe);
  const canPrint = canRunDispatchDocumentCommand('PRINT', workspace, item, unsafe);
  const canReplace = canRunDispatchDocumentCommand('REPLACE', workspace, item, unsafe);
  const completePrimaryBundle = hasCompletePrimaryBundle(item);
  return <div className="space-y-4" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-[var(--sds-text-primary)]">{item.loadingNumber} · {item.customerName}</h2><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{item.destination} · پلاک {item.vehiclePlate} · راننده: {item.driverName}</p></div><ErpBadge tone={stateTone[item.state]}>{filterLabels[item.state]}</ErpBadge></div>
    {item.state === 'BLOCKED' && <ErpInlineState kind="error" title={item.readiness.label} />}
    {item.state === 'READY' && <ErpInlineState kind="success" title="شواهد مقدار، هویت ردیف، قیمت، تخفیف و ارز کامل و آماده تصمیم است." />}
    {item.state === 'ISSUED' && item.bundle && (completePrimaryBundle
      ? <ErpInlineState kind="success" title={`بسته شماره ${item.bundle.number} از یک تصویر ثابت صادر شده و فایل‌های اصلی نگهداری شده‌اند.`} />
      : <ErpInlineState kind="stale" title="بسته کامل بارنامه و صورت‌حساب در این نما قابل اثبات نیست؛ تحویل و جایگزینی غیرفعال است." />)}
    {item.readiness.reasons.map((reason) => <ErpCard key={reason.id} className="p-4"><p className="text-sm text-[var(--sds-text-primary)]">{reason.label}</p><div className="mt-3"><ErpButton label={reason.ownerLabel} href={reason.ownerHref} variant="outline" className="min-h-11" /></div></ErpCard>)}
    <ErpSummaryGrid columns={3} items={[{ label: 'مقدار قطعی', value: `${item.contracts.reduce((count, contract) => count + contract.rows.length, 0).toLocaleString('fa-IR')} ردیف پایدار`, hint: 'ویرایش‌ناپذیر در حسابداری' }, { label: 'وضعیت قیمت', value: item.readiness.label, hint: 'منطبق با نهایی‌سازی لجستیک', tone: item.state === 'BLOCKED' ? 'danger' : 'success' }, { label: 'جمع ارسال', value: formatDisplayedMoney(item.total), hint: 'جمع معتبر ذخیره‌شده', tone: 'primary' }]} />
    <ErpCard className="p-4"><h3 className="font-semibold text-[var(--sds-text-primary)]">ردیف‌های منبع</h3><div className="mt-3 space-y-4">{item.contracts.map((contract) => <section key={contract.id} aria-label={`قرارداد ${contract.number}`}><h4 className="text-sm font-semibold text-[var(--sds-text-primary)]">قرارداد {contract.number}</h4><div className="mt-2 space-y-2">{contract.rows.map((row) => <div key={row.id} className="rounded-lg border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] p-3 text-sm"><strong>{row.label}</strong><p className="mt-1 text-[var(--sds-text-secondary)]">{row.quantity} {row.unit} · خالص {formatDisplayedMoney(row.net)}</p><p className="mt-1 break-all text-xs text-[var(--sds-text-muted)]" dir="ltr">{row.id}</p></div>)}</div></section>)}</div></ErpCard>
    {item.state === 'READY' && workspace.permission === 'MANAGE' && <div className="space-y-3"><ErpTextarea aria-label="دلیل رد پرونده اسناد ارسال" placeholder="دلیل رد را برای بازگشت به منبع وارد کنید" value={rejectionReason} onChange={(event) => onRejectionReason(event.target.value)} disabled={unsafe} rows={3} /><div className="flex flex-wrap gap-2"><ErpButton label={pending ? 'در حال صدور…' : 'پذیرش و صدور هر دو سند'} icon={FaCheck} tone="success" disabled={!canAccept} className="min-h-11" onClick={onAccept} /><ErpButton label="رد برای اصلاح در منبع" icon={FaTimes} tone="danger" variant="outline" disabled={!canAccept || !rejectionReason.trim()} className="min-h-11" onClick={onReject} /></div><p className="text-xs text-[var(--sds-text-secondary)]">پذیرش یک فرمان اتمیک است؛ حسابداری امکان ویرایش مقدار، قیمت، تخفیف، ارز یا انتساب قرارداد را ندارد.</p></div>}
    {item.state === 'ISSUED' && item.bundle && <div className="space-y-4"><div className="flex flex-wrap gap-2"><ErpButton label="دانلود بارنامه" icon={FaDownload} variant="ghost" disabled={!canPrint} className="min-h-11" onClick={() => onHandoff('DOWNLOAD_WAYBILL')} /><ErpButton label="دانلود صورت‌حساب" icon={FaDownload} variant="ghost" disabled={!canPrint} className="min-h-11" onClick={() => onHandoff('DOWNLOAD_STATEMENT')} /></div><div className="flex flex-wrap gap-2"><ErpButton label="چاپ بارنامه" icon={FaPrint} disabled={!canPrint} className="min-h-11" onClick={() => onHandoff('PRINT_WAYBILL')} /><ErpButton label="چاپ صورت‌حساب" icon={FaPrint} variant="outline" disabled={!canPrint} className="min-h-11" onClick={() => onHandoff('PRINT_STATEMENT')} /><ErpButton label="چاپ هر دو" icon={FaPrint} variant="soft" disabled={!canPrint} className="min-h-11" onClick={() => onHandoff('PRINT_BOTH')} /><ErpActionMenu label="اقدامات بیشتر" actions={[...(workspace.permission === 'MANAGE' ? [{ label: 'جایگزینی بسته اسناد', icon: FaRedo, tone: 'warning' as const, disabled: !canReplace, onClick: () => onMore('REPLACE') }] : []), { label: 'جزئیات فایل و checksum', icon: FaFileAlt, onClick: () => onMore('ARTIFACTS') }, { label: 'سابقه چاپ', icon: FaHistory, onClick: () => onMore('PRINT_HISTORY') }]} /></div><p className="text-xs text-[var(--sds-text-secondary)]">چاپ و دانلود همان bytes صادرشده را برمی‌گرداند؛ «چاپ هر دو» فایل سومی ذخیره نمی‌کند.</p>
      {item.bundle.adjustments.length > 0 && <ErpCard className="p-4"><h3 className="font-semibold text-[var(--sds-text-primary)]">اصلاحیه‌های افزایشی</h3><div className="mt-3 space-y-3">{item.bundle.adjustments.map((adjustment) => <div key={adjustment.id} className="border-t border-[var(--sds-border-subtle)] pt-3 first:border-0 first:pt-0"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{adjustment.sharedNumber} / اصلاحیه {adjustment.sequence.toLocaleString('fa-IR')}</strong><ErpBadge tone="purple">{formatDisplayedMoney(adjustment.netDelta)}</ErpBadge></div><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{adjustment.summary} · {faDate(adjustment.issuedAt)}</p></div>)}</div></ErpCard>}
      {item.bundle.history.length > 1 && <ErpCard className="p-4"><h3 className="font-semibold text-[var(--sds-text-primary)]">سابقه تغییرناپذیر بسته</h3>{item.bundle.history.map((entry) => <p key={entry.id} className="mt-2 text-sm text-[var(--sds-text-secondary)]">بسته {entry.number} · {entry.status} · {faDate(entry.occurredAt)}{entry.reason ? ` · ${entry.reason}` : ''}</p>)}</ErpCard>}
    </div>}
  </div>;
}
