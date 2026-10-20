import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { publishedVersions, parseNativeProbe } from './clamav-release-readiness.mjs';
import { validateIncidentSnapshot } from '../backend/scripts/clamav-incident-policy.mjs';
const execute = promisify(execFile);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export async function inspectIncident(container) {
 const run = async args => (await execute('docker', args, {maxBuffer: 4 * 1024 * 1024})).stdout.trim();
 const before = JSON.parse(await run(['inspect', container]))[0];
 if (!before.State.Running) throw new Error('Original incident container must still be running before maintenance');
 const engine = (await run(['exec', container, 'freshclam', '--version'])).match(/^ClamAV ([0-9.]+)/)?.[1];
 const probe = await fs.readFile(new URL('../deploy/clamav/inspect-native.sh', import.meta.url), 'utf8');
 const sample = parseNativeProbe(await run(['exec', container, 'sh', '-ec', probe]));
 const freshclam = sample.processes.filter(process => process.name === 'freshclam');
 const issues = [];
 if (freshclam.length !== 1 || !/^[RSDI]$/.test(freshclam[0].state)) issues.push('UPDATER_NOT_LIVE');
 const versions = {}, bankFiles = {};
 for (const family of ['main', 'daily', 'bytecode']) {
  const file = await run(['exec', container, 'sh', '-ec', `set -- /var/lib/clamav/${family}.c[vl]d; test "$#" -eq 1; test -f "$1"; basename "$1"`]);
  if (!new RegExp('^' + family + '[.](cvd|cld)$').test(file)) throw new Error('Ambiguous original bank');
  const info = await run(['exec', container, 'sigtool', '--info', '/var/lib/clamav/' + file]);
  if (!info.includes('Verification OK')) throw new Error('Original bank signature could not be verified');
  versions[family] = Number(info.match(/^Version: (\d+)/m)?.[1]);
  bankFiles[file] = (await run(['exec', container, 'sha256sum', '/var/lib/clamav/' + file])).split(/\s/)[0];
 }
 const published = await publishedVersions();
 if (Object.keys(versions).some(name => versions[name] !== published[name])) issues.push('SIGNATURES_STALE');
 const config = (await execute('docker', ['cp', container + ':/etc/clamav/.', '-'], {encoding: 'buffer', maxBuffer: 4 * 1024 * 1024})).stdout;
 const after = JSON.parse(await run(['inspect', container]))[0];
 if (before.Id !== after.Id || before.Image !== after.Image || before.State.StartedAt !== after.State.StartedAt || !after.State.Running) throw new Error('Original instance changed during incident inspection');
 return validateIncidentSnapshot({kind: 'DEGRADED_CLAMAV_INCIDENT_V1', image: before.Image, engine,
  checkedAt: new Date().toISOString(), versions, bankFiles, configArchiveSha256: hash(config), issues, reopenOriginal: false}, before.Image);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const [command, container, file] = process.argv.slice(2);
  const actual = await inspectIncident(container);
  if (command === 'snapshot') await fs.writeFile(file, JSON.stringify(actual, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  else if (command === 'verify') {
   const expected = validateIncidentSnapshot(JSON.parse(await fs.readFile(file, 'utf8')), actual.image);
   for (const key of ['image', 'engine', 'versions', 'bankFiles', 'configArchiveSha256', 'issues', 'reopenOriginal']) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) throw new Error('Original incident instance differs from reviewed snapshot: ' + key);
   }
  } else throw new Error('Use snapshot|verify <original-container> <private-snapshot-file>');
  console.log(JSON.stringify(actual));
 } catch (error) { console.error(error.message); process.exitCode = 1; }
}
