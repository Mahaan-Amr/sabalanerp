"use client";

import { useCallback, useEffect, useState } from "react";
import { FaMoneyCheckAlt, FaSync } from "react-icons/fa";
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

const treasuryKindFa: Record<string, string> = {
  CUSTOMER_RECEIPT: "دریافت مشتری",
  PETTY_CASH_ADVANCE: "پرداخت تنخواه",
  INTERNAL_TRANSFER: "انتقال داخلی",
};
const sourceTypeFa: Record<string, string> = {
  BANK_RECEIPT: "واریز بانکی",
  CASH_RECEIPT: "دریافت نقدی",
  PETTY_CASH_ADVANCE: "تنخواه",
};
const adapterTypeFa: Record<string, string> = {
  API: "رابط بانکی",
  CSV: "فایل CSV",
  XLSX: "فایل اکسل",
  MANUAL: "ورود کنترل‌شده دستی",
};
const checkStatusFa: Record<string, string> = {
  RECEIVED: "دریافت‌شده",
  ENDORSED: "پشت‌نویسی‌شده",
  ASSIGNED: "واگذارشده",
  DEPOSITED: "واگذارشده به بانک",
  CLEARED: "وصول‌شده",
  BOUNCED: "برگشت بانکی",
  RETURNED: "عودت‌شده",
  REPLACED: "جایگزین‌شده",
  CANCELLED: "باطل‌شده",
};

