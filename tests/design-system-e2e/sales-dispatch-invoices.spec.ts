import { expect, test, type Page, type Route } from "@playwright/test";
import {
  loginAsAdmin,
  setViewportAndZoom,
  assertNoHorizontalOverflow,
} from "./support/design-system";
test('operational PDFs stay disabled before financial approval', async ({page}) => {
  await loginAsAdmin(page);
  const caseId='qa-operational-print-gate';
  await page.route(`**/api/accounting/contracts/partner/${caseId}/internal`,route=>reply(route,{
    id:'qa-preparation',preparationOnly:true,status:'DRAFT',caseState:'DRAFT',amount:'1600',currency:'IRT',receivedAmount:'0',remainingAmount:'1600',systemInvoiceNumber:null,
    actions:{canCreateInvoice:false,canResolveFlag:false,canFlag:false,canRequestCorrection:false,canReviewInvoice:false,canCreateReceivable:false},
    partnerContext:{caseId,caseNumber:'QA-1',customerContractNumber:'1024',internalRecordNumber:'PI-1024',debtor:{displayName:'همکار نمونه'},endCustomer:{displayName:'مشتری نمونه'}},
    items:[],receivables:[],flags:[],taxRecords:[]
  }));
  await page.route(`**/api/accounting/contracts/partner/${caseId}/lifecycle`,route=>reply(route,{contract:{status:'DRAFT',isInactive:false},permissions:{canDeactivate:false,canReactivate:false,canDelete:false},deleteEligibility:{blockers:[]},deactivationEligibility:{blockers:[]},pendingRequests:[]}));
  await page.goto(`/dashboard/accounting/contracts/partner/${caseId}`);
  const variant=page.getByRole('combobox',{name:'نسخه چاپ'});
  for(const value of ['production','workshop']) {
    await variant.selectOption(value);
    await expect(page.getByRole('button',{name:'دانلود PDF',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'چاپ',exact:true})).toBeDisabled();
    await expect(page.getByText('این خروجی به رکورد مالی تأییدشده و معتبر نیاز دارد.',{exact:true})).toBeVisible();
  }
  await variant.selectOption('accounting');
  await expect(page.getByRole('button',{name:'دانلود PDF',exact:true})).toBeEnabled();
});
const reply = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
const candidateList = /\/api\/accounting\/dispatch-candidates(?:\?.*)?$/;

