import fs from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { applicationRuntimeDatabaseUrl } from './runtimeNativeAuthority';
import { writableTrustKeyAliases } from './onlineTrustMountPaths';
import { parseOnlineHttpIngress, type OnlineHttpIngress } from './onlinePrivateIngress';

export const ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY = '/run/sabalan-online/release-controller-public-key.pem';
const DOMAIN = 'sabalan-online-runtime-startup/v2\n';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(canonical(value)), 'utf8');
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(): never { throw new Error('ONLINE_ORIGINAL_CONTROLLER_AUTHORITY_UNPROVEN'); }
const pin = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.uid, value.mode, value.nlink].map(String).join(':');
export type OnlineStartupDecision = Readonly<{ format: 'sabalan-online-startup-decision/v2'; purpose: 'online-runtime-startup';
  scopeSha256: string; runtimeId: string; nonceSha256: string; runtimePurpose: 'http' | 'jobs'; role: 'serving' | 'control';
  releaseId: string; image: string; sourceCommit: string; runtimeBundleSha256: string; manifestSha256: string;
  acceptanceSha256: string; database: Readonly<{ name: string; systemIdentifier: string }>;
  httpIngress: OnlineHttpIngress | null; issuedAt: string; expiresAt: string }>;

/** Pure signature verification only. Returning data here cannot register a
 * runtime authority. Only the fixed read-only native trust mount below can
 * mint the private capability. The host signer is responsible for actual typed
 * acceptance, original lease/checkpoint/native proofs before signing. */
export function verifyOnlineStartupDecision(bytes: Buffer, publicKeyBytes: Buffer, now = new Date()): OnlineStartupDecision {
  if (bytes.length < 1 || bytes.length > 16384 || publicKeyBytes.length < 1 || publicKeyBytes.length > 4096) fail();
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(publicKeyBytes.toString('ascii'))) fail();
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (!exact(envelope, ['format', 'decision', 'signature']) || envelope.format !== 'sabalan-signed-online-startup/v2'
    || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) fail();
  if (Buffer.from(envelope.signature, 'base64').toString('base64') !== envelope.signature) fail();
  const value = envelope.decision;
  if (!exact(value, ['format', 'purpose', 'scopeSha256', 'runtimeId', 'nonceSha256', 'runtimePurpose', 'role', 'releaseId',
    'image', 'sourceCommit', 'runtimeBundleSha256', 'manifestSha256', 'acceptanceSha256', 'database', 'httpIngress', 'issuedAt', 'expiresAt'])
    || value.format !== 'sabalan-online-startup-decision/v2' || value.purpose !== 'online-runtime-startup'
    || ![value.scopeSha256, value.runtimeId, value.nonceSha256, value.runtimeBundleSha256, value.manifestSha256, value.acceptanceSha256].every(hex)
    || !((value.runtimePurpose === 'http' && value.role === 'serving') || (value.runtimePurpose === 'jobs' && value.role === 'control'))
    || typeof value.releaseId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.releaseId)
    || !/^sha256:[a-f0-9]{64}$/.test(value.image) || !/^[a-f0-9]{40}$/.test(value.sourceCommit)
    || !exact(value.database, ['name', 'systemIdentifier']) || typeof value.database.name !== 'string'
    || !/^[a-zA-Z0-9_]{1,63}$/.test(value.database.name) || !/^[1-9][0-9]*$/.test(value.database.systemIdentifier)) fail();
  if (value.runtimePurpose === 'http') value.httpIngress = parseOnlineHttpIngress(value.httpIngress);
  else if (value.httpIngress !== null) fail();
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt), current = now.getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(current)
    || new Date(issued).toISOString() !== value.issuedAt || new Date(expires).toISOString() !== value.expiresAt
    || issued > current || expires <= current || expires <= issued || expires - issued > 600_000) fail();
  const key = createPublicKey(publicKeyBytes);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.concat([Buffer.from(DOMAIN), encoded(value)]), key,
    Buffer.from(envelope.signature, 'base64'))) fail();
  Object.freeze(value.database); return Object.freeze(value);
}

declare const controllerBrand: unique symbol;
export type OnlineControllerAuthority = Readonly<{ [controllerBrand]: true }>;
type State = { input: NonNullable<ReturnType<typeof loadOnlineRuntimeScope>>; decision: OnlineStartupDecision;
  keyPin: string; decisionPin: string; decisionPath: string; keySha256: string; decisionSha256: string };
