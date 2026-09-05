import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { decryptRecoveryArchive, encryptRecoveryArchive, encryptRecoveryArchiveForRecipients, sha256File } from './recoveryCrypto';
import { RECOVERY_FORMAT_VERSION, recoveryCompatibility, RecoveryPackageType } from './systemRecoveryPolicy';
import { RECOVERY_COORDINATION_DIR, RECOVERY_ROOT } from './recoveryRuntime';
import { publishNotificationEvent } from './notificationService';

const execFileAsync = promisify(execFile);
const PACKAGES_DIR = path.join(RECOVERY_ROOT, 'packages');
const UPLOADS_DIR = path.join(RECOVERY_ROOT, 'uploads');
const WORK_DIR = path.join(RECOVERY_ROOT, 'work');
const INQUIRY_SOURCE_DIR = process.env.INQUIRY_RECOVERY_SOURCE_DIR || path.join(process.cwd(), 'recovery-sources', 'inquiry');
const DISPATCH_DOCUMENT_STORAGE_DIR = path.join(process.cwd(), 'storage', 'dispatch-documents');
const PERFORMANCE_EXPORT_STORAGE_DIR = path.join(process.cwd(), 'storage', 'performance-exports');

const FILE_RECOVERY_MAPPINGS = [
  { payloadPath: 'files/contracts', livePath: path.join(process.cwd(), 'storage', 'contracts'), safetyName: 'contracts' },
  { payloadPath: 'files/hr-hiring', livePath: path.join(process.cwd(), 'storage', 'hr-hiring'), safetyName: 'hr-hiring' },
  { payloadPath: 'files/accounting-contracts', livePath: path.join(process.cwd(), 'storage', 'accounting-contracts'), safetyName: 'accounting-contracts' },
  { payloadPath: 'files/dispatch-documents', livePath: DISPATCH_DOCUMENT_STORAGE_DIR, safetyName: 'dispatch-documents' },
  { payloadPath: 'files/support-tickets', livePath: path.join(process.cwd(), 'storage', 'support-tickets'), safetyName: 'support-tickets' },
  { payloadPath: 'files/performance-exports', livePath: PERFORMANCE_EXPORT_STORAGE_DIR, safetyName: 'performance-exports' },
  { payloadPath: 'files/uploads', livePath: path.join(process.cwd(), 'uploads'), safetyName: 'uploads' },
] as const;

const dispatchArtifactBackupPath = (payloadRoot: string, storageKey: string) => {
  const normalized = storageKey.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw Object.assign(new Error('Dispatch artifact storage key is unsafe.'), { code: 'UNSAFE_RECOVERY_PATH' });
  }
  const root = path.resolve(payloadRoot, 'files', 'dispatch-documents');
  const candidate = path.resolve(root, normalized);
  if (!candidate.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('Dispatch artifact storage key is unsafe.'), { code: 'UNSAFE_RECOVERY_PATH' });
  return candidate;
};

const performanceExportRelativePath = (artifactPath: string, storageRoot = PERFORMANCE_EXPORT_STORAGE_DIR) => {
  const root = path.resolve(storageRoot);
  const resolved = path.resolve(artifactPath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('Performance export artifact path is outside protected storage.'), {
      code: 'UNSAFE_RECOVERY_PATH',
    });
  }
  const relative = path.relative(root, resolved);
  if (!relative || relative.split(path.sep).includes('..')) {
    throw Object.assign(new Error('Performance export artifact path is unsafe.'), { code: 'UNSAFE_RECOVERY_PATH' });
  }
  return relative;
};

const performanceExportBackupPath = (payloadRoot: string, artifactPath: string, storageRoot = PERFORMANCE_EXPORT_STORAGE_DIR) =>
  path.join(payloadRoot, 'files', 'performance-exports', performanceExportRelativePath(artifactPath, storageRoot));

export type RecoveryManifest = {
  format: 'sabalan-recovery';
  formatVersion: number;
  packageType: RecoveryPackageType;
  createdAt: string;
  appVersion: string;
  commit: string | null;
  postgresVersion: string;
  sanitized: boolean;
  components: Array<{ path: string; sha256: string; size: number }>;
};

const ensureDirectories = async () => {
  await Promise.all([PACKAGES_DIR, UPLOADS_DIR, WORK_DIR, RECOVERY_COORDINATION_DIR].map((directory) =>
    fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })));
  for (const entry of await fs.promises.readdir(WORK_DIR, { withFileTypes: true })) {
    const absolute = path.join(WORK_DIR, entry.name);
    const stat = await fs.promises.stat(absolute);
    if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      await fs.promises.rm(absolute, { recursive: entry.isDirectory(), force: true });
    }
  }
};

const databaseConfig = (databaseUrl = process.env.DATABASE_URL || '') => {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
};

const databaseArgs = (databaseUrl: string, database?: string) => {
  const config = databaseConfig(databaseUrl);
  return {
    config,
    connection: ['--host', config.host, '--port', config.port, '--username', config.user, '--dbname', database || config.database],
    env: { ...process.env, PGPASSWORD: config.password },
  };
};

const safeDatabaseName = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