for (const denial of ["command", "refresh"] as const) {
  test(`dispatch closes private void information when access is denied during the ${denial}`, async ({ page }) => {
    await loginAsAdmin(page);
    let groupReads = 0;
    await page.route(candidateList, route => {
      if (new URL(route.request().url()).searchParams.has("loadingId")) {
        groupReads++;
        return route.fulfill({ status: 403, json: { success: false, error: "محتوای خصوصی ۹۱۷۲۱۳" } });
      }
      return route.fulfill({ json: { success: true, capabilities: {
        canManageAccountingCandidates: true, canManageAccountingConfirmation: false,
      }, data: [{
        id: "private-candidate", loadingId: "private-loading", status: "ACCEPTED", canManage: true,
        summary: { driverName: "راننده خصوصی آزمون", loadingNumber: "91" },
        currentSalesInvoice: { id: "private-invoice", number: "917213" },
        waybills: [{ id: "private-waybill", number: "42", status: "ISSUED", hasWaybillArtifact: true }],
      }] } });
    });
    await page.route("**/api/accounting/dispatch-waybills/private-waybill/void", route =>
      route.fulfill({ status: denial === "command" ? 403 : 409, json: { success: false, error: "محتوای خصوصی ۹۱۷۲۱۳" } }));
    await page.goto("/dashboard/accounting/dispatch");
    const row = page.getByRole("row").filter({ hasText: "راننده خصوصی آزمون" });
    await row.getByRole("button", { name: "ابطال بارنامه و فاکتور فروش", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "ابطال بارنامه و فاکتور فروش", exact: true });
    await expect(dialog).toContainText("917213");
    await dialog.getByRole("textbox", { name: "دلیل تصمیم" }).fill("دلیل خصوصی آزمون");
    await dialog.getByRole("button", { name: "تأیید و ثبت" }).click();
    await expect(page.getByText("دسترسی به اطلاعات ارسال مجاز نیست.", { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(page.getByText(/917213|۹۱۷۲۱۳|دلیل خصوصی آزمون/)).toHaveCount(0);
    expect(groupReads).toBe(denial === "command" ? 0 : 1);
  });
}

test("dispatch preserves the permitted confirmation when the candidate group is denied", async ({ page }) => {
  await loginAsAdmin(page);
  await page.route(candidateList, route => {
    if (new URL(route.request().url()).searchParams.has("loadingId")) {
      return route.fulfill({ status: 403, json: { success: false } });
    }
    return route.fulfill({ json: { success: true, capabilities: {
      canManageAccountingCandidates: false, canManageAccountingConfirmation: true,
    }, data: [{
      id: "confirmation-candidate", loadingId: "confirmation-loading", status: "ACCEPTED", canManage: false,
      summary: { driverName: "راننده مجاز آزمون", loadingNumber: "29", driverSource: "CUSTOMER_PICKUP" },
      waybills: [{ id: "confirmation-waybill", number: "43", status: "ISSUED", hasWaybillArtifact: true }],
    }] } });
  });
  await page.route("**/api/dispatch-confirmation/waybills/confirmation-waybill/sessions", route => reply(route, {
    id: "confirmation-session", waybillId: "confirmation-waybill", method: "PERSONAL_PICKUP_ACCOUNTING",
    status: "CONFIRMED", authorization: { id: "confirmation-authorization" },
  }));
  await page.goto("/dashboard/accounting/dispatch");
  await page.getByRole("row").filter({ hasText: "راننده مجاز آزمون" })
    .getByRole("button", { name: "صدور مجوز خروج", exact: true }).click();
  await expect(page.getByText("مجوز خروج صادر شد.", { exact: true })).toBeVisible();
  await expect(page.getByText("مجوز خروج برای گارد صادر شده است.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "لغو مجوز خروج", exact: true })).toBeEnabled();
  await expect(page.getByText("راننده مجاز آزمون", { exact: true })).toHaveCount(0);
});

const replyWithIssueReceipt = (route: Route, invoice: { id: string; number: string }) =>
  reply(route, { status: "ISSUED", commandId: route.request().postDataJSON().commandId, invoice });

test("Accounting reissues a paired cancellation on the same loading", async ({ page }) => {
  await loginAsAdmin(page);
  await setViewportAndZoom(page, { width: 390, height: 900 });
  const loadingId = "qa-recover-loading-12";
  const recovery = { waybillId: "waybill-11", waybillNumber: "11", invoiceId: "invoice-9", invoiceNumber: "9" };
  let requests = 0;
  await page.route(candidateList, route => reply(route, [{
    id: "recovery-candidate", loadingId, status: "ACCEPTED", canManage: true,
    summary: { loadingNumber: "12", driverName: "راننده آزمون" },
    waybills: [
      { id: "waybill-8", number: "8", status: "VOIDED" },
      { id: "waybill-11", number: "11", status: "VOIDED" },
      ...(requests ? [{ id: "waybill-12", number: "12", status: "ISSUED", legacyReconstruction: { id: "pdf-12" } }] : []),
    ],
  }]));
  await page.route("**/api/dispatch-confirmation/capabilities", route => reply(route, {
    canManageAccountingCandidates: true, canManageAccountingConfirmation: false,
  }));
  await page.route(`**/api/accounting/loadings/${loadingId}/sales-invoices`, route => reply(route, {
    ready: Boolean(requests), documentsComplete: Boolean(requests), recovery: requests ? null : recovery,
    invoices: [
      ...(requests ? [{ id: "invoice-12", number: "12", status: "ISSUED" }] : []),
      { id: "invoice-9", number: "9", status: "VOIDED", voidReason: "ابطال ثبت‌شده" },
    ],
  }));
  await page.route(`**/api/accounting/loadings/${loadingId}/issue-dispatch-documents`, async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      recovery: { waybillId: "waybill-11", invoiceId: "invoice-9", reason: "صدور مجدد برای همان بارگیری" },
    });
    requests++;
    await replyWithIssueReceipt(route, { id: "invoice-12", number: "12" });
  });
  await page.goto("/dashboard/accounting/dispatch");
  await page.getByRole("table").getByRole("button", { name: "جزئیات اقلام و اسناد بارگیری" }).click();
  const details = page.getByRole("dialog", { name: "جزئیات اقلام و اسناد بارگیری" });
  const recover = details.getByRole("button", { name: "صدور مجدد بارنامه و فاکتور", exact: true });
  await recover.click();
  const confirm = details.getByRole("button", { name: "تأیید و صدور مجدد" });
  await expect(confirm).toBeDisabled();
  await details.getByRole("button", { name: "انصراف", exact: true }).click();
  expect(requests).toBe(0);
  await recover.click();
  await details.getByRole("textbox", { name: "دلیل صدور مجدد" }).fill("صدور مجدد برای همان بارگیری");
  await assertNoHorizontalOverflow(page);
  await confirm.click();
  await expect(details.getByText("فاکتور ۱۲ · صادرشده", { exact: true })).toBeVisible();
  await expect(details.getByText("فاکتور ۹ · باطل‌شده", { exact: true })).toBeVisible();
  await expect(recover).toHaveCount(0);
  expect(requests).toBe(1);
});

test("Accounting repairs an invalid invoice while its replacement waybill remains active", async ({ page }) => {
  await loginAsAdmin(page);
  const loadingId = "qa-repair-loading-13";
  const oldInvoice = { id: "invoice-10", number: "10" };
  let status = "INVALIDATED";
  let replacementIssued = false;
  await page.route(candidateList, route => reply(route, [{
    id: "repair-candidate", loadingId, status: "ACCEPTED", canManage: true,
    summary: { loadingNumber: "13", driverName: "راننده آزمون" },
    currentSalesInvoice: status === "INVALIDATED" ? oldInvoice : null,
    waybills: [{ id: "active-waybill", number: "21", status: "ISSUED", legacyReconstruction: { id: "waybill-pdf" } }],
  }]));
  await page.route("**/api/dispatch-confirmation/capabilities", route => reply(route, {
    canManageAccountingCandidates: true, canManageAccountingConfirmation: false,
  }));
  await page.route(`**/api/accounting/loadings/${loadingId}/sales-invoices`, route => reply(route, {
    ready: true, documentsComplete: true, invoices: [
      ...(replacementIssued ? [{ id: "invoice-replacement", number: "22", status: "ISSUED" }] : []),
      { ...oldInvoice, status, voidReason: status === "VOIDED" ? "تغییر شماره بارنامه" : null },
    ],
  }));
  await page.route(`**/api/accounting/loadings/${loadingId}/sales-invoices/${oldInvoice.id}/void`, route => {
    expect(route.request().postDataJSON()).toEqual({ reason: "تغییر شماره بارنامه", onlyIfInvalidated: true });
    status = "VOIDED";
    return reply(route, oldInvoice);
  });
  await page.route(`**/api/accounting/loadings/${loadingId}/issue-dispatch-documents`, route => {
    expect(status).toBe("VOIDED");
    replacementIssued = true;
    return replyWithIssueReceipt(route, { id: "invoice-replacement", number: "22" });
  });
  await page.goto("/dashboard/accounting/dispatch");
  const row = page.getByRole("table").getByRole("row", { name: /راننده آزمون/ });
  await row.getByRole("button", { name: "جزئیات اقلام و اسناد بارگیری" }).click();
  const details = page.getByRole("dialog", { name: "جزئیات اقلام و اسناد بارگیری" });
  await details.getByRole("button", { name: "ابطال فاکتور نامعتبر" }).click();
  const confirm = details.getByRole("button", { name: "ثبت ابطال فاکتور فروش" });
  await expect(confirm).toBeDisabled();
  await details.getByRole("textbox", { name: "دلیل ابطال" }).fill("تغییر شماره بارنامه");
  await confirm.click();
  await expect(details.getByText("فاکتور ۱۰ · باطل‌شده", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "صدور فاکتور جایگزین" }).click();
  await expect(details.getByText("فاکتور ۲۲ · صادرشده", { exact: true })).toBeVisible();
  await expect(row.getByText("۲۱", { exact: true })).toBeVisible();
});

const expectInvoicePreview = async (page: Page, workspace: "accounting" | "logistics", loadingId: string) => {
  await page.route(`**/api/${workspace}/loadings/${loadingId}/sales-invoices/invoice-1/pdf?*`, async route => {
    expect(new URL(route.request().url()).searchParams.get("download")).toBe("false");
    // The click must already have opened the window before the PDF is delivered.
    await expect.poll(() => page.context().pages().length).toBe(2);
    await route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4" });
  });
  const [preview] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "مشاهده فاکتور", exact: true }).click(),
  ]);
  await preview.waitForURL(/^blob:/);
  await preview.close();
};

