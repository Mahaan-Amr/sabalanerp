import { expect, test } from "@playwright/test";

const expectReadable = async (locator: import("@playwright/test").Locator) => {
  const colors = await locator.evaluate((element) => {
    const foreground = getComputedStyle(element).color;
    let current: Element | null = element;
    let background = "rgba(0, 0, 0, 0)";
    while (current) {
      background = getComputedStyle(current).backgroundColor;
      if (!background.endsWith(", 0)") && background !== "transparent") break;
      current = current.parentElement;
    }
    return { foreground, background };
  });
  expect(colors.foreground).not.toBe(colors.background);
  expect(colors.foreground).not.toBe("rgba(0, 0, 0, 0)");
};

test("Candidate can enter the existing Job Application with its Application-specific OTP", async ({
  page,
}) => {
  await page.goto("/apply");

  await page.getByLabel("شماره همراه").fill("09120000001");
  await page.getByLabel("کد ورود شش‌رقمی").fill("123456");
  await page.getByRole("button", { name: "تأیید و ورود" }).click();

  await expect(
    page.getByRole("heading", { name: "جایگاه آزمایشی کارشناس حسابداری" }),
  ).toBeVisible();
});

test("HR Processor can enter the hiring case and control the external SMS boundary", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/login"),
  );
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.goto("/dashboard/hr/hiring");
  await expect(page.getByRole("link", { name: "متقاضی آزمایشی" })).toBeVisible({ timeout: 30_000 });

  const controlResponse = await page.request.put(
    "http://127.0.0.1:3100/api/test/hr-hiring-sms",
    { data: { mode: "failure" } },
  );
  expect(controlResponse.ok()).toBe(true);

  await page
    .getByRole("link", { name: "متقاضی آزمایشی" })
    .locator("xpath=ancestor::tr")
    .getByRole("button", { name: "ارسال مجدد دعوت" })
    .click();
  await page.getByRole("button", { name: "ارسال دعوت‌نامه جدید" }).click();
  await expect(page.getByText("خطای آزمایشی ارسال پیامک")).toBeVisible();

  const casePayload = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application",
  );
  const caseBody = await casePayload.json();
  expect(casePayload.ok(), JSON.stringify(caseBody)).toBe(true);
  expect(caseBody.data.currentApplicantOtp).toBeUndefined();
  const otpReveal = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/applicant-otp",
  );
  const otpBody = await otpReveal.json();
  expect(otpReveal.ok(), JSON.stringify(otpBody)).toBe(true);
  expect(otpBody.data.code).toMatch(/^\d{6}$/);

  const smsSnapshot = await page.request.get(
    "http://127.0.0.1:3100/api/test/hr-hiring-sms",
  );
  expect(smsSnapshot.ok()).toBe(true);
  expect(await smsSnapshot.json()).toMatchObject({
    success: true,
    data: {
      mode: "failure",
      messages: [{ phoneNumber: "09120000001" }],
    },
  });
});

