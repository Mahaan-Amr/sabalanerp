import { BiometricCommand, BiometricConnector, BiometricConnectorResult, ConnectorErrorCategory, SimulatorScenario } from './biometricProtocol';

const baseResult = (command: BiometricCommand): BiometricConnectorResult => ({
  commandId: command.commandId,
  operation: command.operation,
  availability: 'AVAILABLE',
  device: { model: 'Sabalan deterministic simulator', serial: 'SIM-0001', connectorVersion: '1.0.0-simulator', sdkVersion: 'simulator-1' },
  captureQuality: { state: 'ACCEPTED', score: 82 },
  liveness: { state: 'LIVE', score: 91 },
  match: { state: command.operation === 'VERIFY' ? 'MATCH' : 'NOT_EVALUATED', ...(command.operation === 'VERIFY' ? { score: 96 } : {}) },
  fallback: { goodQualityLiveNonMatchCount: 0, eligible: false },
  errorCategory: 'NONE',
  retryable: false,
});

export class DeterministicBiometricSimulator implements BiometricConnector {
  private lastNonMatchAttemptByChallenge = new Map<string, number>();

  async execute(command: BiometricCommand): Promise<BiometricConnectorResult> {
    const scenario = String(command.payload.simulation?.scenario || 'SUCCESS') as SimulatorScenario;
    const attempt = Number(command.payload.simulation?.attempt || 1);
    const challengeId = String(command.payload.challengeId || command.commandId);
    const result = baseResult(command);
    const unevaluated = () => {
      result.captureQuality = { state: 'NOT_EVALUATED' };
      result.liveness = { state: 'NOT_EVALUATED' };
      result.match = { state: 'NOT_EVALUATED' };
    };
    const acceptNonMatchAttempt = () => {
      const lastAttempt = this.lastNonMatchAttemptByChallenge.get(challengeId) || 0;
      if (attempt !== lastAttempt + 1) return false;
      this.lastNonMatchAttemptByChallenge.set(challengeId, attempt);
      result.fallback = { goodQualityLiveNonMatchCount: attempt, eligible: attempt >= 3 };
      return true;
    };
    const fail = (errorCategory: ConnectorErrorCategory, retryable = false) => { result.errorCategory = errorCategory; result.retryable = retryable; };

    switch (scenario) {
      case 'POOR_QUALITY': result.captureQuality = { state: 'REJECTED', score: 18 }; result.liveness = { state: 'NOT_EVALUATED' }; result.match = { state: 'NOT_EVALUATED' }; fail('POOR_CAPTURE_QUALITY', true); break;
      case 'LIVENESS_FAILURE': result.liveness = { state: 'NOT_LIVE', score: 11 }; result.match = { state: 'NOT_EVALUATED' }; fail('LIVENESS_FAILED'); break;
      case 'NON_MATCH':
        if (!acceptNonMatchAttempt()) { unevaluated(); fail('ATTEMPT_SEQUENCE_INVALID'); break; }
        result.match = { state: 'NO_MATCH', score: 12 }; fail('NO_MATCH', true); break;
      case 'WRONG_DRIVER':
        if (!acceptNonMatchAttempt()) { unevaluated(); fail('ATTEMPT_SEQUENCE_INVALID'); break; }
        result.match = { state: 'NO_MATCH', score: 4 }; fail('WRONG_DRIVER'); break;
      case 'DISCONNECT': result.availability = 'UNAVAILABLE'; unevaluated(); fail('DEVICE_DISCONNECTED', true); break;
      case 'TIMEOUT': unevaluated(); fail('CAPTURE_TIMEOUT', true); break;
      case 'RETRY': if (attempt < 2) { unevaluated(); fail('RETRYABLE_CONNECTOR_ERROR', true); } break;
      case 'RECOVERY': result.recoveredFrom = 'DEVICE_DISCONNECTED'; break;
      case 'LICENSING_FAILURE': result.availability = 'UNAVAILABLE'; unevaluated(); fail('SDK_LICENSE_INVALID'); break;
      case 'SUCCESS': break;
      default: unevaluated(); fail('INVALID_COMMAND'); break;
    }
    if (result.match.state === 'MATCH') this.lastNonMatchAttemptByChallenge.delete(challengeId);
    return result;
  }
}

export const readBiometricConnectorDiagnostics = async (connector: BiometricConnector, checkedAt = new Date()) => {
  const health = await connector.execute({ commandId: `diagnostic-${checkedAt.getTime()}`, nonce: 'diagnostic-read-only', workstationId: 'server-diagnostic', issuedAt: checkedAt.toISOString(), expiresAt: checkedAt.toISOString(), operation: 'HEALTH', payload: {} });
  return { mode: 'SIMULATOR' as const, availability: health.availability, liveEnrollmentEnabled: false, checkedAt: checkedAt.toISOString(), device: health.device, supportedChecks: ['capture-quality', 'liveness', 'one-to-one-match', 'retry-recovery', 'licensing'] as const };
};
