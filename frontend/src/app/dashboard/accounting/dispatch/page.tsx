"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaBan, FaEye, FaFileAlt, FaFingerprint, FaTruck, FaRedo, FaReply, FaSync, FaWrench } from "react-icons/fa";
import {
  type ErpAction,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpListPage,
  ErpSegmentedControl,
  ErpSheet,
} from "@/components/erp";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import SalesDispatchInvoices from "@/features/accounting/SalesDispatchInvoices";
import { createDispatchDocumentsHttpClient } from "@/features/accounting/dispatch-documents/dispatchDocumentsClient";
import { formatDisplayedMoney, type DispatchDocumentCase } from "@/features/accounting/dispatch-documents/dispatchDocumentsViewModel";
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";
import { biometricAttemptNotice, confirmationActionsFor } from "@/features/biometric/dispatchConfirmationPresentation";
import api, { accountingAPI, dispatchConfirmationAPI } from "@/lib/api";
import { biometricConnectorClient } from "@/lib/biometricConnector";
import { normalizeDigits } from "@/lib/numberFormat";

type DispatchNotice = { kind: "success" | "error"; text: string };
type DispatchSection = "candidates" | "confirmation" | "cases";
type ReasonAction = {
  type: "reject" | "void" | "replace" | "revoke" | "reconstruct";
  id: string;
  invoice?: { id: string; number: string } | null;
  waybillNumber?: string;
  loadingId?: string;
  voidRefreshNotice?: string;
  voidBlocked?: boolean;
  voidRefreshFailed?: boolean;
  idempotencyKey?: string;
};

const dispatchStatusLabels: Record<string, string> = {
  PENDING: "در انتظار بررسی",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "برای اصلاح بازگردانده‌شده",
  RETURNED: "برای اصلاح بازگردانده‌شده",
};
const quantityUnitLabels: Record<string, string> = { meter: "متر طول", squareMeter: "متر مربع", count: "عدد", ton: "تن" };

