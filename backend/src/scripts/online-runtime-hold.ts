/** Container keeper only. The original external controller starts and owns each
 * native runtime; this entry never imports the application, opens SQL or seeds. */
import fs from 'node:fs';

if (process.platform !== 'linux' || process.getuid?.() !== 0
  || process.env.BACKEND_RUNTIME_ROLE !== 'control') {
  throw new Error('ONLINE_CONTROL_KEEPER_REQUIRED');
}
const trust = '/run/sabalan-online/release-controller-public-key.pem';
const stat = fs.lstatSync(trust);
if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.nlink !== 1
  || (stat.mode & 0o777) !== 0o444 || fs.realpathSync(trust) !== trust) {
  throw new Error('ONLINE_CONTROL_TRUST_REQUIRED');
}
const timer = setInterval(() => {}, 60_000);
// Deployment may stop this container only after original native closure.
process.once('SIGTERM', () => clearInterval(timer));
process.once('SIGINT', () => clearInterval(timer));
