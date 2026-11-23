import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import router from '../dispatch-confirmation';
import { prisma } from '../../lib/prisma';
import type { SignedBiometricCommand } from '../../services/biometricProtocol';
import { ProtectedTemplateVault } from '../../services/biometricTemplateVault';
import { assertBiometricCommandSignature } from '../../services/biometricSigning';
import { SESSION_COOKIE } from '../../services/identitySessionService';

test('dispatch rejects an unregistered station without issuing a challenge or granting fallback', async context => {
  const registeredStation = 'ACCOUNTING-TEST';
  const commandKey = Buffer.alloc(32, 1);
  const templateKey = Buffer.alloc(32, 2);
  const workstations = {
    [registeredStation]: {
      commandSecretBase64: commandKey.toString('base64'),
      activeTransportKeyId: 'test-key',
      transportKeysBase64: { 'test-key': Buffer.alloc(32, 3).toString('base64') },
    },
  };
  const environment = {
    BIOMETRIC_WORKSTATIONS_JSON: JSON.stringify(workstations),
    BIOMETRIC_CONNECTOR_MODE: 'unconfigured',
    BIOMETRIC_TEMPLATE_KEY_BASE64: templateKey.toString('base64'),
    DISPATCH_CONFIRMATION_OTP_SECRET: 'test-only-dispatch-otp-secret',
  };
  const originalEnvironment = { ...process.env };
  Object.assign(process.env, environment);
  context.after(() => {
    for (const name of Object.keys(environment)) {
      if (originalEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnvironment[name];
    }
  });

  const stub = (delegate: object, method: string, implementation: () => Promise<unknown>) => {
    const original = Reflect.get(delegate, method);
    const mocked = context.mock.fn(implementation);
    Reflect.set(delegate, method, mocked);
    context.after(() => { Reflect.set(delegate, method, original); });
    return mocked;
  };
  const actorId = 'accounting-test-user';
  const expiresAt = new Date(Date.now() + 60_000);
  stub(prisma.authSession, 'findUnique', async () => ({
    id: 'login-session', lastActivityAt: new Date(), idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt,
    user: { id: actorId, role: 'ACCOUNTANT', isActive: true },
  }));
  let canConfirm = true;
  stub(prisma.featurePermission, 'findUnique', async () => (
    canConfirm ? { permissionLevel: 'edit', isActive: true } : null
  ));
  stub(prisma.roleFeaturePermission, 'findUnique', async () => null);
  stub(prisma.workspacePermission, 'findUnique', async () => null);
  stub(prisma.roleWorkspacePermission, 'findUnique', async () => null);

  const integrityHash = 'a'.repeat(64);
  const sessionId = 'driver-confirmation';
  const driverId = 'driver-test';
  let workstationId = 'UNKNOWN-TEST';
  stub(prisma.dispatchConfirmationSession, 'findUnique', async () => ({
    id: sessionId, status: 'ACTIVE', driverSource: 'INTERNAL', method: 'INTERNAL_BIOMETRIC',
    driverId, workstationId, waybillIntegrityHash: integrityHash, expiresAt, fallbackEligibleAt: null,
    waybill: { status: 'ISSUED', integrityHash },
  }));
  const personnelId = 'personnel-test';
  stub(prisma.internalDriverProfile, 'findUniqueOrThrow', async () => ({ personnelId }));
  stub(prisma.personnel, 'findUnique', async () => ({ id: personnelId, internalDriverProfile: { id: driverId } }));
  stub(prisma.internalDriverProfile, 'findUnique', async () => ({
    status: 'ACTIVE', personnel: { isActive: true }, eligibilityPeriods: [{ status: 'ELIGIBLE' }],
  }));
  const templateContext = { personnelId, finger: 'RIGHT_INDEX', format: 'ISO-19794-2' };
  const vault = new ProtectedTemplateVault({ activeKeyId: 'dispatch-v1', keys: { 'dispatch-v1': templateKey } });
  const protectedEnvelope = vault.seal(Buffer.from('test template'), templateContext);
  stub(prisma.driverBiometricEnrollment, 'findFirst', async () => ({
    templates: [{ ...templateContext, protectedEnvelope, createdAt: new Date() }],
  }));
  const challengeWrites = stub(prisma.biometricConnectorChallenge, 'create', async () => ({}));
  const otpWrites = stub(prisma.dispatchOtpChallenge, 'create', async () => ({}));

  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sessions/${sessionId}`;
  const post = (path: string) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=test-session` },
    body: JSON.stringify({ finger: 'RIGHT_INDEX' }),
    signal: AbortSignal.timeout(3000),
  });

  const unknown = await post('/biometric-command');
  assert.equal(unknown.status, 409);
  assert.deepEqual(await unknown.json(), {
    success: false,
    code: 'BIOMETRIC_WORKSTATION_NOT_REGISTERED',
    error: 'این ایستگاه اثر انگشت ثبت نشده است. از پشتیبانی بخواهید همین ایستگاه را ثبت کند و سپس دوباره تلاش کنید.',
  });
  assert.equal(challengeWrites.mock.callCount(), 0);

  const fallbackDenied = await post('/fallback');
  assert.equal(fallbackDenied.status, 409);
  assert.deepEqual(await fallbackDenied.json(), {
    success: false,
    error: 'روش جایگزین فقط پس از خطای معتبر حسگر یا دو عدم تطبیق معتبر پیاپی در همین نوبت مجاز است.',
  });
  assert.equal(otpWrites.mock.callCount(), 0);

  workstationId = registeredStation;
  canConfirm = false;
  assert.equal((await post('/biometric-command')).status, 403);
  assert.equal((await post('/fallback')).status, 403);
  assert.equal(challengeWrites.mock.callCount(), 0);

  canConfirm = true;
  const registered = await post('/biometric-command');
  assert.equal(registered.status, 201);
  const result = await registered.json() as { success: boolean; data: SignedBiometricCommand };
  assert.equal(result.success, true);
  assert.equal(result.data.command.workstationId, registeredStation);
  assert.equal(result.data.command.operation, 'VERIFY');
  assertBiometricCommandSignature(result.data, commandKey);
  assert.equal(challengeWrites.mock.callCount(), 1);
});
