import assert from 'node:assert/strict';
import test from 'node:test';
import { ProcessBioMiniDevice, type ProcessInvocation } from '../src/processDeviceAdapter';

const identity = { model: 'BioMini SLIM 2', serial: 'SERIAL-01', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' };

test('process adapter parses only the normalized marker and keeps SDK chatter out of results', async () => {
  const invocations: ProcessInvocation[] = [];
  const device = new ProcessBioMiniDevice(async (invocation) => {
    invocations.push(invocation);
    return { exitCode: 0, stdout: `vendor debug\nSABALAN_RESULT:${JSON.stringify({ availability: 'AVAILABLE', device: identity, errorCategory: 'NONE' })}\n`, stderr: '' };
  });
  assert.deepEqual(await device.health(), identity);
  assert.deepEqual(invocations[0].args, ['health', '--sdk-worker']);
});

test('process adapter obtains an enrollment template via private pipe output and validates evidence', async () => {
  const material = Buffer.from('iso-template-material');
  const header = Buffer.from(`SABALAN_TEMPLATE_RESULT:${JSON.stringify({ availability: 'AVAILABLE', device: identity, captureQuality: { state: 'ACCEPTED', score: 86 }, liveness: { state: 'LIVE', score: 999 }, templateFormat: 'ISO_19794_2', templateLength: material.length, errorCategory: 'NONE' })}\n`);
  const device = new ProcessBioMiniDevice(async () => ({ exitCode: 0, stderr: '', stdout: Buffer.concat([header, material]) }));
  const result = await device.capture();
  assert.deepEqual(result.template, material);
  assert.equal(result.quality, 86);
});

test('process adapter sends expected template only over stdin and maps one-to-one verification', async () => {
  const material = Buffer.from('expected-template');
  let invocation!: ProcessInvocation;
  let received!: Buffer;
  const device = new ProcessBioMiniDevice(async (value) => {
    invocation = value;
    received = Buffer.from(value.stdin!);
    return { exitCode: 0, stderr: '', stdout: `SABALAN_RESULT:${JSON.stringify({ availability: 'AVAILABLE', device: identity, captureQuality: { state: 'ACCEPTED', score: 90 }, liveness: { state: 'LIVE', score: 999 }, match: { state: 'MATCH', score: 93 }, errorCategory: 'NONE' })}` };
  });
  const result = await device.verify(material);
  assert.deepEqual(invocation.args, ['verify', '--sdk-worker']);
  assert.deepEqual(received, material);
  assert.ok(invocation.stdin?.every((byte) => byte === 0), 'the worker input copy must be cleared after verification');
  assert.equal(invocation.args.join(' ').includes(material.toString('base64')), false);
  assert.equal(result.matched, true);
});

test('process adapter fails closed on missing marker, nonzero exit and oversized output', async () => {
  await assert.rejects(() => new ProcessBioMiniDevice(async () => ({ exitCode: 0, stdout: 'debug only', stderr: '' })).health(), /normalized result/i);
  await assert.rejects(() => new ProcessBioMiniDevice(async () => ({ exitCode: 2, stdout: 'SABALAN_RESULT:{"availability":"UNAVAILABLE","errorCategory":"DEVICE_DISCONNECTED"}', stderr: '' })).health(), /DEVICE_DISCONNECTED/i);
  await assert.rejects(() => new ProcessBioMiniDevice(async () => ({ exitCode: 0, stdout: 'x'.repeat(70_000), stderr: '' })).health(), /output limit/i);
});
