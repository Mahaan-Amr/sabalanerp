import assert from 'node:assert/strict';
import { createRetiredOnboardingTaskCreationHandler } from '../hr-hiring';
import { legacyOnboardingTaskCompletionDecision } from '../../services/hrOnboardingTaskRetirementAudit';

const recorded: Array<Record<string, unknown>> = [];
const handler = createRetiredOnboardingTaskCreationHandler(async (
  applicationId,
  eventType,
  _req,
  payload,
) => {
  recorded.push({ applicationId, eventType, payload });
});

const run = async () => {
  let statusCode = 200;
  let response: any;
  await handler({
    params: { id: 'application-1' },
    body: { title: 'محتوای حساس نباید ممیزی شود' },
    method: 'POST',
    user: { id: 'hr-manager', role: 'ADMIN' },
    get: () => undefined,
  } as any, {
    status(code: number) { statusCode = code; return this; },
    json(body: any) { response = body; return this; },
  } as any);

  assert.equal(statusCode, 410);
  assert.deepEqual(response, {
    success: false,
    error: 'ایجاد وظیفه دستی شروع همکاری متوقف شده است؛ وضعیت قرارداد، حقوق و بیمه به‌صورت خودکار پیگیری می‌شود.',
  });
  assert.deepEqual(recorded, [{
    applicationId: 'application-1',
    eventType: 'MANUAL_ONBOARDING_TASK_CREATION_RETIRED',
    payload: { method: 'POST', route: '/applications/:id/onboarding-tasks' },
  }]);

  assert.equal(
    legacyOnboardingTaskCompletionDecision({
      title: 'وظیفه دستی قدیمی',
      ownerAuthority: 'HR_MANAGER',
      activationBlocker: true,
    }, 'COMPLETE'),
    'COMPLETE',
  );
  assert.equal(
    legacyOnboardingTaskCompletionDecision({
      title: 'تأیید قرارداد امضاشده',
      ownerAuthority: 'FINANCE_MANAGER',
      activationBlocker: true,
    }, 'COMPLETE'),
    'SYSTEM_MANAGED',
  );
  assert.equal(
    legacyOnboardingTaskCompletionDecision({
      title: 'وظیفه دستی قدیمی',
      ownerAuthority: 'HR_MANAGER',
      activationBlocker: true,
    }, 'IN_PROGRESS'),
    'INVALID_STATUS',
  );
  assert.equal(
    legacyOnboardingTaskCompletionDecision({
      title: 'پیگیری ثبت بیمه',
      ownerAuthority: 'HR_MANAGER',
      activationBlocker: true,
    }, 'COMPLETE'),
    'COMPLETE',
  );

  console.log('HR onboarding task retirement route tests passed.');
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
