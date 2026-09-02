import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ConfigFile {
  workstationId: string;
  allowedOrigin: string;
  listenPort?: number;
  commandSecretBase64: string;
  activeTransportKeyId: string;
  transportKeysBase64: Record<string, string>;
  journalPath: string;
  adapterPath: string;
  allowedDeviceSerial: string;
}

export const loadConnectorConfig = (path = process.env.SABALAN_BIOMETRIC_CONFIG_PATH || join(process.env.ProgramData || 'C:\\ProgramData', 'SabalanERP', 'Biometric Connector', 'connector.json')) => {
  const value = JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
  const commandSecret = Buffer.from(value.commandSecretBase64 || '', 'base64');
  const transportKeys = Object.fromEntries(Object.entries(value.transportKeysBase64 || {}).map(([id, key]) => [id, Buffer.from(key, 'base64')]));
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.workstationId || '')) throw new Error('Configured workstationId is invalid');
  const origin = new URL(value.allowedOrigin);
  if (origin.origin !== value.allowedOrigin || !['https:', 'http:'].includes(origin.protocol)) throw new Error('Configured ERP origin is invalid');
  if (commandSecret.length !== 32 || !value.activeTransportKeyId || transportKeys[value.activeTransportKeyId]?.length !== 32) throw new Error('Configured biometric keys are invalid');
  if (!value.journalPath || !value.adapterPath || !/^[A-Za-z0-9-]{8,128}$/.test(value.allowedDeviceSerial || '')) throw new Error('Configured connector paths or device serial are invalid');
  const listenPort = value.listenPort ?? 47631;
  if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) throw new Error('Configured connector port is invalid');
  return { ...value, allowedOrigin: origin.origin, listenPort, commandSecret, transportKeys };
};
