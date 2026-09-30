"use client";
import { ErpPersianDateField } from "@/components/erp";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ErpPagination,
  ErpSection,
  ErpSegmentedControl,
  ErpSearchableSelect,
} from "@/components/erp";
import { accountingAPI } from "@/lib/api";
import { treasuryLedgerAccounts } from '@/features/accounting/treasuryLedgerAccounts';
import { parseBankApiRecord } from '@/features/accounting/bankStatementInput';
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
  const [workspaceTab, setWorkspaceTab] = useState("bank");
  const [receiptTab, setReceiptTab] = useState("receipt");
  const [bankTab, setBankTab] = useState("import");
  const [bankLinePage, setBankLinePage] = useState(1);
  const [cashTab, setCashTab] = useState("checks");
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ scope: string; kind: "success" | "error"; title: string }>();
  const [actionPending, setActionPending] = useState(false);
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
  const [bankFile, setBankFile] = useState<File | null>(null);
  const bankFileInput = useRef<HTMLInputElement>(null);
  const [exceptionCorrections, setExceptionCorrections] = useState<Record<string, {
    runId: string; rowNumber: string; reason: string; attestUnlinkedCorrection: boolean;
  }>>({});
  const updateExceptionCorrection = (id: string, change: Partial<{ runId: string; rowNumber: string;
    reason: string; attestUnlinkedCorrection: boolean }>) => setExceptionCorrections((current) => {
    const previous = current[id] ?? { runId: "", rowNumber: "", reason: "", attestUnlinkedCorrection: false };
    return { ...current, [id]: { ...previous, ...change } };
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
  const run = async (operation: () => Promise<unknown>, success: string, scope: string) => {
    if (actionPending) return;
    setActionPending(true); setActionFeedback(undefined);
    try { await operation(); setActionFeedback({ scope, kind: "success", title: success }); await load(true); }
    catch (reason) { const local = reason instanceof Error && /[\u0600-\u06ff]/.test(reason.message) ? reason.message : "عملیات خزانه‌داری انجام نشد."; setActionFeedback({ scope, kind: "error", title: accountingFailureMessage(reason, local) }); }
    finally { setActionPending(false); }
  };
  const load = useCallback(async (background = false) => {
    const sequence = ++loadSequence.current;
    if (!background) setLoading(true);
    setError(null);
    try {
      const [overview, context, customers] = await Promise.all([
        accountingAPI.getTreasuryOverview(bankLinePage),
        accountingAPI.getLedgerContext(),
        accountingAPI.getCustomerAccounts(),
      ]);
      if (sequence !== loadSequence.current) return;
      setData({ ...overview.data.data, ledger: context.data.data });
      setCustomerAccounts(customers.data.data);
    } catch (reason) {
      if (sequence !== loadSequence.current) return;
      setError(
        accountingFailureMessage(reason, "نمای کنترل خزانه‌داری بارگیری نشد."),
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [bankLinePage]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <ErpPage
      eyebrow="خزانه‌داری"
      title="کنترل خزانه‌داری"
      description="دریافت، ردیف بانکی، تطبیق، چک، شمارش صندوق و تنخواه با هویت و سابقه مستقل نمایش داده می‌شوند."
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: () => load() }]}
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

      {data && (
        <>
          <ErpSegmentedControl value={workspaceTab} onChange={setWorkspaceTab} options={[{ value: "bank", label: "صورتحساب و تطبیق بانک" }, { value: "receipts", label: "دریافت و تخصیص" }, { value: "cash", label: "چک، صندوق و تنخواه" }]} />
          <ErpSection className={workspaceTab === "receipts" ? "" : "hidden"} title="دریافت‌ها و تخصیص‌ها"
            description="وجه تا زمان تخصیص قطعی، بستانکاری تخصیص‌نیافته همان مشتری باقی می‌ماند."
          ><ErpSegmentedControl value={receiptTab} onChange={setReceiptTab} options={[{"value":"receipt","label":"ثبت دریافت"},{"value":"allocation","label":"تخصیص دریافت"},{"value":"transfer","label":"انتقال داخلی"}]} />
            {data.capabilities?.canManage && (
              <ErpCard className={receiptTab === "receipt" ? "mb-4 p-4" : "hidden"}>
                <strong>ثبت دریافت مشتری</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="مشتری" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
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
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="دفتر" required>
                    <ErpSearchableSelect
                      value={receipt.bookId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          bookId: event.target.value,
                          bankAccountLedgerId: "",
                          customerAdvanceLedgerId: "",
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب بانک در دفترکل" required>
                    <ErpSearchableSelect
                      value={receipt.bankAccountLedgerId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          bankAccountLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, receipt.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب پیش‌دریافت مشتری" required>
                    <ErpSearchableSelect
                      value={receipt.customerAdvanceLedgerId}
                      onChange={(event) =>
                        setReceipt({
                          ...receipt,
                          customerAdvanceLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, receipt.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="مبلغ ریال" required>
                    <ErpInput numberFormat="money"
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
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={receipt.occurredAt}
                      onChange={(value) =>
                        setReceipt({
                          ...receipt,
                          occurredAt: value,
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
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت دریافت قطعی"
                    disabled={actionPending || ([
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
                    ].some((key) => !receipt[key as keyof typeof receipt]))}
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
                        "دریافت مشتری با بستانکاری تخصیص‌نیافته ثبت شد.", "treasury-1"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-1" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className={receiptTab === "allocation" ? "mb-4 p-4" : "hidden"}>
                <strong>تخصیص دریافت به قلم باز</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="دریافت" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="قلم باز" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="مبلغ تخصیص" required>
                    <ErpInput numberFormat="money"
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
                    <ErpSearchableSelect
                      value={allocation.bookId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          bookId: event.target.value,
                          customerAdvanceLedgerId: "",
                          receivableLedgerId: "",
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب پیش‌دریافت" required>
                    <ErpSearchableSelect
                      value={allocation.customerAdvanceLedgerId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          customerAdvanceLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, allocation.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب دریافتنی" required>
                    <ErpSearchableSelect
                      value={allocation.receivableLedgerId}
                      onChange={(event) =>
                        setAllocation({
                          ...allocation,
                          receivableLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, allocation.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="تاریخ سند" required>
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={allocation.documentDate}
                      onChange={(value) =>
                        setAllocation({
                          ...allocation,
                          documentDate: value,
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
                    disabled={actionPending || ([
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
                    ))}
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
                        "تخصیص دریافت قطعی شد.", "treasury-2"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-2" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className={receiptTab === "transfer" ? "mb-4 p-4" : "hidden"}>
                <strong>انتقال داخلی میان حساب‌های مالی</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی مبدأ" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب مالی مقصد" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="مبلغ ریال" required>
                    <ErpInput numberFormat="money"
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
                    <ErpSearchableSelect
                      value={transfer.bookId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          bookId: event.target.value,
                          fromLedgerAccountId: "",
                          toLedgerAccountId: "",
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب دفترکل مبدأ" required>
                    <ErpSearchableSelect
                      value={transfer.fromLedgerAccountId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          fromLedgerAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, transfer.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب دفترکل مقصد" required>
                    <ErpSearchableSelect
                      value={transfer.toLedgerAccountId}
                      onChange={(event) =>
                        setTransfer({
                          ...transfer,
                          toLedgerAccountId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, transfer.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="زمان انتقال" required>
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={transfer.occurredAt}
                      onChange={(value) =>
                        setTransfer({
                          ...transfer,
                          occurredAt: value,
                        })
                      }
                    />
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="ثبت انتقال داخلی"
                    disabled={actionPending || (Object.values(transfer).some((value) => !value))}
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
                        "انتقال داخلی با دو اثر خزانه‌ای ثبت شد.", "treasury-3"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-3" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
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
                              actionPending || (!allocation.reason ||
                              !allocation.documentDate ||
                              !allocation.bookId ||
                              !allocation.fiscalYearId ||
                              !allocation.periodId ||
                              !allocation.customerAdvanceLedgerId ||
                              !allocation.receivableLedgerId)
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
                                "تخصیص با سند مستقل برگشت خورد.", ("treasury-4" + String(row.id))
                              )
                            }
                          />
                        </div>
                      ))}
                  {actionFeedback?.scope === ("treasury-4" + String(row.id)) && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
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
          <ErpSection className={workspaceTab === "bank" ? "" : "hidden"} title="صورتحساب بانکی و تطبیق"
            description="پیشنهاد خودکار تا تأیید صریح اثر قطعی ندارد و برگشت تطبیق در تاریخچه حفظ می‌شود."
          ><ErpSegmentedControl value={bankTab} onChange={setBankTab} options={[{"value":"import","label":"ورود و تطبیق صورتحساب"},{"value":"mapping","label":"نگاشت منبع بانک"}]} />
            {data.capabilities?.canConfigure && (
              <ErpCard className={bankTab === "mapping" ? "mb-4 p-4" : "hidden"}>
                <strong>نگاشت نسخه‌دار منبع بانکی</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="مسیر ورود">
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
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
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={bankMapping.effectiveFrom}
                      onChange={(value) =>
                        setBankMapping({
                          ...bankMapping,
                          effectiveFrom: value,
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
                      actionPending || (!bankMapping.financialAccountId ||
                      !bankMapping.effectiveFrom)
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
                        "نگاشت بانکی نسخه‌دار ثبت شد.", "treasury-5"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-5" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className={bankTab === "import" ? "mb-4 min-w-0 p-4" : "hidden"}><h3 className="mb-3 font-semibold">ورود صورتحساب بانک</h3><div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
                <ErpField label="حساب مالی" required>
                  <ErpSearchableSelect
                    value={bankLine.financialAccountId}
                    onChange={(event) =>
                      setBankLine({
                        ...bankLine,
                        financialAccountId: event.target.value,
                        mappingVersion: bankLine.adapterType === "MANUAL" ? "1" : "",
                      })
                    }
                  >
                    <option value="">انتخاب حساب</option>
                    {data.ledger?.financialAccounts?.map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.titlePersian}
                      </option>
                    ))}
                  </ErpSearchableSelect>
                </ErpField>
                <ErpField label="مسیر ورود">
                  <ErpSearchableSelect
                    value={bankLine.adapterType}
                    onChange={(event) =>
                      setBankLine({
                        ...bankLine,
                        adapterType: event.target.value,
                        mappingVersion: event.target.value === "MANUAL" ? "1" : "",
                      })
                    }
                  >
                    <option value="API">رابط بانکی</option>
                    <option value="CSV">فایل CSV</option>
                    <option value="XLSX">فایل اکسل</option>
                    <option value="MANUAL">ورود کنترل‌شده دستی</option>
                  </ErpSearchableSelect>
                </ErpField>
                <ErpField label="نسخه نگاشت" required>
                  {bankLine.adapterType === "MANUAL" ? (
                    <ErpInput inputMode="numeric" value={bankLine.mappingVersion}
                      onChange={(event) => setBankLine({ ...bankLine, mappingVersion: event.target.value })} />
                  ) : (
                    <ErpSearchableSelect value={bankLine.mappingVersion}
                      onChange={(event) => setBankLine({ ...bankLine, mappingVersion: event.target.value })}>
                      <option value="">انتخاب نگاشت</option>
                      {data.bankMappings?.filter((item: any) => item.financialAccountId === bankLine.financialAccountId && item.adapterType === bankLine.adapterType)
                        .map((item: any) => <option key={item.id} value={item.version}>نسخه {Number(item.version).toLocaleString("fa-IR")}</option>)}
                    </ErpSearchableSelect>
                  )}
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
                      <ErpPersianDateField
                        valueFormat="local-datetime"
                        value={bankLine.bookedAt}
                        onChange={(value) =>
                          setBankLine({
                            ...bankLine,
                            bookedAt: value,
                          })
                        }
                      />
                    </ErpField>
                    <ErpField label="مبلغ ریال" required>
                      <ErpInput numberFormat="money"
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
                      <ErpSearchableSelect
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
                      </ErpSearchableSelect>
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
                ) : bankLine.adapterType === "API" ? (
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
                ) : (
                  <div className="min-w-0">
                    <ErpInput
                      ref={bankFileInput}
                      className="hidden"
                      type="file"
                      accept={bankLine.adapterType === "CSV" ? ".csv,text/csv" : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
                      onChange={(event) => {
                        setBankFile(event.target.files?.[0] || null);
                      }}
                    />
                    <ErpField label="فایل صورت‌حساب بانک" hint="حداکثر ۲ مگابایت و ۱۰۰۰ ردیف؛ تاریخ باید به شکل 2026-09-25T08:00:00Z و مبلغ به ریالِ بدون جداکننده باشد." required>
                      <ErpButton label={bankFile ? "تغییر فایل بانکی" : "انتخاب فایل بانکی"} variant="outline"
                        disabled={actionPending} onClick={() => bankFileInput.current?.click()} />
                    </ErpField>
                    {bankFile && <span className="block break-all text-sm">{bankFile.name}</span>}
                  </div>
                )}
                <div className="md:col-span-3 flex justify-end">
                  <ErpButton
                    label={bankLine.adapterType === "CSV" || bankLine.adapterType === "XLSX" ? "ورود فایل بانکی" : "ثبت ردیف بانکی"}
                    disabled={
                      actionPending || (!bankLine.financialAccountId ||
                      !bankLine.mappingVersion ||
                      (bankLine.adapterType === "MANUAL"
                        ? !bankLine.sourceIdentity ||
                          !bankLine.bookedAt ||
                          !bankLine.amountRials ||
                          !bankLine.description
                        : bankLine.adapterType === "API" ? !bankLine.rawRecord : !bankFile))
                    }
                    onClick={() =>
                      void run(
                        async () => {
                          if (bankLine.adapterType === "CSV" || bankLine.adapterType === "XLSX") {
                            if (!bankFile || bankFile.size > 2_000_000) throw new Error("فایل بانکی باید حداکثر ۲ مگابایت باشد.");
                            const fileBase64 = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
                              reader.onerror = () => reject(new Error("خواندن فایل بانکی ممکن نشد."));
                              reader.readAsDataURL(bankFile);
                            });
                            await accountingAPI.importBankStatementFile({
                              financialAccountId: bankLine.financialAccountId,
                              adapterType: bankLine.adapterType,
                              mappingVersion: Number(bankLine.mappingVersion),
                              fileBase64,
                            });
                            return;
                          }
                          await accountingAPI.importBankStatementLine(
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
                                    rawRecord: parseBankApiRecord(bankLine.rawRecord),
                                  },
                                },
                          );
                        },
                        bankLine.adapterType === "CSV" || bankLine.adapterType === "XLSX"
                          ? "پردازش فایل بانکی پایان یافت؛ نتیجه هر ردیف را بررسی کنید."
                          : "ردیف بانکی با نگاشت نسخه‌دار ثبت شد.", "treasury-6"
                      )
                    }
                  />
                </div>
              </div>
{actionFeedback?.scope === "treasury-6" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
            )}
            {data.bankFileImports?.length > 0 && (
              <div className="mb-4 grid gap-3">
                {data.bankFileImports.map((item: any) => (
                  <ErpCard key={item.id} className="p-4">
                    <strong>گزارش ورود فایل بانکی</strong>
                    <p>ثبت‌شده: {Number(item.imported).toLocaleString("fa-IR")}، ردشده: {Number(item.rejected).toLocaleString("fa-IR")}</p>
                    <p className="break-all text-sm">اثر انگشت فایل: {item.fileHash}</p>
                    {item.results?.filter((row: any) => row.status === "REJECTED").map((row: any) => (
                      <p key={row.rowNumber}>ردیف {Number(row.rowNumber).toLocaleString("fa-IR")}: {row.reason}</p>
                    ))}
                  </ErpCard>
                ))}
              </div>
            )}
            {data.bankExceptions?.length > 0 && (
              <ErpCard className="mb-4 p-4">
                <strong>استثناهای باز صورتحساب بانک</strong>
                {data.bankExceptions.map((item: any) => {
                  const correction = exceptionCorrections[item.id] || { runId: "", rowNumber: "", reason: "", attestUnlinkedCorrection: false };
                  return (
                  <div key={item.id} className="mt-3 grid gap-2 border-t border-[var(--sds-border-default)] pt-3">
                    <p className="text-sm">{item.messagePersian} · مسئول: حسابدار · {dateFa(item.createdAt)}</p>
                    {data.capabilities?.canManage && (
                      <div className="grid gap-2 md:grid-cols-4">
                        <ErpField label="فایل اصلاح‌شده">
                          <ErpSearchableSelect value={correction.runId}
                            onChange={(event) => updateExceptionCorrection(item.id, { runId: event.target.value })}>
                            <option value="">انتخاب فایل</option>
                            {data.bankFileChoices?.filter((run: any) => run.financialAccountId === item.sourceId.split(":")[0]).map((run: any) => (
                              <option key={run.id} value={run.id}>{run.fileHash.slice(0, 12)} · نسخه {run.mappingVersion} · {dateFa(run.createdAt)}</option>
                            ))}
                          </ErpSearchableSelect>
                        </ErpField>
                        <ErpField label="شماره ردیف اصلاح‌شده">
                          <ErpInput inputMode="numeric" value={correction.rowNumber}
                            onChange={(event) => updateExceptionCorrection(item.id, { rowNumber: event.target.value })} />
                        </ErpField>
                        <ErpField label="دلیل رفع استثنا">
                          <ErpInput value={correction.reason}
                            onChange={(event) => updateExceptionCorrection(item.id, { reason: event.target.value })} />
                        </ErpField>
                        {data.capabilities?.canConfigure && (
                          <ErpField label="روش پیوند ردیف">
                            <ErpSearchableSelect value={correction.attestUnlinkedCorrection ? "ATTESTED" : "SOURCE"}
                              onChange={(event) => updateExceptionCorrection(item.id, { attestUnlinkedCorrection: event.target.value === "ATTESTED" })}>
                              <option value="SOURCE">شناسه یا ردیف منبع یکسان</option>
                              <option value="ATTESTED">تأیید مدیر برای ردیف بدون شناسه</option>
                            </ErpSearchableSelect>
                          </ErpField>
                        )}
                        <div className="flex items-end">
                          <ErpButton label="ثبت رفع استثنا" disabled={actionPending || (!correction.runId || !correction.rowNumber || correction.reason.trim().length < (correction.attestUnlinkedCorrection ? 20 : 8))}
                            onClick={() => void run(() => accountingAPI.resolveBankFileException(item.id, {
                              correctedRunId: correction.runId, correctedRowNumber: Number(correction.rowNumber),
                              reason: correction.reason, attestUnlinkedCorrection: correction.attestUnlinkedCorrection,
                            }), "رفع استثنا با ردیف فایل اصلاح‌شده ثبت شد.", "treasury-7")} />
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
</ErpCard>
            )}
            {actionFeedback?.scope === "treasury-7" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
            <ErpPagination currentPage={bankLinePage} totalPages={Math.max(1, Math.ceil(data.bankLineCount / 100))}
              totalItems={data.bankLineCount} itemsPerPage={100} itemLabel="ردیف بانکی"
              onPageChange={(page) => { if (!actionPending && !loading) setBankLinePage(page); }} />
            {data.bankLines.length ? (
              <div className="grid gap-3">
                {data.capabilities?.canManage && (
                  <ErpField label="دلیل تأیید یا برگشت تطبیق">
                    <ErpInput value={matchReason} onChange={(event) => setMatchReason(event.target.value)} />
                  </ErpField>
                )}
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
                    {data.capabilities?.canManage && <div className="mt-3 flex flex-wrap gap-2">
                      <ErpButton disabled={actionPending}
                        label="یافتن تطبیق"
                        variant="outline"
                        onClick={() =>
                          void run(
                            () => accountingAPI.proposeBankMatches(row.id),
                            "پیشنهادهای تطبیق بازسازی شدند.", ("treasury-8" + String(row.id))
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
                            disabled={actionPending || (matchReason.trim().length < 8)}
                            onClick={() =>
                              void run(
                                () =>
                                  accountingAPI.confirmBankMatch(
                                    match.id,
                                    matchReason,
                                  ),
                                "تطبیق بانکی قطعی شد.", ("treasury-8" + String(row.id))
                              )
                            }
                          />
                        ) : match.status === "CONFIRMED" ? (
                          <ErpButton
                            key={match.id}
                            label="برگشت تطبیق"
                            tone="danger"
                            variant="outline"
                            disabled={actionPending || (matchReason.trim().length < 8)}
                            onClick={() =>
                              void run(
                                () =>
                                  accountingAPI.reverseBankMatch(
                                    match.id,
                                    matchReason,
                                  ),
                                "تطبیق بانکی برگشت خورد.", ("treasury-8" + String(row.id))
                              )
                            }
                          />
                        ) : null,
                      )}
                    </div>}
                  {actionFeedback?.scope === ("treasury-8" + String(row.id)) && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
                ))}
              </div>
            ) : (
              <ErpEmptyState title="ردیف بانکی وارد نشده است" />
            )}

</ErpSection>
          <ErpSection className={workspaceTab === "cash" ? "" : "hidden"} title="چک، صندوق و تنخواه"
            description="هویت چک، تحویل‌دار، کسری یا اضافه صندوق و تسویه تنخواه با شاهد و سند مرتبط نگهداری می‌شود."
          ><ErpSegmentedControl value={cashTab} onChange={setCashTab} options={[{"value":"checks","label":"چک‌ها"},{"value":"count","label":"شمارش صندوق"},{"value":"petty","label":"تنخواه"}]} />
            {data.capabilities?.canManage && (
              <ErpCard className={cashTab === "checks" ? "mb-4 p-4" : "hidden"}>
                <strong>ثبت چک دریافتنی</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="مشتری" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
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
                    <ErpInput numberFormat="money"
                      inputMode="numeric"
                      value={check.amountRials}
                      onChange={(event) =>
                        setCheck({ ...check, amountRials: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="سررسید" required>
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={check.dueAt}
                      onChange={(value) =>
                        setCheck({ ...check, dueAt: value })
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
                      actionPending || (!check.profileId ||
                      !check.serialNumber ||
                      !check.bankName ||
                      !check.amountRials ||
                      !check.dueAt)
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
                        "چک دریافتنی ثبت شد.", "treasury-9"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-9" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className="mb-4 p-4">
                <strong>رویداد چک</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="وضعیت بعدی">
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="زمان رویداد" required>
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={checkEvent.occurredAt}
                      onChange={(value) =>
                        setCheckEvent({
                          ...checkEvent,
                          occurredAt: value,
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
                <ErpCard key={row.id} className={cashTab === "checks" ? "p-4" : "hidden"}>
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
                        disabled={actionPending || (!checkEvent.occurredAt)}
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
                            "رویداد چک ثبت شد.", ("treasury-10" + String(row.id))
                          )
                        }
                      />
                    </div>
                  </div>
                {actionFeedback?.scope === ("treasury-10" + String(row.id)) && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
              ))}
            </div>
            {data.capabilities?.canManage && (
              <ErpCard className={cashTab === "count" ? "mb-4 p-4" : "hidden"}>
                <strong>شمارش صندوق</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
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
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={cashCount.countedAt}
                      onChange={(value) =>
                        setCashCount({
                          ...cashCount,
                          countedAt: value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="مانده مورد انتظار" required>
                    <ErpInput numberFormat="money"
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
                    <ErpInput numberFormat="money"
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
                      actionPending || (!cashCount.financialAccountId ||
                      !cashCount.custodianId ||
                      !cashCount.countedAt ||
                      !cashCount.expectedRials ||
                      !cashCount.countedRials)
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
                        "شمارش صندوق ثبت شد.", "treasury-11"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-11" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
            )}
            {data.capabilities?.canManage && (
              <ErpCard className={cashTab === "petty" ? "mb-4 p-4" : "hidden"}>
                <strong>پرداخت تنخواه</strong>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ErpField label="حساب مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
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
                    <ErpInput numberFormat="money"
                      inputMode="numeric"
                      value={petty.amountRials}
                      onChange={(event) =>
                        setPetty({ ...petty, amountRials: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="سقف مصوب" required>
                    <ErpInput numberFormat="money"
                      inputMode="numeric"
                      value={petty.limitRials}
                      onChange={(event) =>
                        setPetty({ ...petty, limitRials: event.target.value })
                      }
                    />
                  </ErpField>
                  <ErpField label="تاریخ پرداخت" required>
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={petty.issuedAt}
                      onChange={(value) =>
                        setPetty({ ...petty, issuedAt: value })
                      }
                    />
                  </ErpField>
                  <ErpField label="سررسید تسویه" required>
                    <ErpPersianDateField
                      valueFormat="local-datetime"
                      value={petty.settlementDueAt}
                      onChange={(value) =>
                        setPetty({
                          ...petty,
                          settlementDueAt: value,
                        })
                      }
                    />
                  </ErpField>
                  <ErpField label="دفتر" required>
                    <ErpSearchableSelect
                      value={petty.bookId}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          bookId: event.target.value,
                          cashLedgerId: "",
                          pettyCashAdvanceLedgerId: "",
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="سال مالی" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="دوره" required>
                    <ErpSearchableSelect
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب نقد" required>
                    <ErpSearchableSelect
                      value={petty.cashLedgerId}
                      onChange={(event) =>
                        setPetty({ ...petty, cashLedgerId: event.target.value })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, petty.bookId)
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
                    </ErpSearchableSelect>
                  </ErpField>
                  <ErpField label="حساب تنخواه" required>
                    <ErpSearchableSelect
                      value={petty.pettyCashAdvanceLedgerId}
                      onChange={(event) =>
                        setPetty({
                          ...petty,
                          pettyCashAdvanceLedgerId: event.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب حساب</option>
                      {treasuryLedgerAccounts(data.ledger, petty.bookId)
                        ?.filter((item: any) => item.level === "MOIN")
                        .map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.titlePersian}
                          </option>
                        ))}
                    </ErpSearchableSelect>
                  </ErpField>
                </div>
                <div className="mt-3 flex justify-end">
                  <ErpButton
                    label="پرداخت تنخواه"
                    disabled={actionPending || (Object.values(petty).some((value) => !value))}
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
                        "تنخواه پرداخت و ثبت قطعی شد.", "treasury-12"
                      )
                    }
                  />
                </div>
              {actionFeedback?.scope === "treasury-12" && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
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
                <ErpPersianDateField
                  valueFormat="local-datetime"
                  value={pettySettlement.settledAt}
                  onChange={(value) =>
                    setPettySettlement({
                      ...pettySettlement,
                      settledAt: value,
                    })
                  }
                />
              </ErpField>
            </div>
            <div className="mt-3 grid gap-3">
              {data.pettyCash.map((row: any) => (
                <ErpCard key={row.id} className={cashTab === "petty" ? "p-4" : "hidden"}>
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
                          actionPending || (!pettySettlement.ledgerVoucherId ||
                          !pettySettlement.settledAt)
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
                            "تنخواه با سند قطعی تسویه شد.", ("treasury-13" + String(row.id))
                          )
                        }
                      />
                    ) : (
                      <ErpBadge tone="success">تسویه‌شده</ErpBadge>
                    )}
                  </div>
                {actionFeedback?.scope === ("treasury-13" + String(row.id)) && <ErpInlineState kind={actionFeedback.kind} title={actionFeedback.title} />}
</ErpCard>
              ))}
            </div>
          </ErpSection>
        </>
      )}
    </ErpPage>
  );
}
