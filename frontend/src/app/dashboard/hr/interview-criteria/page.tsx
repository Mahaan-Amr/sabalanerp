"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ErpBadge, ErpButton, ErpCard, ErpInput, ErpInlineState, ErpLoading, ErpPage, ErpSection, ErpSelect, ErpSheet, ErpTextarea } from "@/components/erp";
import { hiringAPI, hiringError } from "@/lib/hiringApi";

type Criterion = { stableId: string; title: string; description: string | null; answerType: string; isActive: boolean; allowUnassessed?: boolean };
const answerTypes = [
  ["TEXT", "پاسخ تشریحی"], ["SCORE_1_TO_5", "امتیاز ۱ تا ۵"], ["YES_NO", "بله یا خیر"],
  ["ADDRESS", "نشانی"], ["STRENGTHS_WEAKNESSES", "نقاط قوت و ضعف"], ["COMPANION", "همراه"],
];

export default function InterviewCriteriaPage() {
  const router = useRouter();
  const [published, setPublished] = useState<Criterion[]>();
  const [draft, setDraft] = useState<Criterion[]>([]);
  const [version, setVersion] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [dragged, setDragged] = useState<number | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [pendingHref, setPendingHref] = useState("");
  const dirty = useMemo(() => published && JSON.stringify(published) !== JSON.stringify(draft), [draft, published]);
  const load = () => hiringAPI.interviewCriteria().then(({ data }) => { const rows = data.data.criteriaJson || []; setVersion(data.data.version); setCanManage(Boolean(data.data.canManage)); setPublished(rows); setDraft(rows); }).catch((cause) => setError(hiringError(cause)));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${anchor.pathname}${anchor.search}${anchor.hash}`);
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty]);
  if (!published && !error) return <ErpLoading />;
  const update = (index: number, patch: Partial<Criterion>) => setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const move = (from: number, to: number) => setDraft((rows) => { if (to < 0 || to >= rows.length) return rows; const next = [...rows]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  const publish = async () => {
    try { const { data } = await hiringAPI.publishInterviewCriteria(draft); setVersion(data.data.version); setPublished(draft); setReviewing(false); }
    catch (cause) { setError(hiringError(cause)); }
  };
  return <ErpPage eyebrow="منابع انسانی · جذب" title="معیارهای مصاحبه اولیه" description={`نسخه منتشرشده ${version.toLocaleString("fa-IR")}`} backHref="/dashboard/hr/hiring">
    {error && <ErpInlineState kind="error" title={error} />}
    <ErpSection title="نسخه در حال ویرایش" description="تغییرات تا زمان انتشار فقط در این صفحه باقی می‌مانند.">
      <div className="space-y-3">
        {draft.map((criterion, index) => <div key={criterion.stableId} draggable={canManage} onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged !== null) move(dragged, index); setDragged(null); }}><ErpCard className="p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto]">
            <div className="space-y-2"><ErpInput disabled={!canManage} aria-label="عنوان معیار" value={criterion.title} onChange={(event) => update(index, { title: event.target.value })} /><ErpTextarea disabled={!canManage} aria-label="توضیح معیار" value={criterion.description || ""} onChange={(event) => update(index, { description: event.target.value || null })} placeholder="توضیح یا راهنمای اختیاری" /></div>
            <ErpSelect disabled={!canManage} aria-label="نوع پاسخ" value={criterion.answerType} onChange={(event) => update(index, { answerType: event.target.value })}>{answerTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect>
            <div className="flex flex-wrap gap-2"><ErpButton label="بالا" variant="ghost" disabled={!canManage || index === 0} onClick={() => move(index, index - 1)} /><ErpButton label="پایین" variant="ghost" disabled={!canManage || index === draft.length - 1} onClick={() => move(index, index + 1)} /><ErpButton label={criterion.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"} disabled={!canManage} tone={criterion.isActive ? "warning" : "success"} onClick={() => update(index, { isActive: !criterion.isActive })} /></div>
          </div>
        </ErpCard></div>)}
      </div>
      {canManage && <div className="mt-4 flex flex-wrap justify-between gap-2"><ErpButton label="افزودن معیار" onClick={() => setDraft((rows) => [...rows, { stableId: crypto.randomUUID(), title: "", description: null, answerType: "TEXT", isActive: true, allowUnassessed: false }])} /><ErpButton label="انتشار نسخه جدید" variant="solid" disabled={!dirty || draft.some((item) => !item.title.trim())} onClick={() => setReviewing(true)} /></div>}
    </ErpSection>
    <ErpSheet open={reviewing} onClose={() => setReviewing(false)} title="مرور پیش از انتشار" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="بازگشت" variant="ghost" onClick={() => setReviewing(false)} /><ErpButton label="تأیید و انتشار" variant="solid" onClick={publish} /></div>}>
      <div className="grid gap-4 md:grid-cols-2"><ErpCard className="p-4"><b>نسخه فعلی</b><div className="mt-3 space-y-2">{published?.map((item, index) => <div key={item.stableId}>{index + 1}. {item.title}</div>)}</div></ErpCard><ErpCard className="p-4"><b>نسخه جدید</b><div className="mt-3 space-y-2">{draft.map((item, index) => <div key={item.stableId}>{index + 1}. {item.title} {!item.isActive && <ErpBadge tone="neutral">غیرفعال</ErpBadge>}</div>)}</div></ErpCard></div>
    </ErpSheet>
    <ErpSheet open={Boolean(pendingHref)} onClose={() => setPendingHref("")} title="تغییرات منتشرنشده" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="ماندن در صفحه" variant="ghost" onClick={() => setPendingHref("")} /><ErpButton label="خروج بدون انتشار" tone="danger" onClick={() => { const href = pendingHref; setPendingHref(""); router.push(href); }} /></div>}><p>تغییرات این نسخه هنوز منتشر نشده است. با خروج، این تغییرات از بین می‌رود.</p></ErpSheet>
  </ErpPage>;
}
