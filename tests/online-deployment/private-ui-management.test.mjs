import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import test from 'node:test';
import {privateUiManagementServer} from './private-ui-management.fixture.mjs';

test('a half-closed management caller receives the durable reply after asynchronous publication', async () => {
  let publications = 0;
  const server = privateUiManagementServer(async command => {
    assert.equal(command, 'publish'); await new Promise(resolve => setTimeout(resolve, 75));
    publications++; return {generation: publications};
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(server.address().port, '127.0.0.1'); let text = '';
      socket.on('connect', () => socket.end('publish\n'));
      socket.on('data', bytes => {text += bytes.toString('utf8');});
      socket.on('end', () => resolve(text)); socket.on('error', reject);
    });
    assert.deepEqual(JSON.parse(result), {ok: true, value: {generation: 1}}); assert.equal(publications, 1);
  } finally {await new Promise(resolve => server.close(resolve));}
});
