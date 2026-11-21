import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { publishedVersions, parseNativeProbe, fileDigest, validateManagedScheduler, validateTransportIdentity, validateAcquisitionConfiguration } from './clamav-release-readiness.mjs';
import { validateIncidentSnapshot, feupIncidentImage, incidentAcquisitionStateNames as stateNames } from '../backend/scripts/clamav-incident-policy.mjs';
import { mirrorOrigin, validateSourceMigration } from './clamav-source-migration.mjs';
const execute = promisify(execFile);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const vendorNames=stateNames.map(name=>'.source-state/vendor-cdn/'+name);
const managedAcquisitionProbe=`set -eu
cd /var/lib/clamav
for file in .sabalan-updater.lock ${[...stateNames,...vendorNames].join(' ')} .source-state/migration.json; do
  test -f "$file" && test ! -L "$file" || exit 1
done
exec 9<.sabalan-updater.lock
flock -s -n 9
head -n 1 .sabalan-updater-state
for file in ${[...stateNames,...vendorNames].join(' ')} .source-state/migration.json; do
  sha256sum "$file"
done
cat .source-state/migration.json
`;

async function observeFeupAcquisition(container, inspection, run) {
 validateManagedScheduler(inspection.Config.Env);
 const config=await run(['exec',container,'cat','/etc/clamav/freshclam.conf']);
 const transport=/^\s*HTTPProxy/im.test(config)
  ? validateTransportIdentity(inspection,JSON.parse(await run(['image','inspect',inspection.Image]))[0])
  : undefined;
 if(validateAcquisitionConfiguration(config,transport)!==mirrorOrigin)throw new Error('Original managed FEUP acquisition origin changed');
 await run(['exec',container,'/usr/local/bin/sabalan-clamav-acquisition-transport']);
 const [schedule,...lines]=(await run(['exec',container,'sh','-ec',managedAcquisitionProbe])).split('\n');
 if(!/^\d+ \d+ \d+ \d+$/.test(schedule))throw new Error('Original FEUP update schedule is invalid');
 const [attempted,succeeded,result,next]=schedule.split(' ').map(Number);
 const files=[...stateNames,...vendorNames,'.source-state/migration.json'];
 const hashes=Object.fromEntries(files.map((file,index)=>{
  const [digest,reported]=lines[index].split(/\s+/);
  if(reported!==file || !/^[a-f0-9]{64}$/.test(digest))throw new Error('Original FEUP state hash observation failed');
  return [file,digest];
 }));
 const sourceMigration=validateSourceMigration(JSON.parse(lines.slice(files.length).join('\n')));
 for(const name of stateNames){
  if(sourceMigration.originalStateFiles[name].sha256!==hashes['.source-state/vendor-cdn/'+name]){
   throw new Error('The observed original FEUP vendor provenance is inconsistent');
  }
 }
 return {origin:mirrorOrigin,attempted,succeeded,result,next,
  stateFileHashes:Object.fromEntries(stateNames.map(name=>[name,hashes[name]])),
  migrationSha256:hashes['.source-state/migration.json'],sourceMigration};
}

