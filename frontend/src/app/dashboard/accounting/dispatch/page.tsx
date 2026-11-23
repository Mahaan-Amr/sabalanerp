"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaBan, FaEye, FaFileAlt, FaFingerprint, FaTruck, FaRedo, FaReply, FaSync, FaWrench } from "react-icons/fa";
import {
  type ErpAction,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpDisclosure,
  ErpEmptyState,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpListPage,
  ErpLoading,
  ErpPagination,
  ErpSegmentedControl,
  ErpSheet,
} from "@/components/erp";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import SalesDispatchInvoices from "@/features/accounting/SalesDispatchInvoices";
import { dispatchDocumentApiPaths, mapDispatchDocumentReadModel } from "@/features/accounting/dispatch-documents/dispatchDocumentsClient";
import { sepidarCheckAmount } from "@/features/accounting/dispatch-documents/sepidarCheckAmount";
import { formatDisplayedMoney, type DispatchDocumentCase } from "@/features/accounting/dispatch-documents/dispatchDocumentsViewModel";
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";
import { biometricAttemptNotice, confirmationActionsFor } from "@/features/biometric/dispatchConfirmationPresentation";
import api, { accountingAPI, dispatchConfirmationAPI } from "@/lib/api";
import { biometricConnectorClient } from "@/lib/biometricConnector";
import { formatNumericInputText, normalizeDigits } from "@/lib/numberFormat";
import { useAuth } from "@/contexts/AuthContext";

type DispatchNotice = { kind: "success" | "error"; text: string };
type LoadingIssueRequest = {
  id: string;
  recovery?: { waybillId: string; invoiceId: string; reason: string };
};
type LoadingIssueScope = { actorId: string; loadingId: string; key: string };
type LoadingIssueConclusion =
  | { status: "rejected"; text: string }
  | { status: "confirmed"; invoice: { id: string; number: string } };
type LoadingIssueState =
  | { status: "pending" }
  | { status: "unknown"; command: LoadingIssueRequest; receiptMissing: boolean }
  | (LoadingIssueConclusion & { read?: "pending" | "failed" | "ready" });

