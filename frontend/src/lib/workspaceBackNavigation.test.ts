import assert from 'node:assert/strict';
import test from 'node:test';
import { installWorkspaceHistoryTracking, trackWorkspaceHistory, workspaceBackDestination, WORKSPACE_HISTORY_KEY } from './workspaceBackNavigation';

test('direct entry, login, cross-workspace and stale history fall back to the workspace dashboard', () => {
  const current = '/dashboard/crm/customers/customer';
  for (const previous of [null, '/login', '/dashboard/accounting', '//example.com/dashboard/crm', '/dashboard/crm-fake']) {
    assert.deepEqual(workspaceBackDestination(current, { current, previous }, '/dashboard/crm/customers'), { useHistory: false, href: '/dashboard/crm' });
  }
  assert.equal(workspaceBackDestination(current, { current: '/dashboard/crm/customers/old', previous: '/dashboard/crm' }, '/dashboard/crm/customers').useHistory, false);
});

test('valid in-workspace history retains filters and explicit workspace landing parents', () => {
  const current = '/dashboard/hr/personnel/one';
  assert.deepEqual(workspaceBackDestination(current, { current, previous: '/dashboard/hr/personnel?search=نام' }, '/dashboard/hr'), { useHistory: true, href: '/dashboard/hr/personnel?search=نام' });
  assert.deepEqual(workspaceBackDestination('/dashboard/accounting', undefined, '/dashboard'), { useHistory: false, href: '/dashboard' });
  assert.equal(workspaceBackDestination('/dashboard/crm/customers?workspace=sales', undefined, '/dashboard/crm').href, '/dashboard/sales');
  assert.equal(workspaceBackDestination('/dashboard/crm/customers/create?returnTo=contract&step=2', undefined, '/dashboard/crm').href, '/dashboard/sales');
});

test('push and replace track the actual browser predecessor and preserve Next route state', () => {
  let url = new URL('http://workspace.local/dashboard/crm');
  let state: any = { __NA: true, tree: ['original'] };
  const history = {
    get state() { return state; },
    pushState(data: any, _unused: string, path?: string | URL | null) { state = data; if (path) url = new URL(path, url); },
    replaceState(data: any, _unused: string, path?: string | URL | null) { state = data; if (path) url = new URL(path, url); },
  };
  const location = { get href() { return url.href; }, get pathname() { return url.pathname; }, get search() { return url.search; } };
  const dispose = installWorkspaceHistoryTracking({ history, location });
  history.pushState({ __NA: true, tree: ['customer'] }, '', '/dashboard/crm/customers/one');
  assert.deepEqual(state[WORKSPACE_HISTORY_KEY], { current: '/dashboard/crm/customers/one', previous: '/dashboard/crm' });
  history.replaceState({ __NA: true, tree: ['replacement'] }, '', '/dashboard/crm/customers/two?search=a%20b');
  assert.deepEqual(state[WORKSPACE_HISTORY_KEY], { current: '/dashboard/crm/customers/two?search=a%20b', previous: '/dashboard/crm' });
  assert.deepEqual(state.tree, ['replacement']);
  dispose();
});

test('route tracking preserves entries when reloading or traversing browser history', () => {
  assert.deepEqual(trackWorkspaceHistory('/dashboard/crm', null, {}), { current: '/dashboard/crm', previous: null });
  const entry = { current: '/dashboard/crm/customers', previous: '/dashboard/crm' };
  assert.deepEqual(trackWorkspaceHistory(entry.current, '/dashboard', { [WORKSPACE_HISTORY_KEY]: entry }), entry);
  assert.deepEqual(trackWorkspaceHistory('/dashboard/crm/customers/one', entry.current, {}), { current: '/dashboard/crm/customers/one', previous: entry.current });
});
