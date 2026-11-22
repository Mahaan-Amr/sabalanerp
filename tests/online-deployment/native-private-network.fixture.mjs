import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {networkInterfaces} from 'node:os';

/** Address validation is not admission. The original controller binds these
 * values to its inspected existing-container/network enrollment. */
export function assertNativePrivateIPv4(host) {
  assert.equal(typeof host,'string','NATIVE_PRIVATE_HOST_REQUIRED');
  assert.equal(isIP(host),4,'NATIVE_PRIVATE_IPV4_REQUIRED');
  const octets=host.split('.').map(Number);
  assert.ok(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)
    ||(octets[0]===192&&octets[1]===168),'NATIVE_RFC1918_HOST_REQUIRED');
  return host;
}
export function assertNativePrivateInterface(host) {
  assertNativePrivateIPv4(host);
  assert.ok(Object.values(networkInterfaces()).flat().some(value=>value&&!value.internal
    &&value.family==='IPv4'&&value.address===host),'NATIVE_ENROLLED_PRIVATE_INTERFACE_ABSENT');
  return host;
}
