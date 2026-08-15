import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

const walk = async (directory) => {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relative = path.posix.join(directory.replaceAll('\\', '/'), entry.name);
    return entry.isDirectory() ? walk(relative) : [relative];
  }));
  return files.flat();
};

test('HR routes consume canonical field and feedback composition', async () => {
  const files = (await walk('frontend/src')).filter((file) => file.endsWith('.tsx'));
  const violations = [];
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    if (/\b(?:HrField|HrMessage|fieldClass)\b/.test(source) && source.includes('/features/hr/hrUi')) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
  const legacyHelperSource = await readFile(
    path.join(root, 'frontend/src/features/hr/hrUi.tsx'),
    'utf8',
  );
  assert.doesNotMatch(legacyHelperSource, /\b(?:HrField|HrMessage|fieldClass)\b/);
  const hiringDetail = await readFile(path.join(root, 'frontend/src/app/dashboard/hr/hiring/[id]/page.tsx'), 'utf8');
  assert.doesNotMatch(hiringDetail, /const\s+field\s*=|className=\{field\}/);
  assert.doesNotMatch(hiringDetail, /(?:window\.)?(?:prompt|confirm|alert)\s*\(/);
  assert.match(hiringDetail, /<ErpInlineState\s+kind="(?:error|success|stale)"/);
});

test('Users and Administration routes use explicit canonical interaction states', async () => {
  const roots = [
    'frontend/src/app/dashboard/users',
    'frontend/src/app/dashboard/hr/users',
    'frontend/src/app/dashboard/hr/permissions',
    'frontend/src/app/dashboard/admin',
  ];
  const files = (await Promise.all(roots.map(walk))).flat().filter((file) => file.endsWith('.tsx'));
  const violations = [];
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    if (/(?:window\.)?(?:prompt|confirm|alert)\s*\(/.test(source) || /sds-workspace-surface/.test(source) || /<(?:button|input|select|textarea)\b/.test(source)) violations.push(file);
  }
  assert.deepEqual(violations, []);
});

test('Recorded Logistics, public, applicant, confirmation, and residual routes use canonical composition', async () => {
  const roots = [
    'frontend/src/app/dashboard/logistics',
    'frontend/src/app/login',
    'frontend/src/app/register',
    'frontend/src/app/change-password',
    'frontend/src/app/apply',
    'frontend/src/app/contracts/confirm',
    'frontend/src/app/dashboard/bi',
    'frontend/src/app/dashboard/personal',
    'frontend/src/app/dashboard/support',
  ];
  const files = (await Promise.all(roots.map(walk))).flat().filter((file) => file.endsWith('.tsx'));
  files.push('frontend/src/app/page.tsx', 'frontend/src/app/about/page.tsx', 'frontend/src/app/contact/page.tsx', 'frontend/src/app/dashboard/personnel/page.tsx');
  const violations = [];
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    const applicantLocalComposition = file === 'frontend/src/app/apply/page.tsx' && /(?:const\s+inputClass\b|function\s+Field\b|<Field\b)/.test(source);
    if (/sds-workspace-surface/.test(source) || /<(?:button|input|select|textarea)\b/.test(source) || /(?:window\.)?(?:prompt|confirm|alert)\s*\(/.test(source) || applicantLocalComposition) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
});
