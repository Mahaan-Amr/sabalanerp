'use client';

import { useState } from 'react';
import { FaUserCheck } from 'react-icons/fa';
import { ErpButton, ErpInlineState, ErpSheet, ErpTextarea } from '@/components/erp';
import { announceCrossWorkspaceDutyChanged, type CrossWorkspaceDuty } from '@/features/cross-workspace-duties/crossWorkspaceDutyApi';
import { dutyClaimFailureMessage } from '@/features/cross-workspace-duties/dutyQueuePresentation';
import { hrDutyApi } from './hrDutyApi';

export function DestinationDutyClaimAction({
  duty,
  disabled = false,
  onClaimed,
}: {
  duty: CrossWorkspaceDuty;
  disabled?: boolean;
  onClaimed: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (duty.access !== 'AVAILABLE') return null;

  const claim = async (overrideReason: string | null) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await hrDutyApi.claim(duty.id, overrideReason);
      announceCrossWorkspaceDutyChanged();
      setOverrideOpen(false);
      setReason('');
      await onClaimed();
    } catch (requestError) {
      setError(dutyClaimFailureMessage(requestError));
    } finally {
      setPending(false);
    }
  };

  const requestClaim = () => {
    setError(null);
    if (duty.claimRequiresReason) setOverrideOpen(true);
    else void claim(null);
  };

  return (
    <>
      {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: requestClaim }} />}
      <ErpButton
        label={pending ? 'در حال دریافت…' : duty.claimRequiresReason ? 'دریافت با دسترسی مدیر سیستم' : 'دریافت وظیفه'}
        icon={FaUserCheck}
        tone={duty.claimRequiresReason ? 'warning' : 'success'}
        variant="solid"
        disabled={disabled || pending}
        onClick={requestClaim}
      />
      <ErpSheet
        open={overrideOpen}
        onClose={() => { if (!pending) setOverrideOpen(false); }}
        title="دریافت با دسترسی مدیر سیستم"
        presentation="modal"
        pending={pending}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={() => setOverrideOpen(false)} />
            <ErpButton
              label={pending ? 'در حال ثبت…' : 'ثبت دلیل و دریافت'}
              tone="warning"
              variant="solid"
              disabled={pending || reason.trim().length < 3}
              onClick={() => void claim(reason.trim())}
            />
          </div>
        )}
      >
        <p className="sds-text-secondary text-sm leading-7">
          این درخواست را خود شما ثبت کرده‌اید. برای عبور کنترل‌شده از تفکیک وظایف، دلیل اقدام مدیر سیستم در تاریخچه دائمی ثبت می‌شود.
        </p>
        <label className="sds-text-secondary mt-4 block text-sm font-semibold" htmlFor={`duty-override-reason-${duty.id}`}>
          دلیل اقدام مدیر سیستم
        </label>
        <ErpTextarea
          id={`duty-override-reason-${duty.id}`}
          className="mt-2"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
        />
      </ErpSheet>
    </>
  );
}
