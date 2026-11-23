import { useEffect, useLayoutEffect, useMemo } from 'react';
import api, { browserSessionContinuation } from '@/lib/api';
import { bindActorRequests } from '@/lib/actorScopedHttp';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The caller keys its private render tree by actor and effective scope. */
export function useActorScopedHttp(userId: string) {
  const scope = useMemo(() => {
    const lifetime = { active: true, generation: 0 };
    const http = bindActorRequests(api, userId, () => {
      const browserOwner = browserSessionContinuation.expectedUserId();
      return lifetime.active && (!browserOwner || browserOwner === userId) ? lifetime.generation : undefined;
    });
    return { lifetime, http };
  }, [userId]);
  useBrowserLayoutEffect(() => {
    scope.lifetime.active = true;
    return () => {
      scope.lifetime.active = false;
      scope.lifetime.generation++;
    };
  }, [scope]);
  return scope.http;
}
