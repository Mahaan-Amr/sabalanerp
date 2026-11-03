import { WORKSPACE_HISTORY_KEY, type WorkspaceHistoryEntry } from '@/lib/workspaceBackNavigation';

const listHref = '/dashboard/purchasing/inquiries';
const parentKey = 'sabalanPurchasingInquiryParent';
export const inquiryHref = (id?: string | null) => id ? `${listHref}?document=${encodeURIComponent(id)}` : listHref;

function previousHref() {
  const current = `${window.location.pathname}${window.location.search}`;
  const entry = window.history.state?.[WORKSPACE_HISTORY_KEY] as WorkspaceHistoryEntry | undefined;
  const inquiry = window.history.state?.[parentKey];
  return entry?.current === current ? entry.previous : inquiry?.current === current ? inquiry.parent : null;
}

/** Give direct/bookmarked entry the same parents as list → case → item navigation.
 * Preserve Next's history state; do not intercept popstate or rewrite older visits.
 */
export function ensureInquiryHistory(id: string, parentId: string | null) {
  const current = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname !== listHref || new URLSearchParams(window.location.search).get('document') !== id) return;
  const parent = inquiryHref(parentId);
  if (previousHref() === parent) return;
  window.history.replaceState({ ...window.history.state, [parentKey]: null }, '', listHref);
  if (parentId) window.history.pushState({ ...window.history.state, [parentKey]: { current: parent, parent: listHref } }, '', parent);
  window.history.pushState({ ...window.history.state, [parentKey]: { current, parent } }, '', current);
}

export function hasInquiryParent(parentId?: string | null) {
  return previousHref() === inquiryHref(parentId);
}