const psql = async (databaseUrl: string, database: string, sql: string) => {
  const args = databaseArgs(databaseUrl, database);
  await execFileAsync('psql', [...args.connection, '--set', 'ON_ERROR_STOP=1', '--command', sql], {
    env: args.env,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
};

const createDatabase = async (databaseUrl: string, name: string) => {
  const config = databaseConfig(databaseUrl);
  await psql(databaseUrl, 'postgres', `CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  return { ...config, database: name };
};

const dropDatabase = async (databaseUrl: string, name: string) => {
  try {
    await psql(databaseUrl, 'postgres', `DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`);
  } catch {
    // Cleanup must not mask the recovery result.
  }
};

const databaseUrlWithName = (databaseUrl: string, database: string) => {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

const dumpDatabase = async (databaseUrl: string, destination: string) => {
  const args = databaseArgs(databaseUrl);
  await execFileAsync('pg_dump', [...args.connection, '--format=custom', '--no-owner', '--no-privileges', '--file', destination], {
    env: args.env,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
};

const restoreDatabase = async (databaseUrl: string, database: string, source: string) => {
  const args = databaseArgs(databaseUrl, database);
  await execFileAsync('pg_restore', [...args.connection, '--no-owner', '--no-privileges', '--exit-on-error', source], {
    env: args.env,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
};

const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sanitizedText = Buffer.from('Sanitized test placeholder\n', 'utf8');

const sanitizedPlaceholder = (fileName: string) => {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.pdf') return minimalPdf;
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return minimalPng;
  return sanitizedText;
};
export const sanitizedDispatchArtifactMetadata = (storageKey: string) => {
  const bytes = sanitizedPlaceholder(storageKey);
  return { byteLength: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};

const sanitizeDatabase = async (databaseUrl: string) => {
  const disabledPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const sql = `
    DELETE FROM "auth_sessions";
    DELETE FROM "recognized_browser_profiles";
    DELETE FROM "authentication_events";
    DELETE FROM "security_notifications";
    DELETE FROM "contract_confirmation_audit_logs";
    DELETE FROM "contract_public_confirmations";
    UPDATE "sales_contracts" SET "verificationCodeId" = NULL;
    DELETE FROM "contract_verification_codes";
    DELETE FROM "hr_candidate_access_attempts";
    DELETE FROM "hr_candidate_access_throttles";
    DELETE FROM "recovery_audit_events";
    UPDATE "users" SET
      "email" = 'test-' || substr(md5("id"), 1, 16) || '@example.invalid',
      "username" = 'test_' || substr(md5("id"), 1, 16),
      "password" = '${disabledPassword.replace(/'/g, "''")}',
      "firstName" = 'Test',
      "lastName" = substr(md5("id"), 1, 8),
      "isActive" = false,
      "mustChangePassword" = true,
      "creatorDisplayNameSnapshot" = NULL,
      "creatorUsernameSnapshot" = NULL,
      "erasureReason" = NULL,
      "erasedDisplayName" = NULL,
      "erasedUsernameSnapshot" = NULL;
    UPDATE "profiles" SET "avatar" = NULL, "bio" = NULL, "phone" = NULL, "address" = NULL, "city" = NULL, "country" = NULL;
    UPDATE "personnel" SET "firstName" = 'Person', "lastName" = substr(md5("id"), 1, 8), "nationalCode" = NULL, "employeeNumber" = 'T-' || substr(md5("id"), 1, 10);
    UPDATE "customers" SET "firstName" = 'Customer', "lastName" = substr(md5("id"), 1, 8), "companyName" = 'Company ' || substr(md5("id"), 1, 8), "email" = NULL, "phone" = NULL, "address" = NULL, "city" = NULL;
    UPDATE "crm_customers" SET
      "firstName" = 'Customer', "lastName" = substr(md5("id"), 1, 8), "companyName" = 'Company ' || substr(md5("id"), 1, 8),
      "address" = NULL, "city" = NULL, "nationalCode" = NULL, "homeAddress" = NULL, "homeNumber" = NULL,
      "projectManagerName" = NULL, "projectManagerNumber" = NULL, "referrerFirstName" = NULL, "referrerLastName" = NULL,
      "referrerPhoneNumber" = NULL, "workAddress" = NULL, "workNumber" = NULL, "communicationPreferences" = NULL, "customFields" = NULL;
    UPDATE "project_addresses" SET "address" = 'Sanitized address', "postalCode" = NULL, "projectManagerName" = NULL, "projectManagerNumber" = NULL, "marketerFirstName" = NULL, "marketerLastName" = NULL, "marketerPhoneNumber" = NULL;
    UPDATE "phone_numbers" SET "number" = '000' || substr(md5("id"), 1, 8);
    UPDATE "crm_contacts" SET "firstName" = 'Contact', "lastName" = substr(md5("id"), 1, 8), "email" = NULL, "phone" = NULL, "mobile" = NULL, "communicationHistory" = NULL;
    UPDATE "crm_leads" SET "companyName" = 'Company ' || substr(md5("id"), 1, 8), "contactName" = 'Contact ' || substr(md5("id"), 1, 8), "email" = NULL, "phone" = NULL, "notes" = NULL;
    UPDATE "hr_candidates" SET "firstName" = 'Candidate', "lastName" = substr(md5("id"), 1, 8), "mobile" = '000' || substr(md5("id"), 1, 8), "nationalCode" = NULL, "foreignIdentityNumber" = NULL, "postalCode" = NULL, "profileJson" = NULL;
    DELETE FROM "hr_candidate_invitations";
    UPDATE "hr_application_form_revisions" SET
      "dataJson" = '{}'::jsonb, "correctionFieldsJson" = NULL, "correctionDetailsJson" = NULL,
      "correctionReason" = NULL, "declarationFullName" = NULL, "submittedIp" = NULL, "submittedUserAgent" = NULL;
    UPDATE "hr_hiring_audits" SET "payloadJson" = NULL, "ipAddress" = NULL, "userAgent" = NULL;
    UPDATE "dispatch_document_artifacts" SET
      "byteLength" = CASE
        WHEN lower("storageKey") ~ '\\.pdf$' THEN ${sanitizedDispatchArtifactMetadata('artifact.pdf').byteLength}
        WHEN lower("storageKey") ~ '\\.(png|jpg|jpeg|webp)$' THEN ${sanitizedDispatchArtifactMetadata('artifact.png').byteLength}
        ELSE ${sanitizedDispatchArtifactMetadata('artifact.bin').byteLength}
      END,
      "sha256" = CASE
        WHEN lower("storageKey") ~ '\\.pdf$' THEN '${sanitizedDispatchArtifactMetadata('artifact.pdf').sha256}'
        WHEN lower("storageKey") ~ '\\.(png|jpg|jpeg|webp)$' THEN '${sanitizedDispatchArtifactMetadata('artifact.png').sha256}'
        ELSE '${sanitizedDispatchArtifactMetadata('artifact.bin').sha256}'
      END;
    DO $sanitization$
    DECLARE sensitive RECORD;
    BEGIN
      FOR sensitive IN
        SELECT table_name, column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text', 'character varying')
          AND column_name IN (
            'firstName', 'lastName', 'companyName', 'contactName', 'email', 'phone', 'mobile', 'phoneNumber',
            'nationalCode', 'foreignIdentityNumber', 'address', 'homeAddress', 'workAddress', 'homeNumber', 'workNumber',
            'postalCode', 'projectManagerName', 'projectManagerNumber', 'marketerFirstName', 'marketerLastName',
            'marketerPhoneNumber', 'referrerFirstName', 'referrerLastName', 'referrerPhoneNumber', 'bankAccount',
            'iban', 'accountNumber', 'cardNumber', 'ipAddress', 'userAgent', 'approximateLocation', 'originalName'
          )
      LOOP
        IF sensitive.is_nullable = 'YES' THEN
          EXECUTE format('UPDATE %I SET %I = NULL', sensitive.table_name, sensitive.column_name);
        ELSE
          EXECUTE format(
            'UPDATE %I SET %I = %L || substr(md5(ctid::text), 1, 12)',
            sensitive.table_name, sensitive.column_name, 'Sanitized-'
          );
        END IF;
      END LOOP;
    END
    $sanitization$;
  `;
  const config = databaseConfig(databaseUrl);
  await psql(databaseUrl, config.database, sql);
};

const regularFiles = async (root: string, relative = ''): Promise<string[]> => {
  const directory = path.join(root, relative);
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
};

const copyComponent = async (
  source: string,
  destination: string,
  sanitized: boolean,
  exclude?: (relativePath: string) => boolean,
) => {
  if (!fs.existsSync(source)) {
    await fs.promises.mkdir(destination, { recursive: true });
    return;
  }
  if (!sanitized) {
    await fs.promises.cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (candidate) => {
        const relative = path.relative(source, candidate);
        return !relative || !exclude?.(relative);
      },
    });
    return;
  }
  await fs.promises.mkdir(destination, { recursive: true });
  for (const relative of await regularFiles(source)) {
    if (exclude?.(relative)) continue;
    const target = path.join(destination, relative);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, sanitizedPlaceholder(relative), { mode: 0o600 });
  }
};

const shouldExcludeSupportTicketCheckpointFile = (
  relativePath: string,
  referencedStorageNames: ReadonlySet<string>,
) => {
  const storageName = path.basename(relativePath);
  return storageName.startsWith('staged-') && !referencedStorageNames.has(storageName);
};

const backupInquiry = async (destinationDirectory: string, sanitized: boolean) => {
  await fs.promises.mkdir(destinationDirectory, { recursive: true });
  const source = path.join(INQUIRY_SOURCE_DIR, 'inquiry.db');
  if (!fs.existsSync(source)) throw Object.assign(new Error('Inquiry database is unavailable for the recovery snapshot.'), { code: 'INQUIRY_DATA_MISSING' });
  const destination = path.join(destinationDirectory, 'inquiry.db');
  await execFileAsync('sqlite3', [source, `.backup '${destination.replace(/'/g, "''")}'`], { windowsHide: true });
  if (sanitized) {
    const tables = await execFileAsync('sqlite3', [destination, `.tables`], { windowsHide: true });
    const candidates = tables.stdout.split(/\s+/).filter(Boolean);
    for (const table of candidates) {
      if (/^(Admin|User)$/i.test(table) || /session|audit|login|auth/i.test(table)) {
        await execFileAsync('sqlite3', [destination, `DELETE FROM "${table.replace(/"/g, '""')}";`], { windowsHide: true });
      }
    }
  }
};

