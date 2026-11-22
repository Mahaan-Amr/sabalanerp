import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function readPrivate(file: string, maximum: number) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!()) && !(before.mode & 0o077n)
      && before.size > 0n && before.size <= BigInt(maximum));
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null); assert.ok(n > 0); offset += n; }
    assert.equal(fs.readSync(fd, Buffer.alloc(1), 0, 1, null), 0);
    for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'uid', 'mode'] as const) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** Diagnostic browser metadata only. These private per-incarnation directories
 * are outside retained business roots; they grant no runtime/file authority. */
export function configureNativeApplicationEnvironment(runtimeId: string) {
  assert.match(runtimeId, /^[a-f0-9]{64}$/);
  const cwd = process.cwd(); assert.equal(fs.realpathSync(cwd), cwd);
  const privateDirectory = (directory: string, create: boolean) => {
    if (create) fs.mkdirSync(directory, { mode: 0o700 });
    const value = fs.lstatSync(directory);
    assert.ok(value.isDirectory() && !value.isSymbolicLink() && value.uid === process.getuid!() && !(value.mode & 0o077));
    assert.equal(fs.realpathSync(directory), directory);
    return { path: directory, device: String(value.dev), inode: String(value.ino), ownerUid: value.uid };
  };
  privateDirectory(cwd, false);
  const parent = path.join(cwd, '.diagnostic-native-homes');
  try { fs.mkdirSync(parent, { mode: 0o700 }); } catch (error: any) { if (error?.code !== 'EEXIST') throw error; }
  privateDirectory(parent, false);
  const home = path.join(parent, runtimeId), facts = [privateDirectory(home, true)];
  const config = path.join(home, 'xdg-config'), cache = path.join(home, 'xdg-cache');
  facts.push(privateDirectory(config, true), privateDirectory(cache, true));
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = config; process.env.XDG_CACHE_HOME = cache;
  const assets = JSON.parse(readPrivate(path.join(__dirname, 'print-assets.json'), 16384).toString('utf8'));
  const expected = ['brand/sabalan-logo.jpg', 'yekan-bakh/YekanBakh-Regular.woff2',
    'yekan-bakh/YekanBakh-SemiBold.woff2', 'yekan-bakh/YekanBakh-Bold.woff2'];
  assert.deepEqual(assets.map((entry: any) => entry.target), expected);
  for (const [index, entry] of assets.entries()) {
    assert.equal(entry.file, 'print-asset-' + index); assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    const bytes = readPrivate(path.join(__dirname, entry.file), 2 * 1024 * 1024);
    assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
    for (const directory of [path.join(cwd, 'public'), path.join(cwd, 'public', path.dirname(entry.target))]) {
      try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error: any) { if (error?.code !== 'EEXIST') throw error; }
      privateDirectory(directory, false);
    }
    const target = path.join(cwd, 'public', entry.target);
    try {
      const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch (error: any) { if (error?.code !== 'EEXIST') throw error; }
    assert.deepEqual(readPrivate(target, 2 * 1024 * 1024), bytes);
    const fd = fs.openSync(path.dirname(target), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  for (const directory of [config, cache, home, parent, path.join(cwd, 'public'), cwd]) {
    const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return { format: 'sabalan-native-browser-environment/v1', runtimeId, directories: facts, printAssets: assets,
    retainedBusinessData: false, inheritedTmpDir: process.env.TMPDIR || '/tmp' };
}
