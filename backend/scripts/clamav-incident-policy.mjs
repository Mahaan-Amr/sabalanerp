// Incident evidence records an unhealthy original. It is deliberately not a
// rollback-health proof and can never authorize reopening the original release.
export function validateIncidentSnapshot(value, image, now = Date.now()) {
 const families = ['main', 'daily', 'bytecode'];
 if (value?.kind !== 'DEGRADED_CLAMAV_INCIDENT_V1' || value.image !== image
  || !/^sha256:[a-f0-9]{64}$/.test(image || '') || !/^1\.4\.(5|6)$/.test(value.engine || '')
  || !Number.isFinite(Date.parse(value.checkedAt)) || now - Date.parse(value.checkedAt) < 0
  || now - Date.parse(value.checkedAt) > 3600000
  || !/^[a-f0-9]{64}$/.test(value.configArchiveSha256 || '')
  || !Array.isArray(value.issues) || !value.issues.length
  || value.issues.some(issue => !['UPDATER_NOT_LIVE', 'SIGNATURES_STALE'].includes(issue))
  || Object.keys(value.bankFiles || {}).length !== 3
  || families.some(name => !Number.isSafeInteger(value.versions?.[name]) || value.versions[name] < 1
   || Object.entries(value.bankFiles).filter(([file, digest]) => new RegExp('^' + name + '[.](cvd|cld)$').test(file) && /^[a-f0-9]{64}$/.test(digest)).length !== 1)
  || value.reopenOriginal !== false || ['updaterHealthy', 'restoreRehearsalPassed', 'fullReleaseRehearsalPassed'].some(key => key in value)) {
  throw new Error('Explicit, fresh degraded-instance evidence is required; it is not a healthy rollback proof');
 }
 return value;
}

export function requireIncidentSession(session, operation, snapshotSha256) {
 if (operation !== 'incident-recovery' || session?.clamavOperation !== operation
  || !/^[a-f0-9]{64}$/.test(snapshotSha256 || '') || session.clamavIncidentSnapshotSha256 !== snapshotSha256) {
  throw new Error('Incident recovery must match the operation and snapshot bound to its owned session');
 }
}