const writeManifest = async (payloadRoot: string, details: Omit<RecoveryManifest, 'components'>) => {
  const components: RecoveryManifest['components'] = [];
  for (const relative of await regularFiles(payloadRoot)) {
    if (relative === 'manifest.json') continue;
    const absolute = path.join(payloadRoot, relative);
    const stat = await fs.promises.stat(absolute);
    components.push({ path: relative.replace(/\\/g, '/'), sha256: await sha256File(absolute), size: stat.size });
  }
  const manifest: RecoveryManifest = { ...details, components };
  await fs.promises.writeFile(path.join(payloadRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return manifest;
};

const extractRecoveryArchive = async (archivePath: string, payloadRoot: string) => {
  const listed = await execFileAsync('tar', ['-tzf', archivePath], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.length > 250_000) throw Object.assign(new Error('Recovery archive entry count is invalid.'), { code: 'INVALID_RECOVERY_ARCHIVE' });
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '');
    const isArchiveRoot = entry === '.' || entry === './';
    if ((!normalized && !isArchiveRoot) || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
      throw Object.assign(new Error('Recovery archive contains an unsafe path.'), { code: 'UNSAFE_RECOVERY_ARCHIVE' });
    }
  }
  const verbose = await execFileAsync('tar', ['-tvzf', archivePath], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (verbose.stdout.split(/\r?\n/).some((line) => /^[lh]/.test(line))) {
    throw Object.assign(new Error('Recovery archive links are not permitted.'), { code: 'UNSAFE_RECOVERY_ARCHIVE' });
  }
  await execFileAsync('tar', ['-xzf', archivePath, '-C', payloadRoot, '--no-same-owner', '--no-same-permissions'], { windowsHide: true });
};

export const currentPostgresVersion = async (prisma: PrismaClient) => {
  const result = await prisma.$queryRawUnsafe<Array<{ version: string }>>('SHOW server_version');
  return result[0]?.version || 'unknown';
};

export const createRecoveryPackage = async (input: {
  operationId: string;
  packageType: RecoveryPackageType;
  passphrase?: string;
  recipients?: Array<{ keyId: string; passphrase: string } | { keyId: string; publicKeyPem: string }>;
  prisma: PrismaClient;
  onProgress: (progress: number) => Promise<void>;
}) => {
  await ensureDirectories();
  const jobRoot = await fs.promises.mkdtemp(path.join(WORK_DIR, `${input.operationId}-`));
  const payloadRoot = path.join(jobRoot, 'payload');
  const databaseDump = path.join(payloadRoot, 'database', 'main.dump');
  const sanitized = input.packageType === 'SANITIZED_TEST';
  let sanitizedDatabase: string | null = null;
  try {
    await fs.promises.mkdir(path.dirname(databaseDump), { recursive: true });
    await input.onProgress(10);
    if (sanitized) {
      const sourceDump = path.join(jobRoot, 'source.dump');
      await dumpDatabase(process.env.DATABASE_URL || '', sourceDump);
    } else {
      await dumpDatabase(process.env.DATABASE_URL || '', databaseDump);
    }
    await input.onProgress(35);
    const referencedSupportTicketStorageNames = new Set(
      (
        await input.prisma.supportTicketAttachment.findMany({
          where: { storageName: { not: null } },
          select: { storageName: true },
        })
      )
        .map((attachment) => path.basename(String(attachment.storageName || '')))
        .filter(Boolean),
    );
    await Promise.all([
      ...FILE_RECOVERY_MAPPINGS.map((mapping) => copyComponent(
        mapping.livePath,
        path.join(payloadRoot, mapping.payloadPath),
        sanitized,
        mapping.safetyName === 'support-tickets'
          ? (relative) => shouldExcludeSupportTicketCheckpointFile(relative, referencedSupportTicketStorageNames)
          : undefined,
      )),
      backupInquiry(path.join(payloadRoot, 'inquiry'), sanitized),
      copyComponent(
        RECOVERY_COORDINATION_DIR,
        path.join(payloadRoot, 'recovery-coordination'),
        sanitized,
        (relative) => path.basename(relative).startsWith('deployment-'),
      ),
    ]);
    await input.onProgress(55);
    if (sanitized) {
      const sourceDump = path.join(jobRoot, 'source.dump');
      sanitizedDatabase = safeDatabaseName('sabalan_sanitize');
      await createDatabase(process.env.DATABASE_URL || '', sanitizedDatabase);
      await restoreDatabase(process.env.DATABASE_URL || '', sanitizedDatabase, sourceDump);
      const sanitizedUrl = databaseUrlWithName(process.env.DATABASE_URL || '', sanitizedDatabase);
      await sanitizeDatabase(sanitizedUrl);
      await dumpDatabase(sanitizedUrl, databaseDump);
    }
    const manifest = await writeManifest(payloadRoot, {
      format: 'sabalan-recovery',
      formatVersion: RECOVERY_FORMAT_VERSION,
      packageType: input.packageType,
      createdAt: new Date().toISOString(),
      appVersion: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
      commit: process.env.APP_COMMIT || null,
      postgresVersion: await currentPostgresVersion(input.prisma),
      sanitized,
    });
    const archivePath = path.join(jobRoot, 'payload.tar.gz');
    await execFileAsync('tar', ['-czf', archivePath, '-C', payloadRoot, '.'], { windowsHide: true });
    await input.onProgress(75);
    const storageName = `${input.operationId}.sabrec`;
    const destination = path.join(PACKAGES_DIR, storageName);
    if (input.recipients) await encryptRecoveryArchiveForRecipients(archivePath, destination, input.recipients);
    else if (input.passphrase) await encryptRecoveryArchive(archivePath, destination, input.passphrase);
    else throw Object.assign(new Error('Recovery package encryption key is required.'), { code: 'RECOVERY_ENCRYPTION_KEY_REQUIRED' });
    await input.onProgress(95);
    const stat = await fs.promises.stat(destination);
    return { storageName, destination, sha256: await sha256File(destination), size: stat.size, manifest };
  } finally {
    if (sanitizedDatabase) await dropDatabase(process.env.DATABASE_URL || '', sanitizedDatabase);
    await fs.promises.rm(jobRoot, { recursive: true, force: true });
  }
};

export const storeUploadedRecoveryPackage = async (temporaryPath: string, operationId: string) => {
  await ensureDirectories();
  const storageName = `${operationId}.sabrec`;
  const destination = path.join(UPLOADS_DIR, storageName);
  await fs.promises.rename(temporaryPath, destination);
  const stat = await fs.promises.stat(destination);
  return { storageName, destination, sha256: await sha256File(destination), size: stat.size };
};

export const recoveryPackagePath = (source: string, storageName: string) =>
  path.join(source === 'CREATED' ? PACKAGES_DIR : UPLOADS_DIR, path.basename(storageName));

export const validateRecoveryPackage = async (input: {
  sourcePath: string;
  passphrase: string;
  prisma: PrismaClient;
  verifyRestore?: boolean;
}) => {
  await ensureDirectories();
  const jobRoot = await fs.promises.mkdtemp(path.join(WORK_DIR, 'validate-'));
  const archivePath = path.join(jobRoot, 'payload.tar.gz');
  const payloadRoot = path.join(jobRoot, 'payload');
  let stagedDatabase: string | null = null;
  try {
    await decryptRecoveryArchive(input.sourcePath, archivePath, input.passphrase);
    await fs.promises.mkdir(payloadRoot, { recursive: true });
    await extractRecoveryArchive(archivePath, payloadRoot);
    const manifest = JSON.parse(await fs.promises.readFile(path.join(payloadRoot, 'manifest.json'), 'utf8')) as RecoveryManifest;
    if (manifest.format !== 'sabalan-recovery') throw Object.assign(new Error('Invalid recovery manifest.'), { code: 'INVALID_RECOVERY_MANIFEST' });
    if (!['COMPLETE', 'SANITIZED_TEST'].includes(manifest.packageType) || !Array.isArray(manifest.components)) {
      throw Object.assign(new Error('Recovery manifest fields are invalid.'), { code: 'INVALID_RECOVERY_MANIFEST' });
    }
    const componentPaths = new Set(manifest.components.map((component) => component.path));
    if (!componentPaths.has('database/main.dump') || !componentPaths.has('inquiry/inquiry.db')) {
      throw Object.assign(new Error('Recovery package is missing a required data store.'), { code: 'RECOVERY_COMPONENT_MISSING' });
    }
    for (const component of manifest.components) {
      const absolute = path.resolve(payloadRoot, component.path);
      if (!absolute.startsWith(`${path.resolve(payloadRoot)}${path.sep}`)) throw Object.assign(new Error('Unsafe recovery component path.'), { code: 'UNSAFE_RECOVERY_PATH' });
      const stat = await fs.promises.stat(absolute);
      if (stat.size !== component.size || await sha256File(absolute) !== component.sha256) {
        throw Object.assign(new Error(`Recovery component failed integrity validation: ${component.path}`), { code: 'RECOVERY_INTEGRITY_FAILED' });
      }
    }
    const compatibility = recoveryCompatibility({
      sourceFormatVersion: manifest.formatVersion,
      sourceAppVersion: manifest.appVersion,
      targetAppVersion: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
      sourcePostgresVersion: manifest.postgresVersion,
      targetPostgresVersion: await currentPostgresVersion(input.prisma),
    });
    if (input.verifyRestore) {
      const sqlite = await execFileAsync('sqlite3', [path.join(payloadRoot, 'inquiry', 'inquiry.db'), 'PRAGMA integrity_check;'], { windowsHide: true });
      if (sqlite.stdout.trim() !== 'ok') {
        throw Object.assign(new Error(`Recovery SQLite integrity check failed: ${sqlite.stdout.trim()}`), { code: 'RECOVERY_SQLITE_INTEGRITY_FAILED' });
      }
      stagedDatabase = safeDatabaseName('sabalan_checkpoint_verify');
      await createDatabase(process.env.DATABASE_URL || '', stagedDatabase);
      await restoreDatabase(process.env.DATABASE_URL || '', stagedDatabase, path.join(payloadRoot, 'database', 'main.dump'));
      const stagedClient = new PrismaClient({ datasources: { db: { url: databaseUrlWithName(process.env.DATABASE_URL || '', stagedDatabase) } } });
      try {
        await stagedClient.$queryRawUnsafe('SELECT 1');
        await validateStoredFileReferences(stagedClient, payloadRoot);
      } finally {
        await stagedClient.$disconnect();
      }
    }
    return { manifest, compatibility };
  } finally {
    if (stagedDatabase) await dropDatabase(process.env.DATABASE_URL || '', stagedDatabase);
    await fs.promises.rm(jobRoot, { recursive: true, force: true });
  }
};

type RestoreJournal = {
  operationId: string;
  phase: 'STAGED' | 'FILES_PROMOTED' | 'DATABASE_PROMOTED';
  stagedDatabase: string;
  safetyDatabase: string;
  currentDatabase: string;
  safetyFilesRoot: string;
  packageType: RecoveryPackageType;
  checksum: string;
  actorId: string;
  actorDisplay: string;
  authorizationMode: 'TWO_ADMIN' | 'BREAK_GLASS';
  approvedById?: string | null;
  approvalExpiresAt?: string | null;
  breakGlassReason?: string | null;
  packageStoragePath: string;
  bootstrapUsername?: string;
  startedAt: string;
  preservePackage?: boolean;
};

export const RESTORE_JOURNAL_PATH = path.join(RECOVERY_COORDINATION_DIR, 'pending-restore.json');
export const SANITIZED_MARKER_PATH = path.join(RECOVERY_COORDINATION_DIR, 'sanitized-environment.json');
export const INQUIRY_RESTART_MARKER = path.join(RECOVERY_COORDINATION_DIR, 'restart-inquiry');
const INQUIRY_STOPPED_MARKER = path.join(RECOVERY_COORDINATION_DIR, 'inquiry-stopped');

const pauseInquiryForRecovery = async (operationId: string) => {
  if (process.env.INQUIRY_RECOVERY_COORDINATED !== 'true') return;
  if (process.env.INQUIRY_ALREADY_DRAINED === 'true') return;
  await fs.promises.writeFile(INQUIRY_RESTART_MARKER, operationId, { encoding: 'utf8', mode: 0o600 });
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(INQUIRY_STOPPED_MARKER) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!fs.existsSync(INQUIRY_STOPPED_MARKER)) {
    await fs.promises.rm(INQUIRY_RESTART_MARKER, { force: true });
    throw Object.assign(new Error('Inquiry service did not enter recovery maintenance mode.'), { code: 'INQUIRY_MAINTENANCE_TIMEOUT' });
  }
};

