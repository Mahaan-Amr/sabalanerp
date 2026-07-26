import assert from "node:assert/strict";
import { buildHiringOfferTemplateParameters } from "../smsService";
import { mapSmsIrDeliveryState } from "../hrHiringDeliveryPollingService";

process.env.NODE_ENV = "test";
process.env.HR_HIRING_E2E = "true";
process.env.HR_HIRING_SMS_ADAPTER = "memory";

const run = async () => {
  const { default: gateway } = await import("../hrHiringSmsGateway");

  gateway.configureTestAdapter("success", true);
  await gateway.sendOfferReady({
    phoneNumber: "09120000001",
    code: "123456",
  });

  const message = gateway.snapshot().messages[0];
  assert.equal(message.kind, "offer");
  assert.equal(message.code, "123456");
  assert.equal(
    message.text,
    `سامانه منابع انسانی سبلان

پیشنهاد همکاری شما آماده بررسی است.

لطفاً به sabalanerp.com/apply وارد شوید، با شماره همراه و کد 123456 ورود کنید و پیشنهاد همکاری را بررسی و اعلام تصمیم نمایید.`,
  );
  assert.deepEqual(buildHiringOfferTemplateParameters("123456"), [
    { name: "CODE", value: "123456" },
  ]);
  assert.throws(() => buildHiringOfferTemplateParameters(""), /six digits/);
  const deliveryReport = await gateway.getDeliveryReport(1);
  assert.equal(deliveryReport.success, true);
  assert.equal(deliveryReport.deliveryState, 1);
  assert.equal(typeof deliveryReport.deliveryDateTime, "number");
  assert.equal(mapSmsIrDeliveryState(1), "DELIVERED");
  assert.equal(mapSmsIrDeliveryState(2), "FAILED");
  assert.equal(mapSmsIrDeliveryState(0), "ACCEPTED");

  console.log("HR hiring offer SMS tests passed.");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
