import { expect, test } from "@playwright/test";

const applicationId = "hr-e2e-interview-application";
const apiBase = `http://127.0.0.1:3100/api/hr-hiring/applications/${applicationId}`;

test("schema-two interview completion preserves invalid evidence and atomically records corrected evidence", async ({ page }) => {
  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  const permissionsResponse = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/me/action-permissions",
  );
  expect((await permissionsResponse.json()).data).toEqual(expect.arrayContaining([
    "RECORD_INITIAL_INTERVIEW",
    "MANAGE_RECRUITMENT_CASE",
  ]));

  const criteriaResponse = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/interview-criteria",
  );
  expect(criteriaResponse.ok(), await criteriaResponse.text()).toBe(true);
  const criteria = (await criteriaResponse.json()).data.criteriaJson as Array<{
    stableId: string;
    answerType: string;
  }>;
  const answerFor = (answerType: string) => ({
    score: answerType === "SCORE_1_TO_5" ? 3 : null,
    text: ["TEXT", "ADDRESS"].includes(answerType) ? "پاسخ کامل آزمایشی" : "",
    note: "",
    judgment: ["ADDRESS", "YES_NO", "COMPANION"].includes(answerType) ? "POSITIVE" : null,
    companionPresent: ["YES_NO", "COMPANION"].includes(answerType) ? "NO" : null,
    strengths: answerType === "STRENGTHS_WEAKNESSES" ? ["۱", "۲", "۳", "۴", "۵"] : [],
    weaknesses: answerType === "STRENGTHS_WEAKNESSES" ? ["۱", "۲", "۳", "۴", "۵"] : [],
  });
  const answers = Object.fromEntries(
    criteria.map((criterion) => [criterion.stableId, answerFor(criterion.answerType)]),
  );
  const firstCriterionId = criteria[0].stableId;

  const invalidDraft = await page.request.put(`${apiBase}/initial-interview/draft`, {
    data: {
      expectedVersion: 0,
      payload: {
        schemaVersion: 2,
        state: {
          answers: { ...answers, [firstCriterionId]: { ...answers[firstCriterionId], score: null } },
          decision: "POSITIVE",
          decisionReason: "جمع‌بندی آزمایشی",
        },
        customCriteria: [],
      },
    },
  });
  expect(invalidDraft.status(), await invalidDraft.text()).toBe(200);

  const rejectedCompletion = await page.request.post(`${apiBase}/decisions/HR_INTERVIEW`, {
    data: { outcome: "POSITIVE", explanation: "جمع‌بندی آزمایشی" },
  });
  expect(rejectedCompletion.status()).toBe(400);
  expect(await rejectedCompletion.json()).toMatchObject({
    success: false,
    code: "HR_INTERVIEW_EVIDENCE_INVALID",
    target: "criterion",
    criterionId: firstCriterionId,
  });
  const preserved = await page.request.get(`${apiBase}/initial-interview`);
  expect(await preserved.json()).toMatchObject({
    success: true,
    data: { draft: { version: 1 }, history: [] },
  });

  const correctedDraft = await page.request.put(`${apiBase}/initial-interview/draft`, {
    data: {
      expectedVersion: 1,
      payload: {
        schemaVersion: 2,
        state: {
          answers,
          decision: "POSITIVE",
          decisionReason: "جمع‌بندی آزمایشی",
        },
        customCriteria: [],
      },
    },
  });
  expect(correctedDraft.status(), await correctedDraft.text()).toBe(200);

  const completed = await page.request.post(`${apiBase}/decisions/HR_INTERVIEW`, {
    data: { outcome: "POSITIVE", explanation: "جمع‌بندی آزمایشی" },
  });
  expect(completed.status(), await completed.text()).toBe(201);
  expect(await completed.json()).toMatchObject({
    success: true,
    data: { outcome: "POSITIVE", version: 1, criteriaTemplateVersion: 1 },
  });

  const recorded = await page.request.get(`${apiBase}/initial-interview`);
  expect(await recorded.json()).toMatchObject({
    success: true,
    data: {
      draft: null,
      history: [{ version: 1, outcome: "POSITIVE", criteriaTemplateVersion: 1 }],
    },
  });
});

test("completion error names and focuses the invalid criterion before retry succeeds", async ({ page }) => {
  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  const criteriaResponse = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/interview-criteria",
  );
  const criteria = (await criteriaResponse.json()).data.criteriaJson as Array<{
    stableId: string;
    answerType: string;
  }>;
  const answers = Object.fromEntries(criteria.map((criterion) => [criterion.stableId, {
    score: criterion.answerType === "SCORE_1_TO_5" ? 3 : null,
    text: ["TEXT", "ADDRESS"].includes(criterion.answerType) ? "پاسخ کامل آزمایشی" : "",
    note: "",
    judgment: ["ADDRESS", "YES_NO", "COMPANION"].includes(criterion.answerType) ? "POSITIVE" : null,
    companionPresent: ["YES_NO", "COMPANION"].includes(criterion.answerType) ? "NO" : null,
    strengths: criterion.answerType === "STRENGTHS_WEAKNESSES" ? ["۱", "۲", "۳", "۴", "۵"] : [],
    weaknesses: criterion.answerType === "STRENGTHS_WEAKNESSES" ? ["۱", "۲", "۳", "۴", "۵"] : [],
  }]));
  const draft = await page.request.put(`${apiBase}/initial-interview/draft`, {
    data: {
      expectedVersion: 0,
      payload: {
        schemaVersion: 2,
        state: { answers, decision: "POSITIVE", decisionReason: "جمع‌بندی آزمایشی" },
        customCriteria: [],
      },
    },
  });
  expect(draft.ok(), await draft.text()).toBe(true);

  const firstCriterion = criteria[0];
  await page.route(`**/api/hr-hiring/applications/${applicationId}/decisions/HR_INTERVIEW`, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        code: "HR_INTERVIEW_EVIDENCE_INVALID",
        error: `پاسخ معیار «نوع پوشش» کامل نیست. این معیار را بررسی کنید.`,
        target: "criterion",
        criterionId: firstCriterion.stableId,
      }),
    });
  });
  await page.goto(`/dashboard/hr/hiring/${applicationId}?phase=INITIAL_HR_REVIEW`);
  const revisionButton = page.getByRole("button", { name: "ثبت نسخه اصلاحی مصاحبه" });
  const completeButton = page.getByRole("button", { name: "ثبت و تکمیل مصاحبه" });
  await expect(revisionButton.or(completeButton)).toBeVisible({ timeout: 30_000 });
  if (await revisionButton.isVisible()) await revisionButton.click();
  await completeButton.click();

  const validationAlert = page.getByRole("alert").filter({ hasText: "نوع پوشش" });
  await expect(validationAlert).toBeVisible();
  const criterionEditor = page.locator(`[data-interview-criterion-id="${firstCriterion.stableId}"]`);
  await expect.poll(() => criterionEditor.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.unroute(`**/api/hr-hiring/applications/${applicationId}/decisions/HR_INTERVIEW`);
  const completionResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/hr-hiring/applications/${applicationId}/decisions/HR_INTERVIEW`)
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "تلاش مجدد" }).click();
  expect((await completionResponse).status()).toBe(201);
  await expect(validationAlert).toHaveCount(0);
});
