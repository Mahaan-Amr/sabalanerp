import assert from 'node:assert/strict';
import test from 'node:test';
import {networkInterfaces} from 'node:os';
import {assertNativePrivateIPv4,assertNativePrivateInterface} from './native-private-network.fixture.mjs';

test('native role isolation accepts exact RFC1918 addresses and refuses wildcard/public/loopback/DNS values',()=>{
  for(const host of ['10.0.0.2','172.16.0.2','172.31.255.254','192.168.1.2'])assert.equal(assertNativePrivateIPv4(host),host);
  for(const host of [undefined,null,'','0.0.0.0','127.0.0.1','::1','8.8.8.8','172.15.0.2','172.32.0.2',
    '169.254.1.2','backend-retained','010.0.0.2','192.168.1.2:5000','192.168.1.2/path'])assert.throws(()=>assertNativePrivateIPv4(host));
});

test('listener binding requires the actual original process network interface',()=>{
  const interfaces=Object.values(networkInterfaces()).flat().filter(value=>value&&!value.internal&&value.family==='IPv4');
  const actual=interfaces.find(value=>{try{assertNativePrivateIPv4(value.address);return true;}catch{return false;}});
  if(actual)assert.equal(assertNativePrivateInterface(actual.address),actual.address);
  const absent=['10.254.254.254','172.31.254.254','192.168.254.254'].find(host=>!interfaces.some(value=>value.address===host));
  assert.ok(absent);assert.throws(()=>assertNativePrivateInterface(absent),/PRIVATE_INTERFACE_ABSENT/);
});
