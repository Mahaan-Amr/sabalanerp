"use client";

import { useCallback, useEffect, useState } from "react";
import { FaBalanceScale, FaSync } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpPage,
  ErpSection,
  ErpSelect,
} from "@/components/erp";
import { accountingAPI } from "@/lib/api";
import {
  accountingFailureMessage,
  dateFa,
  money,
} from "@/features/accounting/accountingUi";

const taxStatusFa: Record<string, string> = {
  QUEUED: "در صف ارسال",
  SUBMITTED: "ارسال و پذیرش‌شده",
  REJECTED: "ردشده",
  NEEDS_CHANNEL: "نیازمند کانال",
  PENDING: "در انتظار ارسال",
};
const channelStatusFa: Record<string, string> = {
  ACTIVE: "فعال",
  INACTIVE: "غیرفعال",
  DEGRADED: "نیازمند بررسی",
};

export default function TaxOperationsPage() {
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channel, setChannel] = useState({
    legalEntityId: "",
    kind: "DIRECT",
    providerName: "",
    safeKeyVersion: "",
    secretReference: "",
    effectiveFrom: "",
  });
  const [rule, setRule] = useState({
    legalEntityId: "",
    code: "",
    version: "1",
    effectiveFrom: "",
    citation: "",
    invoiceType: "SALE",
    invoicePattern: "ORIGINAL",
    exempt: "false",
    exemptionReason: "",
    rateBasisPoints: "1000",
    allocationRule: "PER_LINE",
    roundingRule: "HALF_UP_IRR",
  });
  const [vat, setVat] = useState({
    legalEntityId: "",
    fiscalYearId: "",
    periodId: "",
  });
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (reason) {
      setError(accountingFailureMessage(reason, "عملیات مالیاتی انجام نشد."));
    }
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await accountingAPI.getTaxOverview()).data.data);
    } catch (reason) {
      setError(accountingFailureMessage(reason, "عملیات مالیاتی بارگیری نشد."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <ErpPage
      eyebrow="مالیات"
      title="عملیات مالیاتی قطعی"
      description="صورتحساب مالیاتی، صف ارسال، تلاش‌ها، کانال مؤثر و تطبیق ارزش افزوده مستقل از سند اقتصادی پیگیری می‌شوند."
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: load }]}
      metrics={
        data
          ? [
              {
                label: "صورتحساب مالیاتی",
                value: Number(data.invoices.length).toLocaleString("fa-IR"),
              },
              {
                label: "نیازمند رسیدگی",
                value: Number(
                  data.invoices.filter((row: any) => row.status !== "SUBMITTED")
                    .length,
                ).toLocaleString("fa-IR"),
              },
              {
                label: "کانال فعال",
                value: Number(
                  data.channels.filter(
                    (row: any) => row.healthStatus === "ACTIVE",
                  ).length,
                ).toLocaleString("fa-IR"),
              },
            ]
          : []
      }
    >
      {loading && (
        <ErpInlineState
          kind="empty"
          title="در حال بارگیری زنجیره صورتحساب و ارسال..."
        />
      )}
      {error && (
        <ErpInlineState
          kind="error"
          title={error}
          action={{ label: "تلاش دوباره", onClick: load }}
        />
      )}
      {notice && <ErpInlineState kind="success" title={notice} />}
      {data && (
        <>
          {data.capabilities?.canConfigure && (
            <ErpSection
              title="قواعد مالیاتی نسخه‌دار"
              description="هر نسخه با بازه اثر، استناد قانونی، الگوی صورتحساب، نرخ و روش گردکردن ثابت و غیرقابل‌ویرایش ثبت می‌شود."
            >
              <div className="grid gap-3 md:grid-cols-3">
                <ErpField label="شناسه واحد گزارشگر" required>
                  <ErpInput
                    value={rule.legalEntityId}
                    onChange={(event) =>
                      setRule({ ...rule, legalEntityId: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="کد قاعده" required>
                  <ErpInput
                    value={rule.code}
                    onChange={(event) =>
                      setRule({ ...rule, code: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="نسخه" required>
                  <ErpInput
                    inputMode="numeric"
                    value={rule.version}
                    onChange={(event) =>
                      setRule({ ...rule, version: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="شروع اثر" required>
                  <ErpInput
                    type="datetime-local"
                    value={rule.effectiveFrom}
                    onChange={(event) =>
                      setRule({ ...rule, effectiveFrom: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="استناد قانونی" required>
                  <ErpInput
                    value={rule.citation}
                    onChange={(event) =>
                      setRule({ ...rule, citation: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="نوع صورتحساب" required>
                  <ErpInput
                    value={rule.invoiceType}
                    onChange={(event) =>
                      setRule({ ...rule, invoiceType: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="الگوی صورتحساب" required>
                  <ErpInput
                    value={rule.invoicePattern}
                    onChange={(event) =>
                      setRule({ ...rule, invoicePattern: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="وضعیت معافیت">
                  <ErpSelect
                    value={rule.exempt}
                    onChange={(event) =>
                      setRule({ ...rule, exempt: event.target.value })
                    }
                  >
                    <option value="false">مشمول مالیات</option>
                    <option value="true">معاف</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="دلیل معافیت">
                  <ErpInput
                    value={rule.exemptionReason}
                    onChange={(event) =>
                      setRule({ ...rule, exemptionReason: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="نرخ در ده‌هزار" required>
                  <ErpInput
                    inputMode="numeric"
                    value={rule.rateBasisPoints}
                    onChange={(event) =>
                      setRule({ ...rule, rateBasisPoints: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="روش تخصیص">
                  <ErpSelect
                    value={rule.allocationRule}
                    onChange={(event) =>
                      setRule({ ...rule, allocationRule: event.target.value })
                    }
                  >
                    <option value="PER_LINE">به تفکیک ردیف</option>
                    <option value="PROPORTIONAL">تخصیص نسبی</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="روش گردکردن">
                  <ErpSelect
                    value={rule.roundingRule}
                    onChange={(event) =>
                      setRule({ ...rule, roundingRule: event.target.value })
                    }
                  >
                    <option value="HALF_UP_IRR">نیم‌به‌بالا به ریال</option>
                    <option value="DOWN_IRR">رو به پایین به ریال</option>
                  </ErpSelect>
                </ErpField>
              </div>
              <div className="mt-3 flex justify-end">
                <ErpButton
                  label="ثبت نسخه قاعده"
                  disabled={
                    !rule.legalEntityId ||
                    !rule.code ||
                    !rule.effectiveFrom ||
                    !rule.citation ||
                    (rule.exempt === "true" && !rule.exemptionReason)
                  }
                  onClick={() =>
                    void run(
                      () =>
                        accountingAPI.createTaxRule({
                          ...rule,
                          version: Number(rule.version),
                          rateBasisPoints: Number(rule.rateBasisPoints),
                          exempt: rule.exempt === "true",
                          effectiveFrom: new Date(
                            rule.effectiveFrom,
                          ).toISOString(),
                          exemptionReason: rule.exemptionReason || undefined,
                        }),
                      "نسخه قاعده مالیاتی ثبت شد.",
                    )
                  }
                />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.rules?.map((item: any) => (
                  <ErpCard key={item.id} className="p-4">
                    <div className="flex justify-between gap-3">
                      <strong>
                        {item.code} · نسخه{" "}
                        {Number(item.version).toLocaleString("fa-IR")}
                      </strong>
                      <ErpBadge tone={item.exempt ? "info" : "success"}>
                        {item.exempt ? "معاف" : "مشمول"}
                      </ErpBadge>
                    </div>
                    <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
                      {item.citation} · از {dateFa(item.effectiveFrom)}
                    </p>
                  </ErpCard>
                ))}
              </div>
            </ErpSection>
          )}
          {data.capabilities?.canConfigure && (
            <ErpSection
              title="عملیات کانال و ارسال"
              description="کانال فقط با ارجاع راز امن ثبت می‌شود؛ راز در این صفحه بازنمایی نخواهد شد."
            >
              <div className="grid gap-3 md:grid-cols-3">
                <ErpField label="شناسه واحد گزارشگر" required>
                  <ErpInput
                    value={channel.legalEntityId}
                    onChange={(event) =>
                      setChannel({
                        ...channel,
                        legalEntityId: event.target.value,
                      })
                    }
                  />
                </ErpField>
                <ErpField label="روش ارسال">
                  <ErpSelect
                    value={channel.kind}
                    onChange={(event) =>
                      setChannel({ ...channel, kind: event.target.value })
                    }
                  >
                    <option value="DIRECT">ارسال مستقیم</option>
                    <option value="TRUSTED_COMPANY">شرکت معتمد</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="نام ارائه‌دهنده">
                  <ErpInput
                    value={channel.providerName}
                    onChange={(event) =>
                      setChannel({
                        ...channel,
                        providerName: event.target.value,
                      })
                    }
                  />
                </ErpField>
                <ErpField label="نسخه کلید امن" required>
                  <ErpInput
                    value={channel.safeKeyVersion}
                    onChange={(event) =>
                      setChannel({
                        ...channel,
                        safeKeyVersion: event.target.value,
                      })
                    }
                  />
                </ErpField>
                <ErpField
                  label="ارجاع راز امن"
                  hint="برای نمونه vault://tax/direct"
                  required
                >
                  <ErpInput
                    value={channel.secretReference}
                    onChange={(event) =>
                      setChannel({
                        ...channel,
                        secretReference: event.target.value,
                      })
                    }
                  />
                </ErpField>
                <ErpField label="زمان شروع اثر" required>
                  <ErpInput
                    type="datetime-local"
                    value={channel.effectiveFrom}
                    onChange={(event) =>
                      setChannel({
                        ...channel,
                        effectiveFrom: event.target.value,
                      })
                    }
                  />
                </ErpField>
              </div>
              <div className="mt-3 flex justify-end">
                <ErpButton
                  label="ثبت کانال ارسال"
                  disabled={
                    !channel.legalEntityId ||
                    !channel.safeKeyVersion ||
                    !channel.secretReference ||
                    !channel.effectiveFrom
                  }
                  onClick={() =>
                    void run(
                      () =>
                        accountingAPI.configureTaxChannel({
                          ...channel,
                          effectiveFrom: new Date(
                            channel.effectiveFrom,
                          ).toISOString(),
                          providerName: channel.providerName || undefined,
                        }),
                      "کانال مالیاتی ثبت شد.",
                    )
                  }
                />
              </div>
            </ErpSection>
          )}
          <ErpSection
            title="صورتحساب‌ها و صف ارسال"
            description="شناسه داخلی، شناسه یکتای بیرونی و سند دفترکل هویت‌های جدا و پیوندخورده دارند."
          >
            {data.invoices.length ? (
              <div className="grid gap-3">
                {data.invoices.map((row: any) => (
                  <ErpCard key={row.id} className="p-4">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <strong>{row.internalSerial}</strong>
                        <span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">
                          {row.externalUniqueTaxId ||
                            "شناسه بیرونی هنوز صادر نشده"}
                        </span>
                      </div>
                      <ErpBadge
                        tone={
                          row.status === "SUBMITTED" ? "success" : "warning"
                        }
                      >
                        {taxStatusFa[row.status] || "نیازمند بررسی"}
                      </ErpBadge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
                      <span>خالص: {money(row.netRials, "IRR")}</span>
                      <span>مالیات: {money(row.taxRials, "IRR")}</span>
                      <span>{dateFa(row.issuedAt)}</span>
                      <span>
                        {Number(
                          row.outboxMessages.flatMap(
                            (message: any) => message.attempts,
                          ).length,
                        ).toLocaleString("fa-IR")}{" "}
                        تلاش ارسال
                      </span>
                    </div>
                    {data.capabilities?.canManage &&
                      row.outboxMessages
                        .filter(
                          (message: any) => message.status === "NEEDS_CHANNEL",
                        )
                        .map((message: any) => (
                          <div
                            key={message.id}
                            className="mt-3 flex flex-wrap items-center gap-2"
                          >
                            <ErpSelect
                              aria-label="انتخاب کانال ارسال"
                              defaultValue=""
                              onChange={(event) => {
                                if (event.target.value)
                                  void run(
                                    () =>
                                      accountingAPI.bindTaxOutboxChannel(
                                        message.id,
                                        event.target.value,
                                      ),
                                    "صورتحساب به کانال مؤثر متصل شد.",
                                  );
                              }}
                            >
                              <option value="">اتصال به کانال فعال</option>
                              {data.channels
                                .filter(
                                  (item: any) => item.healthStatus === "ACTIVE",
                                )
                                .map((item: any) => (
                                  <option key={item.id} value={item.id}>
                                    {item.providerName ||
                                      (item.kind === "DIRECT"
                                        ? "ارسال مستقیم"
                                        : "شرکت معتمد")}
                                  </option>
                                ))}
                            </ErpSelect>
                          </div>
                        ))}
                  </ErpCard>
                ))}
              </div>
            ) : (
              <ErpEmptyState
                icon={FaBalanceScale}
                title="صورتحساب مالیاتی ثبت نشده است"
              />
            )}
          </ErpSection>
          <ErpSection
            title="کانال‌های ارسال"
            description="فقط شناسه نسخه کلید نمایش داده می‌شود؛ ارجاع راز و کلید خصوصی بازنمایی نمی‌شود."
          >
            <div className="grid gap-3 md:grid-cols-2">
              {data.channels.map((row: any) => (
                <ErpCard key={row.id} className="p-4">
                  <div className="flex justify-between gap-3">
                    <strong>
                      {row.providerName ||
                        (row.kind === "DIRECT" ? "ارسال مستقیم" : "شرکت معتمد")}
                    </strong>
                    <ErpBadge
                      tone={
                        row.healthStatus === "ACTIVE" ? "success" : "warning"
                      }
                    >
                      {channelStatusFa[row.healthStatus] || "نامشخص"}
                    </ErpBadge>
                  </div>
                  <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
                    نسخه کلید امن: {row.safeKeyVersion} · از{" "}
                    {dateFa(row.effectiveFrom)}
                  </p>
                </ErpCard>
              ))}
            </div>
          </ErpSection>
          <ErpSection title="تطبیق ارزش افزوده">
            {data.capabilities?.canManage && (
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <ErpField label="شناسه واحد گزارشگر" required>
                  <ErpInput
                    value={vat.legalEntityId}
                    onChange={(event) =>
                      setVat({ ...vat, legalEntityId: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="شناسه سال مالی" required>
                  <ErpInput
                    value={vat.fiscalYearId}
                    onChange={(event) =>
                      setVat({ ...vat, fiscalYearId: event.target.value })
                    }
                  />
                </ErpField>
                <ErpField label="شناسه دوره" required>
                  <ErpInput
                    value={vat.periodId}
                    onChange={(event) =>
                      setVat({ ...vat, periodId: event.target.value })
                    }
                  />
                </ErpField>
                <div className="md:col-span-3 flex justify-end">
                  <ErpButton
                    label="اجرای تطبیق دوره"
                    disabled={
                      !vat.legalEntityId || !vat.fiscalYearId || !vat.periodId
                    }
                    onClick={() =>
                      void run(
                        () => accountingAPI.reconcileVatPeriod(vat),
                        "تطبیق ارزش افزوده ثبت شد.",
                      )
                    }
                  />
                </div>
              </div>
            )}
            {data.reconciliations.length ? (
              <div className="grid gap-3">
                {data.reconciliations.map((row: any) => (
                  <ErpCard key={row.id} className="p-4">
                    <div className="flex flex-wrap justify-between gap-3">
                      <strong>دوره {row.periodId}</strong>
                      <ErpBadge tone="success">تطبیق‌شده</ErpBadge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                      <span>
                        مالیات فروش: {money(row.salesTaxRials, "IRR")}
                      </span>
                      <span>
                        اعتبار خرید:{" "}
                        {money(row.eligiblePurchaseTaxRials, "IRR")}
                      </span>
                      <span>پرداخت: {money(row.paymentRials, "IRR")}</span>
                    </div>
                  </ErpCard>
                ))}
              </div>
            ) : (
              <ErpEmptyState title="تطبیق ارزش افزوده ثبت نشده است" />
            )}
          </ErpSection>
        </>
      )}
    </ErpPage>
  );
}
