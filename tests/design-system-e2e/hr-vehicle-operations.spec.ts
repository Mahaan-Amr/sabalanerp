import { expect, test } from "@playwright/test";
import {
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
  assertNoSeriousAxeViolations,
} from "./support/design-system";

for (const [width, theme] of [
  [1280, "light"],
  [390, "dark"],
] as const)
  test(
    "HR driver actions, future calendar and failed-save recovery at " + width,
    async ({ page }, testInfo) => {
      const cap = {
        canManageEligibility: true,
        canManageProfiles: true,
        canManageCompanyVehicles: true,
        canManagePlates: true,
        canManageAssignments: true,
      };
      const plate = {
        plate: "12 ب 345 ایران 63",
        effectiveFrom: "2026-01-01T00:00:00Z",
        effectiveTo: null,
      };
      const firstVehicle = {
        id: "v1",
        fleetCode: "خودروی اول",
        vehicleType: "سواری",
        status: "ACTIVE",
        plates: [plate],
        assignments: [],
      };
      const secondVehicle = {
        ...firstVehicle,
        id: "v2",
        fleetCode: "خودروی دوم",
        plates: [{ ...plate, plate: "22 ب 345 ایران 63" }],
      };
      const person = { id: "person", firstName: "ماهان", lastName: "امیریان" };
      let current: any = {
        id: "a1",
        driverId: "driver",
        vehicleId: firstVehicle.id,
        vehicle: firstVehicle,
        effectiveFrom: "2026-01-01T00:00:00Z",
        effectiveTo: null,
      };
      const driver = () => ({
        id: "driver",
        personnelId: person.id,
        personnel: person,
        status: "ACTIVE",
        currentEligibility: { status: "ELIGIBLE" },
        currentAssignment: current,
        licenceNumber: "123456789",
        licenceClass: "پایه یک",
        licenceExpiresAt: "2028-01-01T00:00:00Z",
        readiness: { status: "READY", blockers: [] },
      });
      let assignmentBody: any;
      let profileBody: any;
      let failProfile = true;
      await page.route(
        "**/api/dispatch-master-data/vehicle-operations/internal-drivers**",
        (route) =>
          route.fulfill({
            json: { success: true, data: [driver()], capabilities: cap },
          }),
      );
      await page.route(
        "**/api/dispatch-master-data/company-vehicles**",
        (route) =>
          route.fulfill({
            json: {
              success: true,
              data: [firstVehicle, secondVehicle],
              capabilities: cap,
            },
          }),
      );
      await page.route(
        "**/api/dispatch-master-data/driver-vehicle-assignments",
        async (route) => {
          if (route.request().method() === "POST") {
            assignmentBody = route.request().postDataJSON();
            current = {
              ...current,
              id: "a2",
              vehicleId: secondVehicle.id,
              vehicle: secondVehicle,
            };
            await route.fulfill({ json: { success: true, data: current } });
          } else
            await route.fulfill({
              json: {
                success: true,
                data: {
                  assignments: current
                    ? [{ ...current, driver: driver() }]
                    : [],
                  plans: [],
                },
              },
            });
        },
      );
      await page.route(
        "**/api/dispatch-master-data/driver-vehicle-assignments/preview",
        (route) =>
          route.fulfill({
            json: {
              success: true,
              data: {
                driver: driver(),
                vehicle: secondVehicle,
                current: [{ ...current, driver: driver() }],
                conflictingPlans: [],
              },
            },
          }),
      );
      await page.route(
        "**/api/dispatch-master-data/driver-vehicle-assignments/*/end",
        async (route) => {
          current = null;
          await route.fulfill({ json: { success: true } });
        },
      );
      await page.route(
        "**/api/dispatch-master-data/internal-drivers/driver/profile",
        async (route) => {
          profileBody = route.request().postDataJSON();
          await route.fulfill({
            status: failProfile ? 409 : 200,
            json: failProfile
              ? {
                  success: false,
                  error:
                    "شماره گواهینامه قبلاً ثبت شده است. رکورد موجود را بررسی کنید.",
                }
              : { success: true, data: driver() },
          });
        },
      );
      await page.route(
        "**/api/dispatch-master-data/internal-drivers/personnel/person",
        (route) =>
          route.fulfill({
            json: {
              success: true,
              data: {
                personnel: person,
                driver: driver(),
                activeBiometricEnrollment: null,
              },
              capabilities: {
                canManageEligibility: true,
                canManageBiometricEnrollment: false,
              },
            },
          }),
      );
      let suspensionBody: any;
      await page.route(
        "**/api/dispatch-master-data/internal-drivers/driver/eligibility",
        async (route) => {
          suspensionBody = route.request().postDataJSON();
          await route.fulfill({ json: { success: true } });
        },
      );
      await loginAsAdmin(page);
      await page.goto("/dashboard/hr/vehicle-operations");
      await setViewportAndZoom(page, { width, height: 1000 });
      await setTheme(page, theme);
      await expect(
        page.getByRole("link", { name: "ماهان امیریان", exact: true }),
      ).toHaveAttribute(
        "href",
        "/dashboard/hr/personnel/person/driver-eligibility",
      );
      await page
        .getByRole("button", { name: "عملیات راننده", exact: true })
        .click();
      await page
        .getByRole("button", { name: "ویرایش مشخصات رانندگی", exact: true })
        .click();
      const profile = page.getByRole("dialog", {
        name: "ویرایش مشخصات رانندگی",
        exact: true,
      });
      await expect(profile.getByRole("textbox", { name: /دلیل/ })).toHaveCount(
        0,
      );
      await profile
        .getByRole("textbox", { name: "شماره گواهینامه", exact: true })
        .fill("987654321");
      await profile
        .getByRole("button", { name: "ذخیره تغییرات", exact: true })
        .click();
      await expect(
        profile.getByText("شماره گواهینامه قبلاً ثبت شده است.", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        profile.getByRole("textbox", { name: "شماره گواهینامه", exact: true }),
      ).toHaveValue("987654321");
      expect(profileBody.reason).toBeUndefined();
      await profile
        .getByRole("button", { name: "انصراف", exact: true })
        .click();
      await page
        .getByRole("button", { name: "عملیات راننده", exact: true })
        .click();
      await page
        .getByRole("button", { name: "تغییر خودرو", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "انتخاب خودرو", exact: true })
        .click();
      await page.getByRole("option", { name: /خودروی دوم/ }).click();
      await page
        .getByRole("button", { name: "ثبت تخصیص", exact: true })
        .click();
      const transfer = page.getByRole("dialog", {
        name: "تأیید تخصیص خودرو",
        exact: true,
      });
      await expect(
        transfer.getByText("پایان تخصیص قبلی:", { exact: false }),
      ).toBeVisible();
      await transfer
        .getByRole("button", { name: "تأیید و ثبت", exact: true })
        .click();
      await expect(transfer).toBeHidden();
      expect(assignmentBody.effectiveFrom).toBe("NOW");
      expect(assignmentBody.reason).toBeUndefined();
      expect(assignmentBody.expectedAssignmentIds).toEqual(["a1"]);
      await page.route(
        "**/api/dispatch-master-data/company-vehicles/v1/status",
        (route) =>
          route.fulfill({
            status: 403,
            json: {
              success: false,
              error:
                "برای بایگانی همراه پایان تخصیص، مجوز مدیریت تخصیص خودرو هم لازم است.",
            },
          }),
      );
      await page
        .getByRole("button", { name: "خودروهای شرکت", exact: true })
        .click();
      await page
        .locator(".sds-card.p-4")
        .filter({ hasText: "خودروی اول" })
        .filter({ hasNotText: "خودروی دوم" })
        .getByRole("button", { name: "عملیات خودرو", exact: true })
        .click();
      await page
        .getByRole("button", { name: "بایگانی خودرو", exact: true })
        .click();
      const archive = page.getByRole("dialog", {
        name: "بایگانی خودرو",
        exact: true,
      });
      await archive
        .getByRole("button", { name: "تأیید و ثبت", exact: true })
        .click();
      await expect(
        archive.getByText("مجوز مدیریت تخصیص خودرو هم لازم است.", {
          exact: false,
        }),
      ).toBeVisible();
      await archive
        .getByRole("button", { name: "انصراف", exact: true })
        .click();
      await page
        .getByRole("button", { name: "رانندگان داخلی", exact: true })
        .click();
      await page
        .getByRole("button", { name: "عملیات راننده", exact: true })
        .click();
      await page
        .getByRole("button", { name: "ویرایش مشخصات رانندگی", exact: true })
        .click();
      await profile
        .getByRole("button", { name: /اعتبار گواهینامه|۱۴۰/ })
        .click();
      const currentYear = Number(
        new Intl.DateTimeFormat("en-US-u-ca-persian", {
          timeZone: "Asia/Tehran",
          year: "numeric",
        })
          .formatToParts(new Date())
          .find((part) => part.type === "year")!.value,
      );
      // The picker initially displays the stored licence date, whose Jalali year differs from today.
      const storedYear = Number(
        new Intl.DateTimeFormat("en-US-u-ca-persian", {
          year: "numeric",
          timeZone: "Asia/Tehran",
        })
          .formatToParts(new Date("2028-01-01"))
          .find((part) => part.type === "year")!.value,
      );
      await page
        .getByRole("button", {
          name: storedYear.toLocaleString("fa-IR"),
          exact: true,
        })
        .click();
      const lastYear = (currentYear + 15).toLocaleString("fa-IR");
      await expect(
        page.getByRole("button", { name: lastYear, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: (currentYear + 16).toLocaleString("fa-IR"),
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: lastYear, exact: true }).click();
      await page
        .getByRole("dialog", { name: "انتخاب تاریخ شمسی", exact: true })
        .getByRole("gridcell")
        .first()
        .click();
      failProfile = false;
      await profile
        .getByRole("button", { name: "ذخیره تغییرات", exact: true })
        .click();
      await expect(profile).toBeHidden();
      expect(
        Number(
          new Intl.DateTimeFormat("en-US-u-ca-persian", {
            year: "numeric",
            timeZone: "Asia/Tehran",
          })
            .formatToParts(new Date(profileBody.licenceExpiresAt))
            .find((part) => part.type === "year")!.value,
        ),
      ).toBe(currentYear + 15);
      await assertNoSeriousAxeViolations(page);
      await page.screenshot({
        path: testInfo.outputPath("hr-drivers-" + width + "-" + theme + ".png"),
        fullPage: true,
      });
      await page.screenshot({
        path: ".codex-tmp/hr-drivers-" + width + "-" + theme + ".png",
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "ماهان امیریان", exact: true })
        .click();
      await expect(page).toHaveURL(/person\/driver-eligibility/);
      await page
        .getByRole("button", { name: "تغییر وضعیت", exact: true })
        .click();
      const suspension = page.getByRole("dialog", {
        name: "تعلیق صلاحیت رانندگی",
        exact: true,
      });
      await expect(
        suspension.getByRole("textbox", { name: /دلیل/ }),
      ).toHaveCount(0);
      await suspension
        .getByRole("button", { name: "ثبت تعلیق", exact: true })
        .click();
      await expect(suspension).toBeHidden();
      expect(suspensionBody).toEqual({ status: "SUSPENDED" });
      await setViewportAndZoom(page, { width, height: 1000 }, 2);
      expect(
        await page
          .locator("main")
          .last()
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true);
    },
  );
