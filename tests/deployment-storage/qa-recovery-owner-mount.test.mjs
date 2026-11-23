import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateQaRenderedMounts } from '../../deploy/scripts/qa-rehearsal-target.mjs';
import { withQaOwnerKeyUid } from './qa-fixtures.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-recovery-mount-'));
  const qaRoot = path.join(root, 'qa');
  const repositoryRoot = path.join(root, 'repository');
  const secret = path.join(qaRoot, 'secrets');
  fs.mkdirSync(secret, { recursive: true }); fs.mkdirSync(repositoryRoot);
  const trust = path.join(secret, 'partner-release-trust-public.der');
  const publicKey = path.join(secret, 'system-recovery-owner-public.pem');
  fs.writeFileSync(trust, 'QA public trust');
  fs.writeFileSync(publicKey, '-----BEGIN PUBLIC KEY-----\nQA-public-fixture\n-----END PUBLIC KEY-----\n');
  fs.chmodSync(publicKey, 0o444);
  const names = {
    '/app/storage/contracts': 'backend_storage_contracts', '/app/storage/hr-hiring': 'backend_storage_hr_hiring',
    '/app/storage/accounting-contracts': 'backend_storage_accounting_contracts', '/app/storage/dispatch-documents': 'backend_storage_dispatch_documents',
    '/app/storage/support-tickets': 'backend_storage_support_tickets', '/app/storage/performance-exports': 'backend_storage_performance_exports',
    '/app/uploads': 'backend_uploads', '/app/storage/recovery': 'backend_recovery', '/app/recovery-coordination': 'recovery_coordination',
    '/app/recovery-sources/inquiry': 'inquiry_data',
  };
  const volumes = Object.entries(names).map(([target, source]) => ({ type: 'volume', target, source }));
  volumes.push({ type: 'bind', target: '/run/deployment-secrets/partner-release-trust-public.der', source: trust, read_only: true });
  const recovery = { type: 'bind', target: '/run/deployment-secrets/system-recovery-owner-public.pem', source: publicKey, read_only: true };
  volumes.push(recovery);
  return { root, config: { services: { backend: { volumes } } }, recovery, publicKey,
    options: { qaRoot, repositoryRoot, environment: { DEPLOYMENT_SECRET_DIR: secret } } };
}

test('both QA graphs permit exactly the read-only public owner key beneath QA custody', () => {
  const value = fixture();
  try {
    withQaOwnerKeyUid(value.publicKey, 0, () => {
      for (const scannerRetained of [true, false]) {
        assert.doesNotThrow(() => validateQaRenderedMounts(value.config, { ...value.options, scannerRetained }));
      }
      value.recovery.read_only = false;
      assert.throws(() => validateQaRenderedMounts(value.config, value.options));
    });
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('QA custody refuses a read-only public owner key owned by an unprivileged user', () => {
  const value = fixture();
  try {
    withQaOwnerKeyUid(value.publicKey, 1001, () => {
      assert.throws(() => validateQaRenderedMounts(value.config, value.options), { actual: 1001, expected: 0 });
    });
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('a private key, directory, foreign bind or additional private-key mount is refused', () => {
  const value = fixture();
  try {
    withQaOwnerKeyUid(value.publicKey, 0, () => {
      fs.chmodSync(value.publicKey, 0o666);
      fs.writeFileSync(value.publicKey, '-----BEGIN PRIVATE KEY-----\nprivate-fixture\n-----END PRIVATE KEY-----\n');
      fs.chmodSync(value.publicKey, 0o444);
      assert.throws(() => validateQaRenderedMounts(value.config, value.options));
      fs.chmodSync(value.publicKey, 0o666); fs.rmSync(value.publicKey); fs.mkdirSync(value.publicKey);
      assert.throws(() => validateQaRenderedMounts(value.config, value.options));
      fs.rmSync(value.publicKey, { recursive: true }); fs.writeFileSync(value.publicKey, '-----BEGIN PUBLIC KEY-----\nfixture\n');
      const original = value.recovery.source;
      value.recovery.source = path.join(value.root, 'production-owner-private.pem');
      assert.throws(() => validateQaRenderedMounts(value.config, value.options));
      value.recovery.source = original;
      value.config.services.backend.volumes.push({ type: 'bind', read_only: true,
        target: '/run/deployment-secrets/system-recovery-owner-private.pem', source: original });
      assert.throws(() => validateQaRenderedMounts(value.config, value.options));
    });
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