export default function AccountingDispatchPage() {
  const [section, setSection] = useState<DispatchSection>("candidates");
  const [search, setSearch] = useState("");
  const [voidInvoiceLoadingId, setVoidInvoiceLoadingId] = useState<string | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatchCandidates, setDispatchCandidates] = useState<any[]>([]);
  const [dispatchDetails, setDispatchDetails] = useState<Record<string, DispatchDocumentCase>>({});
  const [dispatchReason, setDispatchReason] = useState("");
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [dispatchPending, setDispatchPending] = useState(false);
  const dispatchPendingRef = useRef(false);
  const [dispatchNotice, setDispatchNotice] = useState<DispatchNotice | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<any>(null);
  const [otpCode, setOtpCode] = useState("");
  const [dispatchCapabilities, setDispatchCapabilities] = useState({
    canManageAccountingCandidates: false,
    canManageAccountingConfirmation: false,
  });
  const confirmationActions = confirmationActionsFor(confirmation || {});

  const loadDispatch = useCallback(async () => {
    setLoading(true);
    setDispatchNotice(null);
    try {
      const [candidates, capabilities, details] = await Promise.allSettled([
        accountingAPI.getDispatchCandidates(),
        dispatchConfirmationAPI.getCapabilities(),
        createDispatchDocumentsHttpClient().load(),
      ]);
      if (candidates.status === "fulfilled" && candidates.value.data.success)
        setDispatchCandidates(candidates.value.data.data || []);
      if (
        capabilities.status === "fulfilled" &&
        capabilities.value.data.success
      )
        setDispatchCapabilities(capabilities.value.data.data);
      setDispatchDetails(details.status === "fulfilled"
        ? Object.fromEntries(details.value.cases.map((item) => [item.id, item]))
        : {});
      if (
        candidates.status === "rejected" &&
        capabilities.status === "rejected"
      )
        throw candidates.reason;
    } catch (error: any) {
      setDispatchNotice({
        kind: "error",
        text: userFacingError(error, "اطلاعات ارسال حسابداری دریافت نشد."),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const runDispatch = async (
    command: () => Promise<any>,
    notice: string | ((data: any) => DispatchNotice),
    recover?: (error: any) => Promise<boolean>,
  ): Promise<boolean> => {
    if (dispatchPendingRef.current) return false;
    dispatchPendingRef.current = true;
    setDispatchPending(true);
    setDispatchNotice(null);
    try {
      const response = await command();
      setDispatchNotice(typeof notice === "string" ? { kind: "success", text: notice } : notice(response.data?.data));
      if (response.data?.data?.id && response.data?.data?.waybillId)
        setConfirmation(response.data.data);
      if (response.data?.data?.authorization)
        setConfirmation((current: any) => ({
          ...current,
          authorization: response.data.data.authorization,
        }));
      try {
        const refreshed = await accountingAPI.getDispatchCandidates();
        setDispatchCandidates(refreshed.data.data || []);
        const details = await createDispatchDocumentsHttpClient().load();
        setDispatchDetails(Object.fromEntries(details.cases.map((item) => [item.id, item])));
      } catch {
        setDispatchDetails({});
        // Confirmation-only actors may not have permission to list candidates.
      }
      return true;
    } catch (error: any) {
      if (await recover?.(error)) return false;
      setDispatchNotice({
        kind: "error",
        text: userFacingError(error, "فرمان ارسال انجام نشد."),
      });
      return false;
    } finally {
      dispatchPendingRef.current = false;
      setDispatchPending(false);
    }
  };

  const beginConfirmation = async (waybillId: string) => {
    const succeeded = await runDispatch(async () => {
      let workstationId = "ACCOUNTING-WEB";
      try {
        workstationId = (await biometricConnectorClient.status()).workstationId;
      } catch {
        /* External-driver OTP sessions do not require the scanner. */
      }
      return dispatchConfirmationAPI.startSession(waybillId, workstationId);
    }, data => ({
      kind: "success",
      text: data?.authorization?.id ? "هویت راننده قبلاً تأیید شده است." : "تأیید راننده آماده انجام است.",
    }));
    if (succeeded) setSection("confirmation");
  };

  const refreshVoid = async (action: ReasonAction) => {
    try {
      const response = await accountingAPI.getDispatchCandidates();
      if (!response.data.success || !Array.isArray(response.data.data)) throw new Error("Invalid dispatch response");
      const candidates = response.data.data;
      setDispatchCandidates(candidates);
      const candidate = candidates.find((item: any) => item.loadingId === action.loadingId &&
        item.waybills?.some((waybill: any) => waybill.id === action.id));
      const waybill = candidate?.waybills.find((item: any) => item.id === action.id);
      const invoice = candidate?.currentSalesInvoice ?? null;
      const canManage = candidate?.canManage && (!invoice || candidates.every((item: any) =>
        item.loadingId !== action.loadingId || item.canManage));
      if (waybill?.status !== "ISSUED" || !canManage) {
        setReasonAction({ ...action, invoice, voidBlocked: true, voidRefreshFailed: false,
          voidRefreshNotice: "این بارنامه دیگر قابل ابطال نیست. هیچ سندی با این درخواست باطل نشد." });
        return true;
      }
      if ((invoice?.id ?? null) === (action.invoice?.id ?? null) && !action.voidRefreshFailed) return false;
      setReasonAction({ ...action, invoice, voidBlocked: false, voidRefreshFailed: false,
        idempotencyKey: crypto.randomUUID(),
        voidRefreshNotice: invoice
          ? "وضعیت فاکتور فروش به‌روزرسانی شد. شمارهٔ سندها را بررسی و دوباره تأیید کنید."
          : "این بارگیری اکنون فاکتور فروش فعال ندارد. در صورت تأیید دوباره، فقط بارنامه باطل می‌شود." });
      return true;
    } catch {
      setReasonAction({ ...action, voidBlocked: true, voidRefreshFailed: true,
        voidRefreshNotice: "دریافت وضعیت جدید اسناد ممکن نشد. برای ادامه وضعیت را دوباره بررسی کنید." });
      return true;
    }
  };

  const runReasonAction = async () => {
    if (!reasonAction || !dispatchReason.trim() || reasonAction.voidBlocked) return;
    const reason = dispatchReason.trim();
    let succeeded = false;
    if (reasonAction.type === "reject")
      succeeded = await runDispatch(
        () =>
          accountingAPI.decideDispatchCandidate(reasonAction.id, {
            action: "REJECT",
            reason,
            idempotencyKey: crypto.randomUUID(),
          }),
        "پرونده برای اصلاح علامت‌گذاری شد. بارگیری مربوط را در لجستیک پیگیری کنید.",
      );
    if (reasonAction.type === "void")
      succeeded = await runDispatch(
        () =>
          accountingAPI.voidDispatchWaybill(reasonAction.id, {
            reason,
            idempotencyKey: reasonAction.idempotencyKey || crypto.randomUUID(),
            expectedInvoiceId: reasonAction.invoice?.id ?? null,
          }),
        reasonAction.invoice ? "بارنامه و فاکتور فروش با حفظ سابقه باطل شدند." : "بارنامه با حفظ سابقه باطل شد.",
        async error => error?.response?.status === 409 && await refreshVoid(reasonAction),
      );
    if (reasonAction.type === "replace")
      succeeded = await runDispatch(
        () =>
          accountingAPI.replaceDispatchWaybill(reasonAction.id, {
            reason,
            idempotencyKey: crypto.randomUUID(),
          }),
        "بارنامه جایگزین صادر شد.",
      );
    if (reasonAction.type === "revoke") {
      succeeded = await runDispatch(
        () =>
          dispatchConfirmationAPI.revokeAuthorization(reasonAction.id, reason),
        "مجوز خروج لغو شد.",
      );
      if (succeeded) {
        setConfirmation(null);
        setSection("candidates");
      }
    }
    if (reasonAction.type === "reconstruct")
      succeeded = await runDispatch(() => accountingAPI.reconstructLegacyWaybill(reasonAction.id, reason),
        "نسخه بازسازی‌شده بارنامه با حفظ سابقه ثبت شد.");
    if (succeeded) {
      setReasonAction(null);
      setDispatchReason("");
    }
  };

  useEffect(() => {
    void loadDispatch();
  }, [loadDispatch]);

  const normalize = (value: unknown) => normalizeDigits(String(value ?? ""))
    .toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").trim();
  const query = normalize(search);
  const filteredCandidates = dispatchCandidates.filter(candidate => {
    if (!query) return true;
    const detail = dispatchDetails[candidate.id];
    const values = [candidate.summary?.loadingNumber, candidate.summary?.driverName, candidate.summary?.plate,
      candidate.summary?.customerName, candidate.summary?.projectName, candidate.summary?.projectAddress,
      ...(candidate.waybills || []).map((waybill: any) => waybill.number),
      ...(candidate.lines || []).map((line: any) => line.contractNumber),
      ...(detail?.contracts || []).map(contract => contract.number)];
    return values.some(value => normalize(value).includes(query));
  });
  const selectedCandidate = dispatchCandidates.find(candidate => candidate.id === detailCandidateId);
  const detail = detailCandidateId ? dispatchDetails[detailCandidateId] : undefined;
  const loadingId = selectedCandidate?.loadingId;
  const group = loadingId ? dispatchCandidates.filter(candidate => candidate.loadingId === loadingId) : [];
  const actionsBlocked = dispatchTimelineStale || dispatchPending;
  const canManageLoadingInvoices = (id: string) =>
    !actionsBlocked && dispatchCapabilities.canManageAccountingCandidates &&
    dispatchCandidates.some(candidate => candidate.loadingId === id) &&
    dispatchCandidates.every(candidate => candidate.loadingId !== id || candidate.canManage);
  const activeWaybillFor = (candidate: any) => candidate.waybills?.find(
    (waybill: any) => waybill.status === "ISSUED" || waybill.status === "EXIT_RECORDED",
  );
  const invoiceOnlyRows = new Map<string, any>();
  for (const candidate of filteredCandidates) {
    if (!candidate.loadingId || !candidate.currentSalesInvoice) continue;
    const previous = invoiceOnlyRows.get(candidate.loadingId);
    if (!previous || activeWaybillFor(candidate)?.status === "ISSUED") {
      invoiceOnlyRows.set(candidate.loadingId, candidate);
    }
  }
  const openReason = (type: ReasonAction["type"], id: string) => {
    setDispatchReason("");
    setReasonAction({ type, id });
  };
  const rowActions = (candidate: any): ErpAction[] => {
    const waybill = activeWaybillFor(candidate);
    const canManage = candidate.canManage && dispatchCapabilities.canManageAccountingCandidates;
    const actions: ErpAction[] = [
      { label: "جزئیات اقلام و اسناد بارگیری", icon: FaFileAlt, onClick: () => setDetailCandidateId(candidate.id) },
    ];
    if (["REJECTED", "RETURNED"].includes(candidate.status) && candidate.loadingId) {
      actions.push({ label: "پیگیری بارگیری در لجستیک", icon: FaTruck, href: `/dashboard/logistics/loadings/${encodeURIComponent(candidate.loadingId)}` });
    }
    if (candidate.status === "PENDING" && canManage) {
      actions.push({ label: "بازگرداندن برای اصلاح", icon: FaReply, tone: "danger", disabled: actionsBlocked, onClick: () => openReason("reject", candidate.id) });
    }
    if (waybill?.legacyReconstruction) {
      actions.push({ label: "مشاهده بارنامه بازسازی‌شده", icon: FaEye, disabled: dispatchPending, onClick: async () => {
        const preview = window.open("", "_blank");
        if (!preview) {
          setDispatchNotice({ kind: "error", text: "مرورگر پنجره سند را مسدود کرد." });
          return;
        }
        preview.opener = null;
        try {
          const response = await api.get(`/accounting/dispatch-waybills/${encodeURIComponent(waybill.id)}/reconstruction/pdf`, { responseType: "blob" });
          const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
          preview.location.href = url;
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (error) {
          preview.close();
          setDispatchNotice({ kind: "error", text: userFacingError(error, "بارنامه بازسازی‌شده در دسترس نیست.") });
        }
      } });
    }
    if (waybill?.status === "ISSUED") {
      if (dispatchCapabilities.canManageAccountingConfirmation) {
        actions.push({ label: "تأیید هویت راننده", icon: FaFingerprint, disabled: actionsBlocked, onClick: () => void beginConfirmation(waybill.id) });
      }
      if (canManage) {
        if (!waybill.legacyReconstruction && dispatchDetails[candidate.id]?.bundle?.artifacts.filter(artifact => artifact.kind === "WAYBILL").length !== 1) {
          actions.push({ label: "بازسازی بارنامه قدیمی", icon: FaWrench, disabled: actionsBlocked, onClick: () => openReason("reconstruct", waybill.id) });
        }
        actions.push(
          { label: "صدور نسخه جایگزین", icon: FaRedo, tone: "warning", disabled: actionsBlocked, onClick: () => openReason("replace", waybill.id) },
          ...(candidate.currentSalesInvoice && !canManageLoadingInvoices(candidate.loadingId) && !actionsBlocked ? [] : [{
            label: candidate.currentSalesInvoice ? "ابطال بارنامه و فاکتور فروش" : "ابطال بارنامه",
            icon: FaBan, tone: "danger" as const, disabled: actionsBlocked,
            onClick: () => {
              setDispatchReason("");
              setReasonAction({ type: "void", id: waybill.id, waybillNumber: String(waybill.number),
                invoice: candidate.currentSalesInvoice ?? null, loadingId: candidate.loadingId, idempotencyKey: crypto.randomUUID() });
            },
          }]),
        );
      }
    }
    if (waybill?.status !== "ISSUED" && candidate.currentSalesInvoice &&
      invoiceOnlyRows.get(candidate.loadingId)?.id === candidate.id && canManageLoadingInvoices(candidate.loadingId)) {
      actions.push({ label: "ابطال فاکتور فروش", icon: FaBan, tone: "danger",
        onClick: () => setVoidInvoiceLoadingId(candidate.loadingId) });
    }
    return actions;
  };

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="فرمان‌های ارسال"
      backHref="/dashboard/accounting"
      onBack={section === "confirmation" ? () => setSection("candidates") : undefined}
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: loadDispatch, tone: "neutral" }]}
      sectionNavigation={
        <ErpSegmentedControl
          value={section}
          onChange={setSection}
          options={[
            { value: "candidates", label: "صدور بارنامه" },
            { value: "confirmation", label: "تأیید راننده" },
            { value: "cases", label: "پرونده‌های ارسال" },
          ]}
        />
      }
      filters={section !== "confirmation" ? [{
        id: "dispatch-search", type: "search", label: "جست‌وجو", value: search, onChange: setSearch,
        placeholder: section === "candidates"
          ? "شماره بارگیری، مشتری، پروژه، قرارداد، راننده، پلاک یا شماره بارنامه"
          : "شماره بارگیری، راننده یا وضعیت",
      }] : []}
      isLoading={section === "candidates" && loading}
      mobileLayout="table"
      rows={section === "candidates" ? filteredCandidates : []}
      rowKey={candidate => candidate.id}
      columns={[
        { id: "loading", header: "بارگیری", priority: "primary", cell: candidate => candidate.summary?.loadingNumber ? dispatchCaseReference(candidate.summary.loadingNumber) : "—" },
        { id: "driver", header: "راننده و پلاک", cell: candidate => <><strong>{candidate.summary?.driverName || "راننده نامشخص"}</strong><div className="sds-text-secondary">{candidate.summary?.plate || "—"}</div></> },
        { id: "customer", header: "مشتری و پروژه", cell: candidate => <><div>{candidate.summary?.customerName || "—"}</div><div className="sds-text-secondary">{candidate.summary?.projectName || "—"}</div></> },
        { id: "status", header: "وضعیت", cell: candidate => <ErpBadge tone={candidate.status === "ACCEPTED" ? "success" : ["REJECTED", "RETURNED"].includes(candidate.status) ? "danger" : "warning"}>{dispatchStatusLabels[candidate.status] || operationalStatusLabel(candidate.status)}</ErpBadge> },
        { id: "waybill", header: "بارنامه", cell: candidate => activeWaybillFor(candidate) ? Number(activeWaybillFor(candidate).number).toLocaleString("fa-IR") : "—" },
      ]}
      rowActions={rowActions}
      emptyState={section === "candidates" ? <ErpEmptyState title={query ? "بارگیری مطابق جست‌وجو پیدا نشد" : "پرونده‌ای برای صدور بارنامه وجود ندارد"} /> : null}
    >
      {dispatchNotice && <ErpInlineState kind={dispatchNotice.kind} title={dispatchNotice.text} />}

        {section === "confirmation" && !confirmation?.id && (
          <ErpEmptyState
            title="تأیید فعالی وجود ندارد"
            description="از بخش «صدور بارنامه»، تأیید هویت راننده را برای بارنامه موردنظر آغاز کنید."
          />
        )}
        {section === "confirmation" &&
          confirmation?.id &&
          dispatchCapabilities.canManageAccountingConfirmation && (
            <ErpCard className="p-4">
              <strong>تأیید هویت راننده</strong>
              {confirmationActions.biometric && <p className="mt-1 text-sm sds-text-muted">
                یک انگشت ثبت‌شده را انتخاب کنید و تا پایان بررسی روی حسگر نگه
                دارید.
              </p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {confirmationActions.biometric &&
                  (["RIGHT_INDEX", "LEFT_INDEX"] as const).map((finger) => (
                    <ErpButton
                      key={finger}
                      label={
                        finger === "RIGHT_INDEX"
                          ? "بررسی انگشت اشاره راست"
                          : "بررسی انگشت اشاره چپ"
                      }
                      disabled={dispatchTimelineStale || dispatchPending}
                      onClick={() =>
                        void runDispatch(async () => {
                          const issued =
                            await dispatchConfirmationAPI.createBiometricCommand(
                              confirmation.id,
                              finger,
                            );
                          const connectorResult =
                            await biometricConnectorClient.execute(
                              issued.data.data,
                            );
                          return dispatchConfirmationAPI.completeBiometricAttempt(
                            confirmation.id,
                            {
                              challengeId: issued.data.data.command.commandId,
                              signedResponse: {
                                response: connectorResult.response,
                                signature: connectorResult.signature,
                              },
                            },
                          );
                        }, biometricAttemptNotice)
                      }
                    />
                  ))}
                {confirmationActions.fallback && (
                  <ErpButton
                    label="استفاده از روش جایگزین"
                    variant="outline"
                    disabled={dispatchTimelineStale || dispatchPending}
                    onClick={() =>
                      void runDispatch(
                        () =>
                          dispatchConfirmationAPI.beginFallback(
                            confirmation.id,
                          ),
                        "روش جایگزین فعال شد.",
                      )
                    }
                  />
                )}
                {confirmationActions.otp && (
                  <ErpButton
                    label="ارسال دوباره رمز"
                    variant="ghost"
                    disabled={dispatchTimelineStale || dispatchPending}
                    onClick={() =>
                      void runDispatch(
                        () =>
                          dispatchConfirmationAPI.resendOtp(confirmation.id),
                        "رمز دوباره ارسال شد.",
                      )
                    }
                  />
                )}
              </div>
              {confirmationActions.otp && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ErpInput
                    aria-label="رمز یک‌بارمصرف راننده"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                  />
                  <ErpButton
                    label="تأیید رمز"
                    disabled={
                      dispatchTimelineStale ||
                      dispatchPending ||
                      !otpCode.trim()
                    }
                    onClick={() =>
                      void runDispatch(
                        () =>
                          dispatchConfirmationAPI.verifyOtp(
                            confirmation.id,
                            otpCode.trim(),
                          ),
                        "رمز راننده تأیید شد.",
                      )
                    }
                  />
                </div>
              )}
              {confirmation.authorization?.id && (
                <div className="mt-4">
                  <ErpInlineState
                    kind="success"
                    title="مجوز خروج برای گارد صادر شده است."
                  />
                  <div className="mt-2">
                    <ErpButton
                      label="لغو مجوز خروج"
                      tone="danger"
                      variant="ghost"
                      disabled={dispatchTimelineStale || dispatchPending}
                      onClick={() => {
                        setDispatchReason("");
                        setReasonAction({
                          type: "revoke",
                          id: confirmation.authorization.id,
                        });
                      }}
                    />
                  </div>
                </div>
              )}
            </ErpCard>
          )}

      <div hidden={section !== "cases"}>
        <RoleAwareDispatchCases
          workspace="accounting"
          onStaleChange={setDispatchTimelineStale}
          tableFilter={item => !query || [item.loadingNumber, item.driverName, operationalStatusLabel(item.status)]
            .some(value => normalize(value).includes(query))}
        />
      </div>
      <ErpSheet open={Boolean(selectedCandidate)} onClose={() => setDetailCandidateId(null)} title="جزئیات اقلام و اسناد بارگیری" presentation="modal" size="wide">
        {selectedCandidate && <>
          <strong>{selectedCandidate.summary?.driverName || "راننده نامشخص"}</strong>
          {selectedCandidate.summary?.projectAddress && <p className="text-sm sds-text-secondary">{selectedCandidate.summary.projectAddress}</p>}
          {["REJECTED", "RETURNED"].includes(selectedCandidate.status) && selectedCandidate.dispositionReason && (
            <ErpInlineState kind="stale" title={`دلیل بازگرداندن: ${selectedCandidate.dispositionReason}`} />
          )}
          {detail && detail.contracts.length > 0 ? (
            <div className="mt-3 space-y-2 border-t border-[var(--sds-border-subtle)] pt-3">
              <strong>اقلام و مبلغ این راننده</strong>
              {detail.contracts.map(contract => (
                <div key={contract.id}>
                  <p className="text-sm font-semibold">قرارداد {contract.number}</p>
                  {contract.rows.map(row => (
                    <p key={row.id} className="text-sm sds-text-secondary">{row.label} · {row.quantity} {quantityUnitLabels[row.unit] || "واحد ثبت‌شده"} · {formatDisplayedMoney(row.net)}</p>
                  ))}
                </div>
              ))}
              <p className="text-sm font-semibold">جمع این راننده: {formatDisplayedMoney(detail.total)}</p>
            </div>
          ) : selectedCandidate.lines?.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-[var(--sds-border-subtle)] pt-3">
              <strong>اقلام این راننده</strong>
              {selectedCandidate.lines.map((line: any, index: number) => (
                <p key={index} className="text-sm sds-text-secondary">
                  قرارداد {line.contractNumber || "ثبت نشده"} · {line.productName || "محصول ثبت نشده"} · {line.quantity} {quantityUnitLabels[line.unit] || "واحد ثبت‌شده"}
                </p>
              ))}
            </div>
          )}
          {!detail && <ErpInlineState kind="stale" title="جزئیات قیمت این پرونده در دسترس نیست؛ پیش از تصمیم اطلاعات حسابداری را بررسی کنید." />}
          {loadingId && <SalesDispatchInvoices workspace="accounting" loadingId={loadingId}
            canManage={canManageLoadingInvoices(loadingId)}
            onVoided={loadDispatch}
            documentBlockReason={group.some(candidate => candidate.status === 'ACCEPTED' &&
              !candidate.waybills?.some((waybill: any) => ['ISSUED', 'EXIT_RECORDED'].includes(waybill.status) && waybill.legacyReconstruction) &&
              dispatchDetails[candidate.id]?.bundle?.artifacts.filter(artifact => artifact.kind === 'WAYBILL').length !== 1)
              ? 'فایل بارنامه موجود نیست؛ برای بارنامه قدیمی، صدور اسناد نسخه بازسازی‌شده را ایجاد می‌کند.' : undefined}
            onIssueAll={async recovery => {
              try { await accountingAPI.issueLoadingDocuments(loadingId, recovery); await loadDispatch(); }
              catch (error) {
                setDispatchNotice({ kind: 'error', text: userFacingError(error, 'صدور همه اسناد کامل نشد؛ وضعیت راننده‌ها را بررسی کنید.') });
                const [candidates, details] = await Promise.allSettled([
                  accountingAPI.getDispatchCandidates(), createDispatchDocumentsHttpClient().load(),
                ]);
                if (candidates.status === 'fulfilled') setDispatchCandidates(candidates.value.data.data || []);
                if (details.status === 'fulfilled') setDispatchDetails(Object.fromEntries(details.value.cases.map(item => [item.id, item])));
                throw error;
              }
            }}
            onPrintAll={async () => {
              const preview = window.open('', '_blank');
              if (!preview) throw new Error('مرورگر پنجره چاپ را مسدود کرد.');
              try {
                const response = await api.post(`/accounting/loadings/${encodeURIComponent(loadingId)}/print-documents`, {}, { responseType: 'blob' });
                const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
                preview.location.href = url;
                window.setTimeout(() => URL.revokeObjectURL(url), 60000);
              } catch (error) { preview.close(); throw error; }
            }}
            refreshKey={dispatchCandidates}/>}
        </>}
      </ErpSheet>
      {voidInvoiceLoadingId && <SalesDispatchInvoices key={voidInvoiceLoadingId}
        loadingId={voidInvoiceLoadingId} workspace="accounting"
        canManage={canManageLoadingInvoices(voidInvoiceLoadingId)}
        onCloseVoid={() => setVoidInvoiceLoadingId(null)}
        onVoided={async () => {
          await loadDispatch();
          setDispatchNotice({ kind: "success", text: "فاکتور فروش با حفظ سابقه باطل شد." });
        }} />}
      <ErpSheet
        open={Boolean(reasonAction)}
        onClose={() => {
          if (!dispatchPending) {
            setReasonAction(null);
            setDispatchReason("");
          }
        }}
        title={
          reasonAction?.type === "reject"
            ? "بازگرداندن برای اصلاح"
            : reasonAction?.type === "reconstruct"
              ? "بازسازی بارنامه قدیمی"
            : reasonAction?.type === "replace"
              ? "صدور نسخه جایگزین بارنامه"
              : reasonAction?.type === "void"
                ? reasonAction.invoice ? "ابطال بارنامه و فاکتور فروش" : "ابطال بارنامه"
                : "لغو مجوز خروج"
        }
        presentation="modal"
        pending={dispatchPending}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={dispatchPending}
              onClick={() => {
                setReasonAction(null);
                setDispatchReason("");
              }}
            />
            <ErpButton
              label={reasonAction?.voidRefreshNotice && !reasonAction.voidBlocked ? "تأیید دوباره و ثبت" : "تأیید و ثبت"}
              tone={reasonAction?.type === "replace" || reasonAction?.type === "reconstruct" ? "warning" : "danger"}
              disabled={
                dispatchTimelineStale ||
                dispatchPending ||
                reasonAction?.voidBlocked ||
                (reasonAction?.type === "void" ? dispatchReason.trim().length < 3 : !dispatchReason.trim())
              }
              onClick={() => void runReasonAction()}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {dispatchNotice?.kind === "error" && (
            <ErpInlineState kind="error" title={dispatchNotice.text} />
          )}
          <p className="text-sm leading-7 sds-text-muted">
            {reasonAction?.type === "reject" ? "اصلاح از بارگیری مربوط در لجستیک پیگیری می‌شود و دلیل در سابقه پرونده می‌ماند." : "دلیل این تصمیم در سابقه پرونده باقی می‌ماند."}
          </p>
          {reasonAction?.voidRefreshNotice && (
            <ErpInlineState kind="stale" title={reasonAction.voidRefreshNotice}
              action={reasonAction.voidRefreshFailed ? { label: "بررسی دوبارهٔ وضعیت", disabled: dispatchPending,
                onClick: async () => {
                  if (dispatchPendingRef.current) return;
                  dispatchPendingRef.current = true;
                  setDispatchPending(true);
                  try { await refreshVoid(reasonAction); }
                  finally {
                    dispatchPendingRef.current = false;
                    setDispatchPending(false);
                  }
                } } : undefined} />
          )}
          {reasonAction?.type === "void" && (
            <>
              <p className="text-sm">
                بارنامهٔ شماره <bdi>{reasonAction.waybillNumber}</bdi>
                {reasonAction.invoice && <> و فاکتور فروش شماره <bdi>{reasonAction.invoice.number}</bdi> (فاکتور کل بارگیری)</>}
              </p>
              {reasonAction.invoice && <ErpInlineState kind="stale" title="پس از ابطال فاکتور، خروج راننده‌های این بارگیری تا صدور فاکتور معتبر ممکن نیست." />}
            </>
          )}
          {reasonAction?.type === 'reconstruct' && <ErpInlineState kind="stale"
            title="فایل جدید بر اساس شواهد ثبت‌شده ساخته می‌شود و به‌عنوان نسخه بازسازی‌شده مشخص خواهد بود؛ فایل اصلی بازیابی نمی‌شود." />}
          {reasonAction?.type === "reject" && (
            <div className="flex flex-wrap gap-2" aria-label="دلیل‌های رایج">
              {["اشتباه در مقدار", "اشتباه در راننده", "اشتباه در اقلام"].map(reason => (
                <ErpButton key={reason} label={reason} variant="outline" disabled={dispatchPending} onClick={() => setDispatchReason(reason)} />
              ))}
            </div>
          )}
          <ErpInput
            aria-label="دلیل تصمیم"
            placeholder={reasonAction?.type === "void" ? "دلیل ابطال (حداقل ۳ حرف)" : undefined}
            value={dispatchReason}
            onChange={(event) => setDispatchReason(event.target.value)}
          />
        </div>
      </ErpSheet>
    </ErpListPage>
  );
}
