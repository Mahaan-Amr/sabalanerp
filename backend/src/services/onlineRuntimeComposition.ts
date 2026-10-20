import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RuntimeWorkBoundary } from './runtimeWorkBoundary';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { VersionedFilePublication } from './versionedFilePublication';
import { assertOnlineRuntimeAdmission, type OnlineRuntimeAdmission } from './onlineReleaseAdmission';
import type { OnlineReleaseManifest } from './onlineReleaseEvidence';
import {assertOriginalOnlinePrivateQualification,type OnlinePrivateQualification} from './onlinePrivateQualificationAuthority';
type CompositionManifest=Pick<OnlineReleaseManifest,'roots'|'ephemeralRoots'|'runtimeBundleSha256'|'generation'>;
import { HR_PERSONNEL_ERASURE_STORAGE_ROOTS } from './hrPersonnelErasureGraph';
import { configurePrivateVersionedHrFiles } from './hrFileRuntime';
import { configurePrivateVersionedSharedUploads, SHARED_UPLOAD_ROOTS } from './sharedUploadFileRuntime';
import { configurePrivateVersionedDocumentPdfs, DOCUMENT_PDF_RETAINED_ROOTS, DOCUMENT_PDF_EPHEMERAL_ROOTS } from './documentPdfFileRuntime';
import { ACCOUNTING_OFFICIAL_REPORT_ROOT } from './accountingFileRuntime';
import { configurePrivateVersionedDispatchFiles, DISPATCH_DOCUMENT_STORAGE_ROOT } from './dispatchFileRuntime';
import { configurePrivateVersionedPerformanceFiles, performanceExportStorageDirectory } from './performanceFileRuntime';
import { configurePrivateVersionedSupportFiles, supportTicketStorageDirectory } from './supportFileRuntime';

function fail(): never { throw new Error('ONLINE_RUNTIME_ROOT_INVENTORY_UNPROVEN'); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const required = () => [...new Set([...HR_PERSONNEL_ERASURE_STORAGE_ROOTS, ...DOCUMENT_PDF_RETAINED_ROOTS,
  DISPATCH_DOCUMENT_STORAGE_ROOT, performanceExportStorageDirectory(), supportTicketStorageDirectory()])].sort();
const contained = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};

/** Read-only preparation; never create a missing history store or adopt live
 * bytes during a serving startup. Initial adoption belongs to protected EX. */
export function validateOnlineRootInventory(manifest: CompositionManifest, gate?: { device: string; inode: string; ownerUid: number }) {
  if (!same(manifest.roots.map(value => value.live).sort(), required())
    || !same([...manifest.ephemeralRoots].sort(), [...DOCUMENT_PDF_EPHEMERAL_ROOTS].sort())) fail();
  const directories = [...manifest.roots.flatMap(value => [value.live, value.store]), ...manifest.ephemeralRoots];
  if (process.platform === 'linux') {
    const descriptor = fs.openSync('/proc/self/mountinfo', fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = Buffer.alloc(262145); let length = 0;
      while (length < bytes.length) { const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
      if (!length || length >= bytes.length) fail();
      for (const line of bytes.subarray(0, length).toString('utf8').trim().split('\n')) {
        const target = line.split(' ')[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
        if (!target || directories.some(directory => target.startsWith(directory + '/'))) fail();
      }
    } finally { fs.closeSync(descriptor); }
  }
  for (const [index, directory] of directories.entries()) {
    if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || fs.realpathSync(directory) !== directory) fail();
    const value = fs.lstatSync(directory, { bigint: true });
    if (!value.isDirectory() || value.isSymbolicLink() || (value.mode & 0o077n)
      || (process.getuid && value.uid !== BigInt(process.getuid()))) fail();
    for (const other of directories.slice(index + 1)) if (contained(directory, other) || contained(other, directory)) fail();
  }
  for (const root of manifest.roots) {
    const live = fs.lstatSync(root.live, { bigint: true }), store = fs.lstatSync(root.store, { bigint: true });
    if (String(live.dev) !== root.liveDevice || String(live.ino) !== root.liveInode
      || String(store.dev) !== root.storeDevice || String(store.ino) !== root.storeInode) fail();
    for (const part of ['objects', 'versions', 'heads', 'pending', 'seals', 'reservations']) {
      const target = path.join(root.store, part), value = fs.lstatSync(target);
      if (!value.isDirectory() || value.isSymbolicLink() || fs.realpathSync(target) !== target || (value.mode & 0o077)) fail();
    }
    const baselines = fs.readdirSync(root.store).filter(name => /^legacy-adoption-[a-f0-9]{64}\.json$/.test(name));
    if (baselines.length !== 1) fail();
    const file = path.join(root.store, baselines[0]), descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const before = fs.fstatSync(descriptor, { bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 16384n || (before.mode & 0o777n) !== 0o400n
        || (process.getuid && before.uid !== BigInt(process.getuid()))) fail();
      const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
      while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null); if (!count) fail(); offset += count; }
      if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) fail();
      if (createHash('sha256').update(bytes).digest('hex') !== root.baselineSha256) fail();
      const proof = JSON.parse(bytes.toString('utf8'));
      if (proof.format !== 'sabalan-file-legacy-adoption/v1' || proof.source?.path !== root.live
        || proof.source?.device !== root.liveDevice || proof.source?.inode !== root.liveInode
        || proof.publicOnlineAdmission !== false || proof.captureId !== baselines[0].slice(16, -5)
        || !/^[a-f0-9]{64}$/.test(proof.inventorySha256) || !Number.isSafeInteger(proof.files) || proof.files < 0
        || !Number.isSafeInteger(proof.bytes) || proof.bytes < 0
        || (gate && (proof.gate?.device !== gate.device || proof.gate?.inode !== gate.inode || proof.gate?.ownerUid !== gate.ownerUid))) fail();
      for (const actual of [fs.fstatSync(descriptor, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
        for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'nlink'] as const)
          if (actual[key] !== before[key]) fail();
      }
    } finally { fs.closeSync(descriptor); }
  }
  const official = fs.lstatSync(ACCOUNTING_OFFICIAL_REPORT_ROOT);
  if (!official.isDirectory() || official.isSymbolicLink() || (official.mode & 0o077)
    || fs.realpathSync(ACCOUNTING_OFFICIAL_REPORT_ROOT) !== ACCOUNTING_OFFICIAL_REPORT_ROOT) fail();
}

