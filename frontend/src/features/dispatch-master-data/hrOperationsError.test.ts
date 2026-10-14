import test from "node:test";
import assert from "node:assert/strict";
import { hrOperationsError } from "./hrOperationsError";
test("permission codes and tracking text never hide the precise HR permission problem", () => {
  const message = hrOperationsError(
    {
      response: {
        status: 403,
        data: {
          error: "HR_AUTHORIZATION_DENIED",
          message: "مجوز لازم فعال نیست. کد پیگیری ABC-123",
          trackingId: "ABC-123",
        },
      },
    },
    {
      failedAction: "پایان فعالیت رانندگی",
      nextStep: "مجوز همین اقدام را بررسی کنید",
    },
  );
  assert.match(message, /مجوز لازم برای این اقدام فعال نیست/);
  assert.match(message, /ABC-123/);
  assert.doesNotMatch(message, /پاسخ قابل‌استفاده‌ای|HR_AUTHORIZATION_DENIED/);
});

test("a specific missing assignment permission remains visible for compound vehicle actions", () => {
  const message = hrOperationsError(
    {
      response: {
        status: 403,
        data: {
          error:
            "برای بایگانی همراه پایان تخصیص، مجوز مدیریت تخصیص خودرو هم لازم است.",
        },
      },
    },
    {
      failedAction: "بایگانی خودرو",
      nextStep: "مجوز همین اقدام را بررسی کنید",
    },
  );
  assert.match(message, /مجوز مدیریت تخصیص خودرو/);
});
