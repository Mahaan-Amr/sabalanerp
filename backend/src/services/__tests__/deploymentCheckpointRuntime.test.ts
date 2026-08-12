import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd(), '..');
const deployScript = fs.readFileSync(path.join(repositoryRoot, 'deploy', 'scripts', 'deploy.sh'), 'utf8');
const checkpointScript = fs.readFileSync(path.join(process.cwd(), 'src', 'scripts', 'deployment-checkpoint.ts'), 'utf8');

assert.match(
  deployScript,
  /run_backend_timed_with_heartbeat\(\)[\s\S]*if ! control heartbeat[\s\S]*kill -TERM "\$\{timed_pid\}"[\s\S]*wait "\$\{timed_pid\}"/,
  'long checkpoint work must renew the durable deployment lease until the child exits',
);
assert.match(
  deployScript,
  /run_backend_timed_with_heartbeat "\$\{checkpoint_timeout\}" node dist\/scripts\/deployment-checkpoint\.js/,
  'the coordinated checkpoint must run through the heartbeat-aware wrapper',
);
assert.doesNotMatch(
  checkpointScript,
  /validateRecoveryPackage\(\{ sourcePath: uploaded\.objectPath/,
  'a byte-identical remote package must not be downloaded and decrypted a second time',
);
assert.match(
  checkpointScript,
  /remote\.uploadVerified\(result\.destination, objectKey, result\.sha256\)/,
  'remote read-back must compare against the checksum produced by package creation',
);

console.log('deployment checkpoint runtime tests passed');
