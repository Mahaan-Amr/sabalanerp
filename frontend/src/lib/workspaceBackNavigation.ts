export const WORKSPACE_HISTORY_KEY = 'sabalanWorkspaceHistory';

export type WorkspaceHistoryEntry = { current: string; previous: string | null };

// Only dashboard routes can be trusted as application navigation destinations.
function dashboardPath(path: string): URL | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  const url = new URL(path, 'http://workspace.local');
  return url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/') ? url : null;
}

export function workspaceRoot(path: string): string {
  const url = dashboardPath(path);
  if (!url) return '/dashboard';
  // The customer register can also be opened from Sales.
  if (url.pathname.startsWith('/dashboard/crm/') && (
    url.searchParams.get('workspace') === 'sales' || url.searchParams.get('partnerContract') === '1' || url.searchParams.get('returnTo') === 'contract'
  )) return '/dashboard/sales';
  const workspace = url.pathname.split('/')[2];
  return workspace ? `/dashboard/${workspace}` : '/dashboard';
}

export function workspaceBackDestination(current: string, entry: WorkspaceHistoryEntry | undefined, fallback: string) {
  const root = workspaceRoot(current);
  const previous = entry?.current === current ? entry.previous : null;
  if (previous && previous !== current && dashboardPath(previous) && workspaceRoot(previous) === root) {
    return { useHistory: true, href: previous };
  }
  // At a workspace landing page the declared parent is the main dashboard.
  return { useHistory: false, href: current.split('?')[0] === root && dashboardPath(fallback) ? fallback : root };
}

export function trackWorkspaceHistory(current: string, last: string | null, state: Record<string, unknown> | null) {
  const existing = state?.[WORKSPACE_HISTORY_KEY] as WorkspaceHistoryEntry | undefined;
  if (existing?.current === current) return existing;
  return { current, previous: last && dashboardPath(last) ? last : null };
}

export function installWorkspaceHistoryTracking(host: {
  history: Pick<History, 'state' | 'pushState' | 'replaceState'>;
  location: Pick<Location, 'href' | 'pathname' | 'search'>;
}) {
  const { history, location } = host;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const currentPath = () => `${location.pathname}${location.search}`;
  const initial = trackWorkspaceHistory(currentPath(), null, history.state);
  originalReplace.call(history, { ...history.state, [WORKSPACE_HISTORY_KEY]: initial }, '');
  let active = true;

  function record(data: any, url: string | URL | null | undefined, pushing: boolean) {
    if (!active || !data || typeof data !== 'object' || Array.isArray(data)) return data;
    const nextUrl = new URL(url?.toString() || location.href, location.href);
    const current = `${nextUrl.pathname}${nextUrl.search}`;
    const previousEntry = history.state?.[WORKSPACE_HISTORY_KEY] as WorkspaceHistoryEntry | undefined;
    // Replacing an entry must retain its actual predecessor, not the replaced page.
    const previous = pushing ? currentPath() : previousEntry?.current === currentPath() ? previousEntry.previous : null;
    return { ...data, [WORKSPACE_HISTORY_KEY]: { current, previous: previous && dashboardPath(previous) ? previous : null } };
  }
  const push: History['pushState'] = function (data, unused, url) {
    originalPush.call(history, record(data, url, true), unused, url);
  };
  const replace: History['replaceState'] = function (data, unused, url) {
    originalReplace.call(history, record(data, url, false), unused, url);
  };
  history.pushState = push;
  history.replaceState = replace;
  return () => {
    active = false;
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
