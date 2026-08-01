import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repositoryRoot, 'scripts', 'design-system-adoption.mjs');
const readRepositoryFile = (relativePath) =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const writeFixture = (root, relativePath, content) => {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
};

const writeManifestFixture = (root, {
  rules,
  surfaces = [],
  implementationBoundaries = [],
  exceptions = []
}) => writeFixture(
  root,
  'docs/design-system/migration-manifest.json',
  JSON.stringify({ version: 1, rules, surfaces, implementationBoundaries, exceptions })
);

const runCli = (root, ...args) => spawnSync(
  process.execPath,
  [cliPath, ...args, '--root', root],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

const runGit = (root, ...args) => spawnSync(
  'git',
  args,
  { cwd: root, encoding: 'utf8' }
);

test('report classifies every interactive route through the migration manifest', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-report-'));

  try {
    writeFixture(
      fixtureRoot,
      'frontend/src/app/dashboard/security/page.tsx',
      'export default function GuardPage() { return <main>Guard</main>; }\n'
    );
    writeFixture(
      fixtureRoot,
      'frontend/src/app/login/page.tsx',
      'export default function LoginPage() { return <main>Login</main>; }\n'
    );
    writeFixture(
      fixtureRoot,
      'frontend/src/app/page.tsx',
      'export default function HomePage() { return <main>Home</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/dashboard/security/**/page.tsx',
          status: 'reference',
          acceptanceStatus: 'accepted-reference',
          reason: 'Guard is a reference implementation.'
        },
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ]
    });

    const result = runCli(fixtureRoot, 'report', '--format', 'json');

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(
      report.routes.map(({ route, status }) => ({ route, status })),
      [
        { route: '/dashboard/security', status: 'reference' },
        { route: '/login', status: 'legacy' },
        { route: '/', status: 'legacy' }
      ]
    );
    assert.equal(report.unclassifiedRoutes.length, 0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('repository instructions make design-system discovery and enforcement automatic', () => {
  const agentInstructions = readRepositoryFile('AGENTS.md');
  const catalog = readRepositoryFile('docs/design-system/catalog.md');
  const hook = readRepositoryFile('.githooks/pre-commit');
  const packageJson = JSON.parse(readRepositoryFile('package.json'));

  assert.match(agentInstructions, /docs\/design-system\/catalog\.md/);
  assert.match(agentInstructions, /npm run design-system:check/);
  assert.match(agentInstructions, /permissions, calculations, persisted meaning, recovery, and audit history/);
  assert.match(catalog, /@\/components\/erp/);
  assert.match(catalog, /44px/);
  assert.match(catalog, /390px/);
  assert.match(catalog, /Generated PDFs, Excel exports, emails, and print templates/);
  assert.match(hook, /npm run design-system:check/);
  assert.match(hook, /npm run test:design-system-foundation/);
  assert.equal(packageJson.scripts.prepare, 'node scripts/setup-git-hooks.mjs');
});

test('check permits baselined legacy debt and rejects a new changed-file violation', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-check-'));
  const pagePath = 'frontend/src/app/legacy/page.tsx';
  const baselinePath = 'docs/design-system/adoption-baseline.json';

  try {
    writeFixture(
      fixtureRoot,
      pagePath,
      [
        'export default function LegacyPage() {',
        '  return <button className="glass-liquid-btn text-[#074747]">ذخیره</button>;',
        '}',
        ''
      ].join('\n')
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ]
    });

    const baseline = runCli(
      fixtureRoot,
      'baseline',
      '--output',
      baselinePath
    );
    assert.equal(baseline.status, 0, baseline.stderr);

    const unchanged = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--files',
      pagePath
    );
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.match(unchanged.stdout, /No new Sabalan Design System adoption violations/);

    writeFixture(
      fixtureRoot,
      pagePath,
      [
        'export default function LegacyPage() {',
        '  return <div>',
        '    <button className="glass-liquid-btn text-[#074747]">ذخیره</button>',
        '    <button className="bg-red-600 bg-stone-950 text-white border-black/50" style={{ color: "rgb(220, 38, 38)" }}>حذف</button>',
        '    <div onClick={() => alert("legacy")}>عملیات</div>',
        '  </div>;',
        '}',
        ''
      ].join('\n')
    );

    const changed = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--files',
      pagePath
    );
    assert.equal(changed.status, 1, changed.stdout);
    assert.match(changed.stderr, /hardcoded-semantic-color/);
    assert.match(changed.stderr, /bg-red-600/);
    assert.match(changed.stderr, /bg-stone-950/);
    assert.match(changed.stderr, /text-white/);
    assert.match(changed.stderr, /border-black\/50/);
    assert.match(changed.stderr, /rgb\(220, 38, 38\)/);
    assert.match(changed.stderr, /raw-control-risk/);
    assert.match(changed.stderr, /inaccessible-control-risk/);
    assert.match(changed.stderr, /<div onClick/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('repository manifest classifies every current interactive route', () => {
  const result = runCli(repositoryRoot, 'report', '--format', 'json');

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.routes.length > 0);
  assert.deepEqual(report.unclassifiedRoutes, []);
  assert.equal(
    report.routes.find(({ route }) => route === '/dashboard/security')?.status,
    'reference'
  );
  assert.equal(
    report.routes.find(({ route }) => route === '/dashboard/sales/contracts/create')?.status,
    'migrated'
  );
  assert.equal(
    report.routes.find(({ route }) => route === '/login')?.status,
    'migrated'
  );
  assert.deepEqual(report.routes.filter(({ status }) => status === 'legacy'), []);
  const contractCreationSurface = report.surfaces.find(({ id }) => id === 'contract-creation');
  assert.equal(contractCreationSurface?.status, 'migrated');
  assert.equal(contractCreationSurface?.acceptanceStatus, 'accepted');
  assert.ok(
    contractCreationSurface?.files.includes(
      'frontend/src/features/contract-creation/CreateContractWizardClient.tsx'
    )
  );
  assert.ok(
    report.consumerInventory.shared.some(
      ({ file }) => file === 'frontend/src/app/dashboard/security/page.tsx'
    )
  );
  assert.equal(
    report.consumerInventory.legacy.some(
      ({ interface: interfaceName }) => interfaceName === 'glass-liquid'
    ),
    false
  );
  assert.deepEqual(report.debtSummary, {});
});

