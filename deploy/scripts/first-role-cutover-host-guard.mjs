import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const purpose = 'first-database-role-cutover';
const fail = () => { throw new Error('FIRST_ROLE_CUTOVER_REQUIRES_ITS_ORIGINAL_OWNER'); };
function stat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

/** Ordinary recovery has no authority to restart a half-switched role configuration. */
export function assertNoInterruptedFirstRoleCutover(sessionFile) {
  if (!path.isAbsolute(sessionFile)) fail();
  const directory = path.dirname(sessionFile);
  if (stat(path.join(directory, 'first-role-cutover-open-intent.json'))) fail();
  const sessionStat = stat(sessionFile);
  if (sessionStat) {
    if (!sessionStat.isFile()) fail();
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (session.purpose === purpose || Object.hasOwn(session, 'firstRoleCutover')) fail();
  }
  const journalFile = path.join(directory, 'active-deployment.jsonl');
  const journalStat = stat(journalFile);
  if (!journalStat) return;
  if (!journalStat.isFile()) fail();
  const firstLine = fs.readFileSync(journalFile, 'utf8').split('\n', 1)[0];
  if (firstLine && Object.hasOwn(JSON.parse(firstLine).details ?? {}, 'firstRoleCutover')) fail();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail();
    assertNoInterruptedFirstRoleCutover(process.argv[2]);
  } catch {
    console.error('An unresolved or unreadable first-role cutover boundary requires its original protected owner.');
    process.exitCode = 1;
  }
}
