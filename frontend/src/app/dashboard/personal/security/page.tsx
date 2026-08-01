'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaCheck, FaDesktop, FaKey, FaRedo, FaShieldAlt, FaSignOutAlt, FaTimes } from 'react-icons/fa';
import { authAPI, notificationsAPI } from '@/lib/api';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpSection,
  ErpSheet,
  ErpSkeleton,
  ErpWorkspacePage,
} from '@/components/erp';

type Session = {
  id: string; browser?: string | null; operatingSystem?: string | null; deviceCategory?: string | null;
  ipAddress?: string | null; approximateLocation?: string | null; authenticatedAt: string; lastActivityAt: string;
  revokedAt?: string | null; isCurrent: boolean; isNewBrowser: boolean;
};

export default function PersonalSecurityPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [me, setMe] = useState<any>(null);
  const [securityNotifications, setSecurityNotifications] = useState<any[]>([]);
  const [highlightedSessionId, setHighlightedSessionId] = useState('');
  const [highlightedNotificationId, setHighlightedNotificationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<Session | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const [notMineOpen, setNotMineOpen] = useState(false);
  const [passwordRecommended, setPasswordRecommended] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [sessionsResponse, meResponse, alertsResponse] = await Promise.all([
        authAPI.getSessions(), authAPI.getMe(), notificationsAPI.list({ state: 'UNREAD', category: 'SECURITY', limit: 100 }),
      ]);
      const nextSessions = sessionsResponse.data.data || [];
      setSessions(nextSessions);
      setMe(meResponse.data.data || meResponse.data.user || meResponse.data);
      const nextAlerts = alertsResponse.data.data || [];
      setSecurityNotifications(nextAlerts);
      const params = new URLSearchParams(window.location.search);
      const requestedSessionId = params.get('session') || '';
      const requestedNotificationId = params.get('notification') || '';
      const defaultAlert = nextAlerts.find((item: any) => item.sessionId
        && nextSessions.some((session: Session) => session.id === item.sessionId));
      setHighlightedSessionId(requestedSessionId || defaultAlert?.sessionId || '');
      setHighlightedNotificationId(requestedNotificationId || defaultAlert?.id || '');
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'دریافت وضعیت امنیت حساب انجام نشد.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeSessions = useMemo(() => sessions.filter((session) => !session.revokedAt), [sessions]);
  const history = useMemo(() => sessions.filter((session) => session.revokedAt), [sessions]);
  const alert = securityNotifications.find((item) => item.id === highlightedNotificationId)
    || securityNotifications.find((item) => item.sessionId === highlightedSessionId);

  const revokeSession = async () => {
    if (!revokeTarget) return;
    setBusy('revoke'); setError('');
    try {
      await authAPI.revokeSession(revokeTarget.id);
      setRevokeTarget(null);
      if (revokeTarget.isCurrent) { router.push('/login'); return; }
      setMessage('دسترسی نشست قطع شد.'); await load();
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'قطع نشست انجام نشد.'); }
    finally { setBusy(''); }
  };

  const revokeOthers = async () => {
    setBusy('others'); setError('');
    try { await authAPI.revokeOtherSessions(); setRevokeOthersOpen(false); setMessage('همه نشست‌های دیگر قطع شدند.'); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'قطع نشست‌ها انجام نشد.'); }
    finally { setBusy(''); }
  };

  const resolveAlert = async (decision: 'MINE' | 'NOT_MINE') => {
    if (!alert) return;
    setBusy('resolve'); setError('');
    try {
      const response = await notificationsAPI.resolveSecurityAlert(alert.id, decision);
      setNotMineOpen(false);
      setMessage(decision === 'MINE' ? 'ورود به‌عنوان فعالیت شما ثبت شد.' : 'نشست ناشناس قطع و هشدار تعیین تکلیف شد.');
      await load();
      setPasswordRecommended(Boolean(response.data.data?.passwordChangeRecommended));
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'تعیین تکلیف هشدار انجام نشد.'); }
    finally { setBusy(''); }
  };

  const renderSession = (session: Session) => {
    const highlighted = session.id === highlightedSessionId;
    return (
      <ErpCard key={session.id} className={`p-4 ${highlighted ? 'ring-2 ring-[var(--sds-warning)]' : ''}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-black sds-text-primary"><FaDesktop className="ml-2 inline" />{session.browser || 'مرورگر نامشخص'} · {session.operatingSystem || session.deviceCategory || 'دستگاه نامشخص'}</p>
              {session.isCurrent && <ErpBadge tone="success">نشست فعلی</ErpBadge>}
              {session.isNewBrowser && <ErpBadge tone="warning">مرورگر جدید</ErpBadge>}
              {highlighted && alert && <ErpBadge tone="danger">نیازمند بررسی</ErpBadge>}
            </div>
            <p className="mt-2 text-xs sds-text-muted" dir="ltr">{session.ipAddress || '—'} · {session.approximateLocation || 'مکان تقریبی نامشخص'}</p>
            <p className="mt-1 text-xs sds-text-muted">ورود: {new Date(session.authenticatedAt).toLocaleString('fa-IR')} · آخرین فعالیت: {new Date(session.lastActivityAt).toLocaleString('fa-IR')}</p>
          </div>
          {!session.revokedAt && <ErpButton label={session.isCurrent ? 'خروج از این نشست' : 'قطع دسترسی'} icon={FaSignOutAlt} tone="danger" variant="outline" onClick={() => setRevokeTarget(session)} />}
        </div>
        {highlighted && alert && (
          <div className="mt-4 flex flex-col gap-2 border-t border-[var(--sds-border-subtle)] pt-3 sm:flex-row">
            <ErpButton label="این ورود متعلق به من است" icon={FaCheck} tone="success" onClick={() => void resolveAlert('MINE')} disabled={busy === 'resolve'} />
            <ErpButton label="این ورود من نبود" icon={FaTimes} tone="danger" variant="outline" onClick={() => setNotMineOpen(true)} disabled={busy === 'resolve'} />
          </div>
        )}
      </ErpCard>
    );
  };

  return (
    <ErpWorkspacePage title="امنیت و نشست‌ها" primaryAction={{ label: 'به‌روزرسانی', icon: FaRedo, onClick: () => void load(), disabled: loading }} backHref="/dashboard/personal">
      {passwordRecommended && <ErpInlineState kind="stale" title="نشست ناشناس قطع شد؛ اکنون رمز عبور را تغییر دهید." action={{ label: 'تغییر رمز عبور', href: '/change-password?security=1', icon: FaKey }} />}
      <div className="space-y-4" dir="rtl">
        {message && <ErpInlineState kind="success" title={message} />}
        {error && <ErpInlineState kind={sessions.length ? 'stale' : 'error'} title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
        {loading && !sessions.length ? <ErpSkeleton lines={5} /> : (
          <>
            <ErpSection>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h2 className="font-black sds-text-primary">امنیت حساب</h2><p className="mt-1 text-sm sds-text-muted">رمز عبور: {me?.mustChangePassword ? 'نیازمند تغییر' : 'فعال'} · نشست فعال: {activeSessions.length.toLocaleString('fa-IR')}</p></div>
                <div className="flex flex-wrap gap-2"><ErpButton label="تغییر رمز عبور" icon={FaKey} href="/change-password" /><ErpButton label="قطع همه نشست‌های دیگر" tone="danger" variant="outline" onClick={() => setRevokeOthersOpen(true)} disabled={!activeSessions.some((session) => !session.isCurrent)} /></div>
              </div>
            </ErpSection>
            <ErpSection title="نشست‌های فعال"><div className="space-y-3">{activeSessions.length ? activeSessions.map(renderSession) : <ErpEmptyState icon={FaShieldAlt} title="نشست فعالی وجود ندارد" />}</div></ErpSection>
            {history.length > 0 && <ErpSection title="نشست‌های پایان‌یافته"><div className="space-y-2 opacity-80">{history.map(renderSession)}</div></ErpSection>}
          </>
        )}
      </div>

      <ErpSheet open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)} title={revokeTarget?.isCurrent ? 'خروج از نشست فعلی' : 'قطع دسترسی نشست'} presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setRevokeTarget(null)} /><ErpButton label={revokeTarget?.isCurrent ? 'خروج' : 'قطع دسترسی'} tone="danger" onClick={() => void revokeSession()} disabled={busy === 'revoke'} /></div>}><p className="text-sm leading-7 sds-text-muted">این نشست بلافاصله امکان ادامه کار را از دست می‌دهد. تاریخچه امنیتی آن حفظ می‌شود.</p></ErpSheet>
      <ErpSheet open={revokeOthersOpen} onClose={() => setRevokeOthersOpen(false)} title="قطع همه نشست‌های دیگر" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setRevokeOthersOpen(false)} /><ErpButton label="قطع نشست‌ها" tone="danger" onClick={() => void revokeOthers()} disabled={busy === 'others'} /></div>}><p className="text-sm leading-7 sds-text-muted">همه دستگاه‌ها به‌جز این نشست از حساب خارج می‌شوند.</p></ErpSheet>
      <ErpSheet open={notMineOpen} onClose={() => setNotMineOpen(false)} title="این ورود متعلق به شما نبود؟" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={() => setNotMineOpen(false)} /><ErpButton label="قطع نشست ناشناس" tone="danger" onClick={() => void resolveAlert('NOT_MINE')} disabled={busy === 'resolve'} /></div>}><div className="space-y-3 text-sm leading-7 sds-text-muted"><p>نشست مرتبط فوراً قطع و هشدار تعیین تکلیف می‌شود.</p><p className="font-bold text-[var(--sds-danger)]">پس از آن، تغییر رمز عبور قویاً توصیه می‌شود.</p></div></ErpSheet>
    </ErpWorkspacePage>
  );
}
