import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROUTE_ROOT = 'frontend/src/app';
const DEFAULT_MANIFEST = 'docs/design-system/migration-manifest.json';
const DEFAULT_BASELINE = 'docs/design-system/adoption-baseline.json';
const ROUTE_STATUSES = new Set(['reference', 'migrated', 'legacy', 'exempt']);
const ADOPTION_EXTENSIONS = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);
const FINDING_PATTERNS = [
  {
    category: 'hardcoded-semantic-color',
    expression: /#[\da-fA-F]{3,8}\b/g
  },
  {
    category: 'hardcoded-semantic-color',
    expression: /\b(?:accent|bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:amber|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|yellow|zinc)-\d{2,3}(?:\/\d+)?\b/g
  },
  {
    category: 'hardcoded-semantic-color',
    expression: /\b(?:accent|bg|border|fill|from|outline|ring|shadow|stroke|text|to|via)-(?:black|white)(?:\/\d+)?\b/g
  },
  {
    category: 'hardcoded-semantic-color',
    expression: /\b(?:hsl|hsla|rgb|rgba)\([^)]*\)/g
  },
  {
    category: 'legacy-glass-style',
    expression: /\bglass-liquid-[\w-]+\b/g
  },
  {
    category: 'duplicate-primitive-risk',
    expression: /\b(?:export\s+)?(?:function|const)\s+([A-Z][\w]*(?:Button|Card|Dialog|Field|Input|Modal|SegmentedControl|Sheet|Switch))\b/g,
    signature: (match) => match[1]
  },
  {
    category: 'raw-control-risk',
    expression: /<(button|input|select|textarea)\b/g,
    signature: (match) => `<${match[1]}`
  },
  {
    category: 'inaccessible-control-risk',
    expression: /<(div|span|li)\b[^>]*\bonClick\s*=/g,
    signature: (match) => `<${match[1]} onClick`
  }
];
const SHARED_CONSUMER_PATTERNS = [
  {
    interface: 'erp',
    expression: /from\s+['"]@\/components\/erp(?:\/[^'"]*)?['"]/
  }
];
const LEGACY_CONSUMER_PATTERNS = [
  {
    interface: 'glass-liquid',
    expression: /\bglass-liquid-[\w-]+\b/
  },
  {
    interface: 'hr-ui',
    expression: /from\s+['"]@\/features\/hr\/hrUi['"]/
  },
  {
    interface: 'accounting-ui',
    expression: /from\s+['"]@\/features\/accounting\/accountingUi['"]/
  }
];
const FINDING_CATEGORIES = new Set(FINDING_PATTERNS.map(({ category }) => category));
const CANONICAL_IMPLEMENTATION_ROOTS = [
  'frontend/src/components/erp/',
  'frontend/src/components/design-system/'
];
const CANONICAL_IMPLEMENTATION_FILES = new Set([
  'frontend/src/styles/design-system-tokens.css'
]);

const normalizePath = (value) => value.replace(/\\/g, '/');

const isCanonicalImplementationPattern = (pattern) => {
  const normalized = normalizePath(pattern);
  return (
    !normalized.includes('..')
    && (
      CANONICAL_IMPLEMENTATION_FILES.has(normalized)
      || CANONICAL_IMPLEMENTATION_ROOTS.some((root) => normalized.startsWith(root))
    )
  );
};

const readOption = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const readListOption = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0) return [];
  const values = [];
  for (let cursor = index + 1; cursor < args.length; cursor += 1) {
    if (args[cursor].startsWith('--')) break;
    values.push(args[cursor]);
  }
  return values;
};

const globToRegExp = (pattern) => {
  const normalized = normalizePath(pattern);
  let expression = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }

  return new RegExp(`^${expression}$`);
};

const walkFiles = (root, accept) => {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.next')) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (accept(absolutePath)) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
};

