import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { BiometricDeviceError, type BiometricDevice, type DeviceIdentity } from './deviceAdapter';
import {
  digest, openTransportEnvelope, sealTransportEnvelope, signConnectorResponse, verifyConnectorCommand,
  type ConnectorCommand, type SafeConnectorResult, type SignedConnectorCommand, type TransportContext, type TransportEnvelope,
} from './protocol';
import { CommandJournal } from './journal';

interface ServerOptions {
  allowedOrigin: string;
  workstationId: string;
  commandSecret: Buffer;
  transportKeys: { activeKeyId: string; keys: Record<string, Buffer> };
  journalPath: string;
  device: BiometricDevice;
  now?: () => Date;
}

const unavailableDevice = { model: 'UNAVAILABLE', serial: 'UNAVAILABLE', connectorVersion: 'unknown', sdkVersion: 'unknown' };
const safeResult = (device: DeviceIdentity, values: Partial<SafeConnectorResult> = {}): SafeConnectorResult => ({
  availability: 'AVAILABLE', device,
  captureQuality: { state: 'NOT_EVALUATED' }, liveness: { state: 'NOT_EVALUATED' }, match: { state: 'NOT_EVALUATED' },
  errorCategory: 'NONE', retryable: false, ...values,
});

const json = (response: ServerResponse, status: number, value: unknown, origin?: string) => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  if (origin) response.setHeader('access-control-allow-origin', origin);
  response.end(JSON.stringify(value));
};

const readJson = async (request: IncomingMessage, maximum = 65_536): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maximum) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body is not valid JSON'), { status: 400 }); }
};

const assertPayload = (command: ConnectorCommand) => {
  const payload = command.payload;
  const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const required: Record<ConnectorCommand['operation'], string[]> = {
    HEALTH: [], CAPTURE: ['challengeId', 'subjectId', 'finger'], VERIFY: ['challengeId', 'expectedDriverId', 'waybillIntegrityHash', 'transportEnvelopeDigest'], CANCEL: ['challengeId'],
  };
  const allowed: Record<ConnectorCommand['operation'], Set<string>> = {
    HEALTH: new Set(), CAPTURE: new Set(required.CAPTURE), VERIFY: new Set(required.VERIFY), CANCEL: new Set(required.CANCEL),
  };
  if (!allowed[command.operation] || Object.keys(payload).some((key) => !allowed[command.operation].has(key))) throw new Error('Command payload has unknown fields');
  for (const key of required[command.operation]) if (typeof payload[key] !== 'string' || !safeId.test(String(payload[key]))) throw new Error(`Command payload requires safe ${key}`);
};