export default function TreasuryControlPage() {
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [matchReason, setMatchReason] = useState(
    "تأیید تطبیق بر پایه مبلغ، جهت و تاریخ تراکنش",
  );
  const [bankLine, setBankLine] = useState({
    financialAccountId: "",
    adapterType: "MANUAL",
    mappingVersion: "1",
    sourceIdentity: "",
    bookedAt: "",
    amountRials: "",
    direction: "INBOUND",
    description: "",
    rawRecord: "",
  });
  const [bankMapping, setBankMapping] = useState({
    financialAccountId: "",
    adapterType: "CSV",
    version: "1",
    effectiveFrom: "",
    sourceIdentityField: "reference",
    bookedAtField: "bookedAt",
    amountField: "amountRials",
    directionField: "direction",
    descriptionField: "description",
    inboundValues: "INBOUND,واریز",
    outboundValues: "OUTBOUND,برداشت",
  });
  const [receipt, setReceipt] = useState({
    profileId: "",
    contractId: "",
    bookId: "",
    fiscalYearId: "",
    periodId: "",
    amountRials: "",
    occurredAt: "",
    financialAccountId: "",
    bankAccountLedgerId: "",
    customerAdvanceLedgerId: "",
    sourceType: "BANK_RECEIPT",
    sourceId: "",
    sourceVersion: "1",
  });
  const [allocation, setAllocation] = useState({
    treasuryTransactionId: "",
    openItemId: "",
    amountRials: "",
    bookId: "",
    fiscalYearId: "",
    periodId: "",
    customerAdvanceLedgerId: "",
    receivableLedgerId: "",
    documentDate: "",
    reason: "",
  });
  const [customerAccounts, setCustomerAccounts] = useState<any[]>([]);
  const [openItems, setOpenItems] = useState<any[]>([]);
  const [transfer, setTransfer] = useState({
    fromFinancialAccountId: "",
    toFinancialAccountId: "",
    fromLedgerAccountId: "",
    toLedgerAccountId: "",
    bookId: "",
    fiscalYearId: "",
    periodId: "",
    amountRials: "",
    occurredAt: "",
  });
  const [check, setCheck] = useState({
    profileId: "",
    sayadId: "",
    serialNumber: "",
    bankName: "",
    amountRials: "",
    dueAt: "",
    custodianId: "",
  });
  const [checkEvent, setCheckEvent] = useState({
    nextStatus: "DEPOSITED",
    occurredAt: "",
    fromCustodianId: "",
    toCustodianId: "",
    postingRuleVersion: "1",
    ledgerVoucherId: "",
  });
  const [cashCount, setCashCount] = useState({
    financialAccountId: "",
    custodianId: "",
    countedAt: "",
    expectedRials: "",
    countedRials: "",
    ledgerVoucherId: "",
  });
  const [petty, setPetty] = useState({
    financialAccountId: "",
    custodianId: "",
    costCenterId: "",
    amountRials: "",
    limitRials: "",
    issuedAt: "",
    settlementDueAt: "",
    bookId: "",
    fiscalYearId: "",
    periodId: "",
    cashLedgerId: "",
    pettyCashAdvanceLedgerId: "",
  });
  const [pettySettlement, setPettySettlement] = useState({
    ledgerVoucherId: "",
    settledAt: "",
  });
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (reason) {
      setError(
        accountingFailureMessage(reason, "عملیات خزانه‌داری انجام نشد."),
      );
    }
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overview, context, customers] = await Promise.all([
        accountingAPI.getTreasuryOverview(),
        accountingAPI.getLedgerContext(),
        accountingAPI.getCustomerAccounts(),
      ]);
      setData({ ...overview.data.data, ledger: context.data.data });
      setCustomerAccounts(customers.data.data);
    } catch (reason) {
      setError(
        accountingFailureMessage(reason, "نمای کنترل خزانه‌داری بارگیری نشد."),
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <ErpPage
      eyebrow="خزانه‌داری"
      title="کنترل خزانه‌داری"
      description="دریافت، ردیف بانکی، تطبیق، چک، شمارش صندوق و تنخواه با هویت و سابقه مستقل نمایش داده می‌شوند."
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: load }]}
      metrics={
        data
          ? [
              {
                label: "تراکنش خزانه",
                value: Number(data.transactions.length).toLocaleString("fa-IR"),
              },
              {
                label: "ردیف بانکی",
                value: Number(data.bankLines.length).toLocaleString("fa-IR"),
              },
              {
                label: "چک در گردش",
                value: Number(
                  data.checks.filter(
                    (row: any) =>
                      !["CLEARED", "RETURNED", "CANCELLED"].includes(
                        row.status,
                      ),
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
          title="در حال بازسازی نمای خزانه از رویدادهای قطعی..."
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
          <ErpSection
            title="دریافت‌ها و تخصیص‌ها"
            description="وجه تا زمان تخصیص قطعی، بستانکاری تخصیص‌نیافته همان مشتری باقی می‌ماند."
          >
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>ثبت دریافت مشتری</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="مشتری" required>
                    <ErpSelect
                      value={receipt.profileId}
                      onChange={async (event) => {
                        const profileId = event.target.value;
                        setReceipt({ ...receipt, profileId });
                        setOpenItems(
                          profileId
                            ? (
                                await accountingAPI.getCustomerAccountProjection(
                                  profileId,
                                  { asOf: new Date().toISOString() },
                                )
                              ).data.data.openItems
                            : [],
                        );
                      }}
                    >
                      <option value="">انتخاب مشتری</option>
                      {customerAccounts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.displayName}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="شناسه قرارداد">
                    <ErpInput
                      value={receipt.contractId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          contractId: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="حساب مالی" required>
                    <ErpSelect
                      value={receipt.financialAccountId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          financialAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب مالی</option>
                      {data.ledger?.financialAccounts?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.titlePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="دفتر" required>
                    <ErpSelect
                      value={receipt.bookId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          bookId: event.target.value,
                          fiscalYearId: "",
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب دفتر</option>
                      {data.ledger?.books?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.namePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSelect
                      value={receipt.fiscalYearId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          fiscalYearId: event.target.value,
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب سال</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === receipt.bookId)
                        ?.fiscalYears?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSelect
                      value={receipt.periodId}
                      onChange={(event) =>
                        setReceipt({ ...receipt, periodId: event.target.value })
                      }
                    >
                      <option value="">انتخاب دوره</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === receipt.bookId)
                        ?.fiscalYears?.find(
                          (item: any) => item.id === receipt.fiscalYearId,
                        )
                        ?.periods?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب بانک در دفترکل" required>
                    <ErpSelect
                      value={receipt.bankAccountLedgerId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          bankAccountLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.financialAccountRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب پیش‌دریافت مشتری" required>
                    <ErpSelect
                      value={receipt.customerAdvanceLedgerId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          customerAdvanceLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.partyRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="مبلغ ریال" required>
                    <ErpInput
                      inputMode="numeric"
                      value={receipt.amountRials}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          amountRials: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="زمان دریافت" required>
                    <ErpInput
                      type="datetime-local"
                      value={receipt.occurredAt}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          occurredAt: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="شناسه شاهد" required>
                    <ErpInput
                      value={receipt.sourceId}
                      onChange={(event) =>
                        setReceipt({ ...receipt, sourceId: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="نوع شاهد">
                    <ErpSelect
                      value={receipt.sourceType}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          sourceType: event.target.value,
                        })
                      }
                    >
                      <option value="BANK_RECEIPT">واریز بانکی</option>
                      <option value="CASH_RECEIPT">دریافت نقدی</option>
                    </ErpSelect>
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت دریافت قطعی"
                    disabled={[
                      "profileId",
                      "bookId",
                      "fiscalYearId",
                      "periodId",
                      "amountRials",
                      "occurredAt",
                      "financialAccountId",
                      "bankAccountLedgerId",
                      "customerAdvanceLedgerId",
                      "sourceId",
                    ].some((key) => !receipt[key as keyof typeof receipt])}
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.recordCustomerReceipt({
                            ...receipt,
                            contractId: receipt.contractId || undefined,
                            occurredAt: new Date(
                              receipt.occurredAt,
                            ).toISOString(),
                            source: {
                              type: receipt.sourceType,
                              id: receipt.sourceId,
                              version: Number(receipt.sourceVersion),
                              payload: {
                                sourceId: receipt.sourceId,
                                amountRials: receipt.amountRials,
                              },
                            },
                            idempotencyKey: crypto.randomUUID(),
                            correlationId: crypto.randomUUID(),
                          }),
                        "دریافت مشتری با بستانکاری تخصیص‌نیافته ثبت شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>تخصیص دریافت به قلم باز</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="دریافت" required>
                    <ErpSelect
                      value={allocation.treasuryTransactionId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          treasuryTransactionId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب دریافت</option>
                      {data.transactions
                        .filter((item: any) => item.kind === "CUSTOMER_RECEIPT")
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.profile?.displayName} ·{" "}
                            {money(item.amountRials, "IRR")}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="قلم باز" required>
                    <ErpSelect
                      value={allocation.openItemId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          openItemId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب قلم باز</option>
                      {openItems
                        .filter((item) => item.kind === "RECEIVABLE")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.invoiceNumber} ·{" "}
                            {money(item.remainingRials, "IRR")}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="مبلغ تخصیص" required>
                    <ErpInput
                      inputMode="numeric"
                      value={allocation.amountRials}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          amountRials: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="دفتر" required>
                    <ErpSelect
                      value={allocation.bookId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          bookId: event.target.value,
                          fiscalYearId: "",
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب دفتر</option>
                      {data.ledger?.books?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.namePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSelect
                      value={allocation.fiscalYearId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          fiscalYearId: event.target.value,
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب سال</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === allocation.bookId)
                        ?.fiscalYears?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSelect
                      value={allocation.periodId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          periodId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب دوره</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === allocation.bookId)
                        ?.fiscalYears?.find(
                          (item: any) => item.id === allocation.fiscalYearId,
                        )
                        ?.periods?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب پیش‌دریافت" required>
                    <ErpSelect
                      value={allocation.customerAdvanceLedgerId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          customerAdvanceLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.partyRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب دریافتنی" required>
                    <ErpSelect
                      value={allocation.receivableLedgerId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          receivableLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.partyRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="تاریخ سند" required>
                    <ErpInput
                      type="datetime-local"
                      value={allocation.documentDate}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          documentDate: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField
                    label="دلیل برگشت"
                    hint="فقط هنگام برگشت تخصیص استفاده می‌شود"
                  >
                    <ErpInput
                      value={allocation.reason}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          reason: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت تخصیص"
                    disabled={[
                      "treasuryTransactionId",
                      "openItemId",
                      "amountRials",
                      "bookId",
                      "fiscalYearId",
                      "periodId",
                      "customerAdvanceLedgerId",
                      "receivableLedgerId",
                      "documentDate",
                    ].some(
                      (key) => !allocation[key as keyof typeof allocation],
                    )}
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.allocateCustomerReceipt({
                            ...allocation,
                            allocations: [
                              {
                                openItemId: allocation.openItemId,
                                amountRials: allocation.amountRials,
                              },
                            ],
                            documentDate: new Date(
                              allocation.documentDate,
                            ).toISOString(),
                            idempotencyKey: crypto.randomUUID(),
                            correlationId: crypto.randomUUID(),
                          }),
                        "تخصیص دریافت قطعی شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>انتقال داخلی میان حساب‌های مالی</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی مبدأ" required>
                    <ErpSelect
                      value={transfer.fromFinancialAccountId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          fromFinancialAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب مبدأ</option>
                      {data.ledger?.financialAccounts?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.titlePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب مالی مقصد" required>
                    <ErpSelect
                      value={transfer.toFinancialAccountId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          toFinancialAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب مقصد</option>
                      {data.ledger?.financialAccounts?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.titlePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="مبلغ ریال" required>
                    <ErpInput
                      inputMode="numeric"
                      value={transfer.amountRials}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          amountRials: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="دفتر" required>
                    <ErpSelect
                      value={transfer.bookId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          bookId: event.target.value,
                          fiscalYearId: "",
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب دفتر</option>
                      {data.ledger?.books?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.namePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSelect
                      value={transfer.fiscalYearId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          fiscalYearId: event.target.value,
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب سال</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === transfer.bookId)
                        ?.fiscalYears?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSelect
                      value={transfer.periodId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          periodId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب دوره</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === transfer.bookId)
                        ?.fiscalYears?.find(
                          (item: any) => item.id === transfer.fiscalYearId,
                        )
                        ?.periods?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب دفترکل مبدأ" required>
                    <ErpSelect
                      value={transfer.fromLedgerAccountId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          fromLedgerAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.financialAccountRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب دفترکل مقصد" required>
                    <ErpSelect
                      value={transfer.toLedgerAccountId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          toLedgerAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.financialAccountRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="زمان انتقال" required>
                    <ErpInput
                      type="datetime-local"
                      value={transfer.occurredAt}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          occurredAt: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت انتقال داخلی"
                    disabled={Object.values(transfer).some((value) => !value)}
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.recordInternalTreasuryTransfer({
                            ...transfer,
                            occurredAt: new Date(
                              transfer.occurredAt,
                            ).toISOString(),
                            idempotencyKey: crypto.randomUUID(),
                            correlationId: crypto.randomUUID(),
                          }),
                        "انتقال داخلی با دو اثر خزانه‌ای ثبت شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            {data.transactions.length ? (
              <div className="grid gap-3">
                {data.transactions.map((row: any) => (
                  <ErpCard key={row.id} className="p-4">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <strong>
                          {row.profile?.displayName || "تراکنش خزانه‌داری"}
                        </strong>
                        <span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">
                          {sourceTypeFa[row.sourceType] || "شاهد خزانه‌داری"} ·{" "}
                          {row.sourceId}
                        </span>
                      </div>
                      <strong>{money(row.amountRials, "IRR")}</strong>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-sm text-[var(--sds-text-secondary)]">
                      <span>{dateFa(row.occurredAt)}</span>
                      <ErpBadge tone="info">
                        {treasuryKindFa[row.kind] || "عملیات خزانه"}
                      </ErpBadge>
                      <span>
                        {Number(row.allocations.length).toLocaleString("fa-IR")}{" "}
                        تخصیص
                      </span>
                    </div>
                    {row.allocations
                      ?.filter(
                        (item: any) => !item.reversesId && !item.reversedById,
                      )
                      .map((item: any) => (
                        <div key={item.id} className="mt-2 flex justify-end">
                          <ErpButton
                            label="برگشت تخصیص"
                            tone="danger"
                            variant="outline"
                            disabled={
                              !allocation.reason ||
                              !allocation.documentDate ||
                              !allocation.bookId ||
                              !allocation.fiscalYearId ||
                              !allocation.periodId ||
                              !allocation.customerAdvanceLedgerId ||
                              !allocation.receivableLedgerId
                            }
                            onClick={() =>
                              void run(
                                () =>
                                  accountingAPI.reverseCustomerAllocation(
                                    item.id,
                                    {
                                      bookId: allocation.bookId,
                                      fiscalYearId: allocation.fiscalYearId,
                                      periodId: allocation.periodId,
                                      customerAdvanceLedgerId:
                                        allocation.customerAdvanceLedgerId,
                                      receivableLedgerId:
                                        allocation.receivableLedgerId,
                                      documentDate: new Date(
                                        allocation.documentDate,
                                      ).toISOString(),
                                      reason: allocation.reason,
                                      idempotencyKey: crypto.randomUUID(),
                                      correlationId: crypto.randomUUID(),
                                    },
                                  ),
                                "تخصیص با سند مستقل برگشت خورد.",
                              )
                            }
                          />
                        </div>
                      ))}
                  </ErpCard>
                ))}
              </div>
            ) : (
              <ErpEmptyState
                icon={FaMoneyCheckAlt}
                title="تراکنش خزانه‌داری ثبت نشده است"
              />
            )}
          </ErpSection>
          <ErpSection
            title="صورتحساب بانکی و تطبیق"
            description="پیشنهاد خودکار تا تأیید صریح اثر قطعی ندارد و برگشت تطبیق در تاریخچه حفظ می‌شود."
          >
            {data.capabilities?.canConfigure && (
              <ErpCard className="mb-4 p-4">
                <strong>نگاشت نسخه‌دار منبع بانکی</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی" required>
                    <ErpSelect
                      value={bankMapping.financialAccountId}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          financialAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.financialAccounts?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.titlePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="مسیر ورود">
                    <ErpSelect
                      value={bankMapping.adapterType}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          adapterType: event.target.value,
                        })
                      }
                    >
                      <option value="API">رابط بانکی</option>
                      <option value="CSV">فایل CSV</option>
                      <option value="XLSX">فایل اکسل</option>
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="نسخه">
                    <ErpInput
                      inputMode="numeric"
                      value={bankMapping.version}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          version: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="شروع اثر" required>
                    <ErpInput
                      type="datetime-local"
                      value={bankMapping.effectiveFrom}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          effectiveFrom: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="ستون شناسه">
                    <ErpInput
                      value={bankMapping.sourceIdentityField}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          sourceIdentityField: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="ستون تاریخ">
                    <ErpInput
                      value={bankMapping.bookedAtField}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          bookedAtField: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="ستون مبلغ">
                    <ErpInput
                      value={bankMapping.amountField}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          amountField: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="ستون جهت">
                    <ErpInput
                      value={bankMapping.directionField}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          directionField: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="ستون شرح">
                    <ErpInput
                      value={bankMapping.descriptionField}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          descriptionField: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="مقادیر جهت ورودی">
                    <ErpInput
                      value={bankMapping.inboundValues}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          inboundValues: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="مقادیر جهت خروجی">
                    <ErpInput
                      value={bankMapping.outboundValues}
                      onChange={(event) =>
                        setBankMapping({
                          ...bankMapping,
                          outboundValues: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت نگاشت"
                    disabled={
                      !bankMapping.financialAccountId ||
                      !bankMapping.effectiveFrom
                    }
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.createBankImportMapping({
                            financialAccountId: bankMapping.financialAccountId,
                            adapterType: bankMapping.adapterType,
                            version: Number(bankMapping.version),
                            effectiveFrom: new Date(
                              bankMapping.effectiveFrom,
                            ).toISOString(),
                            columnMapping: {
                              sourceIdentityField:
                                bankMapping.sourceIdentityField,
                              bookedAtField: bankMapping.bookedAtField,
                              amountField: bankMapping.amountField,
                              directionField: bankMapping.directionField,
                              descriptionField: bankMapping.descriptionField,
                              inboundValues: bankMapping.inboundValues
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                              outboundValues: bankMapping.outboundValues
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            },
                          }),
                        "نگاشت بانکی نسخه‌دار ثبت شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            {data.capabilities?.canManage && (
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <ErpField label="حساب مالی" required>
                  <ErpSelect
                    value={bankLine.financialAccountId}
                    onChange={(event) =>
                      setBankLine({
                        ...bankLine,
                        financialAccountId: event.target.value,
                      })
                    }
                  >
                    <option value="">انتخاب حساب</option>
                    {data.ledger?.financialAccounts?.map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.titlePersian}
                      </option>
                    ))}
                  </ErpSelect>
                </ErpField>
                <ErpField label="مسیر ورود">
                  <ErpSelect
                    value={bankLine.adapterType}
                    onChange={(event) =>
                      setBankLine({
                        ...bankLine,
                        adapterType: event.target.value,
                      })
                    }
                  >
                    <option value="API">رابط بانکی</option>
                    <option value="CSV">فایل CSV</option>
                    <option value="XLSX">فایل اکسل</option>
                    <option value="MANUAL">ورود کنترل‌شده دستی</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="نسخه نگاشت" required>
                  <ErpInput
                    inputMode="numeric"
                    value={bankLine.mappingVersion}
                    onChange={(event) =>
                      setBankLine({
                        ...bankLine,
                        mappingVersion: event.target.value,
                      })
                    }
                  />
                </ErpField>
                {bankLine.adapterType === "MANUAL" ? (
                  <>
                    <ErpField label="شناسه یکتای منبع" required>
                      <ErpInput
                        value={bankLine.sourceIdentity}
                        onChange={(event) =>
                          setBankLine({
                            ...bankLine,
                            sourceIdentity: event.target.value,
                          })
                        }
                      />
                    </ErpField>
                    <ErpField label="زمان ثبت بانک" required>
                      <ErpInput
                        type="datetime-local"
                        value={bankLine.bookedAt}
                        onChange={(event) =>
                          setBankLine({
                            ...bankLine,
                            bookedAt: event.target.value,
                          })
                        }
                      />
                    </ErpField>
                    <ErpField label="مبلغ ریال" required>
                      <ErpInput
                        inputMode="numeric"
                        value={bankLine.amountRials}
                        onChange={(event) =>
                          setBankLine({
                            ...bankLine,
                            amountRials: event.target.value,
                          })
                        }
                      />
                    </ErpField>
                    <ErpField label="جهت">
                      <ErpSelect
                        value={bankLine.direction}
                        onChange={(event) =>
                          setBankLine({
                            ...bankLine,
                            direction: event.target.value,
                          })
                        }
                      >
                        <option value="INBOUND">ورودی</option>
                        <option value="OUTBOUND">خروجی</option>
                      </ErpSelect>
                    </ErpField>
                    <ErpField label="شرح" required>
                      <ErpInput
                        value={bankLine.description}
                        onChange={(event) =>
                          setBankLine({
                            ...bankLine,
                            description: event.target.value,
                          })
                        }
                      />
                    </ErpField>
                  </>
                ) : (
                  <ErpField
                    label="رکورد خام منبع"
                    hint="یک شیء JSON مطابق نگاشت نسخه‌دار"
                    required
                  >
                    <ErpInput
                      value={bankLine.rawRecord}
                      onChange={(event) =>
                        setBankLine({
                          ...bankLine,
                          rawRecord: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                )}
                <ErpField label="دلیل تأیید یا برگشت" required>
                  <ErpInput
                    value={matchReason}
                    onChange={(event) => setMatchReason(event.target.value)}
                  />
                </ErpField>
                <div className="md:col-span-3 flex justify-end">
                  <ErpButton
                    label="ثبت ردیف بانکی"
                    disabled={
                      !bankLine.financialAccountId ||
                      (bankLine.adapterType === "MANUAL"
                        ? !bankLine.sourceIdentity ||
                          !bankLine.bookedAt ||
                          !bankLine.amountRials ||
                          !bankLine.description
                        : !bankLine.rawRecord)
                    }
                    onClick={() =>
                      void run(
                        async () =>
                          accountingAPI.importBankStatementLine(
                            bankLine.adapterType === "MANUAL"
                              ? {
                                  ...bankLine,
                                  mappingVersion: Number(
                                    bankLine.mappingVersion,
                                  ),
                                  bookedAt: new Date(
                                    bankLine.bookedAt,
                                  ).toISOString(),
                                  evidence: {
                                    sourceIdentity: bankLine.sourceIdentity,
                                    description: bankLine.description,
                                    amountRials: bankLine.amountRials,
                                    direction: bankLine.direction,
                                  },
                                }
                              : {
                                  financialAccountId:
                                    bankLine.financialAccountId,
                                  adapterType: bankLine.adapterType,
                                  mappingVersion: Number(
                                    bankLine.mappingVersion,
                                  ),
                                  evidence: {
                                    rawRecord: JSON.parse(bankLine.rawRecord),
                                  },
                                },
                          ),
                        "ردیف بانکی با نگاشت نسخه‌دار ثبت شد.",
                      )
                    }
                  />
                </div>
              </div>
            )}
            {data.bankLines.length ? (
              <div className="grid gap-3">
                {data.bankLines.map((row: any) => (
                  <ErpCard key={row.id} className="p-4">
                    <div className="flex flex-wrap justify-between gap-3">
                      <strong>{row.description}</strong>
                      <strong>{money(row.amountRials, "IRR")}</strong>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--sds-text-secondary)]">
                      <span>{dateFa(row.bookedAt)}</span>
                      <span>
                        منبع {adapterTypeFa[row.adapterType] || "بانکی"}، نگاشت
                        نسخه{" "}
                        {Number(row.mappingVersion).toLocaleString("fa-IR")}
                      </span>
                      <span>
                        {Number(row.matches.length).toLocaleString("fa-IR")}{" "}
                        تطبیق
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ErpButton
                        label="یافتن تطبیق"
                        variant="outline"
                        onClick={() =>
                          void run(
                            () => accountingAPI.proposeBankMatches(row.id),
                            "پیشنهادهای تطبیق بازسازی شدند.",
                          )
                        }
                      />
                      {row.matches.map((match: any) =>
                        match.status === "PROPOSED" ? (
                          <ErpButton
                            key={match.id}
                            label="تأیید پیشنهاد"
                            tone="success"
                            variant="outline"
                            disabled={matchReason.trim().length < 8}
                            onClick={() =>
                              void run(
                                () =>
                                  accountingAPI.confirmBankMatch(
                                    match.id,
                                    matchReason,
                                  ),
                                "تطبیق بانکی قطعی شد.",
                              )
                            }
                          />
                        ) : match.status === "CONFIRMED" ? (
                          <ErpButton
                            key={match.id}
                            label="برگشت تطبیق"
                            tone="danger"
                            variant="outline"
                            disabled={matchReason.trim().length < 8}
                            onClick={() =>
                              void run(
                                () =>
                                  accountingAPI.reverseBankMatch(
                                    match.id,
                                    matchReason,
                                  ),
                                "تطبیق بانکی برگشت خورد.",
                              )
                            }
                          />
                        ) : null,
                      )}
                    </div>
                  </ErpCard>
                ))}
              </div>
            ) : (
              <ErpEmptyState title="ردیف بانکی وارد نشده است" />
            )}
          </ErpSection>
          <ErpSection
            title="چک، صندوق و تنخواه"
            description="هویت چک، تحویل‌دار، کسری یا اضافه صندوق و تسویه تنخواه با شاهد و سند مرتبط نگهداری می‌شود."
          >
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>ثبت چک دریافتنی</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="مشتری" required>
                    <ErpSelect
                      value={check.profileId}
                      onChange={(event) =>
                        setCheck({ ...check, profileId: event.target.value })
                      }
                    >
                      <option value="">انتخاب مشتری</option>
                      {customerAccounts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.displayName}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="شناسه صیاد">
                    <ErpInput
                      value={check.sayadId}
                      onChange={(event) =>
                        setCheck({ ...check, sayadId: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="شماره سریال" required>
                    <ErpInput
                      value={check.serialNumber}
                      onChange={(event) =>
                        setCheck({ ...check, serialNumber: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="بانک" required>
                    <ErpInput
                      value={check.bankName}
                      onChange={(event) =>
                        setCheck({ ...check, bankName: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="مبلغ ریال" required>
                    <ErpInput
                      inputMode="numeric"
                      value={check.amountRials}
                      onChange={(event) =>
                        setCheck({ ...check, amountRials: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="سررسید" required>
                    <ErpInput
                      type="datetime-local"
                      value={check.dueAt}
                      onChange={(event) =>
                        setCheck({ ...check, dueAt: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="شناسه تحویل‌دار">
                    <ErpInput
                      value={check.custodianId}
                      onChange={(event) =>
                        setCheck({ ...check, custodianId: event.target.value })
                      }
                    />
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت چک"
                    disabled={
                      !check.profileId ||
                      !check.serialNumber ||
                      !check.bankName ||
                      !check.amountRials ||
                      !check.dueAt
                    }
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.createReceivableCheck({
                            ...check,
                            legalEntityId: data.ledger?.legalEntity?.id,
                            dueAt: new Date(check.dueAt).toISOString(),
                            sayadId: check.sayadId || undefined,
                            custodianId: check.custodianId || undefined,
                            evidence: {
                              serialNumber: check.serialNumber,
                              sayadId: check.sayadId || null,
                            },
                          }),
                        "چک دریافتنی ثبت شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>رویداد چک</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="وضعیت بعدی">
                    <ErpSelect
                      value={checkEvent.nextStatus}
                      onChange={(event) =>
                        setCheckEvent({
                          ...checkEvent,
                          nextStatus: event.target.value,
                        })
                      }
                    >
                      <option value="ENDORSED">پشت‌نویسی</option>
                      <option value="ASSIGNED">واگذاری</option>
                      <option value="DEPOSITED">واگذاری به بانک</option>
                      <option value="CLEARED">وصول</option>
                      <option value="BOUNCED">برگشت بانکی</option>
                      <option value="RETURNED">عودت</option>
                      <option value="REPLACED">جایگزینی</option>
                      <option value="CANCELLED">ابطال</option>
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="زمان رویداد" required>
                    <ErpInput
                      type="datetime-local"
                      value={checkEvent.occurredAt}
                      onChange={(event) =>
                        setCheckEvent({
                          ...checkEvent,
                          occurredAt: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="تحویل‌دار جدید">
                    <ErpInput
                      value={checkEvent.toCustodianId}
                      onChange={(event) =>
                        setCheckEvent({
                          ...checkEvent,
                          toCustodianId: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="نسخه قاعده ثبت">
                    <ErpInput
                      inputMode="numeric"
                      value={checkEvent.postingRuleVersion}
                      onChange={(event) =>
                        setCheckEvent({
                          ...checkEvent,
                          postingRuleVersion: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="شناسه سند قطعی">
                    <ErpInput
                      value={checkEvent.ledgerVoucherId}
                      onChange={(event) =>
                        setCheckEvent({
                          ...checkEvent,
                          ledgerVoucherId: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                </div>
              </ErpCard>
            )}
            <div className="mb-4 grid gap-3">
              {data.checks.map((row: any) => (
                <ErpCard key={row.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>
                        {row.bankName} · {row.serialNumber}
                      </strong>
                      <span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">
                        {money(row.amountRials, "IRR")} · سررسید{" "}
                        {dateFa(row.dueAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ErpBadge tone="info">
                        {checkStatusFa[row.status] || "نیازمند بررسی"}
                      </ErpBadge>
                      <ErpButton
                        label="ثبت رویداد"
                        variant="outline"
                        disabled={!checkEvent.occurredAt}
                        onClick={() =>
                          void run(
                            () =>
                              accountingAPI.transitionReceivableCheck(row.id, {
                                ...checkEvent,
                                occurredAt: new Date(
                                  checkEvent.occurredAt,
                                ).toISOString(),
                                postingRuleVersion: Number(
                                  checkEvent.postingRuleVersion,
                                ),
                                ledgerVoucherId:
                                  checkEvent.ledgerVoucherId || undefined,
                                fromCustodianId: row.custodianId || undefined,
                                toCustodianId:
                                  checkEvent.toCustodianId || undefined,
                                evidence: {
                                  status: checkEvent.nextStatus,
                                  occurredAt: checkEvent.occurredAt,
                                },
                              }),
                            "رویداد چک ثبت شد.",
                          )
                        }
                      />
                    </div>
                  </div>
                </ErpCard>
              ))}
            </div>
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>شمارش صندوق</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی" required>
                    <ErpSelect
                      value={cashCount.financialAccountId}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          financialAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب صندوق</option>
                      {data.ledger?.financialAccounts?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.titlePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="شناسه تحویل‌دار" required>
                    <ErpInput
                      value={cashCount.custodianId}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          custodianId: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="زمان شمارش" required>
                    <ErpInput
                      type="datetime-local"
                      value={cashCount.countedAt}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          countedAt: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="مانده مورد انتظار" required>
                    <ErpInput
                      inputMode="numeric"
                      value={cashCount.expectedRials}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          expectedRials: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="مبلغ شمارش‌شده" required>
                    <ErpInput
                      inputMode="numeric"
                      value={cashCount.countedRials}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          countedRials: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="سند کسری یا اضافه">
                    <ErpInput
                      value={cashCount.ledgerVoucherId}
                      onChange={(event) =>
                        setCashCount({
                          ...cashCount,
                          ledgerVoucherId: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت شمارش"
                    disabled={
                      !cashCount.financialAccountId ||
                      !cashCount.custodianId ||
                      !cashCount.countedAt ||
                      !cashCount.expectedRials ||
                      !cashCount.countedRials
                    }
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.recordCashCount({
                            ...cashCount,
                            cashCountId: crypto.randomUUID(),
                            countedAt: new Date(
                              cashCount.countedAt,
                            ).toISOString(),
                            ledgerVoucherId:
                              cashCount.ledgerVoucherId || undefined,
                            evidence: {
                              expectedRials: cashCount.expectedRials,
                              countedRials: cashCount.countedRials,
                            },
                          }),
                        "شمارش صندوق ثبت شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>پرداخت تنخواه</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی" required>
                    <ErpSelect
                      value={petty.financialAccountId}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          financialAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.financialAccounts?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.titlePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="شناسه امین" required>
                    <ErpInput
                      value={petty.custodianId}
                      onChange={(event) =>
                        setPetty({ ...petty, custodianId: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="شناسه مرکز هزینه" required>
                    <ErpInput
                      value={petty.costCenterId}
                      onChange={(event) =>
                        setPetty({ ...petty, costCenterId: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="مبلغ" required>
                    <ErpInput
                      inputMode="numeric"
                      value={petty.amountRials}
                      onChange={(event) =>
                        setPetty({ ...petty, amountRials: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="سقف مصوب" required>
                    <ErpInput
                      inputMode="numeric"
                      value={petty.limitRials}
                      onChange={(event) =>
                        setPetty({ ...petty, limitRials: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="تاریخ پرداخت" required>
                    <ErpInput
                      type="datetime-local"
                      value={petty.issuedAt}
                      onChange={(event) =>
                        setPetty({ ...petty, issuedAt: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="سررسید تسویه" required>
                    <ErpInput
                      type="datetime-local"
                      value={petty.settlementDueAt}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          settlementDueAt: event.target.value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="دفتر" required>
                    <ErpSelect
                      value={petty.bookId}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          bookId: event.target.value,
                          fiscalYearId: "",
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب دفتر</option>
                      {data.ledger?.books?.map((item: any) => (
                        <option key={item.id} value={item.id}>
                          {item.namePersian}
                        </option>
                      ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSelect
                      value={petty.fiscalYearId}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          fiscalYearId: event.target.value,
                          periodId: "",
                        })
                      }
                    >
                      <option value="">انتخاب سال</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === petty.bookId)
                        ?.fiscalYears?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSelect
                      value={petty.periodId}
                      onChange={(event) =>
                        setPetty({ ...petty, periodId: event.target.value })
                      }
                    >
                      <option value="">انتخاب دوره</option>
                      {data.ledger?.books
                        ?.find((item: any) => item.id === petty.bookId)
                        ?.fiscalYears?.find(
                          (item: any) => item.id === petty.fiscalYearId,
                        )
                        ?.periods?.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب نقد" required>
                    <ErpSelect
                      value={petty.cashLedgerId}
                      onChange={(event) =>
                        setPetty({ ...petty, cashLedgerId: event.target.value })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter(
                          (item: any) =>
                            item.level === "MOIN" &&
                            item.financialAccountRequirement === "REQUIRED",
                        )
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                  <ErpField label="حساب تنخواه" required>
                    <ErpSelect
                      value={petty.pettyCashAdvanceLedgerId}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          pettyCashAdvanceLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {data.ledger?.accounts
                        ?.filter((item: any) => item.level === "MOIN")
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSelect>
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="پرداخت تنخواه"
                    disabled={Object.values(petty).some((value) => !value)}
                    onClick={() =>
                      void run(
                        () =>
                          accountingAPI.issuePettyCashAdvance({
                            ...petty,
                            issuedAt: new Date(petty.issuedAt).toISOString(),
                            settlementDueAt: new Date(
                              petty.settlementDueAt,
                            ).toISOString(),
                            supportingEvidence: {
                              custodianId: petty.custodianId,
                              costCenterId: petty.costCenterId,
                            },
                            idempotencyKey: crypto.randomUUID(),
                            correlationId: crypto.randomUUID(),
                          }),
                        "تنخواه پرداخت و ثبت قطعی شد.",
                      )
                    }
                  />
                </div>
              </ErpCard>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <ErpField label="سند قطعی تسویه تنخواه">
                <ErpInput
                  value={pettySettlement.ledgerVoucherId}
                  onChange={(event) =>
                    setPettySettlement({
                      ...pettySettlement,
                      ledgerVoucherId: event.target.value,
                    })
                  }
                />
              </ErpField>
              <ErpField label="زمان تسویه">
                <ErpInput
                  type="datetime-local"
                  value={pettySettlement.settledAt}
                  onChange={(event) =>
                    setPettySettlement({
                      ...pettySettlement,
                      settledAt: event.target.value,
                    })
                  }
                />
              </ErpField>
            </div>
            <div className="mt-3 grid gap-3">
              {data.pettyCash.map((row: any) => (
                <ErpCard key={row.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>تنخواه {money(row.amountRials, "IRR")}</strong>
                      <span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">
                        امین {row.custodianId} · سررسید{" "}
                        {dateFa(row.settlementDueAt)}
                      </span>
                    </div>
                    {row.status === "OPEN" ? (
                      <ErpButton
                        label="ثبت تسویه"
                        variant="outline"
                        disabled={
                          !pettySettlement.ledgerVoucherId ||
                          !pettySettlement.settledAt
                        }
                        onClick={() =>
                          void run(
                            () =>
                              accountingAPI.settlePettyCashAdvance(row.id, {
                                ledgerVoucherId:
                                  pettySettlement.ledgerVoucherId,
                                settledRials: row.amountRials,
                                settledAt: new Date(
                                  pettySettlement.settledAt,
                                ).toISOString(),
                                evidence: {
                                  advanceId: row.id,
                                  amountRials: row.amountRials,
                                },
                              }),
                            "تنخواه با سند قطعی تسویه شد.",
                          )
                        }
                      />
                    ) : (
                      <ErpBadge tone="success">تسویه‌شده</ErpBadge>
                    )}
                  </div>
                </ErpCard>
              ))}
            </div>
          </ErpSection>
        </>
      )}
    </ErpPage>
  );
}
