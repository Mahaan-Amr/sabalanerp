import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { BiometricDeviceError, type BiometricDevice, type CaptureResult, type DeviceIdentity, type VerifyResult } from './deviceAdapter';

export interface ProcessInvocation { executable: string; args: string[]; stdin?: Buffer; timeoutMilliseconds: number; maximumOutputBytes: number }
interface ProcessResult { exitCode: number | null; stdout: string | Buffer; stderr: string | Buffer }
type ProcessRunner = (invocation: ProcessInvocation) => Promise<ProcessResult>;

const runProcess = (invocation: ProcessInvocation, onSpawn: (child: ChildProcessWithoutNullStreams) => void) => new Promise<ProcessResult>((resolve, reject) => {
  const child = spawn(invocation.executable, invocation.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  onSpawn(child);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const finish = (error?: Error, result?: ProcessResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) {
      stdout.forEach((chunk) => chunk.fill(0));
      stderr.forEach((chunk) => chunk.fill(0));
      reject(error);
    } else resolve(result!);
  };
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > invocation.maximumOutputBytes) { child.kill(); finish(new Error('BioMini worker exceeded its output limit')); return; }
    target.push(Buffer.from(chunk));
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.on('error', (error) => finish(error));
  child.on('close', (exitCode) => {
    const output = Buffer.concat(stdout);
    const errors = Buffer.concat(stderr);
    stdout.forEach((chunk) => chunk.fill(0));
    stderr.forEach((chunk) => chunk.fill(0));
    finish(undefined, { exitCode, stdout: output, stderr: errors });
  });
  const timeout = setTimeout(() => { child.kill(); finish(new Error('BioMini worker timed out')); }, invocation.timeoutMilliseconds);
  child.stdin.end(invocation.stdin || '');
});

type WorkerResult = Record<string, any>;
const marker = 'SABALAN_RESULT:';
const templateMarker = Buffer.from('SABALAN_TEMPLATE_RESULT:');

export class ProcessBioMiniDevice implements BiometricDevice {
  private activeChild?: ChildProcessWithoutNullStreams;
  constructor(private readonly runner?: ProcessRunner, private readonly executable = process.env.SABALAN_BIOMETRIC_ADAPTER_PATH || '') {
    if (!runner && !executable) throw new Error('SABALAN_BIOMETRIC_ADAPTER_PATH is required');
  }

  private async invoke(command: string, stdin?: Buffer): Promise<ProcessResult> {
    try {
      const invocation = { executable: this.executable, args: [command, '--sdk-worker'], stdin, timeoutMilliseconds: 25_000, maximumOutputBytes: 65_536 };
      return this.runner ? await this.runner(invocation) : await runProcess(invocation, (child) => { this.activeChild = child; });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'BioMini worker failed';
      if (/timed out/i.test(message)) throw new BiometricDeviceError('CAPTURE_TIMEOUT', true, message);
      if (/ENOENT|not found|spawn/i.test(message)) throw new BiometricDeviceError('DEVICE_DISCONNECTED', true, message);
      throw error;
    } finally { this.activeChild = undefined; }
  }

  private async execute(command: string, stdin?: Buffer): Promise<WorkerResult> {
    const output = await this.invoke(command, stdin);
    const stdout = Buffer.isBuffer(output.stdout) ? output.stdout : Buffer.from(output.stdout);
    const stderr = Buffer.isBuffer(output.stderr) ? output.stderr : Buffer.from(output.stderr);
    if (stdout.length + stderr.length > 65_536) throw new Error('BioMini worker exceeded its output limit');
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex < 0) throw new Error('BioMini worker did not return a normalized result');
    let result: WorkerResult;
    try { result = JSON.parse(stdout.subarray(markerIndex + marker.length).toString('utf8').trim()); }
    catch { throw new Error('BioMini worker returned an invalid normalized result'); }
    if (output.exitCode !== 0 || result.availability !== 'AVAILABLE') {
      const category = String(result.errorCategory || 'CONNECTOR_ERROR');
      throw new BiometricDeviceError(category, ['DEVICE_DISCONNECTED', 'CAPTURE_TIMEOUT', 'RETRYABLE_CONNECTOR_ERROR'].includes(category), `BioMini worker failed: ${category}`);
    }
    return result;
  }

  private identity(result: WorkerResult): DeviceIdentity {
    const device = result.device;
    if (!device || ['model', 'serial', 'connectorVersion', 'sdkVersion'].some((key) => typeof device[key] !== 'string' || !device[key])) throw new Error('BioMini worker device evidence is invalid');
    return device;
  }

  async health() { return this.identity(await this.execute('health')); }

  async capture(): Promise<CaptureResult> {
    const output = await this.invoke('capture-template');
    const bytes = Buffer.isBuffer(output.stdout) ? output.stdout : Buffer.from(output.stdout);
    const markerIndex = bytes.lastIndexOf(templateMarker);
    const newline = markerIndex < 0 ? -1 : bytes.indexOf(10, markerIndex + templateMarker.length);
    if (output.exitCode !== 0 || markerIndex < 0 || newline < 0) { bytes.fill(0); throw new BiometricDeviceError('CONNECTOR_ERROR', false, 'BioMini worker did not return a framed template result'); }
    let result: WorkerResult;
    try { result = JSON.parse(bytes.subarray(markerIndex + templateMarker.length, newline).toString('utf8').trim()); }
    catch { bytes.fill(0); throw new Error('BioMini worker returned invalid template evidence'); }
    const length = Number(result.templateLength);
    const template = Buffer.from(bytes.subarray(newline + 1, newline + 1 + length));
    const exactFrameLength = newline + 1 + length;
    bytes.fill(0);
    if (result.templateFormat !== 'ISO_19794_2' || !Number.isInteger(length) || length <= 0 || length > 4096 || template.length !== length || exactFrameLength !== bytes.length) { template.fill(0); throw new Error('BioMini worker template evidence is invalid'); }
    if (result.captureQuality?.state !== 'ACCEPTED' || result.liveness?.state !== 'LIVE') { template.fill(0); throw new Error('BioMini capture did not pass quality and liveness checks'); }
    return { device: this.identity(result), quality: Number(result.captureQuality.score), livenessScore: Number(result.liveness.score), template };
  }

  async verify(expectedTemplate: Buffer): Promise<VerifyResult> {
    if (!Buffer.isBuffer(expectedTemplate) || expectedTemplate.length === 0 || expectedTemplate.length > 4096) throw new Error('Expected BioMini template is invalid');
    const workerInput = Buffer.from(expectedTemplate);
    let result: WorkerResult;
    try { result = await this.execute('verify', workerInput); }
    finally { workerInput.fill(0); }
    if (result.captureQuality?.state !== 'ACCEPTED' || result.liveness?.state !== 'LIVE' || !['MATCH', 'NO_MATCH'].includes(result.match?.state)) throw new Error('BioMini verification evidence is invalid');
    return { device: this.identity(result), quality: Number(result.captureQuality.score), livenessScore: Number(result.liveness.score), matched: result.match.state === 'MATCH', matchScore: Number(result.match.score) };
  }

  async cancel() { this.activeChild?.kill(); }
}