const resumeInquiryAfterRecovery = () => fs.promises.rm(INQUIRY_RESTART_MARKER, { force: true });

const writeRestoreJournal = async (journal: RestoreJournal) => {
  await fs.promises.mkdir(RECOVERY_COORDINATION_DIR, { recursive: true });
  await fs.promises.writeFile(RESTORE_JOURNAL_PATH, JSON.stringify(journal), { encoding: 'utf8', mode: 0o600 });
};

const replaceDirectoryContents = async (source: string, destination: string, safetyDestination: string) => {
  await fs.promises.mkdir(destination, { recursive: true });
  const safetyStaging = `${safetyDestination}.copying`;
  await fs.promises.mkdir(path.dirname(safetyDestination), { recursive: true });
  await fs.promises.rm(safetyStaging, { recursive: true, force: true });
  await fs.promises.mkdir(safetyStaging, { recursive: true });
  const existing = await fs.promises.readdir(destination);
  for (const name of existing) {
    await fs.promises.cp(path.join(destination, name), path.join(safetyStaging, name), { recursive: true, force: true });
  }
  await fs.promises.rename(safetyStaging, safetyDestination);
  for (const name of existing) await fs.promises.rm(path.join(destination, name), { recursive: true, force: true });
  if (!fs.existsSync(source)) return;
  for (const name of await fs.promises.readdir(source)) {
    await fs.promises.cp(path.join(source, name), path.join(destination, name), { recursive: true, force: true });
  }
};