for (const width of [1280, 390]) {
  test(`sales dispatch invoice Accounting issuance and void history at ${width}px`, async ({
    page,
  }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    const loadingId = "qa-sales-invoice-loading";
    const blockedReason = "تأیید همه راننده‌ها هنوز کامل نشده است.";
    let ready = false,
      issued = 0,
      voided = 0,
      voidAttempts = 0;
    const invoices: any[] = [];
    const replacementInvoice = width === 1280 ? { id: "invoice-2", number: "2" } : null;
    let currentInvoice: { id: string; number: string } | null = null;
    let initialVoidKey: string;

    await page.route(candidateList, (route) =>
      reply(
        route,
        [0, 1].map((i) => ({
          id: `candidate-${i}`,
          loadingId,
          status: "ACCEPTED",
          canManage: true,
          summary: {
            driverName: i === 0 ? "راننده امید" : "راننده نوید",
            loadingNumber: "27",
            plate: "۱۲ ب ۳۴۵",
          },
          currentSalesInvoice: currentInvoice,
          waybills: issued && i === 0 ? [{
            id: "waybill-1", number: "42", status: voided ? "VOIDED" : "ISSUED", legacyReconstruction: { id: "reconstruction-1" },
          }] : [],
        })),
      ),
    );
    await page.route("**/api/dispatch-confirmation/capabilities", (route) =>
      reply(route, {
        canManageAccountingCandidates: true,
        canManageAccountingConfirmation: false,
      }),
    );
    await page.route(
      `**/api/accounting/loadings/${loadingId}/sales-invoices`,
      (route) => {
        expect(route.request().method()).toBe("GET");
        return reply(route, {
          ready,
          blockedReason: ready ? null : blockedReason,
          documentsComplete: issued > 0,
          invoices,
        });
      },
    );
    await page.route(
      `**/api/accounting/loadings/${loadingId}/issue-dispatch-documents`,
      async (route) => {
        expect(route.request().method()).toBe("POST");
        if (!ready) {
          await route.fulfill({ status: 409, json: { success: false, error: blockedReason } });
          return;
        }
        issued++;
        currentInvoice = { id: "invoice-1", number: "1" };
        invoices.push({
          id: "invoice-1",
          number: "1",
          status: "ISSUED",
          voidReason: null,
        });
        await replyWithIssueReceipt(route, currentInvoice);
      },
    );
    await page.route(
      "**/api/accounting/dispatch-waybills/waybill-1/void",
      async (route) => {
        const body = route.request().postDataJSON();
        expect(body.reason).toBe("اصلاح بارگیری");
        if (++voidAttempts === 1) {
          expect(body.expectedInvoiceId).toBe("invoice-1");
          initialVoidKey = body.idempotencyKey;
          currentInvoice = replacementInvoice;
          invoices[0].status = "VOIDED";
          invoices[0].voidReason = "ابطال توسط کاربر دیگر";
          if (replacementInvoice) invoices.push({ ...replacementInvoice, status: "ISSUED", voidReason: null });
          return route.fulfill({ status: 409, json: { success: false, error: "وضعیت فاکتور تغییر کرده است." } });
        }
        expect(body.expectedInvoiceId).toBe(replacementInvoice?.id ?? null);
        expect(body.idempotencyKey).not.toBe(initialVoidKey);
        if (replacementInvoice) {
          invoices[1].status = "VOIDED";
          invoices[1].voidReason = "اصلاح بارگیری";
        }
        currentInvoice = null;
        voided++;
        await reply(route, { id: "waybill-1" });
      },
    );
    await page.goto("/dashboard/accounting/dispatch");
    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(3);
    const status = table.getByText("پذیرفته‌شده", { exact: true }).first();
    await expect(status).toBeVisible();
    expect(await status.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    })).toBe(1);
    await expect(table.getByRole("button", { name: /ابطال.*فاکتور فروش/ })).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "جست‌وجو در ردیف‌ها", exact: true });
    await search.fill("راننده نوید");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByText("راننده نوید", { exact: true })).toBeVisible();
    await search.fill("۲۷");
    await expect(table.getByRole("row")).toHaveCount(3);
    await assertNoHorizontalOverflow(page);
    await table.getByRole("button", { name: "جزئیات اقلام و اسناد بارگیری" }).first().click();
    const details = page.getByRole("dialog", { name: "جزئیات اقلام و اسناد بارگیری" });
    await expect(details).toBeVisible();
    await expect(async () => {
      const bounds = (await details.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(3);
      expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(3);
    }).toPass({ timeout: 5000 });
    await expect(
      page.getByText("فاکتور فروش کل بارگیری", { exact: true }),
    ).toHaveCount(1);
    const issue = page.getByRole("button", {
      name: "صدور بارنامه‌ها و فاکتور فروش",
      exact: true,
    });
    const blockedIssuance = page.waitForResponse((response) =>
      response.url().endsWith(`/loadings/${loadingId}/issue-dispatch-documents`) && response.status() === 409,
    );
    await issue.click();
    await blockedIssuance;
    await expect(page.getByText("فاکتور فروش صادر نشده است.")).toBeVisible();
    ready = true;
    await page
      .getByRole("button", { name: "به‌روزرسانی فاکتورها", exact: true })
      .click();
    await expect(issue).toBeEnabled();
    await issue.click();
    await expect(
      page.getByText("فاکتور ۱ · صادرشده", { exact: true }),
    ).toBeVisible();
    await expectInvoicePreview(page, "accounting", loadingId);
    await expect(issue).toHaveCount(0);
    await expect(page.getByRole("button", { name: "تکمیل صدور بارنامه‌ها" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "چاپ فاکتور و بارنامه‌ها" })).toBeDisabled();
    await expect(details.getByRole("button", { name: "ابطال فاکتور فروش", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "بستن", exact: true }).click();
    await expect(details).toBeHidden();
    const voidDocuments = table.getByRole("button", { name: "ابطال بارنامه و فاکتور فروش", exact: true });
    await expect(voidDocuments).toHaveCount(1);
    await voidDocuments.click();
    const dialog = page.getByRole("dialog", { name: "ابطال بارنامه و فاکتور فروش" });
    await expect(dialog).toContainText("فاکتور فروش شماره");
    await expect(dialog).toContainText("تا صدور فاکتور معتبر");
    await dialog.getByRole("textbox", { name: "دلیل تصمیم" }).fill("ا");
    await expect(dialog.getByRole("button", { name: "تأیید و ثبت" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "دلیل تصمیم" }).fill("اصلاح بارگیری");
    await dialog.getByRole("button", { name: "تأیید و ثبت" }).click();
    const refreshedDialog = page.getByRole("dialog", {
      name: replacementInvoice ? "ابطال بارنامه و فاکتور فروش" : "ابطال بارنامه",
      exact: true,
    });
    await expect(refreshedDialog.getByText(replacementInvoice ? /شمارهٔ سندها را بررسی/ : /فاکتور فروش فعال ندارد/)).toBeVisible();
    await expect(refreshedDialog.getByRole("textbox", { name: "دلیل تصمیم" })).toHaveValue("اصلاح بارگیری");
    if (replacementInvoice) await expect(refreshedDialog).toContainText(/فاکتور فروش شماره 2/);
    expect(voidAttempts).toBe(1);
    expect(voided).toBe(0);
    await refreshedDialog.getByRole("button", { name: "تأیید دوباره و ثبت" }).click();
    await expect(refreshedDialog).toBeHidden();
    await expect(page.getByText(replacementInvoice
      ? "بارنامه و فاکتور فروش با حفظ سابقه باطل شدند."
      : "بارنامه با حفظ سابقه باطل شد.")).toBeVisible();
    await expect(table.getByRole("button", { name: /ابطال.*فاکتور فروش/ })).toHaveCount(0);
    await table.getByRole("button", { name: "جزئیات اقلام و اسناد بارگیری" }).first().click();
    await expect(
      page.getByText("فاکتور ۱ · باطل‌شده", { exact: true }),
    ).toBeVisible();
    expect(issued).toBe(1);
    expect(voided).toBe(1);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: info.outputPath(`invoice-accounting-${width}.png`),
      fullPage: true,
    });
  });
  test(`sales dispatch invoice Logistics is read-only at ${width}px`, async ({
    page,
  }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    const loadingId = "qa-invoice-readonly";
    await page.route(`**/api/logistics/loadings/${loadingId}`, (route) =>
      reply(route, {
        id: loadingId,
        status: "FINALIZED",
        loadingNumber: "27",
        loadingDate: "2026-10-27",
        customer: { firstName: "مشتری", lastName: "آزمایشی" },
        project: { projectName: "آفتاب" },
        lines: [],
        driverAssignments: [],
      }),
    );
    await page.route(
      `**/api/logistics/loadings/${loadingId}/sales-invoices`,
      (route) =>
        reply(route, {
          ready: true,
          blockedReason: null,
          invoices: [
            {
              id: "invoice-1",
              number: "1",
              status: "ISSUED",
              voidReason: null,
            },
          ],
        }),
    );
    await page.goto(`/dashboard/logistics/loadings/${loadingId}`);
    await expect(
      page.getByText("فاکتور ۱ · صادرشده", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "دانلود فاکتور", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "مشاهده فاکتور", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "صدور فاکتور فروش", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "ابطال فاکتور", exact: true }),
    ).toHaveCount(0);
    await expectInvoicePreview(page, "logistics", loadingId);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: info.outputPath(`invoice-logistics-${width}.png`),
      fullPage: true,
    });
  });
}

