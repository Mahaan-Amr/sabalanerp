import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BiometricDiagnosticsWorkflowError,
  loadBiometricDiagnostics,
} from './biometricDiagnosticsWorkflow';

const serverDiagnostics = { platform: { connector: 0 } };
const localStatus = {
  workstationId: 'SABALAN-LOCAL-BIOMINI',
  availability: 'AVAILABLE',
};
const issuedCommand = { command: { commandId: 'challenge-1' } };
const connectorResult = { response: { status: 'AVAILABLE' }, signature: 'signed-result' };
const completedDiagnostics = {
  mode: 'PHYSICAL',
  availability: 'AVAILABLE',
  liveEnrollmentEnabled: true,
  checkedAt: '2026-09-22T08:00:00.000Z',
  device: { model: 'BioMini SLIM 2', serial: 'serial-1', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' },
  supportedChecks: ['capture-quality'],
};

const dependencies = (overrides: Record<string, unknown> = {}) => ({
  getServerDiagnostics: async () => serverDiagnostics,
  getLocalStatus: async () => localStatus,
  issueDiagnosticCommand: async () => issuedCommand,
  executeConnectorCommand: async () => connectorResult,
  completeDiagnosticCommand: async () => completedDiagnostics,
  ...overrides,
});

test('reports an actionable local-connector error and stops the workflow when status cannot be reached', async () => {
  let issued = false;

  await assert.rejects(
    () => loadBiometricDiagnostics(dependencies({
      getLocalStatus: async () => { throw new TypeError('fetch failed'); },
      issueDiagnosticCommand: async () => { issued = true; return issuedCommand; },
    })),
    (error: unknown) => {
      assert.ok(error instanceof BiometricDiagnosticsWorkflowError);
      assert.equal(error.kind, 'connector');
      assert.equal(
        error.message,
        'اتصال‌گر محلی اثر انگشت در دسترس نیست. اتصال‌گر را روی همین رایانه اجرا کنید، سامانه را با نشانی مجاز باز کنید و سپس دوباره تلاش کنید.',
      );
      return true;
    },
  );

  assert.equal(issued, false);
});

test('preserves backend failures so the page can distinguish permissions and server errors', async () => {
  const backendFailure = Object.assign(new Error('forbidden'), { response: { status: 403 } });

  await assert.rejects(
    () => loadBiometricDiagnostics(dependencies({
      getServerDiagnostics: async () => { throw backendFailure; },
    })),
    (error: unknown) => error === backendFailure,
  );
});

test('returns completed diagnostics with platform health after the signed connector round trip', async () => {
  const result = await loadBiometricDiagnostics(dependencies());

  assert.deepEqual(result, {
    ...completedDiagnostics,
    platform: serverDiagnostics.platform,
  });
});