export const restoreDirectoryFromSafety = async (safety: string, destination: string) => {
  if (!fs.existsSync(safety)) return;
  await fs.promises.mkdir(destination, { recursive: true });
  for (const name of await fs.promises.readdir(destination)) {
    await fs.promises.rm(path.join(destination, name), { recursive: true, force: true });
  }
  for (const name of await fs.promises.readdir(safety)) {
    await fs.promises.cp(path.join(safety, name), path.join(destination, name), { recursive: true, force: true });
  }
};

const migrateDatabase = async (databaseUrl: string) => {
  await execFileAsync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
};

const createSanitizedBootstrapAdmin = async (databaseUrl: string, password: string) => {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const hashed = await bcrypt.hash(password, 12);
    await client.user.deleteMany({ where: { OR: [{ username: 'local_recovery_admin' }, { email: 'local-recovery-admin@example.invalid' }] } });
    await client.user.create({
      data: {
        email: 'local-recovery-admin@example.invalid',
        username: 'local_recovery_admin',
        password: hashed,
        firstName: 'Local',
        lastName: 'Recovery Admin',
        role: 'ADMIN',
        isActive: true,
        mustChangePassword: true,
        creationSource: 'SYSTEM_SEEDED',
        creatorAttributionKind: 'AUTOMATIC',
      },
    });
  } finally {
    await client.$disconnect();
  }
};

const liveStoredFileReferenceCandidates = (
  tableName: string,
  storageNameValue: string,
  applicationRoot = process.cwd(),
  recoveryRoot = RECOVERY_ROOT,
) => {
  const storageName = path.basename(String(storageNameValue || ''));
  if (!storageName) return [];
  if (tableName === 'recovery_operations') {
    return [
      path.join(recoveryRoot, 'packages', storageName),
      path.join(recoveryRoot, 'uploads', storageName),
    ];
  }
  if (tableName.startsWith('hr_')) return [path.join(applicationRoot, 'storage', 'hr-hiring', storageName)];
  if (tableName === 'support_ticket_attachments') {
    return [path.join(applicationRoot, 'storage', 'support-tickets', storageName)];
  }
  return [
    path.join(applicationRoot, 'uploads', 'security-vehicle-pairs', storageName),
    path.join(applicationRoot, 'uploads', 'security-shift-log', storageName),
    path.join(applicationRoot, 'uploads', storageName),
  ];
};

