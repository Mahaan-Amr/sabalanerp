import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwnerScopedBrowserStorage } from './ownerScopedBrowserStorage';

test('navigation drafts survive for their owner without adopting another account or legacy bytes', () => {
  const values = new Map<string, string>([['contractWizardState', '{"private":"legacy"}']]);
  const backing = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let owner: string | undefined = 'seller-a';
  const storage = createOwnerScopedBrowserStorage(backing, () => owner, 'contract-navigation');
  assert.equal(storage.getItem('contractWizardState'), null);
  storage.setItem('contractWizardState', '{"amount":"125000.25","quantity":"3.50"}');
  owner = 'seller-b';
  assert.equal(storage.getItem('contractWizardState'), null);
  storage.removeItem('contractWizardState');
  storage.setItem('contractWizardState', '{"amount":"900"}');
  owner = undefined;
  assert.equal(storage.getItem('contractWizardState'), null);
  assert.throws(() => storage.setItem('contractWizardState', '{}'), /BROWSER_DRAFT_OWNER_REQUIRED/);
  owner = 'seller-a';
  assert.equal(storage.getItem('contractWizardState'), '{"amount":"125000.25","quantity":"3.50"}');
  storage.removeItem('contractWizardState');
  assert.equal(values.get('contractWizardState'), '{"private":"legacy"}');
  owner = 'seller-b';
  assert.equal(storage.getItem('contractWizardState'), '{"amount":"900"}');
});

test('unknown envelopes and unverified writes cannot authorize leaving the form', () => {
  const values = new Map<string, string>();
  const backing = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const storage = createOwnerScopedBrowserStorage(backing, () => 'seller-a', 'contract-navigation');
  storage.setItem('contractWizardState', 'original');
  const destination = [...values.keys()][0];
  values.set(destination, '{"format":"future-unknown","value":"keep"}');
  assert.equal(storage.getItem('contractWizardState'), null);
  assert.throws(() => storage.setItem('contractWizardState', 'replacement'), /BROWSER_DRAFT_EXISTING_VALUE_UNKNOWN/);
  storage.removeItem('contractWizardState');
  assert.equal(values.get(destination), '{"format":"future-unknown","value":"keep"}');
  const unwritable = createOwnerScopedBrowserStorage({ ...backing, setItem() {} }, () => 'seller-a', 'contract-navigation');
  assert.throws(() => unwritable.setItem('other-draft', 'new'), /BROWSER_DRAFT_WRITE_UNVERIFIED/);
  let owner: string | undefined = 'seller-a';
  const switched = createOwnerScopedBrowserStorage({ ...backing,
    setItem(key, value) { backing.setItem(key, value); owner = 'seller-b'; } }, () => owner, 'contract-navigation');
  assert.throws(() => switched.setItem('another-draft', 'owner-a-only'), /BROWSER_DRAFT_WRITE_UNVERIFIED/);
  assert.equal(switched.getItem('another-draft'), null);
});