export async function inspectIncident(container) {
 const run = async args => (await execute('docker', args, {maxBuffer: 4 * 1024 * 1024})).stdout.trim();
 const before = JSON.parse(await run(['inspect', container]))[0];
 if (!before.State.Running) throw new Error('Original incident container must still be running before maintenance');
 const engine = (await run(['exec', container, 'freshclam', '--version'])).match(/^ClamAV ([0-9.]+)/)?.[1];
 const issues = [];
 if (before.Image===feupIncidentImage) {
  const scheduler=await run(['exec',container,'sh','-ec',`
    pid="$(cat /run/sabalan-clamav/updater.pid 2>/dev/null || true)"
    case "$pid" in ''|*[!0-9]*) exit 0;; esac
    state="$(sed 's/.*) //' "/proc/$pid/stat" 2>/dev/null | cut -d' ' -f1)"
    case "$state" in R|S|D|I) printf 'live';; esac
  `]);
  if(scheduler!=='live')issues.push('UPDATER_NOT_LIVE');
 } else {
  const probe = await fs.readFile(new URL('../deploy/clamav/inspect-native.sh', import.meta.url), 'utf8');
  const sample = parseNativeProbe(await run(['exec', container, 'sh', '-ec', probe]));
  const freshclam = sample.processes.filter(process => process.name === 'freshclam');
  if (freshclam.length !== 1 || !/^[RSDI]$/.test(freshclam[0].state)) issues.push('UPDATER_NOT_LIVE');
 }
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
 const acquisition=before.Image===feupIncidentImage ? await observeFeupAcquisition(container,before,run) : undefined;
 const after = JSON.parse(await run(['inspect', container]))[0];
 if (before.Id !== after.Id || before.Image !== after.Image || before.State.StartedAt !== after.State.StartedAt || !after.State.Running) throw new Error('Original instance changed during incident inspection');
 return validateIncidentSnapshot({kind: 'DEGRADED_CLAMAV_INCIDENT_V1', image: before.Image, engine,
  checkedAt: new Date().toISOString(), versions, bankFiles, configArchiveSha256: hash(config), issues, reopenOriginal: false, ...(acquisition?{acquisition}:{})}, before.Image);
}

// The input is a privately captured original bank. Only a new, separate target
// is written. Keeping the active files unchanged makes the first UFPR cycle
// obey the copied FEUP scheduler and FreshClam cooldown.
async function prepareUfpr(snapshotFile, input, output) {
 const snapshotBytes=await fs.readFile(snapshotFile);
 const snapshot=validateIncidentSnapshot(JSON.parse(snapshotBytes),feupIncidentImage);
 const original=snapshot.acquisition;
 const source=await fs.realpath(input);
 const outputParent=await fs.realpath(path.dirname(output));
 const destination=path.join(outputParent,path.basename(output));
 if(destination===source || destination.startsWith(source+path.sep))throw new Error('UFPR staging requires an independent inactive destination');
 await fs.mkdir(destination,{mode:0o700});
 await execute('cp',['-a','--',source+'/.',destination]);
 const files={
  ...snapshot.bankFiles,...original.stateFileHashes,
  '.source-state/migration.json':original.migrationSha256,
  ...Object.fromEntries(stateNames.map(name=>['.source-state/vendor-cdn/'+name,original.sourceMigration.originalStateFiles[name].sha256])),
 };
 const copiedFile=async name=>{
  const file=path.join(destination,name);
  if(await fs.realpath(file)!==file || !(await fs.lstat(file)).isFile())throw new Error('UFPR staging requires regular captured bank files');
  return file;
 };
 for(const [name,digest] of Object.entries(files)){
  if(await fileDigest(await copiedFile(name))!==digest)throw new Error('Captured FEUP bank differs from the reviewed staging original: '+name);
 }
 const archive=path.join(destination,'.source-state','feup-predecessor');
 await fs.mkdir(archive,{mode:0o700});
 for(const name of stateNames){
  await fs.writeFile(path.join(archive,name),await fs.readFile(await copiedFile(name)),{mode:0o400,flag:'wx'});
 }
 await fs.writeFile(path.join(archive,'snapshot.json'),snapshotBytes,{mode:0o400,flag:'wx'});
 return {stagingOriginalSha256:hash(snapshotBytes),next:original.next};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare-ufpr') {
   console.log(JSON.stringify(await prepareUfpr(...args)));
  } else {
   if (!['snapshot','verify'].includes(command))throw new Error('Use snapshot|verify <original-container> <private-snapshot-file> or prepare-ufpr <snapshot> <captured-FEUP-bank> <new-inactive-UFPR-bank>');
   const [container,file]=args;
   const actual=await inspectIncident(container);
   if (command === 'snapshot') await fs.writeFile(file, JSON.stringify(actual, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
   else {
    const expected=validateIncidentSnapshot(JSON.parse(await fs.readFile(file,'utf8')),actual.image);
    for (const key of ['image','engine','versions','bankFiles','configArchiveSha256','issues','reopenOriginal','acquisition']) {
     if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key]))throw new Error('Original incident instance differs from reviewed snapshot: '+key);
    }
   }
   console.log(JSON.stringify(actual));
  }
 } catch (error) { console.error(error.message); process.exitCode=1; }
}
