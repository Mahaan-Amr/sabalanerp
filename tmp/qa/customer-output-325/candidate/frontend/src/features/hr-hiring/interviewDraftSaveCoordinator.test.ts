import assert from 'node:assert/strict';
import { InterviewDraftSaveCoordinator } from './interviewDraftSaveCoordinator';

const main = async () => {
  const calls: Array<{ payload: { answer: number }; version: number }> = [];
  const resolvers: Array<(value: { version: number }) => void> = [];
  const coordinator = new InterviewDraftSaveCoordinator<{ answer: number }>({
    initialVersion: 0,
    save: (payload, version) => {
      calls.push({ payload, version });
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  coordinator.queue({ answer: 1 });
  await Promise.resolve();
  coordinator.queue({ answer: 2 });
  assert.deepEqual(calls, [{ payload: { answer: 1 }, version: 0 }], 'a second autosave must wait for the in-flight save');

  resolvers.shift()!({ version: 1 });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls[1], { payload: { answer: 2 }, version: 1 }, 'the queued save must use the committed version');

  resolvers.shift()!({ version: 2 });
  const flushed = coordinator.flush({ answer: 3 });
  await Promise.resolve();
  assert.deepEqual(calls[2], { payload: { answer: 3 }, version: 2 }, 'completion flushes the latest payload using the latest version');
  resolvers.shift()!({ version: 3 });
  await flushed;

  let conflictCalls = 0;
  const conflict = Object.assign(new Error('version conflict'), { response: { status: 409 } });
  const conflictingCoordinator = new InterviewDraftSaveCoordinator<{ answer: number }>({
    initialVersion: 4,
    save: async () => {
      conflictCalls += 1;
      throw conflict;
    },
  });
  await assert.rejects(conflictingCoordinator.flush({ answer: 5 }), /version conflict/);
  assert.equal(conflictingCoordinator.getSnapshot().status, 'conflict');
  conflictingCoordinator.retry();
  await Promise.resolve();
  assert.equal(conflictCalls, 1, 'a version conflict must stop automatic and manual blind retries');

  const scheduledDelays: number[] = [];
  let transientCalls = 0;
  const transientCoordinator = new InterviewDraftSaveCoordinator<{ answer: number }>({
    initialVersion: 0,
    retryDelaysMs: [10, 20],
    schedule: (_callback, delay) => {
      scheduledDelays.push(delay);
      return delay as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: () => undefined,
    save: async () => {
      transientCalls += 1;
      throw new Error('temporary failure');
    },
  });
  await assert.rejects(transientCoordinator.flush({ answer: 6 }), /temporary failure/);
  assert.deepEqual(scheduledDelays, [10], 'a transient failure schedules the first bounded retry');
  assert.equal(transientCalls, 1);

  console.log('Interview draft save coordinator tests passed.');
};

void main();
