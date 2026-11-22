import fs from 'node:fs/promises';
import path from 'node:path';
import {BrowserRoutingPublicationLock} from '../../deploy/scripts/browser-routing-store.mjs';

export async function assertPrivateUiStartup(root, publicationLock) {
  if (!(publicationLock instanceof BrowserRoutingPublicationLock)) throw Error('FIXTURE_NATIVE_STARTUP_LOCK_REQUIRED');
  publicationLock.assertOwned();
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || await fs.realpath(root) !== root || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw Error('FIXTURE_PRIVATE_STARTUP_ROOT_UNPROVEN');
  }
  // A shutdown can create its held marker until it releases this same native
  // lock. A pre-lock check cannot establish safe restart; check under ownership.
  for (const marker of ['transport-shutdown-held.json', 'obsolete-proxy-retirement-held.json']) {
    publicationLock.assertOwned();
    try {await fs.lstat(path.join(root, marker)); throw Error('FIXTURE_HELD_TRANSPORT_REQUIRES_INSPECTION');}
    catch (failure) {if (failure.code !== 'ENOENT') throw failure;}
  }
  publicationLock.assertOwned();
}
