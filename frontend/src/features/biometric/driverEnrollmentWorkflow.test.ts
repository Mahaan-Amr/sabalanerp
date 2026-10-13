import assert from 'node:assert/strict';
import test from 'node:test';
import { captureEnrollmentFingers, captureEvidenceTone, enrollmentSessionExpired, EnrollmentSession } from './driverEnrollmentWorkflow';

const validResult = { availability: 'AVAILABLE', errorCategory: 'NONE', captureQuality: { state: 'ACCEPTED', score: 80 }, liveness: { state: 'LIVE' } };
function harness() {
  let time = 100_000;
  let failure: string | null = null;
  const events: string[] = [];
  const session: EnrollmentSession = { enrollmentSessionId: 'session-1', captures: [] };
  const dependencies = {
    personnelId: 'personnel-1', session, now: () => time,
    getConnectorStatus: async () => ({ workstationId: 'station-1', availability: 'AVAILABLE' }),
    requestFingerPlacement: async (finger: string) => { events.push(`placement:${finger}`); time += 40_000; },
    createEnrollmentCommand: async (_personnel: string, data: any) => { events.push(`command:${data.finger}`); assert.equal(data.enrollmentSessionId, session.enrollmentSessionId); return { data: { data: { command: { commandId: data.finger } } } }; },
    executeConnectorCommand: async (bundle: any) => ({ response: { result: bundle.command.commandId === failure ? { availability: 'UNAVAILABLE', errorCategory: 'CONNECTOR_ERROR', captureQuality: { state: 'NOT_EVALUATED' }, liveness: { state: 'NOT_EVALUATED' } } : validResult }, signature: 'signature', transportEnvelope: {} }),
    acceptEnrollmentCapture: async (_personnel: string, data: any) => { events.push(`stage:${data.challengeId}`); return { data: { data: { challengeId: data.challengeId, finger: data.challengeId, expiresAt: new Date(session.captures.length ? Date.parse(session.captures[0].expiresAt) : time + 300_000).toISOString(), qualityState: 'ACCEPTED', qualityScore: 80, livenessState: 'LIVE' } } }; },
  };
  return { dependencies, session, events, fail: (finger: string | null) => { failure = finger; }, advance: (ms: number) => { time += ms; } };
}