const routeFromFile = (relativeFile) => {
  const withoutRoot = normalizePath(relativeFile)
    .replace(/^frontend\/src\/app\//, '')
    .replace(/(?:^|\/)page\.(?:js|jsx|ts|tsx)$/, '');
  const routeParts = withoutRoot
    .split('/')
    .filter((part) => part && !(part.startsWith('(') && part.endsWith(')')));
  return routeParts.length ? `/${routeParts.join('/')}` : '/';
};

const loadManifest = (root, manifestPath) => {
  const absolutePath = path.resolve(root, manifestPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing migration manifest: ${normalizePath(path.relative(root, absolutePath))}`);
  }
  const manifest = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!Array.isArray(manifest.rules)) {
    throw new Error('Migration manifest must contain a rules array.');
  }
  for (const rule of manifest.rules) {
    if (!rule.pattern || !ROUTE_STATUSES.has(rule.status) || !rule.acceptanceStatus) {
      throw new Error(`Invalid migration rule: ${JSON.stringify(rule)}`);
    }
  }
  if (manifest.surfaces !== undefined && !Array.isArray(manifest.surfaces)) {
    throw new Error('Migration manifest surfaces must be an array.');
  }
  const surfaceIds = new Set();
  const repositoryFiles = walkFiles(
    path.join(root, 'frontend', 'src'),
    () => true
  ).map((file) => normalizePath(path.relative(root, file)));
  for (const surface of manifest.surfaces ?? []) {
    if (
      typeof surface.id !== 'string'
      || !surface.id.trim()
      || surfaceIds.has(surface.id)
      || !ROUTE_STATUSES.has(surface.status)
      || typeof surface.acceptanceStatus !== 'string'
      || !surface.acceptanceStatus.trim()
      || typeof surface.reason !== 'string'
      || !surface.reason.trim()
      || !Array.isArray(surface.files)
      || surface.files.length === 0
      || surface.files.some((pattern) => typeof pattern !== 'string' || !pattern.trim())
    ) {
      throw new Error(`Invalid migration surface: ${JSON.stringify(surface)}`);
    }
    surfaceIds.add(surface.id);
    for (const pattern of surface.files) {
      const matcher = globToRegExp(pattern);
      if (!repositoryFiles.some((file) => matcher.test(file))) {
        throw new Error(`Surface ${surface.id} pattern matches no files: ${pattern}`);
      }
    }
  }
  if (
    manifest.implementationBoundaries !== undefined
    && !Array.isArray(manifest.implementationBoundaries)
  ) {
    throw new Error('Migration manifest implementationBoundaries must be an array.');
  }
  const boundaryIds = new Set();
  for (const boundary of manifest.implementationBoundaries ?? []) {
    if (
      typeof boundary.id !== 'string'
      || !boundary.id.trim()
      || boundaryIds.has(boundary.id)
      || !Array.isArray(boundary.files)
      || boundary.files.length === 0
      || boundary.files.some((pattern) => typeof pattern !== 'string' || !pattern.trim())
      || !Array.isArray(boundary.allowedCategories)
      || boundary.allowedCategories.length === 0
      || boundary.allowedCategories.some((category) => !FINDING_CATEGORIES.has(category))
      || typeof boundary.reason !== 'string'
      || !boundary.reason.trim()
      || typeof boundary.owner !== 'string'
      || !boundary.owner.trim()
    ) {
      throw new Error(`Invalid implementation boundary: ${JSON.stringify(boundary)}`);
    }
    boundaryIds.add(boundary.id);
    for (const pattern of boundary.files) {
      if (!isCanonicalImplementationPattern(pattern)) {
        throw new Error(
          `Implementation boundary ${boundary.id} pattern is not a canonical implementation path: ${pattern}`
        );
      }
      const matcher = globToRegExp(pattern);
      if (!repositoryFiles.some((file) => matcher.test(file))) {
        throw new Error(`Implementation boundary ${boundary.id} pattern matches no files: ${pattern}`);
      }
    }
  }
  if (manifest.exceptions !== undefined && !Array.isArray(manifest.exceptions)) {
    throw new Error('Migration manifest exceptions must be an array.');
  }
  for (const exception of manifest.exceptions ?? []) {
    const requiredText = [
      'file',
      'category',
      'signature',
      'reason',
      'owner',
      'accessibilityEvidence',
      'themeEvidence',
      'resolution'
    ];
    const missing = requiredText.filter(
      (field) => typeof exception[field] !== 'string' || !exception[field].trim()
    );
    if (
      missing.length > 0
      || !FINDING_CATEGORIES.has(exception.category)
      || !Number.isInteger(exception.allowance)
      || exception.allowance < 1
      || /[*?]/.test(exception.file)
    ) {
      throw new Error(`Invalid migration exception: ${JSON.stringify(exception)}`);
    }
  }
  return manifest;
};

const recordConsumers = ({ source, file, patterns, destination }) => {
  for (const consumer of patterns) {
    if (consumer.expression.test(source)) {
      destination.push({ file, interface: consumer.interface });
    }
  }
};

const allowedCategoriesForFile = (manifest, file) => {
  const categories = new Set();
  for (const boundary of manifest.implementationBoundaries ?? []) {
    if (boundary.files.some((pattern) => globToRegExp(pattern).test(file))) {
      for (const category of boundary.allowedCategories) categories.add(category);
    }
  }
  return categories;
};

const buildReport = ({ root, manifestPath }) => {
  const manifest = loadManifest(root, manifestPath);
  const rules = manifest.rules.map((rule) => ({ ...rule, matcher: globToRegExp(rule.pattern) }));
  const routeFiles = walkFiles(
    path.join(root, ROUTE_ROOT),
    (file) => /[\\/]page\.(?:js|jsx|ts|tsx)$/.test(file)
  );
  const routes = routeFiles.map((absoluteFile) => {
    const file = normalizePath(path.relative(root, absoluteFile));
    const rule = rules.find((candidate) => candidate.matcher.test(file));
    return {
      route: routeFromFile(file),
      file,
      status: rule?.status ?? 'unclassified',
      acceptanceStatus: rule?.acceptanceStatus ?? 'unclassified',
      reason: rule?.reason ?? null
    };
  });

  const adoptionFiles = walkFiles(
    path.join(root, 'frontend', 'src'),
    (file) => ADOPTION_EXTENSIONS.has(path.extname(file))
  );
  const findings = Object.fromEntries(adoptionFiles.map((absoluteFile) => {
    const file = normalizePath(path.relative(root, absoluteFile));
    return [
      file,
      auditSource(
        fs.readFileSync(absoluteFile, 'utf8'),
        allowedCategoriesForFile(manifest, file)
      )
    ];
  }).filter(([, fileFindings]) => Object.keys(fileFindings).length > 0));
  const consumerInventory = {
    shared: [],
    legacy: []
  };
  for (const absoluteFile of adoptionFiles) {
    const file = normalizePath(path.relative(root, absoluteFile));
    const source = fs.readFileSync(absoluteFile, 'utf8');
    recordConsumers({
      source,
      file,
      patterns: SHARED_CONSUMER_PATTERNS,
      destination: consumerInventory.shared
    });
    recordConsumers({
      source,
      file,
      patterns: LEGACY_CONSUMER_PATTERNS,
      destination: consumerInventory.legacy
    });
  }

  return {
    manifestVersion: manifest.version ?? 1,
    routes,
    unclassifiedRoutes: routes.filter((route) => route.status === 'unclassified'),
    surfaces: manifest.surfaces ?? [],
    consumerInventory,
    exceptions: Array.isArray(manifest.exceptions) ? manifest.exceptions : [],
    findings,
    debtSummary: summarizeFindings(findings)
  };
};

const increment = (record, key) => {
  record[key] = (record[key] ?? 0) + 1;
};

function auditSource(source, allowedCategories = new Set()) {
  const findings = {};
  for (const pattern of FINDING_PATTERNS) {
    if (allowedCategories.has(pattern.category)) continue;
    const signatures = findings[pattern.category] ?? {};
    pattern.expression.lastIndex = 0;
    for (const match of source.matchAll(pattern.expression)) {
      const signature = pattern.signature
        ? pattern.signature(match)
        : match[0].toLowerCase();
      increment(signatures, signature);
    }
    if (Object.keys(signatures).length > 0) findings[pattern.category] = signatures;
  }
  return findings;
}

function summarizeFindings(findings) {
  const summary = {};
  for (const fileFindings of Object.values(findings)) {
    for (const [category, signatures] of Object.entries(fileFindings)) {
      summary[category] = (summary[category] ?? 0)
        + Object.values(signatures).reduce((total, count) => total + count, 0);
    }
  }
  return summary;
}

const writeBaseline = ({ root, outputPath, report }) => {
  const absoluteOutput = path.resolve(root, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(
    absoluteOutput,
    `${JSON.stringify({
      version: 1,
      manifestVersion: report.manifestVersion,
      generatedFrom: 'current repository state',
      findings: report.findings
    }, null, 2)}\n`,
    'utf8'
  );
  return normalizePath(path.relative(root, absoluteOutput));
};

const reportUnclassifiedRoutes = (report) => {
  for (const route of report.unclassifiedRoutes) {
    console.error(`Unclassified interactive route: ${route.route} (${route.file})`);
  }
  return report.unclassifiedRoutes.length > 0;
};

const exceptionAllowance = (file, category, signature, exceptions) => exceptions
  .filter((exception) => (
    normalizePath(exception.file) === file
    && exception.category === category
    && exception.signature === signature
  ))
  .reduce((total, exception) => total + exception.allowance, 0);

const checkFiles = ({ root, baseline, files, manifest }) => {
  const violations = [];

  for (const requestedFile of files) {
    const file = normalizePath(requestedFile);
    const absoluteFile = path.resolve(root, requestedFile);
    if (!absoluteFile.startsWith(`${root}${path.sep}`) || !fs.existsSync(absoluteFile)) continue;
    if (!ADOPTION_EXTENSIONS.has(path.extname(absoluteFile))) continue;
    const current = auditSource(
      fs.readFileSync(absoluteFile, 'utf8'),
      allowedCategoriesForFile(manifest, file)
    );
    const previous = baseline.findings?.[file] ?? {};

    for (const [category, signatures] of Object.entries(current)) {
      for (const [signature, count] of Object.entries(signatures)) {
        const allowedCount = Math.max(
          previous[category]?.[signature] ?? 0,
          exceptionAllowance(file, category, signature, manifest.exceptions ?? [])
        );
        if (count > allowedCount) {
          violations.push({
            file,
            category,
            signature,
            added: count - allowedCount
          });
        }
      }
    }
  }

  return violations;
};

const gitLines = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((file) => normalizePath(file.trim()))
    .filter(Boolean);
};

const readBaseline = (root, baselinePath, base) => {
  const absoluteBaseline = path.resolve(root, baselinePath);
  const relativeBaseline = normalizePath(path.relative(root, absoluteBaseline));
  if (relativeBaseline.startsWith('../')) {
    throw new Error('The adoption baseline must be inside the repository.');
  }
  if (base) {
    const result = spawnSync(
      'git',
      ['show', `${base}:${relativeBaseline}`],
      { cwd: root, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      const baseCommit = spawnSync(
        'git',
        ['rev-parse', '--verify', `${base}^{commit}`],
        { cwd: root, encoding: 'utf8' }
      );
      const workingBaselineExists = fs.existsSync(absoluteBaseline);
      if (baseCommit.status === 0 && workingBaselineExists) {
        console.log(`Bootstrapping target-branch adoption baseline from ${relativeBaseline}.`);
        return JSON.parse(fs.readFileSync(absoluteBaseline, 'utf8'));
      }
      throw new Error(
        result.stderr.trim()
        || `Missing adoption baseline at ${base}:${relativeBaseline}`
      );
    }
    return JSON.parse(result.stdout);
  }
  if (!fs.existsSync(absoluteBaseline)) {
    throw new Error(`Missing adoption baseline: ${relativeBaseline}`);
  }
  return JSON.parse(fs.readFileSync(absoluteBaseline, 'utf8'));
};

const collectChangedFiles = (root, base) => {
  const files = new Set();
  if (base) {
    for (const file of gitLines(root, ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])) {
      files.add(file);
    }
  }
  for (const file of gitLines(root, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])) {
    files.add(file);
  }
  for (const file of gitLines(root, ['ls-files', '--others', '--exclude-standard'])) {
    files.add(file);
  }
  return [...files].sort();
};

const args = process.argv.slice(2);
const command = args[0];
const root = path.resolve(readOption(args, '--root', process.cwd()));
const manifestPath = readOption(args, '--manifest', DEFAULT_MANIFEST);
const format = readOption(args, '--format', 'text');

try {
  if (command === 'report') {
    const report = buildReport({ root, manifestPath });
    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(`Classified ${report.routes.length} interactive routes.`);
      console.log(`Unclassified routes: ${report.unclassifiedRoutes.length}`);
      for (const [category, count] of Object.entries(report.debtSummary)) {
        console.log(`${category}: ${count}`);
      }
    }
    if (reportUnclassifiedRoutes(report)) process.exitCode = 1;
  } else if (command === 'baseline') {
    const report = buildReport({ root, manifestPath });
    if (report.unclassifiedRoutes.length > 0) {
      reportUnclassifiedRoutes(report);
      throw new Error('Cannot baseline unclassified interactive routes.');
    }
    const outputPath = readOption(args, '--output', DEFAULT_BASELINE);
    console.log(`Wrote Sabalan Design System adoption baseline: ${writeBaseline({ root, outputPath, report })}`);
  } else if (command === 'check') {
    const manifest = loadManifest(root, manifestPath);
    const baselinePath = readOption(args, '--baseline', DEFAULT_BASELINE);
    const base = readOption(args, '--base', null);
    let files = readListOption(args, '--files');
    if (args.includes('--changed')) {
      files = collectChangedFiles(root, base);
    } else if (files.length === 0) {
      throw new Error('The check command requires --changed or at least one path after --files.');
    }
    const baseline = readBaseline(root, baselinePath, base);
    const violations = checkFiles({ root, baseline, files, manifest });
    if (violations.length === 0) {
      console.log('No new Sabalan Design System adoption violations.');
    } else {
      for (const violation of violations) {
        console.error(
          `${violation.file}: ${violation.category} added ${violation.added} × ${violation.signature}`
        );
      }
      process.exitCode = 1;
    }
  } else {
    throw new Error(
      'Usage: design-system-adoption.mjs <report|baseline|check> [--root path] [--manifest path]'
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
