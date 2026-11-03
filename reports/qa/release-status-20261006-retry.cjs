const fs = require('node:fs');
const file = '/opt/sabalanerp/reports/deploy/codex-update-20261006-retry.log';
const lines = fs.readFileSync(file,'utf8').trim().split('\n');
for (const line of lines.slice(-8)) {
  try {
    const r = JSON.parse(line);
    console.log(JSON.stringify({ok:r.ok, phase:r.deployment?.phase || r.phase, result:r.result, error:r.error?.message || r.message, progress:r.progress}));
  } catch {
    console.log(line.replace(/("?leaseToken"?\s*[:=]\s*")[^"]*/gi, '$1[redacted]').slice(0,240));
  }
}


