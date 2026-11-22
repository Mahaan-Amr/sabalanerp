import fs from 'node:fs';
import { mock } from 'node:test';

/** Represent host ownership without requiring the test runner to run as root. */
export function withQaOwnerKeyUid(file, uid, check) {
  const lstatSync = fs.lstatSync;
  const observe = mock.method(fs, 'lstatSync', (observed, ...options) => {
    const stat = lstatSync(observed, ...options);
    if (observed === file && stat?.isFile()) stat.uid = uid;
    return stat;
  });
  try {
    return check();
  } finally {
    observe.mock.restore();
  }
}
