/** Docker readiness for a private-IP listener. This grants no release authority. */
import http from 'node:http';
import os from 'node:os';

const addresses = [...new Set(Object.values(os.networkInterfaces()).flatMap(values =>
  (values ?? []).filter(value => value.family === 'IPv4' && !value.internal).map(value => value.address)))];
if (process.platform !== 'linux' || addresses.length !== 1) process.exit(1);
const host = addresses[0];
if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) process.exit(1);
const request = http.get({host, port: 5000, path: '/api/ready', timeout: 6000}, response => {
  response.resume();
  response.once('end', () => { process.exitCode = response.statusCode === 200 ? 0 : 1; });
});
request.once('timeout', () => request.destroy(new Error('ONLINE_READINESS_TIMEOUT')));
request.once('error', () => { process.exitCode = 1; });