export const createConnectorServer = (options: ServerOptions) => {
  const journal = new CommandJournal(options.journalPath);
  const now = options.now ?? (() => new Date());
  let deviceTail = Promise.resolve();
  const exclusive = async <T>(operation: () => Promise<T>) => {
    const previous = deviceTail;
    let release!: () => void;
    deviceTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  };
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin !== options.allowedOrigin) return json(response, 403, { error: 'Origin is not approved' });
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type');
      if (request.headers['access-control-request-private-network'] === 'true') response.setHeader('access-control-allow-private-network', 'true');
      return response.end();
    }
    if (request.method === 'GET' && request.url === '/v1/status') {
      try { return json(response, 200, { workstationId: options.workstationId, availability: 'AVAILABLE', device: await exclusive(() => options.device.health()), checkedAt: now().toISOString() }, origin); }
      catch { return json(response, 503, { workstationId: options.workstationId, availability: 'UNAVAILABLE', checkedAt: now().toISOString() }, origin); }
    }
    if (request.method !== 'POST' || request.url !== '/v1/commands') return json(response, 404, { error: 'Not found' }, origin);
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(response, 415, { error: 'JSON content type is required' }, origin);

    let command: ConnectorCommand | undefined;
    try {
      const requestBody = await readJson(request) as SignedConnectorCommand & { transportEnvelope?: TransportEnvelope };
      const signed: SignedConnectorCommand = { command: requestBody.command, signature: requestBody.signature };
      command = verifyConnectorCommand(signed, options.commandSecret, { workstationId: options.workstationId, now: now() });
      assertPayload(command);
      const reservation = journal.reserve({ commandId: command.commandId, nonceHash: digest(command.nonce), requestHash: digest(command) });
      if (reservation.state === 'COMPLETED') return json(response, 200, reservation.response, origin);
      if (reservation.state !== 'RESERVED') return json(response, 409, { error: `Command cannot execute: ${reservation.state}` }, origin);

      let result: SafeConnectorResult;
      let transportEnvelope;
      try {
      if (command.operation === 'HEALTH') result = safeResult(await exclusive(() => options.device.health()));
      else if (command.operation === 'CAPTURE') {
        const capture = await exclusive(() => options.device.capture());
        try {
          const context: TransportContext = { commandId: command.commandId, workstationId: command.workstationId, purpose: 'ENROLLMENT_CAPTURE', subjectId: String(command.payload.subjectId), finger: String(command.payload.finger) };
          const key = options.transportKeys.keys[options.transportKeys.activeKeyId];
          transportEnvelope = sealTransportEnvelope(capture.template, context, options.transportKeys.activeKeyId, key);
          result = safeResult(capture.device, { captureQuality: { state: 'ACCEPTED', score: capture.quality }, liveness: { state: 'LIVE', score: capture.livenessScore } });
        } finally { capture.template.fill(0); }
      } else if (command.operation === 'VERIFY') {
        const envelope = requestBody.transportEnvelope;
        if (!envelope || digest(envelope) !== command.payload.transportEnvelopeDigest) throw new Error('Verification envelope digest does not match the signed command');
        const context: TransportContext = { commandId: command.commandId, workstationId: command.workstationId, purpose: 'VERIFY_EXPECTED', subjectId: String(command.payload.expectedDriverId), waybillIntegrityHash: String(command.payload.waybillIntegrityHash) };
        const expectedTemplate = openTransportEnvelope(envelope, context, options.transportKeys.keys);
        try {
          const verification = await exclusive(() => options.device.verify(expectedTemplate));
          result = safeResult(verification.device, { captureQuality: { state: 'ACCEPTED', score: verification.quality }, liveness: { state: 'LIVE', score: verification.livenessScore }, match: { state: verification.matched ? 'MATCH' : 'NO_MATCH', score: verification.matchScore }, errorCategory: verification.matched ? 'NONE' : 'NO_MATCH' });
        } finally { expectedTemplate.fill(0); }
      } else if (command.operation === 'CANCEL') {
        await options.device.cancel();
        result = safeResult(unavailableDevice, { availability: 'UNAVAILABLE', errorCategory: 'CANCELLED' });
      } else throw new Error('Unsupported connector operation');
      } catch (error) {
        if (!(error instanceof BiometricDeviceError)) throw error;
        result = safeResult(unavailableDevice, { availability: 'UNAVAILABLE', errorCategory: error.category, retryable: error.retryable });
      }

      const responseValue = { commandId: command.commandId, result, ...(transportEnvelope ? { transportEnvelopeDigest: digest(transportEnvelope) } : {}), completedAt: now().toISOString() };
      const signedResponse = signConnectorResponse(responseValue, options.commandSecret);
      const body = transportEnvelope ? { ...signedResponse, transportEnvelope } : signedResponse;
      journal.complete(command.commandId, transportEnvelope ? undefined : signedResponse);
      return json(response, 200, body, origin);
    } catch (error) {
      if (command) journal.interrupt(command.commandId);
      const status = Number((error as { status?: number }).status) || 400;
      return json(response, status, { error: error instanceof Error ? error.message : 'Connector command failed' }, origin);
    }
  });
};