let phase: 'UNBOUND' | 'OPENING' | 'READY' | 'FAILED' = 'UNBOUND';
declare const composedBrand: unique symbol;
export type OnlineComposedRuntime = Readonly<{ [composedBrand]: true }>;
type RootComposition = Readonly<{ boundary: RuntimeWorkBoundary;
  roots: readonly Readonly<{ root: string; publication: VersionedFilePublication }>[] }>;
type Composition=RootComposition & Readonly<{admission:OnlineRuntimeAdmission}>;
const composed = new WeakMap<OnlineComposedRuntime, Composition>();
declare const qualifiedBrand:unique symbol;
export type OnlineQualifiedRuntime=Readonly<{[qualifiedBrand]:true}>;
const qualified=new WeakMap<OnlineQualifiedRuntime,RootComposition & Readonly<{qualification:OnlinePrivateQualification}>>();
export function assertOnlineQualifiedRuntime(runtime:OnlineQualifiedRuntime,purpose?:'http'|'jobs'){
  const value=qualified.get(runtime);if(!value||phase!=='READY')fail();
  assertOriginalOnlinePrivateQualification(value.qualification,purpose);return value;
}
export function assertOnlineComposedRuntime(runtime: OnlineComposedRuntime, purpose?: 'http' | 'jobs'): Composition {
  const value = composed.get(runtime);
  if (!value || phase !== 'READY') fail();
  assertOnlineRuntimeAdmission(value.admission, purpose);
  return value;
}
export async function openOnlineRuntimeComposition(input:{admission:OnlineRuntimeAdmission;boundary:RuntimeWorkBoundary}){
 const manifest=assertOnlineRuntimeAdmission(input.admission);
 const roots=await openRootComposition(manifest,input.boundary,()=>{assertOnlineRuntimeAdmission(input.admission);});
 const runtime=Object.freeze({}) as OnlineComposedRuntime;
 composed.set(runtime,Object.freeze({...roots,admission:input.admission}));return runtime;
}
/** Private qualification is a distinct brand. It never becomes release admission. */
export async function openOnlineQualificationComposition(input:{qualification:OnlinePrivateQualification;boundary:RuntimeWorkBoundary}){
 const {artifacts}=assertOriginalOnlinePrivateQualification(input.qualification);
 const roots=await openRootComposition(artifacts,input.boundary,()=>{assertOriginalOnlinePrivateQualification(input.qualification);});
 const runtime=Object.freeze({}) as OnlineQualifiedRuntime;
 qualified.set(runtime,Object.freeze({...roots,qualification:input.qualification}));return runtime;
}
/** Unexported common implementation; no caller-supplied verifier is public. */
async function openRootComposition(manifest:CompositionManifest,boundary:RuntimeWorkBoundary,assertAuthority:()=>void):Promise<RootComposition>{
  if (phase !== 'UNBOUND' || !(boundary instanceof RuntimeWorkBoundary)
    || boundary.requests !== runtimeHttpRequests) fail();
  runtimeHttpRequests.assertBeforeFirstRequest(); phase = 'OPENING';
  try {
    const gate = boundary.context.gateIdentity(); validateOnlineRootInventory(manifest, gate);
    const roots: Array<{ root: string; publication: VersionedFilePublication }> = [];
    for (const root of manifest.roots) {
      assertAuthority();
      roots.push({ root: root.live, publication: await VersionedFilePublication.open(root.store, root.live, boundary.context) });
    }
    const publication = (root: string) => roots.find(value => value.root === root)!.publication;
    configurePrivateVersionedHrFiles({ boundary: boundary, roots: roots.filter(value => HR_PERSONNEL_ERASURE_STORAGE_ROOTS.includes(value.root)) });
    await configurePrivateVersionedSharedUploads({ boundary: boundary, roots: roots.filter(value => SHARED_UPLOAD_ROOTS.includes(value.root)) });
    await configurePrivateVersionedDocumentPdfs({ boundary: boundary, roots: roots.filter(value => DOCUMENT_PDF_RETAINED_ROOTS.includes(value.root)) });
    await configurePrivateVersionedDispatchFiles({ boundary: boundary, publication: publication(DISPATCH_DOCUMENT_STORAGE_ROOT) });
    await configurePrivateVersionedPerformanceFiles({ boundary: boundary, publication: publication(performanceExportStorageDirectory()) });
    await configurePrivateVersionedSupportFiles({ boundary: boundary, publication: publication(supportTicketStorageDirectory()) });
    validateOnlineRootInventory(manifest, gate); runtimeHttpRequests.assertBeforeFirstRequest();
    assertAuthority();phase='READY';
    return Object.freeze({boundary,roots:Object.freeze(roots.map(value=>Object.freeze(value)))});
  } catch (error) { phase = 'FAILED'; throw error; }
}