const authorities = new WeakMap<OnlineControllerAuthority, State>();
function read(file: string, maximum: number, mode: number) {
  if (fs.realpathSync(file) !== file) fail();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum)
      || (before.mode & 0o777n) !== BigInt(mode)) fail();
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) fail(); offset += count; }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0 || pin(before) !== pin(fs.fstatSync(fd, { bigint: true }))
      || pin(before) !== pin(fs.lstatSync(file, { bigint: true }))) fail();
    return { bytes, identity: pin(before), uid: before.uid, stat: before,
      mountId: fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^mnt_id:\s+([0-9]+)$/m)?.[1] };
  } finally { fs.closeSync(fd); }
}
function assertTrustMount(input: State['input'], key: ReturnType<typeof read>) {
  const file = fs.openSync('/proc/self/mountinfo', fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let raw: Buffer;
  try { const buffer = Buffer.alloc(262145); let length = 0;
    while (length < buffer.length) { const count = fs.readSync(file, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (!length || length >= buffer.length) fail(); raw = buffer.subarray(0, length);
  } finally { fs.closeSync(file); }
  if (digest(raw) !== input.mountInfoSha256 || key.uid !== 0n || !key.mountId) fail();
  const decode = (value: string) => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  const mounts = raw.toString('utf8').trim().split('\n').map(line => {
    const [before, after] = line.split(' - '), fields = before.split(' ');
    if (!after || fields.length < 6) fail();
    return { id: fields[0], device: fields[2], root: decode(fields[3]), target: decode(fields[4]), options: fields[5].split(',') };
  });
  const selected = mounts.find(value => value.id === key.mountId);
  if (!selected || ![ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY, '/run/sabalan-online'].includes(selected.target) || !selected.options.includes('ro')
    || selected.options.includes('rw')) fail();
  for (const alias of writableTrustKeyAliases(mounts, selected, ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY)) {
    try { const value = fs.statSync(alias, { bigint: true });
      if (value.dev === key.stat.dev && value.ino === key.stat.ino) fail();
    } catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
}

/** No environment public key, alternate path, generated fallback, verifier
 * injection or private signer is available in the application runtime. */
export function openOriginalOnlineControllerAuthority(): OnlineControllerAuthority {
  if (process.platform !== 'linux') fail();
  const input = loadOnlineRuntimeScope();
  if (!input || input.scope.format !== 'sabalan-online-runtime-scope/v2' || !applicationRuntimeDatabaseUrl()) fail();
  const key = read(ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY, 4096, 0o444); assertTrustMount(input, key);
  const decisionPath = path.join(input.scope.nativeDirectory, 'release-acceptance', 'startup-decision.json');
  const signed = read(decisionPath, 16384, 0o400), decision = verifyOnlineStartupDecision(signed.bytes, key.bytes);
  if (signed.uid !== BigInt(process.getuid!())) fail();
  if (decision.scopeSha256 !== input.sha256 || decision.runtimeId !== input.scope.runtimeId
    || decision.nonceSha256 !== digest(Buffer.from(input.scope.nonce)) || decision.runtimePurpose !== input.scope.purpose
    || decision.role !== input.scope.role || decision.releaseId !== input.scope.releaseId || decision.image !== input.scope.image
    || decision.sourceCommit !== input.scope.sourceCommit || decision.runtimeBundleSha256 !== input.scope.manifestSha256
    || JSON.stringify(canonical(decision.database)) !== JSON.stringify(canonical(input.scope.database))) fail();
  const authority = Object.freeze({}) as OnlineControllerAuthority;
  authorities.set(authority, { input, decision, keyPin: key.identity, decisionPin: signed.identity, decisionPath,
    keySha256: digest(key.bytes), decisionSha256: digest(signed.bytes) }); return authority;
}

export function assertOriginalOnlineControllerAuthority(authority: OnlineControllerAuthority): OnlineStartupDecision {
  const state = authorities.get(authority);
  if (!state || loadOnlineRuntimeScope() !== state.input || !applicationRuntimeDatabaseUrl()) fail();
  const key = read(ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY, 4096, 0o444), signed = read(state.decisionPath, 16384, 0o400);
  assertTrustMount(state.input, key);
  if (key.identity !== state.keyPin || signed.identity !== state.decisionPin || digest(key.bytes) !== state.keySha256
    || digest(signed.bytes) !== state.decisionSha256) fail();
  return state.decision;
}
