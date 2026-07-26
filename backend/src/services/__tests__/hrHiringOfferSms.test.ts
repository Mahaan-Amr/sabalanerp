import assert from "node:assert/strict";
import { buildHiringOfferTemplateParameters } from "../smsService";

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
  assert.deepEqual(buildHiringOfferTemplateParameters("123456"), [
    { name: "Code", value: "123456" },
  ]);
  assert.throws(() => buildHiringOfferTemplateParameters(""), /six digits/);

  console.log("HR hiring offer SMS tests passed.");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
