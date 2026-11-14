#!/usr/bin/env node
// Read-only #439 gate. It never stops a daemon or creates a namespace.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const refuse = (message) => { throw new Error(message); };
const CUSTODY = '/srv/sabalanerp-qa';
const MANIFEST_KEYS = [
  'format', 'distro', 'initialNetns', 'engineId', 'dataRoot', 'socket',
  'slirpVersion', 'slirpPackageSha256', 'slirpPackage', 'slirpBinarySha256',
  'dockerVersion', 'ipSha256', 'dockerdSha256', 'dockerSha256',
  'daemonConfigSha256', 'dpkgQuerySha256',
].sort();
function exists(path) {
  try { fs.lstatSync(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function run(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8', timeout: 10000,
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0) refuse(`${binary}: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}
function hash(path) { return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'); }
function pinned(path, expected) {
  if (!/^[0-9a-f]{64}$/.test(expected) || hash(path) !== expected) refuse(`hash mismatch: ${path}`);
}
export function inspectCustodyPath(file, root = CUSTODY, source = fs, exactMode) {
  if (typeof file !== 'string' || !path.posix.isAbsolute(file) ||
      file !== path.posix.normalize(file) || !file.startsWith(`${root}/`)) refuse('file outside private QA custody');
  const rootReal = source.realpathSync(root);
  const fileReal = source.realpathSync(file);
  if (rootReal !== root || fileReal !== file || !fileReal.startsWith(`${rootReal}/`)) refuse('custody path resolves outside QA root');
  const parts = file.slice(1).split('/');
  let current = '';
  for (let i = 0; i < parts.length; i++) {
    current += `/${parts[i]}`;
    const st = source.lstatSync(current);
    if (st.isSymbolicLink() || st.uid !== 0) refuse(`unsafe custody owner or link: ${current}`);
    if (i < parts.length - 1) {
      if (!st.isDirectory() || (st.mode & 0o022) ||
          (current.startsWith(root) && (st.mode & 0o077))) refuse(`unsafe custody directory: ${current}`);
    } else if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o022) ||
               (exactMode && !exactMode.includes(st.mode & 0o777))) refuse(`unsafe custody file: ${current}`);
  }
  return source.lstatSync(file);
}
function readCustodyFile(file, exactMode) {
  const expected = inspectCustodyPath(file, CUSTODY, fs, exactMode);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.nlink !== 1) refuse('custody file changed during read');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function zero() {
  if (process.getuid?.() !== 0) refuse('root required');
  if (process.env.WSL_DISTRO_NAME !== 'sabalanerp-qa-debian') refuse('unexpected WSL distro');
  if (fs.readFileSync('/proc/1/comm', 'utf8').trim() !== 'init') refuse('PID 1 is not WSL init');
  if (!/^\[boot\]\s*systemd=false\s*$/m.test(fs.readFileSync('/etc/wsl.conf', 'utf8'))) refuse('systemd=false not pinned');
  const initial = fs.readlinkSync('/proc/self/ns/net');
  if (initial !== 'net:[4026531833]' || fs.readlinkSync('/proc/1/ns/net') !== initial) refuse('initial namespace changed');
  for (const path of ['/run/docker.sock', '/run/docker.pid', '/run/netns/sabalanerp-qa', '/etc/netns/sabalanerp-qa']) {
    if (exists(path)) refuse(`pre-existing path: ${path}`);
  }
  if (exists('/run/netns') && fs.readdirSync('/run/netns').length) refuse('named namespace exists');
  if (exists('/var/lib/docker/containers') && fs.readdirSync('/var/lib/docker/containers').length) refuse('container record exists');
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    try {
      const name = fs.readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
      if (name === 'dockerd' || name === 'slirp4netns') refuse(`${name} PID ${entry} exists`);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
  }
  if (/^\s*nameserver\s+(?:127\.|::1(?:\s|$))/m.test(fs.readFileSync('/etc/resolv.conf', 'utf8'))) refuse('initial resolver uses loopback');
  return initial;
}

export function validateManifest(m, initial) {
  if (!m || typeof m !== 'object' || Array.isArray(m) ||
      JSON.stringify(Object.keys(m).sort()) !== JSON.stringify(MANIFEST_KEYS)) refuse('manifest keys mismatch');
  if (m.format !== 'sabalan-qa-zero-state/v1' || m.distro !== 'sabalanerp-qa-debian' ||
      m.initialNetns !== initial || m.engineId !== '33f03eef-8f8d-45a2-af36-b98958ddacde' ||
      m.dataRoot !== '/var/lib/docker' || m.socket !== '/run/docker.sock' ||
      m.slirpVersion !== '1.2.1-1.1' || m.slirpPackageSha256 !== 'c294a4df952b9ae54e19e0ab19ac09a7e398fbf7aa8969cfcae07f92dc4f30ac' ||
      m.dockerVersion !== '5:29.2.1-1~debian.13~trixie' || !m.slirpPackage?.startsWith(`${CUSTODY}/`) ||
      path.posix.resolve(m.slirpPackage) !== m.slirpPackage ||
      m.slirpBinarySha256 === m.slirpPackageSha256) refuse('manifest identity mismatch');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) try {
  if (process.argv.length !== 3) refuse('usage: qa-zero-state-preflight.mjs ROOT_OWNED_MANIFEST');
  const initial = zero();
  const file = process.argv[2];
  const m = JSON.parse(readCustodyFile(file, [0o400, 0o600]).toString('utf8'));
  validateManifest(m, initial);
  for (const [path, expected] of [
    ['/usr/sbin/ip', m.ipSha256], ['/usr/bin/slirp4netns', m.slirpBinarySha256],
    ['/usr/bin/dockerd', m.dockerdSha256], ['/usr/bin/docker', m.dockerSha256],
    ['/etc/docker/daemon.json', m.daemonConfigSha256], ['/usr/bin/dpkg-query', m.dpkgQuerySha256],
  ]) pinned(path, expected);
  const archiveHash = crypto.createHash('sha256').update(readCustodyFile(m.slirpPackage)).digest('hex');
  if (archiveHash !== m.slirpPackageSha256) refuse('slirp package archive hash mismatch');
  if (run('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'slirp4netns']) !== m.slirpVersion ||
      run('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'docker-ce']) !== m.dockerVersion) refuse('package version mismatch');
  process.stdout.write('PASS: read-only zero-state and pinned binary census; no runtime admission\n');
} catch (error) {
  process.stderr.write(`REFUSE: ${error.message}\n`);
  process.exitCode = 1;
}
