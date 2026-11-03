import assert from 'node:assert/strict';
import { describeClient, privateNetworkLabel } from '../sessionClientMetadata';

assert.deepEqual(
  describeClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'),
  { browser: 'Chrome', operatingSystem: 'Windows', deviceCategory: 'Desktop' }
);
assert.deepEqual(
  describeClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'),
  { browser: 'Safari', operatingSystem: 'iOS', deviceCategory: 'Mobile' }
);
assert.equal(privateNetworkLabel('192.168.1.4'), 'Internal network');
assert.equal(privateNetworkLabel('8.8.8.8'), null);

console.log('session client metadata tests passed');