test('check discovers changed adoption files from git when files are not supplied', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-git-check-'));
  const pagePath = 'frontend/src/app/example/page.tsx';
  const baselinePath = 'docs/design-system/adoption-baseline.json';

  try {
    writeFixture(
      fixtureRoot,
      pagePath,
      'export default function ExamplePage() { return <main>نمونه</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ]
    });
    assert.equal(runGit(fixtureRoot, 'init').status, 0);
    assert.equal(runGit(fixtureRoot, 'config', 'user.name', 'Design System Test').status, 0);
    assert.equal(runGit(fixtureRoot, 'config', 'user.email', 'design-system@example.test').status, 0);
    assert.equal(
      runCli(fixtureRoot, 'baseline', '--output', baselinePath).status,
      0
    );
    assert.equal(runGit(fixtureRoot, 'add', '.').status, 0);
    assert.equal(runGit(fixtureRoot, 'commit', '-m', 'baseline').status, 0);

    const unchanged = runCli(fixtureRoot, 'check', '--baseline', baselinePath, '--changed');
    assert.equal(unchanged.status, 0, unchanged.stderr);

    writeFixture(
      fixtureRoot,
      pagePath,
      'export default function ExamplePage() { return <button className="text-[#dc2626]">حذف</button>; }\n'
    );
    assert.equal(
      runCli(fixtureRoot, 'baseline', '--output', baselinePath).status,
      0
    );

    const changed = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--base',
      'HEAD',
      '--changed'
    );
    assert.equal(changed.status, 1, changed.stdout);
    assert.match(changed.stderr, new RegExp(pagePath.replaceAll('/', '[\\\\/]')));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('changed-file checks stay scoped to frontend adoption sources', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-scope-'));
  const pagePath = 'frontend/src/app/example/page.tsx';
  const baselinePath = 'docs/design-system/adoption-baseline.json';

  try {
    writeFixture(
      fixtureRoot,
      pagePath,
      'export default function ExamplePage() { return <main>نمونه</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ]
    });
    assert.equal(runGit(fixtureRoot, 'init').status, 0);
    assert.equal(runGit(fixtureRoot, 'config', 'user.name', 'Design System Test').status, 0);
    assert.equal(runGit(fixtureRoot, 'config', 'user.email', 'design-system@example.test').status, 0);
    assert.equal(runCli(fixtureRoot, 'baseline', '--output', baselinePath).status, 0);
    assert.equal(runGit(fixtureRoot, 'add', '.').status, 0);
    assert.equal(runGit(fixtureRoot, 'commit', '-m', 'baseline').status, 0);

    writeFixture(
      fixtureRoot,
      'backend/src/report.ts',
      'export const reportStyles = "background:#dc2626;color:#ffffff";\n'
    );

    const changed = runCli(fixtureRoot, 'check', '--baseline', baselinePath, '--changed');
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /No new Sabalan Design System adoption violations/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('exceptions permit only an accountable signature and bounded allowance', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-exception-'));
  const pagePath = 'frontend/src/app/example/page.tsx';
  const baselinePath = 'docs/design-system/adoption-baseline.json';

  try {
    writeFixture(
      fixtureRoot,
      pagePath,
      'export default function ExamplePage() { return <main>نمونه</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ],
      exceptions: [
        {
          file: pagePath,
          category: 'hardcoded-semantic-color',
          signature: 'bg-red-600',
          allowance: 1,
          reason: 'The canonical destructive action is not implemented yet.',
          owner: 'Design System',
          accessibilityEvidence: 'The action also has a Persian text label.',
          themeEvidence: 'The temporary color was checked in both themes.',
          resolution: 'Remove when the canonical destructive action lands.'
        }
      ]
    });
    assert.equal(
      runCli(fixtureRoot, 'baseline', '--output', baselinePath).status,
      0
    );

    writeFixture(
      fixtureRoot,
      pagePath,
      'export default function ExamplePage() { return <button className="bg-red-600">حذف</button>; }\n'
    );
    const withinAllowance = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--files',
      pagePath
    );
    assert.equal(withinAllowance.status, 1);
    assert.doesNotMatch(withinAllowance.stderr, /hardcoded-semantic-color/);
    assert.match(withinAllowance.stderr, /raw-control-risk/);
    assert.equal(
      runCli(fixtureRoot, 'baseline', '--output', baselinePath).status,
      0
    );

    writeFixture(
      fixtureRoot,
      pagePath,
      [
        'export default function ExamplePage() {',
        '  return <><button className="bg-red-600">حذف</button><button className="bg-red-600">رد</button></>;',
        '}',
        ''
      ].join('\n')
    );
    const beyondAllowance = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--files',
      pagePath
    );
    assert.equal(beyondAllowance.status, 1);
    assert.match(beyondAllowance.stderr, /hardcoded-semantic-color added 1 × bg-red-600/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('report fails when an interactive route is unclassified', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-unclassified-'));

  try {
    writeFixture(
      fixtureRoot,
      'frontend/src/app/login/page.tsx',
      'export default function LoginPage() { return <main>Login</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/dashboard/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Only dashboard routes are covered.'
        }
      ]
    });

    const result = runCli(fixtureRoot, 'report');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unclassified interactive route: \/login/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('first adoption baseline can bootstrap when the target branch has none', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-bootstrap-'));
  const baselinePath = 'docs/design-system/adoption-baseline.json';

  try {
    writeFixture(
      fixtureRoot,
      'frontend/src/app/legacy/page.tsx',
      'export default function LegacyPage() { return <button className="bg-red-600">قدیمی</button>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ]
    });
    assert.equal(runGit(fixtureRoot, 'init').status, 0);
    assert.equal(runGit(fixtureRoot, 'config', 'user.name', 'Design System Test').status, 0);
    assert.equal(runGit(fixtureRoot, 'config', 'user.email', 'design-system@example.test').status, 0);
    assert.equal(runGit(fixtureRoot, 'add', '.').status, 0);
    assert.equal(runGit(fixtureRoot, 'commit', '-m', 'before adoption baseline').status, 0);
    assert.equal(
      runCli(fixtureRoot, 'baseline', '--output', baselinePath).status,
      0
    );

    const result = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--base',
      'HEAD',
      '--changed'
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bootstrapping target-branch adoption baseline/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('report rejects reference surfaces that do not resolve to real files', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-surface-'));

  try {
    writeFixture(
      fixtureRoot,
      'frontend/src/app/page.tsx',
      'export default function HomePage() { return <main>Home</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ],
      surfaces: [
        {
          id: 'missing-reference',
          status: 'reference',
          acceptanceStatus: 'accepted-reference',
          reason: 'This declaration is intentionally broken.',
          files: ['frontend/src/features/missing/**']
        }
      ]
    });

    const result = runCli(fixtureRoot, 'report');

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Surface missing-reference pattern matches no files/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('implementation boundaries allow palette adapters and declared modules without weakening callers', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-boundary-'));
  const canonicalPath = 'frontend/src/components/design-system/Button.tsx';
  const callerPath = 'frontend/src/app/example/page.tsx';
  const baselinePath = 'docs/design-system/adoption-baseline.json';

  try {
    writeFixture(fixtureRoot, canonicalPath, 'export {};\n');
    writeFixture(
      fixtureRoot,
      callerPath,
      'export default function ExamplePage() { return <main>نمونه</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ],
      implementationBoundaries: [
        {
          id: 'canonical-design-system',
          files: ['frontend/src/components/design-system/**'],
          allowedCategories: [
            'hardcoded-semantic-color',
            'duplicate-primitive-risk',
            'raw-control-risk'
          ],
          reason: 'Canonical modules implement the semantic interface.',
          owner: 'Design System'
        }
      ]
    });
    assert.equal(
      runCli(fixtureRoot, 'baseline', '--output', baselinePath).status,
      0
    );

    const moduleSource = [
      'export function PrimaryButton() {',
      '  return <button className="bg-teal-700 text-white">ذخیره</button>;',
      '}',
      ''
    ].join('\n');
    writeFixture(fixtureRoot, canonicalPath, moduleSource);
    writeFixture(fixtureRoot, callerPath, moduleSource);

    const canonical = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--files',
      canonicalPath
    );
    assert.equal(canonical.status, 0, canonical.stderr);
    assert.match(canonical.stdout, /No new Sabalan Design System adoption violations/);

    const caller = runCli(
      fixtureRoot,
      'check',
      '--baseline',
      baselinePath,
      '--files',
      callerPath
    );
    assert.equal(caller.status, 1);
    assert.match(caller.stderr, /hardcoded-semantic-color/);
    assert.match(caller.stderr, /duplicate-primitive-risk/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('implementation boundaries reject patterns that can cover feature callers', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sabalan-design-system-broad-boundary-'));

  try {
    writeFixture(
      fixtureRoot,
      'frontend/src/app/example/page.tsx',
      'export default function ExamplePage() { return <main>Example</main>; }\n'
    );
    writeManifestFixture(fixtureRoot, {
      rules: [
        {
          pattern: 'frontend/src/app/**/page.tsx',
          status: 'legacy',
          acceptanceStatus: 'not-started',
          reason: 'Unmigrated routes remain supported.'
        }
      ],
      implementationBoundaries: [
        {
          id: 'too-broad',
          files: ['frontend/src/**'],
          allowedCategories: ['hardcoded-semantic-color'],
          reason: 'This must not suppress caller findings.',
          owner: 'Design System'
        }
      ]
    });

    const result = runCli(fixtureRoot, 'report');

    assert.equal(result.status, 2);
    assert.match(result.stderr, /is not a canonical implementation path/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