test('stage each capture before requesting next placement, despite more than 30 seconds between captures', async () => {
  const h = harness();
  const captures = await captureEnrollmentFingers(h.dependencies);
  assert.deepEqual(h.events, ['placement:RIGHT_INDEX', 'command:RIGHT_INDEX', 'stage:RIGHT_INDEX', 'placement:LEFT_INDEX', 'command:LEFT_INDEX', 'stage:LEFT_INDEX']);
  assert.deepEqual(captures, [{ challengeId: 'RIGHT_INDEX' }, { challengeId: 'LEFT_INDEX' }]);
});
test('failed right reports signed failure before stopping and never accepts invalid capture', async () => {
  const h = harness(); h.fail('RIGHT_INDEX');
  await assert.rejects(captureEnrollmentFingers(h.dependencies), /اتصال‌گر/);
  assert.deepEqual(h.events, ['placement:RIGHT_INDEX', 'command:RIGHT_INDEX', 'stage:RIGHT_INDEX']);
  assert.equal(h.session.captures.length, 0);
});
test('failed left retains right and retry only scans missing left', async () => {
  const h = harness(); h.fail('LEFT_INDEX');
  await assert.rejects(captureEnrollmentFingers(h.dependencies), /اتصال‌گر/);
  assert.equal(h.session.captures.length, 1);
  h.events.length = 0; h.fail(null);
  await captureEnrollmentFingers(h.dependencies);
  assert.deepEqual(h.events, ['placement:LEFT_INDEX', 'command:LEFT_INDEX', 'stage:LEFT_INDEX']);
});
test('both accepted refs survive final submission retry without contacting connector', async () => {
  const h = harness(); await captureEnrollmentFingers(h.dependencies); h.events.length = 0;
  const refs = await captureEnrollmentFingers({ ...h.dependencies, getConnectorStatus: async () => { throw new Error('must not re-scan'); } });
  assert.equal(refs.length, 2); assert.deepEqual(h.events, []);
});
test('expired session is rejected before any new capture', async () => {
  const h = harness(); h.fail('LEFT_INDEX'); await assert.rejects(captureEnrollmentFingers(h.dependencies));
  h.advance(300_000); h.events.length = 0;
  assert.equal(enrollmentSessionExpired(h.session, h.dependencies.now()), true);
  await assert.rejects(captureEnrollmentFingers(h.dependencies), /مهلت ثبت موقت/);
  assert.deepEqual(h.events, []);
});
test('unavailable health response stops before requesting placement', async () => {
  const h = harness();
  await assert.rejects(captureEnrollmentFingers({ ...h.dependencies, getConnectorStatus: async () => ({ workstationId: 'station', availability: 'UNAVAILABLE' }) }), /در دسترس نیست/);
  assert.deepEqual(h.events, []);
});
test('unassessed evidence does not receive a success badge', () => {
  assert.equal(captureEvidenceTone('NOT_EVALUATED', 'ACCEPTED'), 'warning');
  assert.equal(captureEvidenceTone('REJECTED', 'ACCEPTED'), 'danger');
  assert.equal(captureEvidenceTone('LIVE', 'LIVE'), 'success');
});
test('no command is issued before the operator confirms each finger placement', async () => {
  const h = harness();
  let release: (() => void) | undefined;
  const workflow = captureEnrollmentFingers({ ...h.dependencies, requestFingerPlacement: async (finger) => {
    h.events.push(`placement:${finger}`);
    await new Promise<void>(resolve => { release = resolve; });
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.events, ['placement:RIGHT_INDEX']);
  release?.(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.events, ['placement:RIGHT_INDEX', 'command:RIGHT_INDEX', 'stage:RIGHT_INDEX', 'placement:LEFT_INDEX']);
  release?.(); await workflow;
});
test('cancelling during placement prevents issuing another command', async () => {
  const h = harness(); let cancelled = false;
  await assert.rejects(captureEnrollmentFingers({ ...h.dependencies, isCancelled: () => cancelled, requestFingerPlacement: async () => { cancelled = true; } }), /لغو/);
  assert.deepEqual(h.events, []);
});
test('lost stage response retries the same encrypted bundle before any new scan', async () => {
  const h = harness();
  const requests: unknown[] = [];
  let loseResponse = true;
  const dependencies = { ...h.dependencies, acceptEnrollmentCapture: async (personnel: string, data: any) => {
    requests.push(data);
    const accepted = await h.dependencies.acceptEnrollmentCapture(personnel, data);
    if (loseResponse) { loseResponse = false; throw new Error('network response lost'); }
    return accepted;
  } };
  await assert.rejects(captureEnrollmentFingers(dependencies), /response lost/);
  assert.ok(h.session.pendingAcceptance);
  assert.deepEqual(h.events, ['placement:RIGHT_INDEX', 'command:RIGHT_INDEX', 'stage:RIGHT_INDEX']);
  h.events.length = 0;
  await captureEnrollmentFingers(dependencies);
  assert.equal(requests[0], requests[1], 'retry must reuse exact request in memory');
  assert.deepEqual(h.events, ['stage:RIGHT_INDEX', 'placement:LEFT_INDEX', 'command:LEFT_INDEX', 'stage:LEFT_INDEX']);
  assert.equal(h.session.pendingAcceptance, undefined);
});
test('expired pending acceptance cannot retry encrypted content', async () => {
  const h = harness();
  await assert.rejects(captureEnrollmentFingers({ ...h.dependencies, acceptEnrollmentCapture: async () => { throw new Error('lost'); } }));
  h.advance(300_000); h.events.length = 0;
  await assert.rejects(captureEnrollmentFingers(h.dependencies), /مهلت ثبت موقت/);
  assert.deepEqual(h.events, []);
});

test('failed report still shows capture cause without retaining invalid retry material', async () => {
  const h = harness(); h.fail('RIGHT_INDEX');
  let reported: any;
  await assert.rejects(captureEnrollmentFingers({ ...h.dependencies, acceptEnrollmentCapture: async (_personnel, data) => {
    reported = data;
    throw new Error('network report unavailable');
  } }), /اتصال‌گر/);
  assert.equal(reported.challengeId, 'RIGHT_INDEX');
  assert.equal(reported.signedResponse.response.result.errorCategory, 'CONNECTOR_ERROR');
  assert.equal(h.session.captures.length, 0);
  assert.equal(h.session.pendingAcceptance, undefined);
  assert.deepEqual(h.events, ['placement:RIGHT_INDEX', 'command:RIGHT_INDEX']);
});
