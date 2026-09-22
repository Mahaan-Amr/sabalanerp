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