test("latest pre-identity decisions and identity evidence modes persist through the authenticated API", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  const release = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-release-application/pre-identity/release",
  );
  expect(release.ok(), await release.text()).toBe(true);
  await page.goto("/dashboard/hr/hiring/hr-e2e-release-application");
  await expect(page.locator('[aria-current="step"]').first()).toHaveAttribute(
    "aria-label",
    /^مرحله 4: بررسی و احراز هویت/,
    { timeout: 30_000 },
  );

  const blockedRelease = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-blocked-application/pre-identity/release",
  );
  expect(blockedRelease.ok()).toBe(false);
  expect(await blockedRelease.json()).toMatchObject({
    success: false,
    error: "سه تصمیم مرحله پیش از احراز هویت باید در آخرین نسخه مثبت باشند.",
  });

  const originalSeen = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/documents",
    { form: { category: "OTHER", customTitle: "گواهی حرفه‌ای", inspectionSource: "ORIGINAL_SEEN", note: "اصل بررسی شد" } },
  );
  expect(originalSeen.status()).toBe(201);
  expect(await originalSeen.json()).toMatchObject({
    success: true,
    data: { customTitle: "گواهی حرفه‌ای", version: 1, storageName: null },
  });

  const replacement = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/documents",
    { form: { category: "OTHER", customTitle: "گواهی حرفه‌ای", inspectionSource: "ORIGINAL_SEEN" } },
  );
  expect(replacement.status()).toBe(201);
  expect(await replacement.json()).toMatchObject({
    success: true,
    data: { customTitle: "گواهی حرفه‌ای", version: 2, storageName: null },
  });

  const secondSeries = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/documents",
    { form: { category: "OTHER", customTitle: "مجوز تخصصی", inspectionSource: "ORIGINAL_SEEN" } },
  );
  expect(secondSeries.status()).toBe(201);
  expect(await secondSeries.json()).toMatchObject({
    success: true,
    data: { customTitle: "مجوز تخصصی", version: 1, storageName: null },
  });

  const missingCopy = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/documents",
    { form: { category: "NATIONAL_ID_FRONT", inspectionSource: "COPY_RECEIVED" } },
  );
  expect(missingCopy.ok()).toBe(false);
  expect(await missingCopy.json()).toMatchObject({
    success: false,
    error: "فایل کپی دریافت‌شده الزامی است.",
  });

  const receivedCopy = await page.request.post(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/documents",
    {
      multipart: {
        category: "NATIONAL_ID_FRONT",
        inspectionSource: "COPY_RECEIVED",
        file: {
          name: "national-id.png",
          mimeType: "image/png",
          buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
        },
      },
    },
  );
  expect(receivedCopy.status()).toBe(201);
  expect(await receivedCopy.json()).toMatchObject({
    success: true,
    data: { category: "NATIONAL_ID_FRONT", version: 1, originalName: "national-id.png" },
  });
});

test("HR sends one correction request and Candidate reuses the existing OTP", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.request.put("http://127.0.0.1:3100/api/test/hr-hiring-sms", {
    data: { mode: "success", reset: true },
  });
  await page.goto("/dashboard/hr/hiring/hr-e2e-application?phase=IDENTITY");
  await page.getByRole("button", { name: "بازگشت برای اصلاح" }).click();
  const explanations = page.getByPlaceholder("توضیح مشکل و روش اصلاح");
  await explanations.nth(0).fill("کد ملی با کارت ملی یکسان نیست.");
  await explanations.nth(1).fill("کد پستی را با مدرک نشانی بررسی کنید.");
  await page
    .getByRole("button", { name: "ارسال درخواست اصلاح به متقاضی" })
    .click();
  await expect(page.getByText("درخواست اصلاح برای متقاضی ارسال شد.")).toBeVisible();

  const snapshot = await page.request.get(
    "http://127.0.0.1:3100/api/test/hr-hiring-sms",
  );
  const snapshotBody = await snapshot.json();
  const otpReveal = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/applicant-otp",
  );
  const otpBody = await otpReveal.json();
  expect(otpReveal.ok(), JSON.stringify(otpBody)).toBe(true);
  expect(snapshotBody.data.messages).toHaveLength(1);
  expect(snapshotBody.data.messages[0]).toMatchObject({
    kind: "correction",
    phoneNumber: "09120000001",
    code: otpBody.data.code,
  });

  const candidateContext = await browser.newContext({
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  });
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto("http://127.0.0.1:3100/apply");
  await candidatePage.getByLabel("شماره همراه").fill("09120000001");
  await candidatePage.getByLabel("کد ورود شش‌رقمی").fill("123456");
  await candidatePage.getByRole("button", { name: "تأیید و ورود" }).click();
  for (const [sectionTitle, fieldLabels] of [
    ["سوابق کار حرفه‌ای", ["نام سازمان/شرکت", "مدت همکاری", "آخرین سمت", "آخرین حقوق و مزایا (ریال)"]],
    ["مهارت‌های فنی، حرفه‌ای و عمومی", ["نام مهارت", "مدت آشنایی", "سطح تسلط"]],
    ["زبان‌های خارجی", ["نام زبان", "سطح خواندن/نوشتن", "سطح مکالمه"]],
  ] as const) {
    const section = candidatePage.locator("section").filter({
      has: candidatePage.getByRole("heading", { name: sectionTitle, exact: true }),
    });
    for (const fieldLabel of fieldLabels) {
      await expect(section.getByLabel(fieldLabel, { exact: true })).toBeVisible();
    }
  }
  await expect(candidatePage.getByText("کد ملی — کد ملی با کارت ملی یکسان نیست.", { exact: true })).toBeVisible();
  await expect(candidatePage.getByLabel(/کد پستی — کد پستی را با مدرک نشانی بررسی کنید/)).toBeVisible();
  const nationalCodeInput = candidatePage.getByLabel(/کد ملی — کد ملی با کارت ملی یکسان نیست/);
  await expect(nationalCodeInput).toHaveAttribute("maxlength", "10");
  await nationalCodeInput.fill("۱۲۳۴۵۶۷۸۹");
  await expect(nationalCodeInput).toHaveValue("123456789");
  await expect(candidatePage.getByText("کد ملی باید دقیقاً ۱۰ رقم باشد.", { exact: true })).toBeVisible();
  await nationalCodeInput.fill("۲۲۹۴۵۶۷۸۹۰");
  await expect(nationalCodeInput).toHaveValue("2294567890");
  await candidatePage
    .getByLabel(/کد پستی — کد پستی را با مدرک نشانی بررسی کنید/)
    .fill("1234567890");
  await candidatePage
    .getByLabel("صحت نسخه اصلاح‌شده را تأیید می‌کنم.")
    .check();
  await candidatePage.getByRole("button", { name: "ذخیره و ارسال اصلاحات" }).click();
  await expect(candidatePage.getByText("نسخه اصلاح‌شده ارسال شد.")).toBeVisible();
  await expect(candidatePage.getByText("کد ملی معتبر نیست.", { exact: true })).toHaveCount(0);
  await candidateContext.close();
});

