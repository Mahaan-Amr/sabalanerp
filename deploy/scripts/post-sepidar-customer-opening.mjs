import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { privateDirectoryReader } from './lib/customer-allocation-controller.mjs';
import { readSepidarOpeningEvidence } from './lib/sepidar-opening-controller.mjs';
import { postSepidarOpeningBatch } from './lib/sepidar-opening-posting.mjs';

const origin = 'https://sabalanerp.com';
let receipt;
try {
  const { values } = parseArgs({ options: {
    evidence: { type: 'string' }, approver: { type: 'string' }, 'approver-sha256': { type: 'string' },
    'qualification-sha256': { type: 'string' }, receipt: { type: 'string' }, apply: { type: 'boolean' },
  } });
  if (!values.receipt || !values.evidence || !values.approver) throw new Error('SEPIDAR_OPENING_POSTING_OPTIONS_REQUIRED');
  const token = readFileSync(0, 'utf8').trim();
  if (!/^[a-zA-Z0-9._~-]{20,3000}$/.test(token)) throw new Error('SEPIDAR_OPENING_ACCOUNTANT_SESSION_REQUIRED');
  const evidence = readSepidarOpeningEvidence(privateDirectoryReader(values.evidence), {
    approvalKeySha256: values['approver-sha256'], qualificationSha256: values['qualification-sha256'],
  }, privateDirectoryReader(values.approver));
  receipt = openSync(values.receipt, 'wx', 0o600);
  const record = row => {
    writeSync(receipt, JSON.stringify(row) + '\n');
    fsyncSync(receipt);
  };
  const result = await postSepidarOpeningBatch({
    evidence, record, apply: values.apply,
    request: (path, init) => fetch(origin + path, { ...init, redirect: 'error',
      headers: { cookie: 'sabalan_session=' + token, origin, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    }),
  });
  record({ status: 'SUMMARY', ...result });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  const message = /^SEPIDAR_OPENING_[A-Z_]+$/.test(error.message) ? error.message : 'SEPIDAR_OPENING_POSTING_UNVERIFIED';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
} finally {
  if (receipt !== undefined) closeSync(receipt);
}
