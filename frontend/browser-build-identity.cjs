/** An absent identity denotes a legacy build and is never online admission.
 * Identified images retain the same value at build and runtime. */
function browserBuildIdentity(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^erp_[a-z0-9_-]{8,90}$/.test(value)) {
    throw new Error('BROWSER_BUILD_ID_INVALID');
  }
  return value;
}

const fs = require('node:fs');
const path = require('node:path');

function assertEnvironmentIdentity(id, environment) {
  if (environment.SABALAN_BROWSER_BUILD_ID !== undefined && browserBuildIdentity(environment.SABALAN_BROWSER_BUILD_ID) !== id) {
    throw new Error('BROWSER_BUILD_RUNTIME_IDENTITY_MISMATCH');
  }
  if (environment.NEXT_DEPLOYMENT_ID !== undefined && environment.NEXT_DEPLOYMENT_ID !== id) {
    throw new Error('BROWSER_BUILD_NEXT_IDENTITY_MISMATCH');
  }
}

function resolveBrowserBuildIdentity({ phase, directory, environment = process.env }) {
  if (phase !== 'phase-production-server') {
    const id = browserBuildIdentity(environment.SABALAN_BROWSER_BUILD_ID);
    assertEnvironmentIdentity(id, environment);
    return id;
  }
  let artifact;
  try { artifact = JSON.parse(fs.readFileSync(path.join(directory, 'browser-build-identity.json'), 'utf8')); }
  catch { throw new Error('BROWSER_BUILD_ARTIFACT_REQUIRED'); }
  const nativeBuildId = fs.readFileSync(path.join(directory, 'BUILD_ID'), 'utf8').trim();
  if (!artifact || artifact.format !== 'sabalan-browser-build/v1'
    || typeof artifact.nativeBuildId !== 'string' || artifact.nativeBuildId !== nativeBuildId
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(nativeBuildId)) throw new Error('BROWSER_BUILD_ARTIFACT_MISMATCH');
  const id = browserBuildIdentity(artifact.browserBuildId);
  if (typeof artifact.browserBuildId !== 'string' || (id && nativeBuildId !== id)) throw new Error('BROWSER_BUILD_ARTIFACT_MISMATCH');
  assertEnvironmentIdentity(id, environment);
  return id;
}

function finalizeBrowserBuild({ directory, environment = process.env }) {
  const id = browserBuildIdentity(environment.SABALAN_BROWSER_BUILD_ID);
  assertEnvironmentIdentity(id, environment);
  const nativeBuildId = fs.readFileSync(path.join(directory, 'BUILD_ID'), 'utf8').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(nativeBuildId) || (id && nativeBuildId !== id)) throw new Error('BROWSER_BUILD_ARTIFACT_MISMATCH');
  const file = path.join(directory, 'browser-build-identity.json');
  const descriptor = fs.openSync(file, 'wx', 0o644);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify({ format: 'sabalan-browser-build/v1', browserBuildId: id, nativeBuildId })}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

module.exports = { browserBuildIdentity, resolveBrowserBuildIdentity, finalizeBrowserBuild };