test("Offer notification includes the applicant's existing OTP for /apply", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.request.put("http://127.0.0.1:3100/api/test/hr-hiring-sms", {
    data: { mode: "success", reset: true },
  });
  const retry = await page.request.post("/api/hr-hiring/applications/hr-e2e-application/compensation/hr-e2e-compensation-snapshot/notification/retry");
  expect(retry.ok()).toBeTruthy();

  const smsSnapshot = await page.request.get(
    "http://127.0.0.1:3100/api/test/hr-hiring-sms",
  );
  const otpReveal = await page.request.get(
    "http://127.0.0.1:3100/api/hr-hiring/applications/hr-e2e-application/applicant-otp",
  );
  const otpBody = await otpReveal.json();
  expect(otpReveal.ok(), JSON.stringify(otpBody)).toBe(true);
  expect(await smsSnapshot.json()).toMatchObject({
    success: true,
    data: {
      messages: [
        {
          kind: "offer",
          phoneNumber: "09120000001",
          code: otpBody.data.code,
        },
      ],
    },
  });
});

test("localized assessment scores reject invalid values and accept 0 through 100", async ({
  page,
}) => {
  await page.goto("/apply");
  await page.getByLabel("شماره همراه").fill("09120000001");
  await page.getByLabel("کد ورود شش‌رقمی").fill("123456");
  await page.getByRole("button", { name: "تأیید و ورود" }).click();
  const scores = page.locator('input[inputmode="decimal"]');
  await scores.nth(0).fill("۱۰۱");
  await expect(page.getByText("امتیاز باید بین ۰ تا ۱۰۰ باشد.")).toBeVisible();
  await expect(page.getByRole("button", { name: "ثبت نهایی نتیجه" })).toBeDisabled();

  await scores.nth(0).fill("۰");
  await scores.nth(1).fill("٢٥٫٥");
  await scores.nth(2).fill("50.25");
  await scores.nth(3).fill("۱۰۰");
  await page.getByRole("button", { name: "ثبت نهایی نتیجه" }).click();
  await expect(page.getByText("نتیجه ارزیابی ثبت شد.")).toBeVisible();
});

test("Candidate accepts the latest offer with fresh dedicated evidence", async ({
  page,
}) => {
  await page.goto("/apply");
  await page.getByLabel("شماره همراه").fill("09120000001");
  await page.getByLabel("کد ورود شش‌رقمی").fill("123456");
  await page.getByRole("button", { name: "تأیید و ورود" }).click();

  await page.getByLabel("تصمیم درباره پیشنهاد همکاری").selectOption("ACCEPTED");
  await page
    .getByLabel("پیشنهاد همکاری را مطالعه کرده‌ام و می‌پذیرم.")
    .check();
  await page.getByRole("button", { name: "پذیرش پیشنهاد" }).click();
  await expect(
    page.getByText("پذیرش پیشنهاد همکاری با موفقیت ثبت شد."),
  ).toBeVisible();
});

