import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication, type VersionedFileRootScope } from './versionedFilePublication';
import { publishDurableFile, removeDurableFile } from './durableFilePublication';
import { configureAccountingPdfParentFiles } from './accountingFileRuntime';

export const DOCUMENT_PDF_RETAINED_ROOTS = Object.freeze(['contracts', 'accounting-contracts']
  .map(name => path.resolve(process.cwd(), 'storage', name)).sort());
export const DOCUMENT_PDF_EPHEMERAL_ROOTS = Object.freeze(['reports', 'sales-reports', 'bi-reports']
  .map(name => path.resolve(process.cwd(), 'storage', name)).sort());
const ACCOUNTING_ROOT = path.resolve(process.cwd(), 'storage', 'accounting-contracts');
const MAX_EPHEMERAL_PDF_BYTES = 256 * 1024 * 1024;
const MAX_TEMPORARY_GENERATIONS = 10000;
type Generation = { state: 'PUBLISHING' | 'SETTLED' | 'REMOVING' | 'HELD'; identity?: string };
const temporaryGenerations = new Map<string, Generation>();
const generationIdentity = (value: BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.uid, value.mode, value.nlink].map(String).join(':');
type Pin = { device: string; inode: string };
type Profile = { boundary: RuntimeWorkBoundary; retained: ReadonlyMap<string, VersionedFileRootScope>;
  ephemeral: ReadonlyMap<string, Pin> };
let phase: 'UNBOUND' | 'CONFIGURING' | 'READY' | 'FAILED' = 'UNBOUND';
let observed = false;
let profile: Profile | undefined;
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }

async function privateRoot(root: string): Promise<Pin> {
  if (await fs.realpath(root) !== root) fail('DOCUMENT_PDF_DIRECTORY_ALIAS');
  const value = await fs.lstat(root, { bigint: true });
  if (!value.isDirectory() || value.uid !== BigInt(process.getuid!()) || (value.mode & 0o077n)) fail('DOCUMENT_PDF_DIRECTORY_UNSAFE');
  return { device: String(value.dev), inode: String(value.ino) };
}

/** Startup only. Retained Accounting PDFs and official-report children share
 * one publisher; no overlap or late owner replacement is permitted. The three
 * explicitly classified temporary report roots are admitted live work only,
 * not retained recovery sources. The controller precreates every directory. */
export async function configurePrivateVersionedDocumentPdfs(input: {
  boundary: RuntimeWorkBoundary; roots: readonly { root: string; publication: VersionedFilePublication }[];
}): Promise<void> {
  if (phase !== 'UNBOUND') fail('DOCUMENT_PDF_RUNTIME_ALREADY_BOUND');
  if (observed) fail('DOCUMENT_PDF_RUNTIME_ALREADY_OBSERVED');
  runtimeHttpRequests.assertBeforeFirstRequest();
  if (!(input?.boundary instanceof RuntimeWorkBoundary) || input.boundary.requests !== runtimeHttpRequests
    || !Array.isArray(input.roots)) fail('DOCUMENT_PDF_RUNTIME_SCOPE_INVALID');
  for (const source of input.roots) {
    if (!source || !path.isAbsolute(source.root) || path.resolve(source.root) !== source.root
      || !(source.publication instanceof VersionedFilePublication) || !source.publication.ownsRoot(source.root)
      || !source.publication.ownsWork(input.boundary.context)) fail('DOCUMENT_PDF_RUNTIME_SCOPE_INVALID');
  }
  if (JSON.stringify(input.roots.map(source => source.root).sort()) !== JSON.stringify(DOCUMENT_PDF_RETAINED_ROOTS)) {
    fail('DOCUMENT_PDF_RUNTIME_ROOT_SET_INCOMPLETE');
  }
  phase = 'CONFIGURING';
  try {
    const ephemeral = new Map<string, Pin>(), retained = new Map<string, VersionedFileRootScope>();
    for (const root of DOCUMENT_PDF_EPHEMERAL_ROOTS) ephemeral.set(root, await privateRoot(root));
    for (const source of input.roots) retained.set(source.root, await source.publication.bindRoot(source.root));
    const parent = input.roots.find(source => source.root === ACCOUNTING_ROOT)!;
    await configureAccountingPdfParentFiles({ boundary: input.boundary, publication: parent.publication });
    runtimeHttpRequests.assertBeforeFirstRequest();
    if (observed) fail('DOCUMENT_PDF_RUNTIME_ALREADY_OBSERVED');
    profile = { boundary: input.boundary, retained, ephemeral }; phase = 'READY';
  } catch (error) { phase = 'FAILED'; throw error; }
}

