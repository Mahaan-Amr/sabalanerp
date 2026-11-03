'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaChevronDown, FaImage, FaLifeRing, FaMicrophone, FaPaperPlane, FaPause, FaShieldAlt, FaTrash } from 'react-icons/fa';
import { supportTicketsAPI } from '@/lib/api';
import { featureLabelFa, workspaceLabelFa } from '@/lib/featureLabelsFa';
import {
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpCheckboxControl,
  ErpInlineState,
  ErpInput,
  ErpWorkspacePage,
  ErpPressable,
  ErpSelect,
  ErpTextarea,
  erpFieldLabelClassName,
} from '@/components/erp';

type Origin = {
  route: string;
  pageTitle?: string;
  viewport?: { width: number; height: number };
  buildCommit?: string;
  sensitiveCandidate?: {
    pageText?: string;
    formValues?: Record<string, string | number | boolean>;
    uploadedFileMetadata?: Array<{ name: string; size: number; type: string }>;
  };
};

type PendingEvidence = {
  id: string;
  file: File;
  kind: 'IMAGE' | 'AUDIO' | 'DOCUMENT';
  previewUrl?: string;
  durationSeconds?: number;
  transcript?: string;
};

const typeOptions = [
  ['TECHNICAL_ERROR', 'خطای فنی'],
  ['INCORRECT_DATA', 'داده یا محاسبه نادرست'],
  ['ACCESS_PROBLEM', 'مشکل دسترسی'],
  ['GUIDANCE', 'نیاز به راهنمایی'],
  ['IMPROVEMENT', 'پیشنهاد بهبود'],
  ['SECURITY_PRIVACY', 'امنیت یا حریم خصوصی'],
  ['OTHER', 'سایر'],
];

const impactOptions = [
  ['MINOR', 'مزاحمت جزئی'],
  ['SINGLE_TASK', 'اختلال در یک کار'],
  ['BLOCKED', 'مسدود شدن کار'],
  ['WIDESPREAD', 'اختلال گسترده'],
];

