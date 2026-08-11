import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const canonicalClient = 'backend/src/lib/prisma.ts';
const recoveryClient = 'backend/src/services/systemRecoveryEngine.ts';
const standaloneRoots = [
  'backend/src/prisma/',
  'backend/src/scripts/',
  'backend/scripts/',
];
const scannedRoots = ['backend/src', 'backend/scripts'];
const sourceExtensions = new Set(['.ts', '.js', '.cjs', '.mjs']);

const normalize = (value) => value.replaceAll('\\', '/');
const count = (text, pattern) => [...text.matchAll(pattern)].length;

const walk = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
};

const failures = [];
const constructionSites = [];

for (const root of scannedRoots) {
  for (const absolutePath of walk(path.join(repositoryRoot, root))) {
    const relativePath = normalize(path.relative(repositoryRoot, absolutePath));
    const source = fs.readFileSync(absolutePath, 'utf8');
    const isTest = relativePath.includes('/__tests__/') || /\.test\.[cm]?[jt]s$/.test(relativePath);
    const isStandalone = isTest || standaloneRoots.some((allowedRoot) => relativePath.startsWith(allowedRoot));
    if (relativePath !== canonicalClient && relativePath !== recoveryClient && !isStandalone && /\bprisma\.\$disconnect\s*\(/.test(source)) {
      failures.push(`${relativePath} disconnects the canonical Prisma client. Only the ownership module may close it.`);
    }
    const constructors = count(source, /new\s+PrismaClient\s*\(/g);
    if (!constructors) continue;

    constructionSites.push({ relativePath, constructors });

    if (relativePath === canonicalClient) {
      if (constructors !== 1) {
        failures.push(`${canonicalClient} must construct exactly one PrismaClient.`);
      }
      continue;
    }

    if (relativePath === recoveryClient) {
      const disconnects = count(source, /\.\$disconnect\s*\(/g);
      if (constructors !== 3 || disconnects < constructors) {
        failures.push(`${recoveryClient} may construct only its three explicit alternate-database validation/recovery clients, each closed in finally.`);
      }
      continue;
    }

    if (isTest) {
      // Integration/concurrency tests deliberately own isolated clients and
      // temporary databases; their harness controls lifecycle and cleanup.
      continue;
    }

    if (isStandalone) {
      const disconnects = count(source, /\.\$disconnect\s*\(/g);
      if (disconnects < constructors) {
        failures.push(`${relativePath} constructs ${constructors} standalone PrismaClient instance(s) but has only ${disconnects} disconnect call(s).`);
      }
      continue;
    }

    failures.push(`${relativePath} constructs PrismaClient. Application runtime code must import backend/src/lib/prisma.ts.`);
  }
}

const expectedRuntimeSites = new Map([
  [canonicalClient, 1],
  [recoveryClient, 3],
]);
for (const [expectedPath, expectedCount] of expectedRuntimeSites) {
  const actual = constructionSites.find((site) => site.relativePath === expectedPath)?.constructors ?? 0;
  if (actual !== expectedCount) {
    failures.push(`${expectedPath} expected ${expectedCount} PrismaClient construction site(s), found ${actual}.`);
  }
}

for (const composePath of ['docker-compose.local.yml', 'docker-compose.prod.yml']) {
  const source = fs.readFileSync(path.join(repositoryRoot, composePath), 'utf8');
  const backendDatabaseUrl = source.match(/DATABASE_URL:\s*postgresql:[^\r\n]+/)?.[0] ?? '';
  if (!backendDatabaseUrl.includes('connection_limit=')) {
    failures.push(`${composePath} must set an explicit backend Prisma connection_limit.`);
  }
  if (!backendDatabaseUrl.includes('pool_timeout=')) {
    failures.push(`${composePath} must set an explicit backend Prisma pool_timeout.`);
  }
}

if (failures.length) {
  console.error('Database client ownership check failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Database client ownership check passed.');
console.log(`Canonical runtime pool: ${canonicalClient}`);
console.log(`Explicit alternate-database recovery clients: ${recoveryClient}`);