function selected() {
  observed = true;
  if (phase === 'CONFIGURING' || phase === 'FAILED') fail('DOCUMENT_PDF_RUNTIME_NOT_READY');
  return profile;
}
function target(file: string) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || !/^[\w.-]+\.pdf$/.test(path.basename(file))) fail('DOCUMENT_PDF_TARGET_INVALID');
  return { root: path.dirname(file), key: path.basename(file) };
}
async function assertTemporaryRoot(current: Profile, root: string) {
  const expected = current.ephemeral.get(root);
  if (!expected) fail('DOCUMENT_PDF_TEMPORARY_ROOT_UNCLASSIFIED');
  const actual = await privateRoot(root);
  if (actual.device !== expected.device || actual.inode !== expected.inode) fail('DOCUMENT_PDF_DIRECTORY_CHANGED');
}

/** The actual renderer and its awaited browser.close remain inside the same
 * admitted work as publication. Unknown destinations refuse before rendering. */
export async function publishDocumentPdfFile(file: string, render: () => Promise<Buffer>): Promise<string> {
  const current = selected();
  const root = path.dirname(file), temporary = DOCUMENT_PDF_EPHEMERAL_ROOTS.includes(root);
  if (!current && !temporary) { await publishDurableFile(file, await render(), { replace: true }); return file; }
  const { key } = target(file), retained = current?.retained.get(root);
  if (current && !retained && !temporary) fail('DOCUMENT_PDF_OUTPUT_ROOT_UNCLASSIFIED');
  current?.boundary.context.assertActive();
  const publish = async () => {
    if (!temporary) {
      await retained!.publish(key, await render(), { replace: true }); return file;
    }
    if (temporaryGenerations.size >= MAX_TEMPORARY_GENERATIONS) fail('DOCUMENT_PDF_TEMPORARY_GENERATION_CAPACITY');
    // This private path is never reused, even if two callers request the same
    // timestamp/name. Human download names and retained document keys stay as-is.
    const actualPath = path.join(root, key.slice(0, -4).slice(0, 180) + '.' + randomBytes(16).toString('hex') + '.pdf');
    if (temporaryGenerations.has(actualPath)) fail('DOCUMENT_PDF_TEMPORARY_GENERATION_COLLISION');
    const generation: Generation = { state: 'PUBLISHING' }; temporaryGenerations.set(actualPath, generation);
    let publishing = false;
    try {
      if (current) await assertTemporaryRoot(current, root);
      const bytes = await render();
      if (bytes.length > MAX_EPHEMERAL_PDF_BYTES) fail('DOCUMENT_PDF_TEMPORARY_CAPACITY');
      if (current) await assertTemporaryRoot(current, root);
      publishing = true;
      const result = await publishDurableFile(actualPath, bytes); // Atomic no-clobber, including ordinary mode.
      const value = await fs.lstat(actualPath, { bigint: true });
      if (!value.isFile() || value.nlink !== 1n || String(value.ino) !== result.identity.inode
        || (process.platform !== 'win32' && String(value.dev) !== result.identity.device)
        || value.size !== BigInt(result.byteLength)) fail('DOCUMENT_PDF_TEMPORARY_GENERATION_CHANGED');
      if (current) await assertTemporaryRoot(current, root);
      generation.identity = generationIdentity(value); generation.state = 'SETTLED'; return actualPath;
    } catch (error) {
      if (!publishing) temporaryGenerations.delete(actualPath);
      else generation.state = 'HELD'; // Unknown publication is never adopted or deleted by a later callback.
      throw error;
    }
  };
  return current ? current.boundary.context.run(publish) : publish();
}

/** Used only after the actual download callback. Retained documents cannot be
 * deleted by temporary-report delivery, even if a caller supplies their path. */
export async function removeTemporaryDocumentPdf(file: string): Promise<boolean> {
  const current = selected();
  const { root } = target(file);
  if (!DOCUMENT_PDF_EPHEMERAL_ROOTS.includes(root)) fail('DOCUMENT_PDF_TEMPORARY_ROOT_UNCLASSIFIED');
  current?.boundary.context.assertActive();
  const generation = temporaryGenerations.get(file);
  if (!generation || !/\.[a-f0-9]{32}\.pdf$/.test(path.basename(file)) || generation.state !== 'SETTLED'
    || !generation.identity) fail('DOCUMENT_PDF_TEMPORARY_GENERATION_UNPROVEN');
  generation.state = 'REMOVING'; // Claim synchronously, before another callback can begin.
  const remove = async () => {
    try {
      if (current) await assertTemporaryRoot(current, root);
      const actual = await fs.lstat(file, { bigint: true });
      if (!actual.isFile() || generationIdentity(actual) !== generation.identity) fail('DOCUMENT_PDF_TEMPORARY_GENERATION_CHANGED');
      const removed = await removeDurableFile(file);
      if (current) await assertTemporaryRoot(current, root);
      temporaryGenerations.delete(file); return removed;
    } catch (error) { generation.state = 'HELD'; throw error; }
  };
  try { return await (current ? current.boundary.context.run(remove) : remove()); }
  catch (error) { generation.state = 'HELD'; throw error; }
}