export default function NewSupportTicketPage() {
  const router = useRouter();
  const [origin, setOrigin] = useState<Origin>({ route: '/dashboard' });
  const [context, setContext] = useState<{ workspaces: string[]; features: Array<{ workspace: string; feature: string; label?: string }> }>({ workspaces: [], features: [] });
  const [form, setForm] = useState({
    title: '',
    type: 'TECHNICAL_ERROR',
    impact: 'SINGLE_TASK',
    workaroundExists: false,
    reportedWorkspace: '',
    reportedFeature: '',
    description: '',
    steps: '',
    expectedResult: '',
    sensitiveEvidenceConsent: false,
    sensitiveEvidenceText: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<PendingEvidence[]>([]);
  const [recording, setRecording] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);
  const originSelectionAppliedRef = useRef(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('support-ticket-origin');
      if (stored) {
        const parsed = JSON.parse(stored) as Origin;
        setOrigin(parsed);
        if (parsed.sensitiveCandidate) {
          setForm((current) => ({ ...current, sensitiveEvidenceConsent: true }));
        }
        sessionStorage.removeItem('support-ticket-origin');
      }
      else setOrigin({
        route: window.location.pathname,
        pageTitle: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        buildCommit: process.env.NEXT_PUBLIC_BUILD_COMMIT || 'local',
      });
    } catch {
      setOrigin({ route: window.location.pathname });
    }
    supportTicketsAPI.getContext().then((response) => setContext(response.data.data)).catch(() => setError('دریافت محدوده‌های دسترسی ممکن نشد.'));
  }, []);

  useEffect(() => () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (originSelectionAppliedRef.current || !context.workspaces.length) return;
    const originatingWorkspace = origin.route.split(/[?#]/, 1)[0].split('/').filter(Boolean)[1] || '';
    originSelectionAppliedRef.current = true;
    if (context.workspaces.includes(originatingWorkspace)) {
      setForm((current) => ({ ...current, reportedWorkspace: originatingWorkspace, reportedFeature: '' }));
    }
  }, [context.workspaces, origin.route]);

  const addFiles = async (files: FileList | null, kind: 'IMAGE' | 'AUDIO' | 'DOCUMENT') => {
    if (!files) return;
    const next = await Promise.all(Array.from(files).slice(0, Math.max(0, 5 - evidence.length)).map(async (file) => {
      const previewUrl = ['IMAGE', 'AUDIO'].includes(kind) ? URL.createObjectURL(file) : undefined;
      let durationSeconds: number | undefined;
      if (kind === 'AUDIO' && previewUrl) {
        durationSeconds = await new Promise<number>((resolve) => {
          const audio = new Audio(previewUrl);
          audio.onloadedmetadata = () => resolve(Math.max(1, Math.ceil(audio.duration)));
          audio.onerror = () => resolve(0);
        });
      }
      return { id: crypto.randomUUID(), file, kind, previewUrl, durationSeconds };
    }));
    setEvidence((current) => [...current, ...next]);
  };

  const removeEvidence = (id: string) => {
    setEvidence((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const startRecording = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recordingStartedRef.current = Date.now();
      recorder.ondataavailable = (event) => event.data.size && recordingChunksRef.current.push(event.data);
      recorder.onstop = () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedRef.current) / 1000));
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        setEvidence((current) => [...current.filter((item) => item.kind !== 'AUDIO'), {
          id: crypto.randomUUID(),
          file,
          kind: 'AUDIO',
          previewUrl: URL.createObjectURL(file),
          durationSeconds,
          transcript: '',
        }]);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      window.setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
          setRecording(false);
        }
      }, 600_000);
    } catch {
      setError('دسترسی میکروفون داده نشد یا ضبط صدا در این مرورگر پشتیبانی نمی‌شود.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  };

  const features = useMemo(
    () => context.features.filter((feature) => feature.workspace === form.reportedWorkspace),
    [context.features, form.reportedWorkspace],
  );
  const needsSensitiveConsent = form.type === 'SECURITY_PRIVACY' || Boolean(origin.sensitiveCandidate) || evidence.some((item) => item.kind === 'AUDIO');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const stagedAttachmentTokens: string[] = [];
      for (const item of evidence) {
        const payload = new FormData();
        payload.append('file', item.file);
        payload.append('sensitive', String(item.kind === 'AUDIO'));
        payload.append('sensitiveEvidenceConsent', String(form.sensitiveEvidenceConsent));
        if (item.durationSeconds) payload.append('durationSeconds', String(item.durationSeconds));
        if (item.transcript) payload.append('transcript', item.transcript);
        const staged = await supportTicketsAPI.stageAttachment(payload);
        stagedAttachmentTokens.push(staged.data.data.token);
      }
      const response = await supportTicketsAPI.create({
        ...form,
        reportedWorkspace: form.reportedWorkspace || null,
        reportedFeature: form.reportedFeature || null,
        originRoute: origin.route,
        stagedAttachmentTokens,
        sensitiveEvidenceSnapshot: form.sensitiveEvidenceConsent
          ? {
              ...(origin.sensitiveCandidate || {}),
              pageText: [origin.sensitiveCandidate?.pageText, form.sensitiveEvidenceText.trim()].filter(Boolean).join('\n\n'),
            }
          : null,
        diagnosticSnapshot: origin,
      }, crypto.randomUUID());
      sessionStorage.removeItem('support-ticket-origin');
      router.push(`/dashboard/support/tickets/${response.data.data.id}`);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'ثبت تیکت انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErpWorkspacePage title="ثبت درخواست پشتیبانی" backHref="/dashboard/support/history">
      <form onSubmit={submit} className="space-y-5" dir="rtl">
        {error && <ErpInlineState kind="error" title={error} />}
        {form.type === 'SECURITY_PRIVACY' && (
          <ErpCard tone="danger">
            <div className="flex items-start gap-3">
              <FaShieldAlt className="mt-1 h-5 w-5 shrink-0" />
              <div>
                <p className="font-bold">مسیر حفاظت‌شده امنیت و حریم خصوصی</p>
                <p className="mt-1 text-sm">این گزارش فقط برای مدیران سیستم و مسئولان تعیین‌شده رخداد امنیتی قابل مشاهده است.</p>
              </div>
            </div>
          </ErpCard>
        )}
        <ErpCard className="p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="lg:col-span-2">
              <span className={erpFieldLabelClassName}>عنوان</span>
              <ErpInput value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={180} required />
            </label>
            <label>
              <span className={erpFieldLabelClassName}>نوع مشکل</span>
              <ErpSelect value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </ErpSelect>
            </label>
            <label>
              <span className={erpFieldLabelClassName}>اثر مشکل</span>
              <ErpSelect value={form.impact} onChange={(event) => setForm({ ...form, impact: event.target.value })}>
                {impactOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </ErpSelect>
            </label>
            <label className="lg:col-span-2">
              <span className={erpFieldLabelClassName}>شرح مشکل</span>
              <ErpTextarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={6} maxLength={10000} />
            </label>
            <label>
              <span className={erpFieldLabelClassName}>فضای کاری مرتبط</span>
              <ErpSelect value={form.reportedWorkspace} onChange={(event) => setForm({ ...form, reportedWorkspace: event.target.value, reportedFeature: '' })}>
                <option value="">عمومی / نامشخص</option>
                {context.workspaces.map((workspace) => <option key={workspace} value={workspace}>{workspaceLabelFa(workspace)}</option>)}
              </ErpSelect>
            </label>
            <label>
              <span className={erpFieldLabelClassName}>قابلیت مرتبط</span>
              <ErpSelect value={form.reportedFeature} onChange={(event) => setForm({ ...form, reportedFeature: event.target.value })} disabled={!form.reportedWorkspace}>
                <option value="">عمومی / نامشخص</option>
                {features.map((feature) => <option key={feature.feature} value={feature.feature}>{featureLabelFa(feature.feature, feature.label)}</option>)}
              </ErpSelect>
            </label>
            <div className="lg:col-span-2">
              <ErpButton label="جزئیات بیشتر" icon={FaChevronDown} tone="neutral" variant="ghost" onClick={() => setDetailsOpen((open) => !open)} />
            </div>
            {detailsOpen && <>
              <label><span className={erpFieldLabelClassName}>مراحلی که طی کردید</span><ErpTextarea value={form.steps} onChange={(event) => setForm({ ...form, steps: event.target.value })} rows={4} maxLength={5000} /></label>
              <label><span className={erpFieldLabelClassName}>نتیجه مورد انتظار</span><ErpTextarea value={form.expectedResult} onChange={(event) => setForm({ ...form, expectedResult: event.target.value })} rows={4} maxLength={5000} /></label>
              <div className="lg:col-span-2"><ErpCheckbox checked={form.workaroundExists} onChange={(event) => setForm({ ...form, workaroundExists: event.target.checked })} label="برای ادامه کار راه‌حل موقت دارم" /></div>
            </>}
          </div>
        </ErpCard>
        <ErpCard>
          <h2 className="font-bold">تصویر، سند یا پیام صوتی</h2>
          <p className="mt-1 text-sm text-[var(--sds-text-muted)]">حداکثر ۵ فایل؛ صوت حداکثر ۱۰ دقیقه است و همیشه شاهد حساس محسوب می‌شود.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className="sds-action sds-tone-neutral sds-action-outline inline-flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-bold">
              <FaImage /> افزودن تصویر
              <ErpInput type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => void addFiles(event.target.files, 'IMAGE')} />
            </label>
            <label className="sds-action sds-tone-neutral sds-action-outline inline-flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-bold">
              <FaPaperPlane /> افزودن سند
              <ErpInput type="file" accept=".pdf,.docx,.xlsx,.txt" multiple className="sr-only" onChange={(event) => void addFiles(event.target.files, 'DOCUMENT')} />
            </label>
            <label className="sds-action sds-tone-neutral sds-action-outline inline-flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-bold">
              <FaMicrophone /> بارگذاری پیام صوتی
              <ErpInput
                type="file"
                accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav"
                className="sr-only"
                onChange={(event) => void addFiles(event.target.files, 'AUDIO')}
              />
            </label>
            <ErpButton
              label={recording ? 'پایان ضبط' : 'ضبط پیام صوتی'}
              icon={recording ? FaPause : FaMicrophone}
              onClick={recording ? stopRecording : () => void startRecording()}
              tone={recording ? 'danger' : 'primary'}
              variant="outline"
              disabled={!recording && evidence.some((item) => item.kind === 'AUDIO')}
            />
          </div>
          {evidence.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {evidence.map((item) => (
                <div key={item.id} className="rounded-xl border border-[var(--sds-border-subtle)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold">{item.file.name}</p>
                    <ErpButton label="حذف" icon={FaTrash} onClick={() => removeEvidence(item.id)} tone="danger" variant="ghost" />
                  </div>
                  {item.kind === 'IMAGE' && item.previewUrl && <img src={item.previewUrl} alt="پیش‌نمایش شاهد" className="mt-3 max-h-48 w-full rounded-lg object-contain" />}
                  {item.kind === 'AUDIO' && item.previewUrl && <audio className="mt-3 w-full" controls src={item.previewUrl}>مرورگر شما پخش صوت را پشتیبانی نمی‌کند.</audio>}
                  {item.kind === 'AUDIO' && (
                    <label className="mt-3 block">
                      <span className={erpFieldLabelClassName}>متن پیاده‌شده قابل اصلاح</span>
                      <ErpTextarea
                        value={item.transcript || ''}
                        onChange={(event) => setEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, transcript: event.target.value } : entry))}
                        rows={3}
                        placeholder="اگر مرورگر پیاده‌سازی فارسی را پشتیبانی کند، متن اینجا قرار می‌گیرد؛ می‌توانید آن را اصلاح کنید."
                      />
                    </label>
                  )}
                  <p className="mt-2 text-xs text-[var(--sds-text-muted)]">{(item.file.size / 1024 / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت</p>
                </div>
              ))}
            </div>
          )}
        </ErpCard>
        {needsSensitiveConsent && <ErpCard tone="warning">
          <label className="flex cursor-pointer items-start gap-3">
            <ErpCheckboxControl
              checked={form.sensitiveEvidenceConsent}
              onChange={(event) => setForm({ ...form, sensitiveEvidenceConsent: event.target.checked })}
              aria-describedby="sensitive-evidence-help"
            />
            <span>
              <span className="block font-bold">اجازه می‌دهم شواهد حساس انتخاب‌شده را نیز همراه این تیکت ارسال کنم</span>
              <span id="sensitive-evidence-help" className="mt-1 block text-sm leading-6">
                خام فرم‌ها، متن صفحه، اسناد بارگذاری‌شده و اطلاعات منابع انسانی، مالی یا مشتری فقط با انتخاب شما افزوده می‌شوند. رمز عبور، توکن، کوکی و کلید رمزنگاری هرگز جمع‌آوری نمی‌شود.
              </span>
            </span>
          </label>
          {form.sensitiveEvidenceConsent && (
            <label className="mt-4 block">
              <span className={erpFieldLabelClassName}>اطلاعات حساس انتخاب‌شده برای اشتراک</span>
              <ErpTextarea
                value={form.sensitiveEvidenceText}
                onChange={(event) => setForm({ ...form, sensitiveEvidenceText: event.target.value })}
                rows={5}
                maxLength={20_000}
                placeholder="فقط مقادیر، متن صفحه یا اطلاعاتی را که آگاهانه می‌خواهید به مسئول مجاز نشان دهید اینجا وارد کنید. پیش از ارسال قابل بازبینی و حذف است."
              />
            </label>
          )}
        </ErpCard>}
        <div className="flex flex-wrap justify-end gap-2">
          <ErpButton label="انصراف" href="/dashboard/support/history" tone="neutral" variant="outline" />
          <ErpPressable
            type="submit"
            disabled={saving || !form.title.trim() || (!form.description.trim() && evidence.length === 0) || (evidence.some((item) => item.kind === 'AUDIO') && !form.sensitiveEvidenceConsent)}
            className="sds-action sds-tone-primary sds-action-solid inline-flex min-h-11 items-center justify-center gap-2 px-4 text-sm font-bold disabled:opacity-50"
          >
            {saving ? <FaLifeRing className="h-4 w-4" /> : <FaPaperPlane className="h-4 w-4" />}
            {saving ? 'در حال ثبت…' : 'ثبت درخواست'}
          </ErpPressable>
        </div>
      </form>
    </ErpWorkspacePage>
  );
}
