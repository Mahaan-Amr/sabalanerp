import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

function renderedNginxPorts(bindAddress) {
  const environment = {
    ...process.env,
    DOMAIN: 'erp.qa.test',
    INQUIRY_DOMAIN: 'inquiry.qa.test',
  };
  if (bindAddress) environment.DEPLOYMENT_NGINX_BIND_ADDRESS = bindAddress;
  else delete environment.DEPLOYMENT_NGINX_BIND_ADDRESS;
  const output = execFileSync('docker', ['compose', '-f', 'docker-compose.prod.yml', 'config', '--format', 'json'], {
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(output).services.nginx.ports;
}

test('isolated protected rehearsal binds both ingress ports only to loopback', () => {
  const ports = renderedNginxPorts('127.0.0.1');
  assert.deepEqual(ports.map(({ target, published, host_ip }) => ({ target, published, host_ip })), [
    { target: 80, published: '80', host_ip: '127.0.0.1' },
    { target: 443, published: '443', host_ip: '127.0.0.1' },
  ]);
});

test('production ingress retains its existing all-interface binding by default', () => {
  const ports = renderedNginxPorts();
  assert.deepEqual(ports.map(({ target, published, host_ip }) => ({ target, published, host_ip })), [
    { target: 80, published: '80', host_ip: '0.0.0.0' },
    { target: 443, published: '443', host_ip: '0.0.0.0' },
  ]);
});
