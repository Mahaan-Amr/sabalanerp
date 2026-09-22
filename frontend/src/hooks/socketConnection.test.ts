import assert from 'node:assert/strict';
import { resolveSocketUrl, socketConnectionOptions } from './socketConnection';

assert.equal(resolveSocketUrl({
  apiUrl: '/api',
  browserOrigin: 'https://erp.example.com',
}), 'https://erp.example.com');

assert.equal(resolveSocketUrl({
  apiUrl: 'http://localhost:5000/api',
  browserOrigin: 'http://localhost:3000',
}), 'http://localhost:5000');

assert.deepEqual(
  socketConnectionOptions.transports,
  ['websocket', 'polling'],
  'WebSocket must be attempted before XHR polling when the proxy supports both transports.',
);
assert.equal(socketConnectionOptions.tryAllTransports, true);

console.log('Socket connection policy tests passed.');
