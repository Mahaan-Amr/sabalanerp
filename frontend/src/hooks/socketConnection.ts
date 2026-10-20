import type { ManagerOptions, SocketOptions } from 'socket.io-client';

export const resolveSocketUrl = (input: {
  apiUrl: string;
  browserOrigin: string;
  configuredSocketUrl?: string;
}) => input.configuredSocketUrl || (input.apiUrl.startsWith('/')
  ? input.browserOrigin
  : input.apiUrl.replace(/\/api\/?$/, ''));

export const socketConnectionOptions: Partial<ManagerOptions & SocketOptions> = {
  withCredentials: true,
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
};

/** Browser WebSocket handshakes cannot supply arbitrary build headers. Keep
 * polling, upgrade and reconnect on the same compiled producer; its identity
 * never replaces the backend's authoritative session authorization. */
export const socketConnectionOptionsForProducer = (buildId: string | null): Partial<ManagerOptions & SocketOptions> => {
  if (buildId !== null && !/^erp_[a-z0-9_-]{8,90}$/.test(buildId)) throw new Error('BROWSER_BUILD_REQUEST_IDENTITY_INVALID');
  return { ...socketConnectionOptions, ...(buildId === null ? {} : { query: { __sabalan_build: buildId } }) };
};
