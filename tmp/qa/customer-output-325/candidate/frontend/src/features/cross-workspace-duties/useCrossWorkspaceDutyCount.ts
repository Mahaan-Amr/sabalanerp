'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CROSS_WORKSPACE_DUTY_CHANGED_EVENT,
  crossWorkspaceDutyApi,
} from './crossWorkspaceDutyApi';

export const useCrossWorkspaceDutyCount = (workspace: string | null) => {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!workspace) {
      setCount(0);
      return;
    }
    try {
      const response = await crossWorkspaceDutyApi.summary(workspace);
      setCount(response.data.data.attention);
    } catch {
      // Preserve the last successful count during transient failures.
    }
  }, [workspace]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onChange = () => void refresh();
    window.addEventListener(CROSS_WORKSPACE_DUTY_CHANGED_EVENT, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(CROSS_WORKSPACE_DUTY_CHANGED_EVENT, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [refresh]);

  return count;
};
