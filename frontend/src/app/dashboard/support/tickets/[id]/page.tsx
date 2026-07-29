'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FaComments, FaEyeSlash, FaGavel, FaPaperPlane, FaPaperclip, FaShieldAlt, FaUserPlus } from 'react-icons/fa';
import { API_ORIGIN, authAPI, supportTicketsAPI, usersAPI } from '@/lib/api';
import { featureLabelFa, workspaceLabelFa } from '@/lib/featureLabelsFa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpEmptyState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpPressable,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
  erpFieldLabelClassName,
} from '@/components/erp';

const statusLabels: Record<string, string> = {
  NEW: 'جدید', TRIAGED: 'بررسی اولیه', IN_PROGRESS: 'در حال رسیدگی',
  WAITING_REPORTER: 'منتظر گزارشگر', RESOLVED: 'حل‌شده', CLOSED: 'بسته‌شده', DUPLICATE: 'تکراری',
};
const participantLabels: Record<string, string> = { HANDLER: 'مسئول رسیدگی', COLLABORATOR: 'همکار', WATCHER: 'ناظر' };
const priorityLabels: Record<string, string> = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'بالا', URGENT: 'فوری' };
const auditActionLabels: Record<string, string> = {
  CREATED: 'تیکت ثبت شد',
  ENTRY_ADDED: 'پیام تازه ثبت شد',
  ATTACHMENT_ADDED: 'پیوست تازه ثبت شد',
  ATTACHMENT_DOWNLOADED: 'پیوست دانلود شد',
  ATTACHMENT_REDACTED: 'پیوست پوشانده شد',
  ENTRY_REDACTED: 'محتوای پیام پوشانده شد',
  PARTICIPANT_ASSIGNED: 'مسئول، همکار یا ناظر تعیین شد',
  PRIORITY_CONFIRMED: 'اولویت تأیید شد',
  STATUS_CHANGED: 'وضعیت تغییر کرد',
  RESOLVED: 'نتیجه رسیدگی ثبت شد',
  MARKED_DUPLICATE: 'تیکت به‌عنوان تکراری ثبت شد',
  REOPENED: 'تیکت بازگشایی شد',
  TRANSCRIPT_CORRECTED: 'متن پیاده‌شده اصلاح شد',
  LEGAL_HOLD_PLACED: 'توقف قانونی نگهداری ثبت شد',
  LEGAL_HOLD_RELEASED: 'توقف قانونی نگهداری آزاد شد',
  DIAGNOSTIC_BUNDLE_PREVIEWED: 'پیش‌نمایش بسته تشخیصی ساخته شد',
  DIAGNOSTIC_BUNDLE_GENERATED: 'بسته تشخیصی تأیید شد',
  DIAGNOSTIC_BUNDLE_DOWNLOADED: 'بسته تشخیصی دانلود شد',
};

