export interface DeviceIdentity {
  model: string;
  serial: string;
  connectorVersion: string;
  sdkVersion: string;
}

export interface CaptureResult {
  device: DeviceIdentity;
  quality: number;
  livenessScore: number;
  template: Buffer;
}

export interface VerifyResult {
  device: DeviceIdentity;
  quality: number;
  livenessScore: number;
  matched: boolean;
  matchScore: number;
}

export interface BiometricDevice {
  health(): Promise<DeviceIdentity>;
  capture(): Promise<CaptureResult>;
  verify(expectedTemplate: Buffer): Promise<VerifyResult>;
  cancel(): Promise<void>;
}

export class BiometricDeviceError extends Error {
  constructor(readonly category: string, readonly retryable: boolean, message = category) { super(message); }
}

export class FakeBiometricDevice implements BiometricDevice {
  readonly calls: string[] = [];
  readonly templateMaterial = Buffer.from('iso-template-material');
  templateWasCleared = false;
  private lastExpectedTemplate?: Buffer;
  get expectedTemplateWasCleared() { return Boolean(this.lastExpectedTemplate?.every((byte) => byte === 0)); }
  delayMilliseconds = 0;
  private readonly identity = { model: 'BioMini SLIM 2', serial: 'SBBM-SLIM2-01', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' };

  private async delay() { if (this.delayMilliseconds) await new Promise((resolve) => setTimeout(resolve, this.delayMilliseconds)); }
  async health() { this.calls.push('HEALTH'); await this.delay(); return this.identity; }
  async capture() {
    this.calls.push('CAPTURE'); await this.delay();
    const template = Buffer.from(this.templateMaterial);
    const originalFill = template.fill.bind(template);
    template.fill = ((value: number) => { this.templateWasCleared = value === 0; return originalFill(value); }) as typeof template.fill;
    return { device: this.identity, quality: 86, livenessScore: 999, template };
  }
  async verify(expectedTemplate: Buffer) {
    this.calls.push('VERIFY'); await this.delay();
    const matched = expectedTemplate.equals(this.templateMaterial);
    this.lastExpectedTemplate = expectedTemplate;
    return { device: this.identity, quality: 86, livenessScore: 999, matched, matchScore: matched ? 97 : 0 };
  }
  async cancel() { this.calls.push('CANCEL'); }
}
