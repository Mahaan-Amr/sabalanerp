export type BiometricDiagnosticsPlatform = Record<
  'connector' | 'confirmation' | 'authorization' | 'projection' | 'auditIntegrity' | 'outage' | 'sms',
  number
>;

export type BiometricDiagnosticsResult = {
  mode: 'SIMULATOR' | 'PHYSICAL';
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  liveEnrollmentEnabled: boolean;
  checkedAt: string;
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  supportedChecks: readonly string[];
  platform?: BiometricDiagnosticsPlatform;
};

type IssuedDiagnosticCommand = {
  command: { commandId: string };
  [key: string]: unknown;
};

type ConnectorCommandResult = {
  response: unknown;
  signature: string;
};

type BiometricDiagnosticsDependencies = {
  getServerDiagnostics: () => Promise<{ platform?: BiometricDiagnosticsPlatform }>;
  getLocalStatus: () => Promise<{ workstationId: string }>;
  issueDiagnosticCommand: (workstationId: string) => Promise<IssuedDiagnosticCommand>;
  executeConnectorCommand: (command: IssuedDiagnosticCommand) => Promise<ConnectorCommandResult>;
  completeDiagnosticCommand: (payload: {
    challengeId: string;
    signedResponse: ConnectorCommandResult;
  }) => Promise<Omit<BiometricDiagnosticsResult, 'platform'>>;
};

const connectorUnavailableMessage = 'اتصال‌گر محلی اثر انگشت در دسترس نیست. اتصال‌گر را روی همین رایانه اجرا کنید، سامانه را با نشانی مجاز باز کنید و سپس دوباره تلاش کنید.';

export class BiometricDiagnosticsWorkflowError extends Error {
  readonly kind: 'connector';

  constructor() {
    super(connectorUnavailableMessage);
    this.name = 'BiometricDiagnosticsWorkflowError';
    this.kind = 'connector';
  }
}

const runConnectorStep = async <T>(action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch {
    throw new BiometricDiagnosticsWorkflowError();
  }
};

export const loadBiometricDiagnostics = async (
  dependencies: BiometricDiagnosticsDependencies,
): Promise<BiometricDiagnosticsResult> => {
  const serverDiagnostics = await dependencies.getServerDiagnostics();
  const local = await runConnectorStep(dependencies.getLocalStatus);
  const issued = await dependencies.issueDiagnosticCommand(local.workstationId);
  const connectorResult = await runConnectorStep(() => dependencies.executeConnectorCommand(issued));
  const completed = await dependencies.completeDiagnosticCommand({
    challengeId: issued.command.commandId,
    signedResponse: connectorResult,
  });

  return { ...completed, platform: serverDiagnostics.platform };
};
