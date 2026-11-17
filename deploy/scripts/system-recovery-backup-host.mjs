import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const operationIdPattern = /^c[a-z0-9]{24}$/;
const deploymentIdPattern = /^deploy-[a-zA-Z0-9_-]{1,120}$/;
const maximumBytes = 4096;

async function relayInput(runner, envFile, operationId) {
  if (!operationIdPattern.test(operationId ?? '') || process.stdin.isTTY) throw new Error();
  const input = fstatSync(0);
  if (!input.isFIFO() && !input.isSocket()) throw new Error();
  const passphrase = Buffer.alloc(maximumBytes);
  const deadline = setTimeout(() => process.stdin.destroy(new Error()), 10_000);
  let length = 0;
  try {
    for await (const chunk of process.stdin) {
      if (chunk.length > maximumBytes - length) throw new Error();
      length += chunk.copy(passphrase, length);
    }
    const value = new TextDecoder('utf-8', { fatal: true }).decode(passphrase.subarray(0, length));
    if (value.length < 12 || !/[a-z]/i.test(value) || !/[0-9]/.test(value)) throw new Error();
    clearTimeout(deadline);

    if (process.platform !== 'linux' || process.getuid() !== 0) {
      console.error('SYSTEM_RECOVERY_BACKUP_REQUIRES_NATIVE_ROOT');
      return 1;
    }
    const child = spawn('/bin/sh', [runner, '--system-recovery-backup-input', realpathSync(envFile), operationId], {
      detached: true,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    let interrupted = false;
    const handlers = signals.map(signal => () => {
      interrupted = true;
      child.kill('SIGTERM');
    });
    signals.forEach((signal, index) => process.on(signal, handlers[index]));
    child.stdin.on('error', () => {});
    child.stdin.end(passphrase.subarray(0, length), () => passphrase.fill(0));
    try {
      const code = await new Promise(resolve => {
        child.once('error', () => {
          console.error('SYSTEM_RECOVERY_BACKUP_RUNNER_UNAVAILABLE');
        });
        child.once('close', resolve);
      });
      return interrupted ? 130 : (code ?? 1);
    } finally {
      signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
    }
  } finally {
    clearTimeout(deadline);
    passphrase.fill(0);
  }
}

function updateIntent(action, file, deploymentId, operationId) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || realpathSync(dirname(file)) !== dirname(file)
    || !deploymentIdPattern.test(deploymentId ?? '') || !operationIdPattern.test(operationId ?? '')) throw new Error();
  if (action === 'hold') {
    const fd = openSync(file, 'wx', 0o400);
    try {
      writeFileSync(fd, JSON.stringify({ deploymentId, operationId }) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } else {
    const expected = JSON.stringify({ deploymentId, operationId }) + '\n';
    if (readFileSync(file, 'utf8') !== expected) throw new Error();
    renameSync(file, join(dirname(file), 'system-recovery-backup-' + deploymentId + '.completed.json'));
  }
  const directory = openSync(dirname(file), constants.O_DIRECTORY | constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'launch' && args.length === 3) process.exitCode = await relayInput(...args);
  else if ((command === 'hold' || command === 'clear') && args.length === 3) updateIntent(command, ...args);
  else throw new Error();
} catch {
  console.error(command === 'launch' ? 'SYSTEM_RECOVERY_BACKUP_INPUT_INVALID' : 'SYSTEM_RECOVERY_BACKUP_CUSTODY_FAILED');
  process.exitCode = 1;
}
