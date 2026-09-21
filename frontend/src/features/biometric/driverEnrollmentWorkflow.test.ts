import assert from 'node:assert/strict';
import test from 'node:test';
import { captureEnrollmentFingers, EnrollmentFinger } from './driverEnrollmentWorkflow';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('each enrolled finger waits for a separate operator placement confirmation', async () => {
  const events: string[] = [];
  const placementResolvers = new Map<EnrollmentFinger, () => void>();
  let commandSequence = 0;

  const workflow = captureEnrollmentFingers({
    personnelId: 'personnel-1',
    getConnectorStatus: async () => ({ workstationId: 'workstation-1' }),
    requestFingerPlacement: async (finger: EnrollmentFinger) => {
      events.push(`prompt:${finger}`);
      await new Promise<void>((resolve) => placementResolvers.set(finger, resolve));
    },
    createEnrollmentCommand: async (_personnelId: string, { finger }: { finger: EnrollmentFinger }) => {
      events.push(`command:${finger}`);
      commandSequence += 1;
      return { data: { data: { command: { commandId: `command-${commandSequence}` } } } };
    },
    executeConnectorCommand: async () => ({ response: { result: { captureQuality: { state: 'ACCEPTED', score: 80 }, liveness: { state: 'LIVE', score: 999 } } }, signature: 'signature', transportEnvelope: {} }),
  } as any);

  await flush();
  assert.deepEqual(events, ['prompt:RIGHT_INDEX'], 'right capture must not start before the operator confirms finger placement');

  placementResolvers.get('RIGHT_INDEX')?.();
  await flush();
  assert.deepEqual(events, ['prompt:RIGHT_INDEX', 'command:RIGHT_INDEX', 'prompt:LEFT_INDEX'], 'left capture must pause for a second operator action');

  placementResolvers.get('LEFT_INDEX')?.();
  await workflow;
  assert.deepEqual(events, ['prompt:RIGHT_INDEX', 'command:RIGHT_INDEX', 'prompt:LEFT_INDEX', 'command:LEFT_INDEX']);
});
