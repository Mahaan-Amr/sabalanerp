import fs from 'node:fs';
import { createHash } from 'node:crypto';

/** Observe the actual Linux host, not its hostname or caller-declared environment.
 * The hardware/VM UUID survives reboot; boot identity alone cannot prove independence.
 * Missing host observations leave the point ineligible for automatic retirement. */
export function readRecoveryHostIdentity() {
  if (process.platform !== 'linux') throw new Error('DEPLOYMENT_RECOVERY_HOST_IDENTITY_UNAVAILABLE');
  const read = (file: string) => {
    const value = fs.readFileSync(file, 'utf8').trim().toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
      || /^[0-]*$/.test(value) || /^[f-]*$/.test(value)) throw new Error('DEPLOYMENT_RECOVERY_HOST_IDENTITY_UNAVAILABLE');
    return createHash('sha256').update(value).digest('hex');
  };
  return { machineUuidSha256: read('/sys/class/dmi/id/product_uuid'),
    kernelBootIdSha256: read('/proc/sys/kernel/random/boot_id') };
}
