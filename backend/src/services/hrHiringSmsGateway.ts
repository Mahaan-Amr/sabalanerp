import smsService from "./smsService";

export type HiringSmsMessage = {
  phoneNumber: string;
  kind: "invitation" | "correction" | "offer";
  code?: string;
  text?: string;
  sentAt: string;
};

export type HiringSmsResult = {
  success: boolean;
  messageId?: number;
  error?: string;
  rawResponse?: unknown;
};

type TestMode = "success" | "failure";

class HrHiringSmsGateway {
  private testMode: TestMode = "success";
  private readonly messages: HiringSmsMessage[] = [];

  private get usesTestAdapter() {
    return (
      process.env.NODE_ENV === "test" &&
      process.env.HR_HIRING_E2E === "true" &&
      process.env.HR_HIRING_SMS_ADAPTER === "memory"
    );
  }

  async sendInvitation(params: {
    phoneNumber: string;
    code: string;
  }): Promise<HiringSmsResult> {
    if (!this.usesTestAdapter) {
      return smsService.sendHiringInvitation(params);
    }

    this.messages.push({
      ...params,
      kind: "invitation",
      sentAt: new Date().toISOString(),
    });
    if (this.testMode === "failure") {
      return { success: false, error: "خطای آزمایشی ارسال پیامک" };
    }
    return { success: true, messageId: this.messages.length };
  }

  async sendCorrection(params: {
    phoneNumber: string;
    details: string;
    replacementCode?: string;
  }): Promise<HiringSmsResult> {
    if (!this.usesTestAdapter) {
      return smsService.sendHiringCorrection(params);
    }
    this.messages.push({
      phoneNumber: params.phoneNumber,
      kind: "correction",
      code: params.replacementCode,
      text: params.details,
      sentAt: new Date().toISOString(),
    });
    if (this.testMode === "failure") {
      return { success: false, error: "خطای آزمایشی ارسال پیامک" };
    }
    return { success: true, messageId: this.messages.length };
  }

  async sendOfferReady(params: {
    phoneNumber: string;
    code: string;
  }): Promise<HiringSmsResult> {
    if (!this.usesTestAdapter) {
      return smsService.sendHiringOfferReady(params);
    }
    this.messages.push({
      phoneNumber: params.phoneNumber,
      kind: "offer",
      code: params.code,
      text: "پیشنهاد همکاری شما آماده بررسی است. به صفحه درخواست استخدام وارد شوید.",
      sentAt: new Date().toISOString(),
    });
    if (this.testMode === "failure") {
      return { success: false, error: "خطای آزمایشی ارسال پیامک" };
    }
    return { success: true, messageId: this.messages.length };
  }

  configureTestAdapter(mode: TestMode, reset = false) {
    if (!this.usesTestAdapter) {
      throw new Error("درگاه آزمایشی پیامک فعال نیست.");
    }
    this.testMode = mode;
    if (reset) this.messages.splice(0);
    return this.snapshot();
  }

  snapshot() {
    return {
      mode: this.testMode,
      messages: this.messages.map((message) => ({ ...message })),
    };
  }
}

export const hrHiringSmsGateway = new HrHiringSmsGateway();
export default hrHiringSmsGateway;