const validateStoredFileReferences = async (client: PrismaClient, payloadRoot: string) => {
  const columns = await client.$queryRawUnsafe<Array<{ tableName: string; columnName: string }>>(`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('storageName', 'returnEvidenceStorageName')
      AND table_name <> 'recovery_operations'
  `);
  // Recovery packages deliberately do not recursively embed older recovery
  // packages. Live deployment gates validate those files in RECOVERY_ROOT.
  const missing: Array<{ table: string; column: string; storageName: string }> = [];
  for (const column of columns) {
    if (!/^[A-Za-z0-9_]+$/.test(column.tableName) || !/^[A-Za-z0-9_]+$/.test(column.columnName)) continue;
    const values = await client.$queryRawUnsafe<Array<{ value: string }>>(
      `SELECT "${column.columnName}" AS value FROM "${column.tableName}" WHERE "${column.columnName}" IS NOT NULL`,
    );
    for (const row of values) {
      const storageName = path.basename(String(row.value || ''));
      if (!storageName) continue;
      const candidates = column.tableName.startsWith('hr_')
        ? [path.join(payloadRoot, 'files', 'hr-hiring', storageName)]
        : column.tableName === 'support_ticket_attachments'
          ? [path.join(payloadRoot, 'files', 'support-tickets', storageName)]
        : [
            path.join(payloadRoot, 'files', 'uploads', 'security-vehicle-pairs', storageName),
            path.join(payloadRoot, 'files', 'uploads', 'security-shift-log', storageName),
            path.join(payloadRoot, 'files', 'uploads', storageName),
          ];
      if (!candidates.some((candidate) => fs.existsSync(candidate))) {
        missing.push({ table: column.tableName, column: column.columnName, storageName });
        if (missing.length >= 25) break;
      }
    }
    if (missing.length >= 25) break;
  }
  if (missing.length) {
    throw Object.assign(new Error(`Recovery package has missing stored-file references (${missing.length} shown).`), {
      code: 'RECOVERY_FILE_REFERENCE_MISSING',
      details: missing,
    });
  }
  const readyPerformanceExports = await client.performanceExportReceipt.findMany({
    where: { status: 'READY' },
    select: { id: true, artifactPath: true },
  });
  const missingPerformanceExports: Array<{ id: string; artifactPath: string | null }> = [];
  for (const receipt of readyPerformanceExports) {
    if (!receipt.artifactPath) {
      missingPerformanceExports.push(receipt);
      continue;
    }
    const candidate = performanceExportBackupPath(payloadRoot, receipt.artifactPath);
    const stat = await fs.promises.stat(candidate).catch(() => null);
    if (!stat?.isFile()) missingPerformanceExports.push(receipt);
  }
  if (missingPerformanceExports.length) {
    throw Object.assign(new Error(`Recovery package has missing performance-export artifacts (${missingPerformanceExports.length}).`), {
      code: 'RECOVERY_PERFORMANCE_EXPORT_MISSING',
      details: missingPerformanceExports.slice(0, 25),
    });
  }
  const dispatchArtifacts = await client.dispatchDocumentArtifact.findMany({ select: { id: true, storageKey: true, byteLength: true, sha256: true } });
  const missingDispatchArtifacts = dispatchArtifacts.filter(artifact => !fs.existsSync(dispatchArtifactBackupPath(payloadRoot, artifact.storageKey)));
  if (missingDispatchArtifacts.length) {
    throw Object.assign(new Error(`Recovery package has missing dispatch-document artifacts (${missingDispatchArtifacts.length}).`), {
      code: 'RECOVERY_DISPATCH_ARTIFACT_MISSING',
      details: missingDispatchArtifacts.slice(0, 25),
    });
  }
  const corruptDispatchArtifacts: Array<{ id: string; storageKey: string; expectedByteLength: string; actualByteLength: number; expectedSha256: string; actualSha256: string }> = [];
  for (const artifact of dispatchArtifacts) {
    const artifactPath = dispatchArtifactBackupPath(payloadRoot, artifact.storageKey);
    if (!fs.existsSync(artifactPath)) continue;
    const stat = await fs.promises.stat(artifactPath);
    const actualSha256 = stat.isFile() ? await sha256File(artifactPath) : '';
    if (!stat.isFile() || BigInt(stat.size) !== BigInt(artifact.byteLength) || actualSha256 !== artifact.sha256) {
      corruptDispatchArtifacts.push({
        id: artifact.id,
        storageKey: artifact.storageKey,
        expectedByteLength: String(artifact.byteLength),
        actualByteLength: stat.size,
        expectedSha256: artifact.sha256,
        actualSha256,
      });
    }
  }
  if (corruptDispatchArtifacts.length) {
    throw Object.assign(new Error(`Recovery package has corrupt dispatch-document artifacts (${corruptDispatchArtifacts.length}).`), {
      code: 'RECOVERY_DISPATCH_ARTIFACT_CORRUPT',
      details: corruptDispatchArtifacts.slice(0, 25),
    });
  }
};

export const validateLiveStoredFileReferences = async (client: PrismaClient) => {
  const columns = await client.$queryRawUnsafe<Array<{ tableName: string; columnName: string }>>(`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('storageName', 'returnEvidenceStorageName')
      AND table_name <> 'recovery_operations'
  `);
  // Recovery packages have their own expiry lifecycle and deliberately do not
  // recursively embed older recovery packages. Deployment checkpoints protect
  // the live databases and business-owned file roots instead.
  const missing: Array<{ table: string; column: string; storageName: string }> = [];
  for (const column of columns) {
    if (!/^[A-Za-z0-9_]+$/.test(column.tableName) || !/^[A-Za-z0-9_]+$/.test(column.columnName)) continue;
    const values = await client.$queryRawUnsafe<Array<{ value: string }>>(
      `SELECT "${column.columnName}" AS value FROM "${column.tableName}" WHERE "${column.columnName}" IS NOT NULL`,
    );
    for (const row of values) {
      const storageName = path.basename(String(row.value || ''));
      if (!storageName) continue;
      const candidates = liveStoredFileReferenceCandidates(column.tableName, storageName);
      if (!candidates.some((candidate) => fs.existsSync(candidate))) missing.push({ table: column.tableName, column: column.columnName, storageName });
      if (missing.length >= 25) break;
    }
    if (missing.length >= 25) break;
  }
  if (missing.length) {
    throw Object.assign(new Error(`Live storage has missing database file references (${missing.length} shown).`), {
      code: 'DEPLOYMENT_FILE_REFERENCE_MISSING',
      details: missing,
    });
  }
  const readyPerformanceExports = await client.performanceExportReceipt.findMany({
    where: { status: 'READY' },
    select: { id: true, artifactPath: true },
  });
  const missingPerformanceExports: Array<{ id: string; artifactPath: string | null }> = [];
  for (const receipt of readyPerformanceExports) {
    if (!receipt.artifactPath) {
      missingPerformanceExports.push(receipt);
      continue;
    }
    const candidate = path.join(PERFORMANCE_EXPORT_STORAGE_DIR, performanceExportRelativePath(receipt.artifactPath));
    const stat = await fs.promises.stat(candidate).catch(() => null);
    if (!stat?.isFile()) missingPerformanceExports.push(receipt);
  }
  if (missingPerformanceExports.length) {
    throw Object.assign(new Error(`Live storage has missing performance-export artifacts (${missingPerformanceExports.length}).`), {
      code: 'DEPLOYMENT_PERFORMANCE_EXPORT_MISSING',
      details: missingPerformanceExports.slice(0, 25),
    });
  }
  return { checkedColumns: columns.length, readyPerformanceExports: readyPerformanceExports.length };
};

