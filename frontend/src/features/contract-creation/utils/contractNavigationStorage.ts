import { browserSessionContinuation } from '../../../lib/api';
import { createOwnerScopedBrowserStorage, type BrowserDraftStorage } from '../../../lib/ownerScopedBrowserStorage';

const current = (navigation: boolean) => createOwnerScopedBrowserStorage(navigation ? window.sessionStorage : window.localStorage,
  () => browserSessionContinuation.snapshot() === null ? browserSessionContinuation.expectedUserId() : undefined,
  navigation ? 'contract-navigation' : 'contract-autosave');

/** Lazy browser-only access: no storage or owner is captured during SSR. */
export const contractNavigationStorage: BrowserDraftStorage = {
  getItem: key => current(true).getItem(key),
  setItem: (key, value) => current(true).setItem(key, value),
  removeItem: key => current(true).removeItem(key),
};

export const contractAutosaveStorage: BrowserDraftStorage = {
  getItem: key => current(false).getItem(key),
  setItem: (key, value) => current(false).setItem(key, value),
  removeItem: key => current(false).removeItem(key),
};
