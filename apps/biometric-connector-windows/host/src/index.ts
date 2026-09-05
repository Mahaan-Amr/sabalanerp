import { loadConnectorConfig } from './config';
import { ProcessBioMiniDevice } from './processDeviceAdapter';
import { createConnectorServer } from './server';

const config = loadConnectorConfig();
process.env.SABALAN_BIOMETRIC_ALLOWED_SERIAL = config.allowedDeviceSerial;
const server = createConnectorServer({
  allowedOrigin: config.allowedOrigin,
  workstationId: config.workstationId,
  commandSecret: config.commandSecret,
  transportKeys: { activeKeyId: config.activeTransportKeyId, keys: config.transportKeys },
  journalPath: config.journalPath,
  device: new ProcessBioMiniDevice(undefined, config.adapterPath),
});

server.listen(config.listenPort, '127.0.0.1', () => process.stdout.write(`Sabalan biometric connector listening on 127.0.0.1:${config.listenPort}\n`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
