import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureInitialInterviewCriteriaSet,
} from '../hrInitialInterviewCriteriaSet';
import {
  initialInterviewDraftSaveError,
  mergeInitialInterviewDraftWithFrozenCriteria,
  withFrozenInitialInterviewCriteria,
} from '../hrInitialInterviewDraftPersistence';

test('first interview atomically materializes the canonical defaults as criteria version 1', async () => {
  const calls: unknown[] = [];
  const database = {
    hrInterviewCriteriaVersion: {
      findFirst: async () => null,
      upsert: async (args: unknown) => {
        calls.push(args);
        return {
          id: 'criteria-v1',
          version: 1,
          criteriaJson: (args as any).create.criteriaJson,
          publishedByUserId: (args as any).create.publishedByUserId,
        };
      },
    },
  };

  const criteriaSet = await ensureInitialInterviewCriteriaSet(database, 'user-1');

  assert.equal(criteriaSet.version, 1);
  assert.equal(criteriaSet.publishedByUserId, 'user-1');
  assert.equal((criteriaSet.criteriaJson as unknown[]).length, 17);
  assert.deepEqual(calls, [{
    where: { version: 1 },
    create: {
      version: 1,
      criteriaJson: criteriaSet.criteriaJson,
      publishedByUserId: 'user-1',
    },
    update: {},
  }]);
});

test('unexpected draft persistence errors keep technical details in the cause only', () => {
  const databaseError = new Error('Invalid prisma create constraint 23514');
  const publicError = initialInterviewDraftSaveError(databaseError) as Error & {
    statusCode?: number;
    isOperational?: boolean;
    cause?: unknown;
  };

  assert.equal(publicError.message, 'ذخیره پیش‌نویس مصاحبه انجام نشد. دوباره تلاش کنید.');
  assert.equal(publicError.statusCode, 500);
  assert.equal(publicError.isOperational, true);
  assert.equal(publicError.cause, databaseError);
  assert.doesNotMatch(publicError.message, /prisma|23514|constraint/i);
});

test('version conflicts keep their actionable public message', () => {
  const conflict = Object.assign(new Error('پیش‌نویس توسط کاربر دیگری تغییر کرده است.'), { statusCode: 409 });
  assert.equal(initialInterviewDraftSaveError(conflict), conflict);
});

test('Prisma serializable conflicts become safe explicit draft conflicts', () => {
  const conflict = initialInterviewDraftSaveError({
    code: 'P2034',
    message: 'Transaction failed due to a write conflict',
  }) as Error & { statusCode: number; cause: unknown };

  assert.equal(conflict.statusCode, 409);
  assert.match(conflict.message, /نسخه جدید سرور/);
  assert.doesNotMatch(conflict.message, /P2034|Prisma|Transaction/);
  assert.equal((conflict.cause as { code: string }).code, 'P2034');
});

test('an existing draft always keeps the exact frozen criteria version and snapshot', () => {
  const frozenSnapshot = [{ stableId: 'appearance', title: 'نوع پوشش' }];
  const result = mergeInitialInterviewDraftWithFrozenCriteria(
    { version: 1, criteria: [{ criterionId: 'appearance', score: 4 }] },
    {
      schemaVersion: 2,
      state: { decision: null },
      criteriaTemplateVersion: 999,
      criteriaSnapshot: [{ stableId: 'wrong' }],
    },
    7,
    frozenSnapshot,
  );

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.criteriaTemplateVersion, 7);
  assert.equal(result.criteriaSnapshot, frozenSnapshot);
  assert.deepEqual(result.state, { decision: null });
});

test('a draft without its historical criteria fails closed and remains recoverable', () => {
  assert.throws(
    () => withFrozenInitialInterviewCriteria({ schemaVersion: 2 }, 7, null),
    (error: Error & { statusCode?: number; code?: string }) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'HR_INTERVIEW_CRITERIA_SNAPSHOT_UNAVAILABLE');
      assert.match(error.message, /اطلاعات حفظ شده/);
      return true;
    },
  );
});
