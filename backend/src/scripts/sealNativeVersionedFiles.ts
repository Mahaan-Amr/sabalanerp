import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NativeFileCaptureAuthority } from '../services/nativeFileCaptureAuthority';
import { VersionedFilePublication } from '../services/versionedFilePublication';

/** Private descendant of the actual capture worker. Never run as an HTTP
 * application, never opens Prisma, and cannot manufacture a runtime grant. */
async function main() {
  if (process.platform !== 'linux' || process.argv.length !== 4 || process.umask() !== 0o077
    || !/^[a-f0-9]{64}$/.test(process.argv[3])) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
  const scopeFile = process.argv[2];
  if (!path.isAbsolute(scopeFile) || fs.realpathSync(scopeFile) !== scopeFile) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
  const fd = fs.openSync(scopeFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid!())
      || (stat.mode & 0o777n) !== 0o400n || stat.size < 1n || stat.size > 262144n) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
    bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
      offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(scopeFile, { bigint: true });
    const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
      value.uid, value.mode, value.nlink].map(String).join(':');
    if (identity(stat) !== identity(after) || identity(stat) !== identity(named)) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
  } finally { fs.closeSync(fd); }
  if (createHash('sha256').update(bytes).digest('hex') !== process.argv[3]) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
  const scope = JSON.parse(bytes.toString('utf8'));
  if (scope.format !== 'sabalan-coherent-capture-scope/v3' || !Array.isArray(scope.sources)
    || scope.sources.length < 1 || scope.sources.length > 32 || !Array.isArray(scope.sealer?.stores)
    || scope.sealer.stores.length !== scope.sources.length) throw new Error('FILE_CAPTURE_COMMAND_INVALID');
  const authorities: NativeFileCaptureAuthority[] = [],
    versionedCuts: Array<{ name: string; captureId: string; storeRoot: string; sha256: string }> = [];
  for (let index = 0; index < scope.sources.length; index++) {
    const source = scope.sources[index], store = scope.sealer.stores[index];
    const authority = NativeFileCaptureAuthority.open({ componentScopeFile: scopeFile,
      componentScopeSha256: process.argv[3], componentDirectory: path.dirname(scopeFile), sourceName: source.name,
      storeIdentity: { device: store.device, inode: store.inode } });
    authorities.push(authority);
    const port = await VersionedFilePublication.openForCapture(authority), cut = await port.seal();
    versionedCuts.push({ name: source.name, captureId: authority.captureId, storeRoot: source.storeRoot, sha256: cut.sha256 });
  }
  for (const authority of authorities) authority.assertOwned();
  process.stdout.write(JSON.stringify({ phase: 'SEALED', versionedCuts }) + '\n');
}
void main().catch(() => { process.stderr.write('FILE_CAPTURE_NATIVE_SEAL_UNPROVEN\n'); process.exitCode = 75; });