export default function SupportTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [nextStatus, setNextStatus] = useState('IN_PROGRESS');
  const [nextPriority, setNextPriority] = useState('NORMAL');
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeRole, setAssigneeRole] = useState<'HANDLER' | 'COLLABORATOR' | 'WATCHER'>('HANDLER');
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [bundlePreview, setBundlePreview] = useState<any>(null);
  const [selectedSensitive, setSelectedSensitive] = useState<string[]>([]);
  const [readyBundleId, setReadyBundleId] = useState('');

  const load = useCallback(async () => {
    try {
      const [ticketResponse, meResponse] = await Promise.all([supportTicketsAPI.get(params.id), authAPI.getMe()]);
      setTicket(ticketResponse.data.data);
      setTranscripts(Object.fromEntries(
        (ticketResponse.data.data.entries || [])
          .filter((entry: any) => entry.attachments?.some((attachment: any) => attachment.kind === 'AUDIO'))
          .map((entry: any) => [entry.id, entry.transcriptCurrent || '']),
      ));
      const me = meResponse.data.user || meResponse.data.data || meResponse.data;
      setCurrentUser(me);
      if (['ADMIN', 'MANAGER'].includes(me.role)) {
        usersAPI.getUsers(1, 100).then((response) => setUsers(response.data.users || response.data.data || [])).catch(() => undefined);
      }
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'تیکت پیدا نشد.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  const participant = useMemo(
    () => ticket?.participants?.find((item: any) => item.userId === currentUser?.id),
    [ticket, currentUser],
  );
  const canHandle = Boolean(
    currentUser
    && (currentUser.role === 'ADMIN'
      || (currentUser.role === 'MANAGER' && !ticket?.restrictedIncident)
      || ['HANDLER', 'COLLABORATOR'].includes(participant?.role)),
  );
  const watcher = participant?.role === 'WATCHER';
  const canReply = currentUser?.id === ticket?.reporterId || (canHandle && !watcher);
  const timelineEntries = useMemo(() => {
    const entries = (ticket?.entries || []).map((entry: any) => ({ ...entry, timelineType: 'entry' }));
    const auditEvents = (ticket?.auditEvents || [])
      .filter((event: any) => event.action !== 'ENTRY_ADDED')
      .map((event: any) => ({
        id: `audit-${event.id}`,
        timelineType: 'audit',
        kind: 'AUDIT',
        author: null,
        body: `${auditActionLabels[event.action] || event.action}${event.reason ? ` — ${event.reason}` : ''}`,
        attachments: [],
        createdAt: event.createdAt,
      }));
    return [...entries, ...auditEvents].sort(
      (left: any, right: any) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
  }, [ticket]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      setMessage('');
      setActionReason('');
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'عملیات انجام نشد.');
    } finally {
      setBusy(false);
    }
  };

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (message.trim()) void run(() => supportTicketsAPI.addEntry(params.id, message.trim()));
  };

  const reopenTicket = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await supportTicketsAPI.reopen(params.id, actionReason);
      setActionReason('');
      if (response.data.createdFollowUp && response.data.data?.id) {
        router.push(`/dashboard/support/tickets/${response.data.data.id}`);
        return;
      }
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'بازگشایی انجام نشد.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ErpLoading />;
  if (!ticket) return <ErpEmptyState icon={FaComments} title={error || 'تیکت پیدا نشد'} action={{ label: 'بازگشت به تاریخچه', href: '/dashboard/support/history' }} />;
  const priority = ticket.confirmedPriority || ticket.suggestedPriority;
  const attachmentUrl = (id: string, inline = false) =>
    `${API_ORIGIN}/api/support-tickets/attachments/${id}/download${inline ? '?inline=true' : ''}`;

  return (
    <ErpPage
      eyebrow={`پشتیبانی · ${ticket.referenceCode}`}
      title={ticket.title}
      description={`${workspaceLabelFa(ticket.reportedWorkspace)}${ticket.reportedFeature ? ` / ${featureLabelFa(ticket.reportedFeature)}` : ''}`}
      backHref="/dashboard/support/history"
    >
      <div className="space-y-4" dir="rtl">
        {error && <ErpCard tone="danger"><p role="alert" className="text-sm font-bold">{error}</p></ErpCard>}
        <ErpCard>
          <div className="flex flex-wrap gap-2">
            <ErpBadge tone={ticket.restrictedIncident ? 'danger' : 'info'}>{ticket.restrictedIncident ? 'رخداد حفاظت‌شده' : statusLabels[ticket.status] || ticket.status}</ErpBadge>
            <ErpBadge tone={priority === 'URGENT' ? 'danger' : priority === 'HIGH' ? 'warning' : 'neutral'}>اولویت {priorityLabels[priority] || priority}</ErpBadge>
            <ErpBadge tone="neutral">{new Date(ticket.createdAt).toLocaleString('fa-IR')}</ErpBadge>
          </div>
          {ticket.restrictedIncident && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)]">
              <FaShieldAlt className="mt-0.5 shrink-0" />
              جزئیات این رخداد فقط در اختیار افراد مجاز قرار می‌گیرد و در اعلان قفل صفحه نمایش داده نمی‌شود.
            </div>
          )}
          {ticket.participants?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {ticket.participants.map((item: any) => (
                <ErpBadge key={item.id} tone={item.role === 'HANDLER' ? 'primary' : 'neutral'}>
                  {item.user.firstName} {item.user.lastName} · {participantLabels[item.role] || item.role}
                </ErpBadge>
              ))}
            </div>
          )}
        </ErpCard>

        {canHandle && (
          <ErpCard tone="info">
            <h2 className="mb-4 font-bold">کنترل رسیدگی</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              <label>
                <span className={erpFieldLabelClassName}>وضعیت بعدی</span>
                <ErpSelect value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                  {['TRIAGED', 'IN_PROGRESS', 'WAITING_REPORTER', 'RESOLVED', 'CLOSED'].map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
                </ErpSelect>
              </label>
              <label>
                <span className={erpFieldLabelClassName}>اولویت تأییدشده</span>
                <ErpSelect value={nextPriority} onChange={(event) => setNextPriority(event.target.value)}>
                  <option value="LOW">کم</option><option value="NORMAL">عادی</option><option value="HIGH">بالا</option><option value="URGENT">فوری</option>
                </ErpSelect>
              </label>
              <label className="lg:col-span-1">
                <span className={erpFieldLabelClassName}>دلیل ثبت‌شده</span>
                <ErpInput value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="حداقل ۳ نویسه" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <ErpButton label="ثبت وضعیت" onClick={() => void run(() => supportTicketsAPI.setStatus(params.id, nextStatus, actionReason))} disabled={busy || actionReason.trim().length < 3} />
              <ErpButton label="ثبت اولویت" onClick={() => void run(() => supportTicketsAPI.setPriority(params.id, nextPriority, actionReason))} disabled={busy || actionReason.trim().length < 3} tone="warning" />
            </div>
            {users.length > 0 && (
              <div className="mt-5 border-t border-[var(--sds-border-subtle)] pt-4">
                <h3 className="mb-3 font-bold">ارجاع یا افزودن ناظر</h3>
                <div className="grid gap-3 lg:grid-cols-[1fr_14rem_auto]">
                  <ErpSelect value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                    <option value="">انتخاب کاربر</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} (@{user.username})</option>)}
                  </ErpSelect>
                  <ErpSelect value={assigneeRole} onChange={(event) => setAssigneeRole(event.target.value as typeof assigneeRole)}>
                    <option value="HANDLER">مسئول رسیدگی</option><option value="COLLABORATOR">همکار</option><option value="WATCHER">ناظر فقط‌خواندنی</option>
                  </ErpSelect>
                  <ErpButton
                    label="ثبت ارجاع"
                    icon={FaUserPlus}
                    onClick={() => void run(() => supportTicketsAPI.assignParticipant(params.id, { userId: assigneeId, role: assigneeRole, reason: actionReason }))}
                    disabled={busy || !assigneeId || actionReason.trim().length < 3}
                  />
                </div>
              </div>
            )}
            {currentUser?.role === 'ADMIN' && (
              <div className="mt-5 border-t border-[var(--sds-border-subtle)] pt-4">
                <h3 className="font-bold">نگهداری قانونی و حسابرسی</h3>
                <p className="mt-1 text-sm text-[var(--sds-text-muted)]">
                  توقف قانونی فقط حذف شواهد را متوقف می‌کند و مانع بسته‌شدن عملیاتی تیکت نمی‌شود.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ErpButton
                    label="ثبت توقف قانونی"
                    icon={FaGavel}
                    tone="warning"
                    variant="outline"
                    onClick={() => void run(() => supportTicketsAPI.placeLegalHold(params.id, actionReason))}
                    disabled={busy || actionReason.trim().length < 5 || ticket.legalHolds?.some((hold: any) => !hold.releasedAt)}
                  />
                  {ticket.legalHolds?.filter((hold: any) => !hold.releasedAt).map((hold: any) => (
                    <ErpButton
                      key={hold.id}
                      label="آزادسازی توقف قانونی"
                      tone="neutral"
                      variant="outline"
                      onClick={() => void run(() => supportTicketsAPI.releaseLegalHold(params.id, hold.id, actionReason))}
                      disabled={busy || actionReason.trim().length < 5}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="mt-5 border-t border-[var(--sds-border-subtle)] pt-4">
              <h3 className="font-bold">بسته تشخیصی کنترل‌شده برای Codex</h3>
              <p className="mt-1 text-sm text-[var(--sds-text-muted)]">به‌صورت پیش‌فرض هیچ شاهد حساسی وارد بسته نمی‌شود و بسته به پایگاه production دسترسی مستقیم نمی‌دهد.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ErpButton
                  label="ساخت پیش‌نمایش"
                  onClick={() => void run(async () => {
                    const response = await supportTicketsAPI.previewDiagnosticBundle(params.id);
                    setBundlePreview(response.data.data);
                    setSelectedSensitive([]);
                  })}
                  disabled={busy}
                  tone="purple"
                  variant="outline"
                />
                {readyBundleId && (
                  <>
                    <ErpButton label="دانلود Markdown" href={supportTicketsAPI.diagnosticBundleDownloadUrl(params.id, readyBundleId, 'markdown')} tone="neutral" variant="outline" />
                    <ErpButton label="دانلود JSON" href={supportTicketsAPI.diagnosticBundleDownloadUrl(params.id, readyBundleId, 'json')} tone="neutral" variant="outline" />
                  </>
                )}
              </div>
            </div>
          </ErpCard>
        )}

        <ErpSheet open={Boolean(bundlePreview)} onClose={() => setBundlePreview(null)} title="پیش‌نمایش بسته تشخیصی">
          {bundlePreview && (
            <div className="space-y-4">
              <pre dir="ltr" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] p-3 text-xs">{bundlePreview.markdown}</pre>
              {bundlePreview.availableSensitiveEvidence?.length > 0 && (
                <div>
                  <h3 className="font-bold">شواهد حساس اختیاری</h3>
                  <p className="mt-1 text-sm text-[var(--sds-warning)]">انتخاب هر مورد فقط metadata امن آن را وارد بسته می‌کند؛ فایل binary جداگانه و فقط از مسیر مجاز قابل دریافت است.</p>
                  <div className="mt-2 space-y-2">
                    {bundlePreview.availableSensitiveEvidence.map((item: any) => (
                      <ErpCheckbox
                        key={item.id}
                        label={`${item.originalName} · ${item.kind}`}
                        checked={selectedSensitive.includes(item.id)}
                        onChange={() => setSelectedSensitive((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                      />
                    ))}
                  </div>
                </div>
              )}
              <label>
                <span className={erpFieldLabelClassName}>دلیل تولید و تأیید</span>
                <ErpTextarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} rows={3} />
              </label>
              <ErpButton
                label="تأیید و آماده‌سازی دانلود"
                onClick={() => void run(async () => {
                  const response = await supportTicketsAPI.confirmDiagnosticBundle(params.id, bundlePreview.id, {
                    sensitiveAttachmentIds: selectedSensitive,
                    reason: actionReason,
                  });
                  setReadyBundleId(response.data.data.id);
                  setBundlePreview(null);
                })}
                disabled={busy || actionReason.trim().length < 5}
                tone="purple"
              />
            </div>
          )}
        </ErpSheet>

        <section aria-labelledby="ticket-timeline-title">
          <h2 id="ticket-timeline-title" className="mb-3 text-lg font-bold">خط زمانی</h2>
          <div className="space-y-3">
            {timelineEntries.map((entry: any) => (
              <ErpCard key={entry.id} tone={entry.kind === 'RESOLUTION' ? 'success' : entry.timelineType === 'audit' ? 'info' : 'neutral'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{entry.author ? `${entry.author.firstName} ${entry.author.lastName}` : 'سامانه'}{entry.kind === 'RESOLUTION' ? ' · نتیجه رسیدگی' : entry.timelineType === 'audit' ? ' · رویداد حسابرسی' : ''}</p>
                  <time className="text-xs text-[var(--sds-text-muted)]">{new Date(entry.createdAt).toLocaleString('fa-IR')}</time>
                </div>
                {entry.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{entry.redactedAt ? 'این محتوا با ثبت دلیل پوشانده شده است.' : entry.body}</p>}
                {currentUser?.role === 'ADMIN' && entry.timelineType !== 'audit' && !entry.redactedAt && (entry.body || entry.transcriptCurrent) && (
                  <div className="mt-3">
                    <ErpButton
                      label="پوشاندن محتوای این پیام"
                      icon={FaEyeSlash}
                      tone="danger"
                      variant="outline"
                      onClick={() => void run(() => supportTicketsAPI.redactEntry(params.id, entry.id, actionReason))}
                      disabled={busy || actionReason.trim().length < 5}
                    />
                  </div>
                )}
                {entry.attachments?.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {entry.attachments.map((attachment: any) => (
                      <div key={attachment.id} className="rounded-lg border border-[var(--sds-border-subtle)] p-3">
                        <p className="inline-flex items-center gap-2 text-xs font-bold"><FaPaperclip />{attachment.originalName}</p>
                        {attachment.redactedAt ? (
                          <p className="mt-2 text-sm text-[var(--sds-danger)]">این پیوست با ثبت دلیل پوشانده شده است.</p>
                        ) : attachment.kind === 'AUDIO' ? (
                          <audio className="mt-3 w-full" controls preload="metadata" src={attachmentUrl(attachment.id, true)}>مرورگر شما پخش صوت را پشتیبانی نمی‌کند.</audio>
                        ) : attachment.kind === 'IMAGE' ? (
                          <img src={attachmentUrl(attachment.id, true)} alt={attachment.originalName || 'تصویر پیوست'} className="mt-3 max-h-80 w-full rounded-lg object-contain" />
                        ) : null}
                        {!attachment.redactedAt && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <ErpButton label="دانلود پیوست" href={attachmentUrl(attachment.id)} tone="neutral" variant="outline" />
                            {currentUser?.role === 'ADMIN' && (
                              <ErpButton
                                label="پوشاندن پیوست"
                                icon={FaEyeSlash}
                                tone="danger"
                                variant="outline"
                                onClick={() => void run(() => supportTicketsAPI.redactAttachment(params.id, attachment.id, actionReason))}
                                disabled={busy || actionReason.trim().length < 5}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {entry.attachments?.some((attachment: any) => attachment.kind === 'AUDIO') && canReply && (
                  <div className="mt-3">
                    <label>
                      <span className={erpFieldLabelClassName}>متن پیاده‌شده قابل اصلاح · نسخه {entry.transcriptVersion || 0}</span>
                      <ErpTextarea
                        value={transcripts[entry.id] || ''}
                        onChange={(event) => setTranscripts({ ...transcripts, [entry.id]: event.target.value })}
                        rows={3}
                      />
                    </label>
                    <div className="mt-2">
                      <ErpButton
                        label="ثبت اصلاح متن"
                        onClick={() => void run(() => supportTicketsAPI.updateTranscript(params.id, entry.id, transcripts[entry.id] || ''))}
                        disabled={busy || !(transcripts[entry.id] || '').trim()}
                        tone="neutral"
                        variant="outline"
                      />
                    </div>
                  </div>
                )}
              </ErpCard>
            ))}
          </div>
        </section>

        {canReply && ticket.status !== 'CLOSED' && (
          <ErpCard>
            <form onSubmit={submitMessage}>
              <label>
                <span className={erpFieldLabelClassName}>افزودن پاسخ یا اصلاحیه</span>
                <ErpTextarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} maxLength={10000} />
              </label>
              <div className="mt-3 flex justify-end">
                <ErpPressable type="submit" disabled={busy || !message.trim()} tone="primary" variant="solid" className="inline-flex min-h-11 items-center gap-2 px-4 font-bold disabled:opacity-50">
                  <FaPaperPlane /> ارسال پاسخ
                </ErpPressable>
              </div>
            </form>
          </ErpCard>
        )}
        {watcher && <ErpCard tone="neutral"><p className="text-sm">شما به‌عنوان ناظر فقط‌خواندنی به این تیکت دسترسی دارید.</p></ErpCard>}
        {currentUser?.id === ticket.reporterId && ticket.status === 'CLOSED' && ticket.reopenUntil && new Date(ticket.reopenUntil) > new Date() && (
          <ErpCard tone="warning">
            <p className="mb-3 text-sm">این تیکت تا {new Date(ticket.reopenUntil).toLocaleDateString('fa-IR')} قابل بازگشایی است.</p>
            <ErpInput value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="دلیل بازگشایی" />
            <div className="mt-3"><ErpButton label="بازگشایی" onClick={() => void reopenTicket()} disabled={busy || actionReason.trim().length < 3} /></div>
          </ErpCard>
        )}
        {ticket.originRoute && (
          <ErpCard tone="neutral">
            <h2 className="font-bold">اطلاعات فنی ثبت‌شده</h2>
            <p className="mt-2 text-sm" dir="ltr">{ticket.originRoute}</p>
            <p className="mt-1 text-xs text-[var(--sds-text-muted)]">نسخه: {ticket.releaseBuild || 'نامشخص'}</p>
          </ErpCard>
        )}
        {canHandle && ticket.sensitiveEvidenceSnapshot && (
          <ErpCard tone="warning">
            <h2 className="font-bold">اطلاعات حساس اختیاری گزارشگر</h2>
            <p className="mt-1 text-sm text-[var(--sds-text-muted)]">
              این بخش با رضایت صریح گزارشگر ثبت شده و فقط برای رسیدگی مجاز نمایش داده می‌شود.
            </p>
            <pre dir="ltr" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] p-3 text-xs">
              {JSON.stringify(ticket.sensitiveEvidenceSnapshot, null, 2)}
            </pre>
          </ErpCard>
        )}
      </div>
    </ErpPage>
  );
}
