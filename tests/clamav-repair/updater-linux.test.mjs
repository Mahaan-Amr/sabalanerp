import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../deploy/clamav/update-once.sh',import.meta.url),'utf8');
test('real flock, cooldown-as-zero, persisted retry slots, process death and concurrent writers (existing local Compose)',()=>{
 const inventory=spawnSync('docker',['compose','-f','docker-compose.local.yml','ps','--format','json','clamav'],{encoding:'utf8',cwd:new URL('../../',import.meta.url).pathname});
 assert.equal(inventory.status,0,inventory.stderr);
 assert.ok(inventory.stdout.includes('sabalanerp-local-clamav-1'),'requires the existing local project');
 const script=`set -eu
root="$(mktemp -d /tmp/sabalan-updater-test.XXXXXX)"
trap 'rm -rf "$root"' EXIT
mkdir "$root/bin" "$root/db"
cat > "$root/update.sh" <<'UPDATE_SOURCE'
${source}
UPDATE_SOURCE
cat > "$root/bin/date" <<'DATE_SOURCE'
#!/bin/sh
cat "$TEST_ROOT/now"
DATE_SOURCE
cat > "$root/bin/freshclam" <<'FRESH_SOURCE'
#!/bin/sh
echo attempt >> "$TEST_ROOT/attempts"
if [ -f "$TEST_ROOT/block" ]; then
  echo "$PPID" > "$TEST_ROOT/writer-parent"
  while [ -f "$TEST_ROOT/block" ]; do sleep 0.05; done
fi
case "$(cat "$TEST_ROOT/result")" in
 cooldown) echo 'WARNING: You are still on cool-down until after: tomorrow'; exit 0;;
 denied) echo 'ERROR: HTTP 403'; exit 17;;
 network) echo 'ERROR: DNS unavailable'; exit 52;;
 *) for name in main daily bytecode; do echo "$name.cvd database is up-to-date (version: 1)"; done;;
esac
FRESH_SOURCE
chmod +x "$root/bin/"*
export TEST_ROOT="$root" CLAMAV_DATABASE_DIRECTORY="$root/db" PATH="$root/bin:$PATH"
echo 100000 > "$root/now"
echo cooldown > "$root/result"
status=0; sh "$root/update.sh" >/dev/null 2>&1 || status=$?
[ "$status" = 17 ]
[ "$(cat "$root/db/.sabalan-updater-state")" = '100000 0 17 107200' ]
# Recreation cannot erase cooldown or schedule another request.
sh "$root/update.sh"
[ "$(wc -l < "$root/attempts")" -eq 1 ]
echo 107200 > "$root/now"; echo success > "$root/result"
sh "$root/update.sh" >/dev/null
[ "$(cat "$root/db/.sabalan-updater-state")" = '107200 107200 0 114400' ]
# A held writer prevents a second updater even at a due time.
echo 114400 > "$root/now"; touch "$root/block"
sh "$root/update.sh" >/dev/null 2>&1 & writer=$!
for i in 1 2 3 4 5 6 7 8 9 10; do [ ! -f "$root/writer-parent" ] || break; sleep 0.1; done
[ -f "$root/writer-parent" ]
status=0; sh "$root/update.sh" >/dev/null 2>&1 || status=$?
[ "$status" = 75 ]
# Kill during the request: the reserved slot survives and blocks restart storms.
kill -KILL "$writer"; wait "$writer" 2>/dev/null || true
rm "$root/block"
sleep 0.2
[ "$(cat "$root/db/.sabalan-updater-state")" = '114400 107200 1 121600' ]
sh "$root/update.sh"
[ "$(wc -l < "$root/attempts")" -eq 3 ]
echo 121600 > "$root/now"; echo denied > "$root/result"
status=0; sh "$root/update.sh" >/dev/null 2>&1 || status=$?
[ "$status" = 17 ]
echo 128800 > "$root/now"; echo network > "$root/result"
status=0; sh "$root/update.sh" >/dev/null 2>&1 || status=$?
[ "$status" = 52 ]
echo UPDATER_LINUX_OK
`;
 const result=spawnSync('docker',['exec','-i','sabalanerp-local-clamav-1','sh','-s'],{input:script,encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,JSON.stringify({stdout:result.stdout,stderr:result.stderr,error:result.error?.message}));
 assert.match(result.stdout,/UPDATER_LINUX_OK/);
});

test('real process evidence and streamed EICAR inspection create no scanner fixture files',async()=>{
 const {parseNativeProbe,validateNativeUpdater}=await import('../../scripts/clamav-release-readiness.mjs');
 const inventory=spawnSync('docker',['compose','-f','docker-compose.local.yml','ps','clamav'],{encoding:'utf8'});
 assert.equal(inventory.status,0,inventory.stderr);assert.match(inventory.stdout,/sabalanerp-local-clamav-1/);
 const native=fs.readFileSync(new URL('../../deploy/clamav/inspect-native.sh',import.meta.url),'utf8');
 const sample=spawnSync('docker',['exec','-i','sabalanerp-local-clamav-1','sh','-s'],{input:native,encoding:'utf8',timeout:10000});
 assert.equal(sample.status,0,sample.stderr);
 const value=parseNativeProbe(sample.stdout);
 assert.ok(value.processes.some(p=>p.name==='clamd'&&p.uid===value.clamavUid&&p.state!=='Z'));
 // The local managed scheduler is not a native daemon; this must never fake native readiness.
 assert.throws(()=>validateNativeUpdater(value,'DatabaseMirror database.clamav.net\nNotifyClamd /etc/clamav/clamd.conf\n','',{}));
 const script=String.raw`printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' | clamdscan --stream --no-summary -`;
 const detected=spawnSync('docker',['exec','sabalanerp-local-clamav-1','sh','-ec',script],{encoding:'utf8',timeout:15000});
 assert.equal(detected.status,1,detected.stdout+detected.stderr);assert.match(detected.stdout,/Eicar.*FOUND/i);
 const clean=spawnSync('docker',['exec','sabalanerp-local-clamav-1','clamdscan','--no-summary','/etc/hosts'],{encoding:'utf8',timeout:15000});
 assert.equal(clean.status,0,clean.stdout+clean.stderr);assert.match(clean.stdout,/OK/);
});
