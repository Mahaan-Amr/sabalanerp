'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErpInlineState } from '@/components/erp';

export function useSmsSuccess() {
  const [sequence, setSequence] = useState(0);
  const [visible, setVisible] = useState(false);
  const show = useCallback(() => { setVisible(true); setSequence(value => value + 1); }, []);
  useEffect(() => {
    if (!sequence) return;
    const timer = window.setTimeout(() => setVisible(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [sequence]);
  return { show, feedback: visible ? <ErpInlineState kind="success" title="پیامک با موفقیت ارسال شد ✨"
    className="fixed bottom-6 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2" /> : null };
}