test("Accounting-only Finance users record and independently verify collateral through duties", async ({ browser }) => {
  const login = async (email: string) => {
    const context = await browser.newContext({ locale: "fa-IR", timezoneId: "Asia/Tehran" });
    const page = await context.newPage();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(email);
    await page.locator('input[name="password"]').fill("HrE2ePass123!");
    await page.locator("form").getByRole("button", { name: "ورود" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    return { context, page };
  };

  const recorder = await login("finance.recorder.e2e@sabalanerp.test");
  expect((await recorder.page.request.get("/api/hr-hiring/applications/hr-e2e-application")).status()).toBe(403);
  await recorder.page.goto("/dashboard/accounting/duties");
  await recorder.page.getByRole("button", { name: "قابل دریافت" }).click();
  await expect(recorder.page.getByText("ثبت دریافت وثیقه استخدام")).toBeVisible();
  await recorder.page.getByRole("button", { name: "دریافت وظیفه" }).click();
  await recorder.page.getByRole("link", { name: "مشاهده وظیفه" }).click();
  await recorder.page.getByLabel("شناسه یا سریال").fill("PN-E2E-1");
  await recorder.page.getByLabel("صادرکننده یا ضامن").fill("ضامن آزمایشی");
  await recorder.page.getByLabel("محل نگهداری اصل").fill("گاوصندوق آزمایشی");
  await recorder.page.getByLabel("تاریخ دریافت").click();
  await recorder.page.getByRole("button", { name: "امروز" }).click();
  await recorder.page.getByLabel("اسکن مدرک دریافت").setInputFiles({
    name: "promissory-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await recorder.page.getByRole("button", { name: "ثبت دریافت و ارسال برای تأیید" }).click();
  await expect(recorder.page.getByText("بسته", { exact: true })).toBeVisible();
  await recorder.context.close();

  const manager = await login("finance.manager.e2e@sabalanerp.test");
  expect((await manager.page.request.get("/api/hr-hiring/applications/hr-e2e-application")).status()).toBe(403);
  await manager.page.goto("/dashboard/accounting/duties");
  await expect(manager.page.getByText("تأیید دریافت وثیقه استخدام")).toBeVisible();
  await manager.page.getByRole("link", { name: "مشاهده وظیفه" }).click();
  await expect(manager.page.getByText("PN-E2E-1")).toBeVisible();
  const download = manager.page.waitForEvent("download");
  await manager.page.getByRole("button", { name: "دریافت فایل مدرک" }).click();
  await download;
  await manager.page.getByLabel("تصمیم").selectOption("APPROVE");
  await manager.page.getByRole("button", { name: "ارسال تصمیم" }).click();
  await expect(manager.page.getByText("بسته", { exact: true })).toBeVisible();
  await manager.context.close();
});

test("Candidate portal and HR hiring remain readable in both remembered themes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("hrApplicantTheme", "light");
  });
  await page.goto("/apply");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectReadable(page.getByRole("heading", { name: "فرم استخدام سبلان" }));
  await expectReadable(page.getByLabel("شماره همراه"));

  await page.getByRole("button", { name: "فعال‌کردن حالت تیره" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectReadable(page.getByRole("heading", { name: "فرم استخدام سبلان" }));
  await expectReadable(page.getByLabel("شماره همراه"));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hrApplicantTheme")))
    .toBe("dark");

  await page.goto("/login");
  await page
    .locator('input[name="identifier"]')
    .fill("hr.processor.e2e@sabalanerp.test");
  await page.locator('input[name="password"]').fill("HrE2ePass123!");
  await page.locator("form").getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.goto("/dashboard/hr/hiring");
  await expectReadable(page.getByRole("link", { name: "متقاضی آزمایشی" }));
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /\b(?:HR_MANAGER|HR_PROCESSOR|APPROVED|NOT_STARTED|CANDIDATE)\b/,
  );
});