export const stageAndPromoteRecovery = async (input: {
  operationId: string;
  sourcePath: string;
  passphrase: string;
  packageType: RecoveryPackageType;
  checksum: string;
  actorId: string;
  actorDisplay: string;
  authorizationMode: 'TWO_ADMIN' | 'BREAK_GLASS';
  approvedById?: string | null;
  approvalExpiresAt?: Date | null;
  breakGlassReason?: string | null;
  bootstrapPassword?: string;
  applyMigrations?: boolean;
  preservePackage?: boolean;
  onProgress: (progress: number) => Promise<void>;
}) => {
  await ensureDirectories();
  const jobRoot = await fs.promises.mkdtemp(path.join(WORK_DIR, `restore-${input.operationId}-`));
  const archivePath = path.join(jobRoot, 'payload.tar.gz');
  const payloadRoot = path.join(jobRoot, 'payload');
  const config = databaseConfig();
  const stagedDatabase = safeDatabaseName('sabalan_restore');
  const safetyDatabase = safeDatabaseName('sabalan_safety');
  const safetyFilesRoot = path.join(RECOVERY_ROOT, 'safety', input.operationId);
  const journal: RestoreJournal = {
    operationId: input.operationId,
    phase: 'STAGED',
    stagedDatabase,
    safetyDatabase,
    currentDatabase: config.database,
    safetyFilesRoot,
    packageType: input.packageType,
    checksum: input.checksum,
    actorId: input.actorId,
    actorDisplay: input.actorDisplay,
    authorizationMode: input.authorizationMode,
    approvedById: input.approvedById,
    approvalExpiresAt: input.approvalExpiresAt?.toISOString() || null,
    breakGlassReason: input.breakGlassReason,
    packageStoragePath: input.sourcePath,
    bootstrapUsername: input.packageType === 'SANITIZED_TEST' ? 'local_recovery_admin' : undefined,
    startedAt: new Date().toISOString(),
    preservePackage: input.preservePackage,
  };
  try {
    await writeRestoreJournal(journal);
    await decryptRecoveryArchive(input.sourcePath, archivePath, input.passphrase);
    await fs.promises.mkdir(payloadRoot, { recursive: true });
    await extractRecoveryArchive(archivePath, payloadRoot);
    await input.onProgress(20);
    await createDatabase(process.env.DATABASE_URL || '', stagedDatabase);
    await restoreDatabase(process.env.DATABASE_URL || '', stagedDatabase, path.join(payloadRoot, 'database', 'main.dump'));
    const stagedUrl = databaseUrlWithName(process.env.DATABASE_URL || '', stagedDatabase);
    if (input.applyMigrations !== false) await migrateDatabase(stagedUrl);
    if (input.packageType === 'SANITIZED_TEST') {
      if (process.env.NODE_ENV === 'production' || process.env.ALLOW_SANITIZED_RECOVERY !== 'true') {
        throw Object.assign(new Error('Sanitized test restore is disabled in this environment.'), { code: 'SANITIZED_RESTORE_DISABLED' });
      }
      if (!input.bootstrapPassword) throw new Error('Bootstrap password is required.');
      await createSanitizedBootstrapAdmin(stagedUrl, input.bootstrapPassword);
    }
    const stagedClient = new PrismaClient({ datasources: { db: { url: stagedUrl } } });
    try {
      await stagedClient.$queryRaw`SELECT 1`;
      await validateStoredFileReferences(stagedClient, payloadRoot);
      await stagedClient.authSession.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'SYSTEM_RECOVERY_GLOBAL_REVOCATION' },
      });
    } finally {
      await stagedClient.$disconnect();
    }
    await writeRestoreJournal(journal);
    await input.onProgress(50);
    await pauseInquiryForRecovery(input.operationId);
    const mappings = [
      ...FILE_RECOVERY_MAPPINGS.map(({ payloadPath, livePath, safetyName }) => [payloadPath, livePath, safetyName] as const),
      ['inquiry', INQUIRY_SOURCE_DIR, 'inquiry'],
    ] as const;
    for (const [relativeSource, destination, safetyName] of mappings) {
      await replaceDirectoryContents(path.join(payloadRoot, relativeSource), destination, path.join(safetyFilesRoot, safetyName));
    }
    journal.phase = 'FILES_PROMOTED';
    await writeRestoreJournal(journal);
    await input.onProgress(70);
    const current = config.database.replace(/"/g, '""');
    const staged = stagedDatabase.replace(/"/g, '""');
    const safety = safetyDatabase.replace(/"/g, '""');
    await psql(
      process.env.DATABASE_URL || '',
      'postgres',
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${current.replace(/'/g, "''")}', '${staged.replace(/'/g, "''")}') AND pid <> pg_backend_pid()`,
    );
    await psql(process.env.DATABASE_URL || '', 'postgres', `ALTER DATABASE "${current}" RENAME TO "${safety}"`);
    try {
      await psql(process.env.DATABASE_URL || '', 'postgres', `ALTER DATABASE "${staged}" RENAME TO "${current}"`);
    } catch (error) {
      await psql(process.env.DATABASE_URL || '', 'postgres', `ALTER DATABASE "${safety}" RENAME TO "${current}"`).catch(() => undefined);
      throw error;
    }
    journal.phase = 'DATABASE_PROMOTED';
    await writeRestoreJournal(journal);
    if (input.packageType === 'SANITIZED_TEST') {
      await fs.promises.writeFile(SANITIZED_MARKER_PATH, JSON.stringify({ operationId: input.operationId, restoredAt: new Date().toISOString() }), { mode: 0o600 });
    } else {
      await fs.promises.rm(SANITIZED_MARKER_PATH, { force: true });
    }
    await resumeInquiryAfterRecovery();
    await input.onProgress(90);
    return { promoted: true, journal };
  } catch (error) {
    const currentJournal = fs.existsSync(RESTORE_JOURNAL_PATH)
      ? JSON.parse(await fs.promises.readFile(RESTORE_JOURNAL_PATH, 'utf8')) as RestoreJournal
      : journal;
    if (currentJournal.phase === 'DATABASE_PROMOTED') {
      await resumeInquiryAfterRecovery();
      return { promoted: true, journal: currentJournal };
    }
    if (fs.existsSync(safetyFilesRoot)) {
      const mappings = [
        ...FILE_RECOVERY_MAPPINGS.map(({ safetyName, livePath }) => [safetyName, livePath] as const),
        ['inquiry', INQUIRY_SOURCE_DIR],
      ] as const;
      for (const [safetyName, destination] of mappings) {
        await restoreDirectoryFromSafety(path.join(safetyFilesRoot, safetyName), destination);
      }
      await dropDatabase(process.env.DATABASE_URL || '', stagedDatabase);
      await fs.promises.rm(RESTORE_JOURNAL_PATH, { force: true });
    }
    await resumeInquiryAfterRecovery();
    throw error;
  } finally {
    await fs.promises.rm(jobRoot, { recursive: true, force: true });
  }
};

export const readRestoreJournal = async (): Promise<RestoreJournal | null> => {
  try {
    return JSON.parse(await fs.promises.readFile(RESTORE_JOURNAL_PATH, 'utf8')) as RestoreJournal;
  } catch {
    return null;
  }
};

export const finalizePromotedRecovery = async (prisma: PrismaClient, journal: RestoreJournal) => {
  const actorExists = await prisma.user.findUnique({ where: { id: journal.actorId }, select: { id: true } });
  const existing = await prisma.recoveryOperation.findUnique({ where: { id: journal.operationId } });
  if (!existing) {
    await prisma.recoveryOperation.create({
      data: {
        id: journal.operationId,
        packageType: journal.packageType,
        source: 'RESTORED',
        status: 'COMPLETED',
        progress: 100,
        encryptedSha256: journal.checksum,
        createdById: actorExists?.id,
        approvedById: journal.approvedById && await prisma.user.findUnique({ where: { id: journal.approvedById }, select: { id: true } }).then((row) => row?.id),
        breakGlassReason: journal.breakGlassReason,
        restoreStartedAt: new Date(journal.startedAt),
        completedAt: new Date(),
      },
    });
  } else {
    await prisma.recoveryOperation.update({
      where: { id: journal.operationId },
      data: { status: 'COMPLETED', progress: 100, completedAt: new Date(), errorCode: null, errorMessage: null },
    });
  }
  await prisma.recoveryAuditEvent.create({
    data: {
      operationId: journal.operationId,
      actorId: actorExists?.id,
      eventType: 'RECOVERY_RESTORE_COMPLETED',
      packageChecksum: journal.checksum,
      details: {
        actorDisplay: journal.actorDisplay,
        packageType: journal.packageType,
        globalSessionRevocation: true,
        authorizationMode: journal.authorizationMode,
        approvedById: journal.approvedById,
        approvalExpiresAt: journal.approvalExpiresAt,
        breakGlassReason: journal.breakGlassReason,
      },
    },
  });
  if (journal.approvedById) {
    const approver = await prisma.user.findUnique({ where: { id: journal.approvedById }, select: { id: true } });
    await prisma.recoveryAuditEvent.create({
      data: {
        operationId: journal.operationId,
        actorId: approver?.id,
        eventType: 'RECOVERY_RESTORE_APPROVAL_PRESERVED',
        packageChecksum: journal.checksum,
        details: { approvalExpiresAt: journal.approvalExpiresAt, authorizationMode: journal.authorizationMode },
      },
    });
  }
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
  if (admins.length) {
    await publishNotificationEvent(prisma, {
      type: 'SYSTEM_RECOVERY_COMPLETED',
      deduplicationKey: `system-recovery-completed:${journal.operationId}`,
      recipientIds: admins.map((admin) => admin.id),
      actorId: actorExists?.id,
      resourceType: 'RecoveryOperation',
      resourceId: journal.operationId,
      referenceId: journal.operationId,
      actionUrl: '/dashboard/admin/system-recovery',
      payload: { actorDisplay: journal.actorDisplay },
    });
  }
  await dropDatabase(process.env.DATABASE_URL || '', journal.safetyDatabase);
  await fs.promises.rm(journal.safetyFilesRoot, { recursive: true, force: true });
  if (!journal.preservePackage) await fs.promises.rm(journal.packageStoragePath, { force: true });
  await fs.promises.rm(RESTORE_JOURNAL_PATH, { force: true });
};

export const isSanitizedRecoveryEnvironment = () => fs.existsSync(SANITIZED_MARKER_PATH);

export const rollbackInterruptedRecovery = async (journal: RestoreJournal) => {
  const mappings = [
    ...FILE_RECOVERY_MAPPINGS.map(({ safetyName, livePath }) => [safetyName, livePath] as const),
    ['inquiry', INQUIRY_SOURCE_DIR],
  ] as const;
  for (const [safetyName, destination] of mappings) {
    await restoreDirectoryFromSafety(path.join(journal.safetyFilesRoot, safetyName), destination);
  }
  await dropDatabase(process.env.DATABASE_URL || '', journal.stagedDatabase);
  await fs.promises.rm(journal.safetyFilesRoot, { recursive: true, force: true });
  await fs.promises.rm(RESTORE_JOURNAL_PATH, { force: true });
};

export const removeRecoveryPackage = async (source: string, storageName?: string | null) => {
  if (!storageName) return;
  await fs.promises.rm(recoveryPackagePath(source, storageName), { force: true });
};

export const recoveryEngineInternals = {
  databaseConfig,
  databaseUrlWithName,
  safeDatabaseName,
  dispatchArtifactBackupPath,
  dispatchDocumentStorageDirectory: DISPATCH_DOCUMENT_STORAGE_DIR,
  performanceExportBackupPath,
  performanceExportStorageDirectory: PERFORMANCE_EXPORT_STORAGE_DIR,
  fileRecoveryMappings: FILE_RECOVERY_MAPPINGS,
  validateStoredFileReferences,
  liveStoredFileReferenceCandidates,
  shouldExcludeSupportTicketCheckpointFile,
};
