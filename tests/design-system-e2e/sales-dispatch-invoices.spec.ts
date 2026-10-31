import { expect, test, type Route } from "@playwright/test";
import {
  loginAsAdmin,
  setViewportAndZoom,
  assertNoHorizontalOverflow,
} from "./support/design-system";
test.afterAll(async ({ browser }) => { await browser.close(); });
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
for (const width of [1280, 390]) {
  test(`sales dispatch invoice Accounting issuance and void history at ${width}px`, async ({
    page,
  }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    const loadingId = "qa-sales-invoice-loading";
    let ready = false,
      issued = 0,
      voided = 0;
    const invoices: any[] = [];
    await page.route("**/api/accounting/dispatch-candidates", (route) =>
      reply(
        route,
        [0, 1].map((i) => ({
          id: `candidate-${i}`,
          loadingId,
          status: "ACCEPTED",
          canManage: true,
          summary: {
            driverName: `راننده ${i}`,
            loadingNumber: "27",
            plate: "۱۲ ب ۳۴۵",
          },
          waybills: [],
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
      async (route) => {
        if (route.request().method() === "POST") {
          expect(route.request().postDataJSON().idempotencyKey).toBeTruthy();
          issued++;
          invoices.push({
            id: "invoice-1",
            number: "1",
            status: "ISSUED",
            voidReason: null,
          });
          await reply(route, { id: "invoice-1", number: "1" });
        } else
          await reply(route, {
            ready,
            blockedReason: ready
              ? null
              : "تأیید همه راننده‌ها هنوز کامل نشده است.",
            invoices,
          });
      },
    );
    await page.route(
      `**/api/accounting/loadings/${loadingId}/sales-invoices/invoice-1/void`,
      async (route) => {
        expect(route.request().postDataJSON().reason).toBe("اصلاح بارگیری");
        voided++;
        invoices[0].status = "VOIDED";
        invoices[0].voidReason = "اصلاح بارگیری";
        await reply(route, { id: "invoice-1" });
      },
    );
    await page.goto("/dashboard/accounting/dispatch");
    await expect(
      page.getByText("فاکتور فروش کل بارگیری", { exact: true }),
    ).toHaveCount(1);
    const issue = page.getByRole("button", {
      name: "صدور فاکتور فروش",
      exact: true,
    });
    await expect(issue).toBeDisabled();
    ready = true;
    await page
      .getByRole("button", { name: "به‌روزرسانی فاکتورها", exact: true })
      .click();
    await expect(issue).toBeEnabled();
    await issue.click();
    await expect(
      page.getByText("فاکتور ۱ · صادرشده", { exact: true }),
    ).toBeVisible();
    await expect(issue).toBeDisabled();
    await page
      .getByRole("button", { name: "ابطال فاکتور", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "ابطال فاکتور فروش",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "دلیل ابطال" })
      .fill("اصلاح بارگیری");
    await dialog
      .getByRole("button", { name: "ثبت ابطال با حفظ سابقه" })
      .click();
    await expect(dialog).toBeHidden();
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
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: info.outputPath(`invoice-logistics-${width}.png`),
      fullPage: true,
    });
  });
}