test("Accounting verifies a customer pickup before issuing its waybill and sales invoice", async ({ page }) => {
  await loginAsAdmin(page);
  await setViewportAndZoom(page, { width: 390, height: 900 });
  const loadingId = "qa-pickup-loading";
  const candidateId = "qa-pickup-candidate";
  let sent = false;
  let verified = false;
  let issued = false;
  await page.route(candidateList, route => reply(route, [{
    id: candidateId, loadingId, status: issued ? "ACCEPTED" : "PENDING", canManage: true,
    summary: { loadingNumber: "14", driverName: "راننده متفرقه", driverSource: "CUSTOMER_PICKUP", plate: "۱۲ ب ۳۴۵ ایران ۶۷" },
    pickupVerification: verified ? { verifiedAt: new Date().toISOString() } : null,
    waybills: issued ? [{ id: "pickup-waybill", number: "21", status: "ISSUED", legacyReconstruction: { id: "pickup-pdf" } }] : [],
  }]));
  await page.route("**/api/dispatch-confirmation/capabilities", route => reply(route, {
    canManageAccountingCandidates: true, canManageAccountingConfirmation: true,
  }));
  await page.route(`**/api/accounting/dispatch-candidates/${candidateId}/pickup-verification/send`, route => {
    expect(route.request().postDataJSON()).toEqual({});
    sent = true;
    return reply(route, { verified: false });
  });
  await page.route(`**/api/accounting/dispatch-candidates/${candidateId}/pickup-verification/verify`, route => {
    expect(sent).toBe(true);
    expect(route.request().postDataJSON()).toEqual({ code: "123456" });
    verified = true;
    return reply(route, { verified: true });
  });
  await page.route(`**/api/accounting/loadings/${loadingId}/sales-invoices`, route => reply(route, {
    ready: issued, documentsComplete: issued, invoices: issued ? [{ id: "pickup-invoice", number: "22", status: "ISSUED" }] : [],
  }));
  await page.route(`**/api/accounting/loadings/${loadingId}/issue-dispatch-documents`, route => {
    expect(verified).toBe(true);
    issued = true;
    return replyWithIssueReceipt(route, { id: "pickup-invoice", number: "22" });
  });
  await page.goto("/dashboard/accounting/dispatch");
  await page.getByRole("table").getByRole("button", { name: "جزئیات اقلام و اسناد بارگیری" }).click();
  const details = page.getByRole("dialog", { name: "جزئیات اقلام و اسناد بارگیری" });
  const issue = details.getByRole("button", { name: "صدور بارنامه‌ها و فاکتور فروش" });
  await expect(issue).toBeDisabled();
  await details.getByRole("button", { name: "ارسال کد پیامکی" }).click();
  await expect(details.getByText("کد به شماره همراه ثبت‌شده در پذیرش ارسال شد.")).toBeVisible();
  await details.getByRole("textbox", { name: "کد پیامکی راننده متفرقه" }).fill("۱۲۳۴۵۶");
  await details.getByRole("button", { name: "تأیید کد", exact: true }).click();
  await expect(details.getByText("شماره همراه تأیید شده است")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await expect(issue).toBeEnabled();
  await issue.click();
  await expect(details.getByText("فاکتور ۲۲ · صادرشده", { exact: true })).toBeVisible();
});

test("Accounting shows the OTP controls after the biometric fallback starts", async ({ page }) => {
  await loginAsAdmin(page);
  const waybillId = "qa-fallback-waybill";
  const sessionId = "qa-fallback-session";
  await page.route(candidateList, route => reply(route, [{
    id: "qa-fallback-candidate", loadingId: "qa-fallback-loading", status: "ACCEPTED", canManage: true,
    summary: { loadingNumber: "15", driverName: "راننده نمونه", driverSource: "INTERNAL" },
    waybills: [{ id: waybillId, number: "23", status: "ISSUED" }],
  }]));
  await page.route("**/api/dispatch-confirmation/capabilities", route => reply(route, {
    canManageAccountingCandidates: true, canManageAccountingConfirmation: true,
  }));
  await page.route(`**/api/dispatch-confirmation/waybills/${waybillId}/sessions`, route => reply(route, {
    id: sessionId, waybillId, driverSource: "INTERNAL", method: "INTERNAL_BIOMETRIC", status: "ACTIVE",
  }));
  await page.route(`**/api/dispatch-confirmation/sessions/${sessionId}/fallback`, route => reply(route, {
    sessionId, method: "INTERNAL_FALLBACK",
  }));
  await page.route(`**/api/dispatch-confirmation/sessions/${sessionId}/otp/verify`, route => {
    expect(route.request().postDataJSON()).toEqual({ code: "123456" });
    return reply(route, { verifiedAt: new Date().toISOString() });
  });
  await page.goto("/dashboard/accounting/dispatch");
  await page.getByRole("table").getByRole("button", { name: "تأیید هویت راننده" }).click();
  const fallback = page.getByRole("button", { name: "استفاده از روش جایگزین" });
  const code = page.getByRole("textbox", { name: "رمز یک‌بارمصرف راننده" });
  await expect(code).toHaveCount(0);
  await fallback.click();
  await expect(code).toBeVisible();
  await expect(fallback).toHaveCount(0);
  const verify = page.getByRole("button", { name: "تأیید رمز", exact: true });
  await expect(verify).toBeDisabled();
  await code.fill("۰۱۲۳");
  await expect(code).toHaveValue("0123");
  await expect(verify).toBeDisabled();
  await code.fill("۱۲٣۴۵۶");
  await expect(code).toHaveValue("123456");
  await expect(verify).toBeEnabled();
  await code.press("Enter");
  await expect(page.getByText("رمز راننده تأیید شد. تأیید نهایی را سرپرست گارد تکمیل می‌کند.", { exact: true })).toBeVisible();
});

test("Accounting shows how to recover from an unregistered biometric workstation", async ({ page }) => {
  await loginAsAdmin(page);
  const waybillId = "qa-workstation-waybill";
  const sessionId = "qa-workstation-session";
  await page.route(candidateList, route => reply(route, [{
    id: "qa-workstation-candidate", loadingId: "qa-workstation-loading", status: "ACCEPTED", canManage: true,
    summary: { loadingNumber: "15", driverName: "راننده نمونه", driverSource: "INTERNAL" },
    waybills: [{ id: waybillId, number: "23", status: "ISSUED" }],
  }]));
  await page.route("**/api/dispatch-confirmation/capabilities", route => reply(route, {
    canManageAccountingCandidates: true, canManageAccountingConfirmation: true,
  }));
  await page.route(`**/api/dispatch-confirmation/waybills/${waybillId}/sessions`, route => reply(route, {
    id: sessionId, waybillId, driverSource: "INTERNAL", method: "INTERNAL_BIOMETRIC", status: "ACTIVE",
  }));
  await page.route(`**/api/dispatch-confirmation/sessions/${sessionId}/biometric-command`, route => route.fulfill({
    status: 409,
    json: {
      success: false,
      code: "BIOMETRIC_WORKSTATION_NOT_REGISTERED",
      error: "این ایستگاه اثر انگشت ثبت نشده است. از پشتیبانی بخواهید همین ایستگاه را ثبت کند و سپس دوباره تلاش کنید.",
    },
  }));
  await page.route(`**/api/dispatch-confirmation/sessions/${sessionId}/fallback`, route => route.fulfill({
    status: 409,
    json: { success: false, error: "روش جایگزین فقط پس از خطای معتبر حسگر یا دو عدم تطبیق معتبر پیاپی در همین نوبت مجاز است." },
  }));
  await page.route("http://127.0.0.1:47631/v1/status", route => route.fulfill({
    headers: { "Access-Control-Allow-Origin": "*" },
    json: { workstationId: "UNREGISTERED-TEST" },
  }));
  const captures: string[] = [];
  await page.route("http://127.0.0.1:47631/v1/commands", route => {
    captures.push(route.request().url());
    return route.abort();
  });
  await page.goto("/dashboard/accounting/dispatch");
  await page.getByRole("table").getByRole("button", { name: "تأیید هویت راننده" }).click();

  const scan = page.getByRole("button", { name: "بررسی انگشت اشاره راست" });
  await scan.click();
  await expect(page.getByText("این ایستگاه اثر انگشت ثبت نشده است. از پشتیبانی بخواهید همین ایستگاه را ثبت کند و سپس دوباره تلاش کنید.", { exact: true })).toBeVisible();
  expect(captures).toEqual([]);
  await expect(scan).toBeEnabled();
  await page.getByRole("button", { name: "استفاده از روش جایگزین" }).click();
  await expect(page.getByText(/روش جایگزین فقط پس از خطای معتبر حسگر/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "رمز یک‌بارمصرف راننده" })).toHaveCount(0);
});
