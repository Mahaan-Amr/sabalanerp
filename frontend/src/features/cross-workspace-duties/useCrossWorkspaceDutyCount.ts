'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  CROSS_WORKSPACE_DUTY_CHANGED_EVENT,
  requestCrossWorkspaceDutySummary,
} from './crossWorkspaceDutyApi';

export const useCrossWorkspaceDutyCount = (workspace: string | null) => {
  const { user } = useAuth();
  const [result, setResult] = useState<{ session: typeof user; workspace: string | null; count: number } | null>(null);

  useEffect(() => {
    if (!user || !workspace) return;
    let active = true;
    const refresh = async (changed = false) => {
      try {
        const { attention: count } = await requestCrossWorkspaceDutySummary(user, workspace, changed);
        if (active) setResult({ session: user, workspace, count });
      } catch {
        // Preserve the last successful count for this session during transient failures.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onChange = () => void refresh(true);
    const onFocus = () => void refresh();
    window.addEventListener(CROSS_WORKSPACE_DUTY_CHANGED_EVENT, onChange);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(CROSS_WORKSPACE_DUTY_CHANGED_EVENT, onChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, workspace]);

  return user && result?.session === user && result.workspace === workspace ? result.count : 0;
};