const errorStatus = (error: unknown) => (error as { response?: { status?: number } })?.response?.status;
const errorCode = (error: unknown) => (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
type DispatchSection = "candidates" | "confirmation" | "cases";
type ReferenceAuditEntry = {
  id: string;
  actorId: string;
  createdAt: string;
  beforeState?: { sepidarLoadingReference: string | null } | null;
  afterState?: { sepidarLoadingReference: string | null } | null;
  note?: string | null;
};
type ReferenceCandidate = {
  id: string;
  loadingId: string;
  waybills: { id: string }[];
  canManageSepidarLoadingReference: boolean;
  sepidarLoadingReference: string | null;
  sepidarLoadingReferenceHistory: ReferenceAuditEntry[];
};
type ReferenceError = { text: string; stale?: boolean; reason?: boolean };
const referenceLabel = "شماره بارگیری سپیدار";
const dispatchCandidateAccessDenied = (error: unknown) => {
  const status = errorStatus(error);
  return status === 401 || status === 403;
};
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
const dispatchPageSize = 50;

export default function AccountingDispatchPage() {
  const { user } = useAuth();
  const issueActorId = useRef(user?.id);
  issueActorId.current = user?.id;
  const [loadingIssues, setLoadingIssues] = useState<Record<string, LoadingIssueState>>({});
  const groupReads = useRef(new Set<string>());
  const [section, setSection] = useState<DispatchSection>("candidates");
  const [search, setSearch] = useState("");
  const [voidInvoiceLoadingId, setVoidInvoiceLoadingId] = useState<string | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [referenceTarget, setReferenceTarget] = useState<{ loadingId: string; candidateId: string } | null>(null);
  const referenceLoadingId = referenceTarget?.loadingId;
  const referenceCandidateId = referenceTarget?.candidateId;
  const [referenceInput, setReferenceInput] = useState("");
  const [referenceAmount, setReferenceAmount] = useState("");
  const [referenceDetail, setReferenceDetail] = useState<DispatchDocumentCase | null>();
  const [referenceExpected, setReferenceExpected] = useState<string | null>(null);
  const [referenceVersion, setReferenceVersion] = useState<string | null>(null);
  const [referenceReason, setReferenceReason] = useState("");
  const [referenceError, setReferenceError] = useState<ReferenceError | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatchCandidates, setDispatchCandidates] = useState<any[]>([]);
  const referenceCandidate: ReferenceCandidate | undefined = dispatchCandidates.find(
    candidate => candidate.id === referenceCandidateId,
  );
  const referenceWaybillId = referenceCandidate?.waybills.at(-1)?.id;
  const [detailRead, setDetailRead] = useState<{ key: string; value: DispatchDocumentCase | null }>();
  const [detailAttempt, retryDetail] = useState(0);
  const [page, setPage] = useState(1);
  const [candidatePage, setCandidatePage] = useState<{
    ids: Set<string>; invoiceActionIds: Set<string>; page: number; total: number;
  }>();
  const registryRequest = useRef(0);
  const showTimeline = section === "cases";
  const registrySearch = showTimeline ? "" : search.trim();
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
  const [pickupCode, setPickupCode] = useState("");
  const [dispatchCapabilities, setDispatchCapabilities] = useState({
    canManageAccountingCandidates: false,
    canManageAccountingConfirmation: false,
  });
  const confirmationActions = confirmationActionsFor(confirmation || {});

  useEffect(() => {
    if (!referenceCandidateId) return;
    const controller = new AbortController();
    api.get(dispatchDocumentApiPaths("/accounting").readModel(referenceCandidateId, referenceWaybillId), { signal: controller.signal })
      .then(response => {
        const detail = mapDispatchDocumentReadModel(response.data.data);
        if (!controller.signal.aborted) setReferenceDetail(detail.id === referenceCandidateId ? detail : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setReferenceDetail(null);
      });
    return () => controller.abort();
  }, [referenceCandidateId, referenceWaybillId]);

  const loadDispatch = useCallback(async () => {
    const request = ++registryRequest.current;
    setLoading(true);
    setDispatchNotice(null);
    try {
      const response = showTimeline
        ? await accountingAPI.getDispatchCandidates()
        : await accountingAPI.getDispatchCandidatePage(page, dispatchPageSize, registrySearch);
      if (request !== registryRequest.current) return;
      const { data = [], relatedCandidates = [], invoiceActionCandidateIds = [], pagination } = response.data;
      setDispatchCandidates([...data, ...relatedCandidates]);
      setCandidatePage(pagination ? {
        ids: new Set(data.map((row: { id: string }) => row.id)), invoiceActionIds: new Set(invoiceActionCandidateIds),
        page: pagination.page, total: pagination.total,
      } : undefined);
      if (response.data.capabilities) {
        setDispatchCapabilities(response.data.capabilities);
      } else {
        const capabilities = await dispatchConfirmationAPI.getCapabilities().catch(() => null);
        if (request !== registryRequest.current) return;
        if (capabilities?.data.success) setDispatchCapabilities(capabilities.data.data);
      }
      retryDetail(attempt => attempt + 1);
    } catch (error: any) {
      if (request !== registryRequest.current) return;
      if (dispatchCandidateAccessDenied(error)) {
        setDispatchCandidates([]);
        setCandidatePage(undefined);
        const capabilities = await dispatchConfirmationAPI.getCapabilities().catch(() => null);
        if (request !== registryRequest.current) return;
        setDispatchCapabilities(capabilities?.data.success ? capabilities.data.data : {
          canManageAccountingCandidates: false,
          canManageAccountingConfirmation: false,
        });
        return;
      }
      setDispatchNotice({
        kind: "error",
        text: userFacingError(error, "اطلاعات ارسال حسابداری دریافت نشد."),
      });
    } finally {
      if (request === registryRequest.current) setLoading(false);
    }
  }, [page, registrySearch, showTimeline]);

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
      if (response.data?.data?.sessionId && response.data.data.method)
        setConfirmation((current: any) => current?.id === response.data.data.sessionId
          ? { ...current, method: response.data.data.method }
          : current);
      if (response.data?.data?.authorization)
        setConfirmation((current: any) => ({
          ...current,
          authorization: response.data.data.authorization,
        }));
      try {
        const refreshed = await accountingAPI.getDispatchCandidates();
        setDispatchCandidates(refreshed.data.data || []);
        retryDetail(attempt => attempt + 1);
      } catch (error) {
        if (dispatchCandidateAccessDenied(error)) setDispatchCandidates([]);
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

  const beginConfirmation = async (waybillId: string, pickup: boolean) => {
    const succeeded = await runDispatch(async () => {
      let workstationId = "ACCOUNTING-WEB";
      try {
        if (!pickup) workstationId = (await biometricConnectorClient.status()).workstationId;
      } catch {
        /* Keep the web workstation identifier when the connector is unavailable. */
      }
      return dispatchConfirmationAPI.startSession(waybillId, workstationId);
    }, data => ({
      kind: "success",
      text: data?.authorization?.id ? "مجوز خروج صادر شد." : "تأیید راننده آماده انجام است.",
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
    if (candidatePage) return candidatePage.ids.has(candidate.id);
    if (!query) return true;
    const values = [candidate.summary?.loadingNumber, candidate.sepidarLoadingReference, candidate.summary?.driverName, candidate.summary?.plate,
      candidate.summary?.customerName, candidate.summary?.projectName, candidate.summary?.projectAddress, candidate.partnerCaseNumber,
      ...(candidate.waybills || []).map((waybill: any) => waybill.number),
      ...(candidate.lines || []).map((line: any) => line.contractNumber),
      ...(candidate.contractNumbers || [])];
    return values.some(value => normalize(value).includes(query));
  });
  const selectedCandidate = dispatchCandidates.find(candidate => candidate.id === detailCandidateId);
  const selectedId = selectedCandidate?.id;
  const selectedWaybillId = selectedCandidate?.waybills.at(-1)?.id;
  const detailKey = selectedId ? JSON.stringify([selectedId, selectedWaybillId, detailAttempt]) : undefined;
  const detail = detailKey && detailRead?.key === detailKey ? detailRead.value : undefined;
  useEffect(() => {
    if (!selectedId || !detailKey) return;
    const controller = new AbortController();
    api.get(dispatchDocumentApiPaths("/accounting").readModel(selectedId, selectedWaybillId), { signal: controller.signal })
      .then(response => {
        const value = mapDispatchDocumentReadModel(response.data.data);
        if (!controller.signal.aborted) setDetailRead({ key: detailKey, value: value.id === selectedId ? value : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailRead({ key: detailKey, value: null });
      });
    return () => controller.abort();
  }, [selectedId, selectedWaybillId, detailKey]);
  const loadingId = selectedCandidate?.loadingId;
  const selectedLoadingId = useRef(loadingId);
  selectedLoadingId.current = loadingId;
  const group = loadingId ? dispatchCandidates.filter(candidate => candidate.loadingId === loadingId) : [];
  const groupSnapshot = useRef({ rows: group, version: 0 });
  const previousGroup = groupSnapshot.current;
  if (previousGroup.rows.length !== group.length || group.some((candidate, index) => candidate !== previousGroup.rows[index])) {
    groupSnapshot.current = { rows: group, version: previousGroup.version + 1 };
  }
  const issueScope: LoadingIssueScope | null = user && loadingId
    ? { actorId: user.id, loadingId, key: JSON.stringify([user.id, loadingId]) }
    : null;
  const issue = issueScope ? loadingIssues[issueScope.key] : undefined;
  const setIssue = (scope: LoadingIssueScope, state: LoadingIssueState) => {
    if (issueActorId.current === scope.actorId) {
      setLoadingIssues(current => ({ ...current, [scope.key]: state }));
    }
  };
  const clearIssueGroup = (scope: LoadingIssueScope) => {
    if (issueActorId.current !== scope.actorId) return;
    setDispatchCandidates(current => current.filter(candidate => candidate.loadingId !== scope.loadingId));
  };
  const readIssueGroup = async (scope: LoadingIssueScope, conclusion: LoadingIssueConclusion) => {
    if (groupReads.current.has(scope.key)) return;
    groupReads.current.add(scope.key);
    setIssue(scope, { ...conclusion, read: "pending" });
    try {
      const response = await accountingAPI.getDispatchCandidates(scope.loadingId);
      if (issueActorId.current !== scope.actorId) return;
      const rows = response.data.data;
      if (!response.data.success || !Array.isArray(rows) || rows.some(row => row.loadingId !== scope.loadingId)) {
        throw new Error("Invalid dispatch group response");
      }
      setDispatchCandidates(current => {
        if (!current.some(candidate => candidate.loadingId === scope.loadingId)) return current;
        const updated = new Map(rows.map(row => [row.id, row]));
        const merged = current.flatMap(candidate => {
          if (candidate.loadingId !== scope.loadingId) return [candidate];
          const row = updated.get(candidate.id);
          updated.delete(candidate.id);
          return row ? [row] : [];
        });
        return [...merged, ...Array.from(updated.values())];
      });
      setCandidatePage(current => {
        if (!current) return current;
        const invoiceActionIds = new Set(current.invoiceActionIds);
        for (const row of rows) invoiceActionIds.delete(row.id);
        const eligible = rows.filter(row => current.ids.has(row.id) && row.currentSalesInvoice);
        const actionRow = eligible.find(row => row.waybills?.some((waybill: any) => waybill.status === "ISSUED")) ?? eligible[0];
        if (actionRow) invoiceActionIds.add(actionRow.id);
        return { ...current, invoiceActionIds };
      });
      if (selectedLoadingId.current === scope.loadingId) retryDetail(attempt => attempt + 1);
      setIssue(scope, { ...conclusion, read: "ready" });
    } catch (error) {
      if (dispatchCandidateAccessDenied(error)) clearIssueGroup(scope);
      setIssue(scope, { ...conclusion, read: "failed" });
    } finally {
      groupReads.current.delete(scope.key);
    }
  };
  const confirmIssueReceipt = (scope: LoadingIssueScope, command: LoadingIssueRequest, result?: {
    commandId?: unknown; status?: unknown; invoice?: { id?: unknown; number?: unknown };
  }) => {
    if (result?.commandId !== command.id || result.status !== "ISSUED" ||
        typeof result.invoice?.id !== "string" || typeof result.invoice?.number !== "string") {
      throw new Error("Invalid dispatch issue receipt");
    }
    if (issueActorId.current === scope.actorId) {
      void readIssueGroup(scope, { status: "confirmed", invoice: { id: result.invoice.id, number: result.invoice.number } });
    }
  };
  const readIssueReceipt = async (scope: LoadingIssueScope, command: LoadingIssueRequest) => {
    try {
      const response = await accountingAPI.getLoadingDocumentIssueReceipt(scope.loadingId, command.id);
      confirmIssueReceipt(scope, command, response.data.data);
    } catch (error) {
      if (dispatchCandidateAccessDenied(error)) {
        clearIssueGroup(scope);
        setIssue(scope, { status: "rejected", text: "مجوز دریافت رسید صدور اسناد بارگیری را ندارید." });
        return;
      }
      setIssue(scope, { status: "unknown", command, receiptMissing: errorCode(error) === "LOADING_ISSUE_RECEIPT_MISSING" });
    }
  };
  const handleIssue = async (scope: LoadingIssueScope, command: LoadingIssueRequest, receiptOnly = false) => {
    if (dispatchPendingRef.current || issueActorId.current !== scope.actorId) return;
    dispatchPendingRef.current = true;
    setDispatchPending(true);
    setIssue(scope, { status: "pending" });
    try {
      if (receiptOnly) {
        await readIssueReceipt(scope, command);
        return;
      }
      try {
        const response = await accountingAPI.issueLoadingDocuments(scope.loadingId, command.id, command.recovery);
        confirmIssueReceipt(scope, command, response.data.data);
      } catch (error) {
        const status = errorStatus(error);
        if (dispatchCandidateAccessDenied(error)) {
          clearIssueGroup(scope);
          setDispatchNotice({ kind: "error", text: userFacingError(error, "مجوز صدور اسناد بارگیری را ندارید.") });
        } else if (status && status >= 400 && status < 500 && status !== 408) {
          const conclusion = { status: "rejected", text: userFacingError(error, "صدور اسناد بارگیری کامل نشد.") } as const;
          if (status === 409) void readIssueGroup(scope, conclusion);
          else setIssue(scope, conclusion);
        } else {
          await readIssueReceipt(scope, command);
        }
      }
    } finally {
      dispatchPendingRef.current = false;
      setDispatchPending(false);
    }
  };
  const pendingPickupVerification = (candidate: any) =>
    candidate.summary?.driverSource === "CUSTOMER_PICKUP" && candidate.status === "PENDING" && !candidate.pickupVerification?.verifiedAt;
  const showCandidate = (id: string) => {
    setPickupCode("");
    setDispatchNotice(null);
    setDetailRead(undefined);
    setDetailCandidateId(id);
  };
  const pickupVerification = (id: string, command: "send" | "verify") => runDispatch(
    () => api.post(`/accounting/dispatch-candidates/${encodeURIComponent(id)}/pickup-verification/${command}`,
      command === "verify" ? { code: pickupCode } : {}),
    data => ({ kind: "success", text: data?.verified ? "شماره همراه تأیید شد." : "کد به شماره همراه ثبت‌شده در پذیرش ارسال شد." }),
  );
  const actionsBlocked = dispatchTimelineStale || dispatchPending;
  const candidatesByLoading = new Map<string, ReferenceCandidate>(
    dispatchCandidates.filter(candidate => candidate.loadingId).map(candidate => [candidate.loadingId, candidate]),
  );
  const referenceForLoading = (id?: string | null) => id ? candidatesByLoading.get(id)?.sepidarLoadingReference : null;
  const referenceAction = (candidate?: ReferenceCandidate): ErpAction[] => {
    if (!candidate?.canManageSepidarLoadingReference || !dispatchCapabilities.canManageAccountingCandidates) return [];
    const current = candidate.sepidarLoadingReference;
    const version = candidate.sepidarLoadingReferenceHistory?.[0]?.id ?? null;
    return [{
      label: current || version ? "اصلاح شماره بارگیری سپیدار" : "ثبت شماره بارگیری سپیدار",
      icon: FaFileAlt,
      disabled: actionsBlocked,
      onClick: () => {
        setReferenceTarget({ loadingId: candidate.loadingId, candidateId: candidate.id });
        setReferenceAmount("");
        setReferenceDetail(undefined);
        setReferenceExpected(current);
        setReferenceVersion(version);
        setReferenceInput(current ?? "");
        setReferenceReason("");
        setReferenceError(null);
      },
    }];
  };
  const referenceIsCorrection = Boolean(referenceExpected || referenceVersion);
  const checkingReferenceAmount = Boolean(referenceInput.trim());
  const expectedReferenceAmount = referenceDetail ? sepidarCheckAmount(referenceDetail.total) : null;
  const referenceAmountMatches = expectedReferenceAmount !== null
    && sepidarCheckAmount({ amount: referenceAmount, currency: "IRR" }) === expectedReferenceAmount;
  const runReferenceAction = async (action: () => Promise<void>, onFailure: (error: unknown) => void) => {
    if (dispatchPendingRef.current) return;
    dispatchPendingRef.current = true;
    setDispatchPending(true);
    try {
      await action();
    } catch (error) {
      onFailure(error);
    } finally {
      dispatchPendingRef.current = false;
      setDispatchPending(false);
    }
  };
  const saveReference = async () => {
    if (!referenceLoadingId || dispatchTimelineStale || referenceError?.stale) return;
    if (checkingReferenceAmount && !referenceAmountMatches) return;
    await runReferenceAction(async () => {
      setReferenceError(null);
      const saved = await accountingAPI.registerSepidarLoadingReference(referenceLoadingId, {
        value: referenceInput.trim() ? referenceInput : null,
        expectedVersion: referenceVersion,
        reason: referenceIsCorrection ? referenceReason : undefined,
      });
      const { value, auditEntry } = saved.data.data as { value: string | null; auditEntry: ReferenceAuditEntry };
      setDispatchCandidates(current => current.map(candidate => candidate.loadingId === referenceLoadingId ? {
        ...candidate,
        sepidarLoadingReference: value,
        sepidarLoadingReferenceHistory: [auditEntry, ...(candidate.sepidarLoadingReferenceHistory ?? [])],
      } : candidate));
      setReferenceTarget(null);
      setDispatchNotice({ kind: "success", text: referenceIsCorrection ? "شماره بارگیری سپیدار اصلاح شد." : "شماره بارگیری سپیدار ثبت شد." });
    }, error => {
      const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setReferenceError({
        text: userFacingError(error, "ثبت شماره بارگیری سپیدار انجام نشد."),
        stale: code === "SEPIDAR_REFERENCE_STALE",
        reason: code === "SEPIDAR_REFERENCE_REASON_REQUIRED",
      });
    });
  };
  const refreshReference = async () => {
    await runReferenceAction(async () => {
      const refreshed = await accountingAPI.getDispatchCandidates();
      const rows = refreshed.data.data || [];
      setDispatchCandidates(rows);
      const candidate: ReferenceCandidate | undefined = rows.find((row: ReferenceCandidate) =>
        row.loadingId === referenceLoadingId && row.id === referenceCandidateId);
      if (!candidate?.canManageSepidarLoadingReference) {
        setReferenceTarget(null);
        setDispatchNotice({ kind: "error", text: "امکان اصلاح شماره برای این بارگیری وجود ندارد." });
        return;
      }
      setReferenceExpected(candidate.sepidarLoadingReference);
      setReferenceVersion(candidate.sepidarLoadingReferenceHistory?.[0]?.id ?? null);
      setReferenceError(null);
    }, error => {
      if (dispatchCandidateAccessDenied(error)) {
        setDispatchCandidates([]);
        setReferenceTarget(null);
        setDispatchNotice({ kind: "error", text: "دسترسی به اطلاعات بارگیری مجاز نیست." });
        return;
      }
      setReferenceError({ text: userFacingError(error, "تازه‌سازی انجام نشد."), stale: true });
    });
  };
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
      { label: "جزئیات اقلام و اسناد بارگیری", icon: FaFileAlt, onClick: () => showCandidate(candidate.id) },
      ...referenceAction(candidate),
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
        const pickup = ["CUSTOMER_PICKUP", "PERSONAL_PICKUP"].includes(candidate.summary?.driverSource);
        actions.push({ label: pickup ? "صدور مجوز خروج" : "تأیید هویت راننده", icon: pickup ? FaTruck : FaFingerprint,
          disabled: actionsBlocked, onClick: () => void beginConfirmation(waybill.id, pickup) });
      }
      if (canManage) {
        if (!waybill.legacyReconstruction && !waybill.hasWaybillArtifact) {
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
    const isInvoiceActionRow = candidatePage?.invoiceActionIds.has(candidate.id)
      ?? invoiceOnlyRows.get(candidate.loadingId)?.id === candidate.id;
    if (waybill?.status !== "ISSUED" && candidate.currentSalesInvoice && isInvoiceActionRow && canManageLoadingInvoices(candidate.loadingId)) {
      actions.push({ label: "ابطال فاکتور فروش", icon: FaBan, tone: "danger",
        onClick: () => setVoidInvoiceLoadingId(candidate.loadingId) });
    }
    return actions;
  };

  const totalCandidates = candidatePage?.total ?? filteredCandidates.length;
  const totalPages = Math.max(1, Math.ceil(totalCandidates / dispatchPageSize));
  const currentPage = candidatePage?.page ?? Math.min(page, totalPages);
  const visibleCandidates = candidatePage ? filteredCandidates
    : filteredCandidates.slice((currentPage - 1) * dispatchPageSize, currentPage * dispatchPageSize);
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
        id: "dispatch-search", type: "search", label: "جست‌وجو", value: search, onChange: value => { setSearch(value); setPage(1); },
        placeholder: section === "candidates"
          ? "شماره بارگیری، شماره بارگیری سپیدار، مشتری، پروژه، قرارداد، راننده، پلاک یا شماره بارنامه"
          : "شماره بارگیری، شماره بارگیری سپیدار، راننده یا وضعیت",
      }] : []}
      isLoading={section === "candidates" && loading}
      mobileLayout="table"
      rows={section === "candidates" ? visibleCandidates : []}
      footer={section === "candidates" && totalPages > 1 && <ErpPagination currentPage={currentPage}
        totalPages={totalPages} totalItems={totalCandidates} itemsPerPage={dispatchPageSize}
        onPageChange={setPage} itemLabel="پرونده" />}
      rowKey={candidate => candidate.id}
      columns={[
        { id: "loading", header: "بارگیری", priority: "primary", cell: candidate => candidate.summary?.loadingNumber ? dispatchCaseReference(candidate.summary.loadingNumber) : "—" },
        { id: "sepidar", header: referenceLabel, cell: candidate => <bdi>{candidate.sepidarLoadingReference ?? "—"}</bdi> },
        { id: "driver", header: "راننده و پلاک", cell: candidate => <><strong>{candidate.summary?.driverName || "راننده نامشخص"}</strong><div className="sds-text-secondary">{candidate.summary?.plate || "—"}</div></> },
        { id: "customer", header: "مشتری و پروژه", cell: candidate => <><div>{candidate.summary?.customerName || "—"}</div>{candidate.summary?.personalPickup && <div className="sds-text-secondary">{candidate.summary.personalPickup.partners.map((partner: any) => partner.name).join("، ")} · قرارداد {candidate.summary.personalPickup.contracts.map((contract: any) => contract.number).join("، ")}</div>}<div className="sds-text-secondary">{candidate.summary?.projectName || "—"}</div></> },
        { id: "status", header: "وضعیت", cell: candidate => <ErpBadge tone={candidate.status === "ACCEPTED" ? "success" : ["REJECTED", "RETURNED"].includes(candidate.status) ? "danger" : "warning"}><span className="whitespace-nowrap">{dispatchStatusLabels[candidate.status] || operationalStatusLabel(candidate.status)}</span></ErpBadge> },
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
              <strong>{confirmation?.method === "PERSONAL_PICKUP_ACCOUNTING" ? "مجوز خروج راننده شخصی" : "تأیید هویت راننده"}</strong>
              <p className="mt-1 text-sm sds-text-secondary">شماره بارگیری سپیدار: <bdi>{dispatchCandidates.find(candidate =>
                candidate.waybills?.some((waybill: any) => waybill.id === confirmation.waybillId))?.sepidarLoadingReference || "—"}</bdi></p>
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
                        "روش جایگزین فعال است. پس از تأیید رمز راننده، تأیید سرپرست گارد لازم است.",
                      )
                    }
                  />
                )}
              </div>
              {confirmationActions.otp && (
                <form
                  className="mt-4 w-full max-w-sm space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (dispatchTimelineStale || dispatchPending || otpCode.length !== 6) return;
                    void runDispatch(
                      () => dispatchConfirmationAPI.verifyOtp(confirmation.id, otpCode),
                      "رمز راننده تأیید شد. تأیید نهایی را سرپرست گارد تکمیل می‌کند.",
                    );
                  }}
                >
                  <ErpField label="رمز یک‌بارمصرف راننده" hint="کد ۶ رقمی پیامک‌شده به راننده را وارد کنید.">
                    <ErpInput
                      value={otpCode}
                      onChange={(event) => setOtpCode(normalizeDigits(event.target.value).replace(/[^0-9]/g, ""))}
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      className="text-center text-xl tabular-nums"
                      disabled={dispatchTimelineStale || dispatchPending}
                    />
                  </ErpField>
                  <div className="flex flex-wrap gap-2">
                    <ErpButton
                      type="submit"
                      label={dispatchPending ? "در حال انجام…" : "تأیید رمز"}
                      disabled={dispatchTimelineStale || dispatchPending || otpCode.length !== 6}
                    />
                    <ErpButton
                      label="ارسال دوباره رمز"
                      variant="ghost"
                      disabled={dispatchTimelineStale || dispatchPending}
                      onClick={() =>
                        void runDispatch(
                          () => dispatchConfirmationAPI.resendOtp(confirmation.id),
                          "رمز دوباره ارسال شد.",
                        )
                      }
                    />
                  </div>
                </form>
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
          tableFilter={item => !query || [item.loadingNumber, referenceForLoading(item.loadingId), item.driverName, operationalStatusLabel(item.status)]
            .some(value => normalize(value).includes(query))}
          tableColumns={[{ id: "sepidar", header: referenceLabel, cell: item => <bdi>{referenceForLoading(item.loadingId) ?? "—"}</bdi> }]}
          tableRowActions={item => referenceAction(dispatchCandidates.find(candidate =>
            candidate.loadingId === item.loadingId && candidate.id === item.accountingCandidateId))}
        />
      </div>
      <ErpSheet open={Boolean(selectedCandidate)} onClose={() => setDetailCandidateId(null)}
        title="جزئیات اقلام و اسناد بارگیری" presentation="modal" size="wide" pending={dispatchPending}>
        {selectedCandidate && <div className="space-y-4">
          <div className="space-y-1">
            <strong>{selectedCandidate.summary?.driverName || "راننده نامشخص"}</strong>
            <p className="text-sm sds-text-secondary">شماره بارگیری سپیدار: <bdi>{selectedCandidate.sepidarLoadingReference || "—"}</bdi></p>
            {selectedCandidate.loadingStatus === "CANCELLED" && <ErpBadge tone="danger">بارگیری لغوشده</ErpBadge>}
            {selectedCandidate.summary?.personalPickup && <div className="space-y-1 text-sm sds-text-secondary">
              <p>مشتری: {selectedCandidate.summary.customerName}</p>
              {selectedCandidate.summary.personalPickup.partners.map((partner: any) => <p key={partner.caseId}>همکار: {partner.name}</p>)}
              <p>قرارداد: {selectedCandidate.summary.personalPickup.contracts.map((contract: any) => contract.number).join("، ")}</p>
            </div>}
            {selectedCandidate.summary?.driverSource === "CUSTOMER_PICKUP" && selectedCandidate.summary.plate && (
              <p className="text-sm sds-text-secondary">پلاک <bdi dir="rtl">{selectedCandidate.summary.plate}</bdi></p>
            )}
            {selectedCandidate.summary?.projectAddress && (
              <p className="text-sm sds-text-secondary">{selectedCandidate.summary.projectAddress}</p>
            )}
          </div>
          {Boolean(selectedCandidate.sepidarLoadingReferenceHistory?.length) &&
            <ErpDisclosure title="سابقه شماره بارگیری سپیدار" className="mt-3">
              <div className="space-y-2">{selectedCandidate.sepidarLoadingReferenceHistory.map((entry: ReferenceAuditEntry) =>
                <p key={entry.id} className="text-sm sds-text-secondary">
                  <bdi>{entry.beforeState?.sepidarLoadingReference || "—"}</bdi> ← <bdi>{entry.afterState?.sepidarLoadingReference || "—"}</bdi>
                  {' · '}{entry.actorId}{' · '}{new Date(entry.createdAt).toLocaleString('fa-IR')}
                  {entry.note && <> · {entry.note}</>}
                </p>)}</div>
            </ErpDisclosure>}
          {selectedCandidate.summary?.driverSource === "CUSTOMER_PICKUP" && (
            <>
              {selectedCandidate.pickupVerification?.verifiedAt && <ErpBadge tone="success">شماره همراه تأیید شده است</ErpBadge>}
              {pendingPickupVerification(selectedCandidate) && selectedCandidate.canManage && (
                <ErpCard className="space-y-3 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <h3 className="font-semibold">تأیید شماره همراه</h3>
                    <ErpButton label="ارسال کد پیامکی" variant="outline" disabled={actionsBlocked}
                      onClick={() => void pickupVerification(selectedCandidate.id, "send")} />
                  </div>
                  <div className="grid items-end gap-2 sm:max-w-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                    <ErpField label="کد پیامکی راننده متفرقه">
                      <ErpInput dir="ltr" className="text-center tabular-nums"
                        inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pickupCode} disabled={actionsBlocked}
                        onChange={event => setPickupCode(normalizeDigits(event.target.value).replace(/[^0-9]/g, ""))} />
                    </ErpField>
                    <ErpButton label="تأیید کد" disabled={actionsBlocked || pickupCode.length !== 6}
                      onClick={async () => {
                        if (await pickupVerification(selectedCandidate.id, "verify")) setPickupCode("");
                      }} />
                  </div>
                </ErpCard>
              )}
              {dispatchNotice && (!selectedCandidate.pickupVerification?.verifiedAt || dispatchNotice.text !== "شماره همراه تأیید شد.") && (
                <ErpInlineState kind={dispatchNotice.kind} title={dispatchNotice.text} />
              )}
            </>
          )}
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
          {detail === undefined && <ErpLoading />}
          {detail === null && <ErpInlineState kind="stale" title="جزئیات قیمت این پرونده در دسترس نیست؛ پیش از تصمیم اطلاعات حسابداری را بررسی کنید."
            action={{ label: "تلاش دوباره", onClick: () => retryDetail(attempt => attempt + 1) }} />}
          {issue?.status === "confirmed" && <ErpInlineState kind="success"
            title={<span>بارنامه‌ها و فاکتور فروش صادر شدند. <bdi>{issue.invoice.number}</bdi></span>} />}
          {issueScope && (issue?.status === "confirmed" || issue?.status === "rejected") && issue.read === "failed" &&
            <ErpInlineState kind="stale" title="وضعیت بارگیری به‌روز نشد."
              action={{ label: "تلاش دوباره برای خواندن وضعیت بارگیری", onClick: () => void readIssueGroup(issueScope, issue) }} />}
          {issueScope && issue?.status === "unknown" && <ErpInlineState kind="stale" title="نتیجهٔ فرمان صدور هنوز مشخص نیست."
            action={{ label: "بررسی دوبارهٔ رسید صدور", onClick: () => void handleIssue(issueScope, issue.command, true) }}
            actions={issue.receiptMissing && canManageLoadingInvoices(issueScope.loadingId) ? [{
              label: "ادامهٔ همان فرمان صدور", onClick: () => void handleIssue(issueScope, issue.command),
            }] : []} />}
          {issue?.status === "rejected" && <ErpInlineState kind="error" title={issue.text} />}
          {loadingId && <SalesDispatchInvoices key={loadingId} workspace="accounting" loadingId={loadingId}
            canManage={canManageLoadingInvoices(loadingId)}
            onVoided={loadDispatch}
            issuanceBlockReason={group.some(pendingPickupVerification) ? "کد پیامکی همه راننده‌های متفرقه این بارگیری را تأیید کنید." : undefined}
            documentBlockReason={group.some(candidate => candidate.status === 'ACCEPTED' &&
              !candidate.waybills?.some((waybill: any) =>
                ['ISSUED', 'EXIT_RECORDED'].includes(waybill.status) && (waybill.legacyReconstruction || waybill.hasWaybillArtifact)))
              ? 'فایل بارنامه موجود نیست؛ برای بارنامه قدیمی، صدور اسناد نسخه بازسازی‌شده را ایجاد می‌کند.' : undefined}
            groupedIssueBlocked={dispatchPending || issue?.status === "unknown" ||
              ((issue?.status === "confirmed" || issue?.status === "rejected") && (issue.read === "pending" || issue.read === "failed"))}
            confirmedInvoiceId={issue?.status === "confirmed" ? issue.invoice.id : undefined}
            onIssueAll={async recovery => {
              if (issueScope) await handleIssue(issueScope, { id: crypto.randomUUID(), recovery });
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
            refreshKey={groupSnapshot.current.version}/>}
        </div>}
      </ErpSheet>
      <ErpSheet open={Boolean(referenceLoadingId)} title={referenceIsCorrection ? "اصلاح شماره بارگیری سپیدار" : "ثبت شماره بارگیری سپیدار"} presentation="modal"
        pending={dispatchPending} onClose={() => { if (!dispatchPending) setReferenceTarget(null); }}
        footer={<div className="flex justify-end gap-2">
          <ErpButton label="انصراف" variant="ghost" disabled={dispatchPending} onClick={() => setReferenceTarget(null)} />
          <ErpButton label={referenceIsCorrection ? referenceInput.trim() ? "ذخیره شماره" : "پاک‌کردن شماره" : "ثبت شماره"}
            tone={referenceExpected && !referenceInput.trim() ? "danger" : "primary"}
            disabled={actionsBlocked || referenceError?.stale || (!referenceExpected && !checkingReferenceAmount)
              || (checkingReferenceAmount && !referenceAmountMatches) || (referenceIsCorrection && !referenceReason.trim())}
            onClick={saveReference} />
        </div>}>
        <div className="space-y-3">
          <ErpField label={referenceLabel} error={referenceError?.reason ? undefined : referenceError?.text}
            hint={referenceIsCorrection ? <>شماره فعلی <bdi>{referenceExpected ?? "—"}</bdi></> : undefined}>
            <ErpInput dir="ltr" inputMode="numeric" value={referenceInput}
              onChange={event => { setReferenceInput(event.target.value); if (!referenceError?.stale) setReferenceError(null); }} />
          </ErpField>
          {(!referenceIsCorrection || checkingReferenceAmount) && <ErpField label="مبلغ سپیدار (ریال)" required
            hint={expectedReferenceAmount !== null
              ? <>جمع این راننده به ریال <bdi>{formatNumericInputText(expectedReferenceAmount).displayText}</bdi></>
              : referenceDetail === undefined ? "در حال دریافت جمع این راننده…" : "جمع دقیق این راننده در دسترس نیست."}
            error={expectedReferenceAmount !== null && referenceAmount && !referenceAmountMatches
              ? "مبلغ سپیدار باید با جمع این راننده برابر باشد." : undefined}>
            <ErpInput numberFormat="money" dir="ltr" value={referenceAmount}
              disabled={dispatchPending || expectedReferenceAmount === null}
              onChange={event => setReferenceAmount(event.target.value)} />
          </ErpField>}
          {referenceError?.stale && <ErpButton label="به‌روزرسانی شماره فعلی" variant="soft" disabled={dispatchPending} onClick={refreshReference} />}
          {referenceIsCorrection && <ErpField label="دلیل اصلاح" required error={referenceError?.reason ? referenceError.text : undefined}>
            <ErpInput maxLength={200} value={referenceReason}
              onChange={event => { setReferenceReason(event.target.value); if (!referenceError?.stale) setReferenceError(null); }} />
          </ErpField>}
        </div>
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
