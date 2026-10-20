import assert from 'node:assert/strict';
import { resolveSocketUrl, socketConnectionOptions, socketConnectionOptionsForProducer } from './socketConnection';

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
assert.equal(socketConnectionOptionsForProducer(null).query, undefined);
assert.deepEqual(socketConnectionOptionsForProducer('erp_socket_producer_old').query, { __sabalan_build: 'erp_socket_producer_old' });
assert.deepEqual(socketConnectionOptionsForProducer('erp_socket_producer_new').transports, ['websocket', 'polling']);
assert.throws(() => socketConnectionOptionsForProducer('latest'), /BROWSER_BUILD_REQUEST_IDENTITY_INVALID/);
assert.throws(() => socketConnectionOptionsForProducer('erp_socket&other=owner'), /BROWSER_BUILD_REQUEST_IDENTITY_INVALID/);

console.log('Socket connection policy tests passed.');
