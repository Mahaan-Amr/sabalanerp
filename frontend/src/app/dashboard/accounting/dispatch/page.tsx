"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaBan, FaEye, FaFileAlt, FaFileInvoiceDollar, FaFingerprint, FaListAlt, FaTruck, FaRedo, FaReply, FaSync, FaWrench } from "react-icons/fa";
import {
  type ErpAction,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpDisclosure,
  ErpEmptyState,
  ErpField,
  ErpFilters,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPagination,
  ErpListContent,
  ErpPage,
  ErpSegmentedControl,
  ErpSheet,
} from "@/components/erp";
import RoleAwareDispatchCases, { type DispatchCaseRow } from "@/features/dispatch-case/RoleAwareDispatchCases";
import SalesDispatchInvoices from "@/features/accounting/SalesDispatchInvoices";
import { dispatchDocumentApiPaths, mapDispatchDocumentReadModel } from "@/features/accounting/dispatch-documents/dispatchDocumentsClient";
import SepidarDispatchInvoices, { SepidarInvoiceNumbers, sepidarInvoiceLabel, sepidarInvoicesOf, type SepidarAuditEntry,
  type SepidarInvoice, type SepidarInvoiceOwner } from "@/features/accounting/SepidarDispatchInvoices";
import { candidateDispatchTableRow, contractsOf, currentLoadingCandidates, dispatchTableColumns, dispatchTableFilters, matchDispatchTableRow,
  type DispatchTableCandidate, type DispatchTableRow } from "@/features/accounting/dispatchTable";
import { formatDisplayedMoney, type DispatchDocumentCase } from "@/features/accounting/dispatch-documents/dispatchDocumentsViewModel";
import { userFacingError } from "@/features/dispatch/userFacingError";
import { biometricAttemptNotice, confirmationActionsFor } from "@/features/biometric/dispatchConfirmationPresentation";
import { createAccountingAPI, createDispatchConfirmationAPI } from "@/lib/api";
import { biometricConnectorClient } from "@/lib/biometricConnector";
import { normalizeDigits } from "@/lib/numberFormat";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace, WORKSPACES } from "@/contexts/WorkspaceContext";
import { useActorScopedHttp } from "@/hooks/useActorScopedHttp";
import { createDispatchRegistryReads } from "@/features/accounting/dispatchRegistryReads";
import { clearOtherActorLoadingIssues, forgetLoadingIssue, rememberLoadingIssue, storedLoadingIssue,
  type LoadingIssueRequest } from "@/features/accounting/pendingLoadingIssue";

type DispatchNotice = { kind: "success" | "error"; text: string };
type LoadingIssueScope = { actorId: string; loadingId: string; key: string; registryScope: number };
type LoadingIssueConclusion =
  | { status: "rejected"; text: string }
  | { status: "confirmed"; invoice: { id: string; number: string } };
type LoadingIssueState =
  | { status: "pending" }
  | { status: "unknown"; command: LoadingIssueRequest; receiptMissing: boolean }
  | (LoadingIssueConclusion & { read?: "pending" | "failed" | "ready" });

const errorStatus = (error: unknown) => (error as { response?: { status?: number } })?.response?.status;
const errorCode = (error: unknown) => (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
const lostDispatchIdentity = (error: unknown) => errorStatus(error) === 401 || errorCode(error) === "AUTH_CONTEXT_CHANGED"
  || (error as { code?: unknown })?.code === "AUTH_CONTEXT_CHANGED";
const dispatchAccessDenied = (error: unknown) => lostDispatchIdentity(error) || errorStatus(error) === 403;
const dispatchDeniedNotice = { kind: "error", text: "دسترسی به اطلاعات ارسال مجاز نیست." } as const;
const loadingIssueKey = (actorId: string, loadingId: string) => JSON.stringify([actorId, loadingId]);
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

const quantityUnitLabels: Record<string, string> = { meter: "متر طول", squareMeter: "متر مربع", count: "عدد", ton: "تن" };
const dispatchPageSize = 50;

export default function AccountingDispatchPage() {
  const { user, loading: authLoading } = useAuth();
  const { getWorkspacePermission, permissionsReady } = useWorkspace();
  useEffect(() => {
    if (!authLoading) clearOtherActorLoadingIssues(user?.id);
  }, [authLoading, user?.id]);
  if (authLoading || !user) return null;
  if (!permissionsReady) return <ErpLoading />;
  const permission = getWorkspacePermission(WORKSPACES.ACCOUNTING);
  return <AccountingDispatchWorkspace key={JSON.stringify([user.id, user.role, permission])} actorId={user.id} />;
}

function AccountingDispatchWorkspace({ actorId }: { actorId: string }) {
  const api = useActorScopedHttp(actorId);
  const accountingAPI = useMemo(() => createAccountingAPI(api), [api]);
  const dispatchConfirmationAPI = useMemo(() => createDispatchConfirmationAPI(api), [api]);
  const issueActorId = useRef<string | undefined>(actorId);
  useEffect(() => {
    issueActorId.current = actorId;
    return () => { issueActorId.current = undefined; };
  }, [actorId]);
  const [loadingIssues, setLoadingIssues] = useState<Record<string, LoadingIssueState>>({});
  const groupReads = useRef(new Set<string>());
  const [section, setSection] = useState<DispatchSection>("candidates");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [caseRefresh, setCaseRefresh] = useState(0);
  const [voidInvoiceLoadingId, setVoidInvoiceLoadingId] = useState<string | null>(null);
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [referenceLoadingId, setReferenceLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const registry = useMemo(() => createDispatchRegistryReads<any>(), []);
  const [{ rows: dispatchCandidates, page: candidatePage }, setRegistry] = useState<ReturnType<typeof registry.discard>>({ rows: [] });
  const [detailRead, setDetailRead] = useState<{ key: string; value: DispatchDocumentCase | null }>();
  const [detailAttempt, retryDetail] = useState(0);
  const [page, setPage] = useState(1);
  const showTimeline = section === "cases";
  const registrySearch = showTimeline ? "" : search.trim();
  const registryStatus = showTimeline ? undefined : statusFilter || undefined;
  const registryInvoice = showTimeline ? undefined : invoiceFilter || undefined;
  const [dispatchReason, setDispatchReason] = useState("");
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const currentReasonAction = useRef(reasonAction);
  currentReasonAction.current = reasonAction;
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [dispatchPending, setDispatchPending] = useState(false);
  const dispatchPendingRef = useRef(false);
  const [dispatchNotice, setDispatchNotice] = useState<DispatchNotice | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<any>(null);
  const confirmationScope = useRef(0);
  const [otpCode, setOtpCode] = useState("");
  const [pickupCode, setPickupCode] = useState("");
  const [dispatchCapabilities, setDispatchCapabilities] = useState({
    canManageAccountingCandidates: false,
    canManageAccountingConfirmation: false,
  });
  const confirmationActions = confirmationActionsFor(confirmation || {});
  const discardCandidates = useCallback(() => {
    setRegistry(registry.discard());
    setLoading(false);
    setDetailCandidateId(null);
    setDetailRead(undefined);
    setReferenceLoadingId(null);
    setVoidInvoiceLoadingId(null);
    setPickupCode("");
    setLoadingIssues({});
    if (currentReasonAction.current?.type !== "revoke") {
      setReasonAction(null);
      setDispatchReason("");
    }
    setDispatchCapabilities(current => ({ ...current, canManageAccountingCandidates: false }));
  }, [registry]);
  const discardConfirmation = useCallback(() => {
    confirmationScope.current++;
    setConfirmation(null);
    setOtpCode("");
    if (currentReasonAction.current?.type === "revoke") {
      setReasonAction(null);
      setDispatchReason("");
    }
    setDispatchCapabilities(current => ({ ...current, canManageAccountingConfirmation: false }));
  }, []);
  const discardIdentity = useCallback(() => {
    discardCandidates();
    discardConfirmation();
  }, [discardCandidates, discardConfirmation]);

  const handleSepidarError = useCallback((error: unknown, deniedLoadingId: string) => {
    if (!dispatchAccessDenied(error) && errorStatus(error) !== 404) return false;
    if (lostDispatchIdentity(error)) discardIdentity();
    else if (errorStatus(error) === 403) discardCandidates();
    else {
      const deniedCandidateIds = new Set(registry.rowsForGroup(deniedLoadingId).map(row => row.id));
      const result = registry.acceptGroup(registry.beginGroup(), deniedLoadingId, []);
      if (result?.snapshot) setRegistry(result.snapshot);
      setDetailCandidateId(current => current && deniedCandidateIds.has(current) ? null : current);
      setReferenceLoadingId(current => current === deniedLoadingId ? null : current);
    }
    setDispatchNotice(dispatchDeniedNotice);
    return true;
  }, [discardCandidates, discardIdentity, registry]);

  const loadDispatch = useCallback(async () => {
    const request = registry.beginList();
    const confirmationAtStart = confirmationScope.current;
    const applyCapabilities = (capabilities: typeof dispatchCapabilities) => {
      if (confirmationAtStart === confirmationScope.current && !capabilities.canManageAccountingConfirmation) discardConfirmation();
      setDispatchCapabilities(current => ({
        ...capabilities,
        canManageAccountingConfirmation: confirmationAtStart === confirmationScope.current
          ? capabilities.canManageAccountingConfirmation : current.canManageAccountingConfirmation,
      }));
    };
    setLoading(true);
    setDispatchNotice(null);
    try {
      const response = showTimeline
        ? await accountingAPI.getDispatchCandidates()
        : await accountingAPI.getDispatchCandidatePage(page, dispatchPageSize, registrySearch, registryStatus, registryInvoice);
      const { data = [], relatedCandidates = [], invoiceActionCandidateIds = [], pagination } = response.data;
      const next = registry.acceptList(request, {
        rows: [...data, ...relatedCandidates],
        page: pagination ? {
          ids: new Set(data.map((row: { id: string }) => row.id)), invoiceActionIds: new Set(invoiceActionCandidateIds),
          page: pagination.page, total: pagination.total,
        } : undefined,
      }, candidate => matchDispatchTableRow(candidateDispatchTableRow(candidate), registrySearch, registryStatus ?? "", registryInvoice ?? ""));
      if (!next) return;
      setRegistry(next);
      if (response.data.capabilities) {
        applyCapabilities(response.data.capabilities);
      } else {
        const capabilities = await dispatchConfirmationAPI.getCapabilities().catch(() => null);
        if (!registry.isCurrentList(request)) return;
        if (capabilities?.data.success) applyCapabilities(capabilities.data.data);
      }
      retryDetail(attempt => attempt + 1);
    } catch (error: any) {
      if (!registry.isCurrentList(request)) return;
      if (lostDispatchIdentity(error)) {
        discardIdentity();
        setDispatchNotice(dispatchDeniedNotice);
        return;
      }
      if (dispatchAccessDenied(error)) {
        discardCandidates();
        const capabilityRead = registry.beginList();
        const capabilities = await dispatchConfirmationAPI.getCapabilities().catch(() => null);
        if (!registry.isCurrentList(capabilityRead)) return;
        applyCapabilities(capabilities?.data.success ? {
          ...capabilities.data.data, canManageAccountingCandidates: false,
        } : {
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
      if (registry.isCurrentList(request)) setLoading(false);
    }
  }, [accountingAPI, dispatchConfirmationAPI, discardCandidates, discardConfirmation, discardIdentity, page, registry, registrySearch,
    registryStatus, registryInvoice, showTimeline]);

  const runDispatch = async (
    command: () => Promise<any>,
    notice: string | ((data: any) => DispatchNotice),
    options: { loadingId?: string; confirmation?: boolean; recover?: (error: any) => Promise<boolean> } = {},
  ): Promise<boolean> => {
    if (dispatchPendingRef.current) return false;
    const currentScope = () => options.confirmation ? confirmationScope.current : registry.currentScope();
    const requestScope = currentScope();
    dispatchPendingRef.current = true;
    setDispatchPending(true);
    setDispatchNotice(null);
    try {
      const response = await command();
      if (requestScope !== currentScope()) return false;
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
      if (options.loadingId) {
        try {
          await refreshCandidateGroup(options.loadingId);
        } catch (error) {
          if (lostDispatchIdentity(error)) {
            discardIdentity();
            setDispatchNotice(dispatchDeniedNotice);
            return false;
          }
          // A confirmation may be lawful even when the actor cannot read candidate rows.
          if (dispatchAccessDenied(error)) discardCandidates();
        }
      }
      return true;
    } catch (error: any) {
      if (lostDispatchIdentity(error)) discardIdentity();
      else if (dispatchAccessDenied(error)) {
        if (options.confirmation) discardConfirmation();
        else discardCandidates();
      }
      if (dispatchAccessDenied(error)) {
        setDispatchNotice(dispatchDeniedNotice);
        return false;
      }
      if (requestScope !== currentScope()) return false;
      if (await options.recover?.(error)) return false;
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

  const beginConfirmation = async (waybillId: string, pickup: boolean, loadingId: string) => {
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
    }), { loadingId, confirmation: true });
    if (succeeded) setSection("confirmation");
  };

  const refreshVoid = async (action: ReasonAction) => {
    const scope = registry.currentScope();
    try {
      if (!action.loadingId) throw new Error("Missing dispatch group");
      const candidates = await refreshCandidateGroup(action.loadingId);
      if (scope !== registry.currentScope()) return true;
      const candidate = candidates.find((item: any) => item.loadingId === action.loadingId &&
        item.waybills?.some((waybill: any) => waybill.id === action.id));
      const waybill = candidate?.waybills.find((item: any) => item.id === action.id);
      const invoice = candidate?.currentSalesInvoice ?? null;
      const canManage = candidate?.canManage && (!invoice || candidates.every((item: any) =>
        item.loadingId !== action.loadingId || item.canManage));
      if (!canManage) {
        setReasonAction(null);
        setDispatchReason("");
        setDispatchNotice(dispatchDeniedNotice);
        return true;
      }
      if (waybill?.status !== "ISSUED") {
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
    } catch (error) {
      if (dispatchAccessDenied(error)) {
        if (lostDispatchIdentity(error)) discardIdentity();
        else discardCandidates();
        setDispatchNotice(dispatchDeniedNotice);
        return true;
      }
      if (scope !== registry.currentScope()) return true;
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
        { loadingId: reasonAction.loadingId },
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
        { loadingId: reasonAction.loadingId, recover: async error => error?.response?.status === 409 && await refreshVoid(reasonAction) },
      );
    if (reasonAction.type === "replace")
      succeeded = await runDispatch(
        () =>
          accountingAPI.replaceDispatchWaybill(reasonAction.id, {
            reason,
            idempotencyKey: crypto.randomUUID(),
          }),
        "بارنامه جایگزین صادر شد.",
        { loadingId: reasonAction.loadingId },
      );
    if (reasonAction.type === "revoke") {
      succeeded = await runDispatch(
        () =>
          dispatchConfirmationAPI.revokeAuthorization(reasonAction.id, reason),
        "مجوز خروج لغو شد.",
        { loadingId: reasonAction.loadingId, confirmation: true },
      );
      if (succeeded) {
        setConfirmation(null);
        setSection("candidates");
      }
    }
    if (reasonAction.type === "reconstruct")
      succeeded = await runDispatch(() => accountingAPI.reconstructLegacyWaybill(reasonAction.id, reason),
        "نسخه بازسازی‌شده بارنامه با حفظ سابقه ثبت شد.", { loadingId: reasonAction.loadingId });
    if (succeeded) {
      setReasonAction(null);
      setDispatchReason("");
    }
  };

  useEffect(() => {
    void loadDispatch();
  }, [loadDispatch]);

  const candidateRows = dispatchCandidates.filter(candidate => !candidatePage || candidatePage.ids.has(candidate.id))
    .map(candidateDispatchTableRow);
  const loadingGroups = new Map<string, DispatchTableCandidate[]>();
  for (const candidate of dispatchCandidates) {
    if (!candidate.loadingId) continue;
    const members = loadingGroups.get(candidate.loadingId) ?? [];
    members.push(candidate);
    loadingGroups.set(candidate.loadingId, members);
  }
  const candidateMatches = (row: DispatchTableRow) => matchDispatchTableRow(row, search, statusFilter, invoiceFilter);
  const filteredCandidateRows = candidateRows.filter(candidateMatches);
  const visibleFilters = (rows: DispatchTableRow[]) => dispatchTableFilters(rows,
    { id: "dispatch-search", type: "search", label: "جست‌وجو در ردیف‌ها", value: search, onChange: value => { setSearch(value); setPage(1); },
      placeholder: "بارگیری، فاکتور سپیدار، راننده، مشتری یا بارنامه" },
    { id: "dispatch-status", label: "وضعیت", value: statusFilter, onChange: value => { setStatusFilter(value); setPage(1); } },
    { id: "dispatch-sepidar", label: "فاکتور سپیدار", value: invoiceFilter, onChange: value => { setInvoiceFilter(value); setPage(1); } },
  );
  const hasFilters = Boolean(search.trim() || statusFilter || invoiceFilter);
  const noRows = (title: string) => <ErpEmptyState title={hasFilters ? "بارگیری مطابق جست‌وجو و فیلترها پیدا نشد" : title}
    action={hasFilters ? { label: "پاک‌کردن جست‌وجو و فیلترها", variant: "outline", onClick: () => {
      setSearch(""); setStatusFilter(""); setInvoiceFilter(""); setPage(1);
    } } : undefined} />;
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
  }, [api, selectedId, selectedWaybillId, detailKey]);
  const loadingId = selectedCandidate?.loadingId;
  const selectedLoadingId = useRef(loadingId);
  selectedLoadingId.current = loadingId;
  const group = loadingId ? dispatchCandidates.filter(candidate => candidate.loadingId === loadingId) : [];
  const groupSnapshot = useRef({ rows: group, version: 0 });
  const previousGroup = groupSnapshot.current;
  if (previousGroup.rows.length !== group.length || group.some((candidate, index) => candidate !== previousGroup.rows[index])) {
    groupSnapshot.current = { rows: group, version: previousGroup.version + 1 };
  }
  const issueScope: LoadingIssueScope | null = loadingId
    ? { actorId, loadingId, key: loadingIssueKey(actorId, loadingId), registryScope: registry.currentScope() }
    : null;
  const issue = issueScope ? loadingIssues[issueScope.key] : undefined;
  const isCurrentIssue = (scope: LoadingIssueScope) =>
    issueActorId.current === scope.actorId && registry.currentScope() === scope.registryScope;
  const setIssue = (scope: LoadingIssueScope, state: LoadingIssueState) => {
    if (isCurrentIssue(scope)) {
      setLoadingIssues(current => ({ ...current, [scope.key]: state }));
    }
  };
  const clearIssueGroup = (scope: LoadingIssueScope) => {
    if (!isCurrentIssue(scope)) return;
    const result = registry.acceptGroup(registry.beginGroup(), scope.loadingId, []);
    if (result?.snapshot) setRegistry(result.snapshot);
    if (selectedLoadingId.current === scope.loadingId) {
      setDetailCandidateId(null);
      setDetailRead(undefined);
      setPickupCode("");
    }
    setReferenceLoadingId(current => current === scope.loadingId ? null : current);
    setVoidInvoiceLoadingId(current => current === scope.loadingId ? null : current);
    if (currentReasonAction.current?.type !== "revoke" && currentReasonAction.current?.loadingId === scope.loadingId) {
      setReasonAction(null);
      setDispatchReason("");
    }
    setLoadingIssues(current => {
      const remaining = { ...current };
      delete remaining[scope.key];
      return remaining;
    });
  };
  async function refreshCandidateGroup(id: string) {
    const read = registry.beginGroup();
    try {
      const response = await accountingAPI.getDispatchCandidates(id);
      const rows = response.data.data;
      if (!response.data.success || !Array.isArray(rows) || rows.some(row => row.loadingId !== id)) {
        throw new Error("Invalid dispatch group response");
      }
      const result = registry.acceptGroup(read, id, rows);
      if (!result) throw new Error("Dispatch group read superseded");
      if (result.snapshot) {
        setRegistry(result.snapshot);
        if (selectedLoadingId.current === id) retryDetail(attempt => attempt + 1);
      }
      return result.rows;
    } catch (error) {
      if (!dispatchAccessDenied(error)) {
        const fresher = registry.newerGroupRows(read, id);
        if (fresher) return fresher;
        if (read.scope !== registry.currentScope()) throw new Error("Dispatch group read superseded");
      }
      throw error;
    }
  }
  const readIssueGroup = async (scope: LoadingIssueScope, conclusion: LoadingIssueConclusion) => {
    if (!isCurrentIssue(scope) || groupReads.current.has(scope.key)) return;
    groupReads.current.add(scope.key);
    setIssue(scope, { ...conclusion, read: "pending" });
    try {
      await refreshCandidateGroup(scope.loadingId);
      setIssue(scope, { ...conclusion, read: "ready" });
    } catch (error) {
      if (lostDispatchIdentity(error)) {
        discardIdentity();
        setDispatchNotice(dispatchDeniedNotice);
        return;
      }
      if (dispatchAccessDenied(error)) {
        clearIssueGroup(scope);
        setDispatchNotice(dispatchDeniedNotice);
        return;
      }
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
    if (isCurrentIssue(scope)) {
      forgetLoadingIssue(scope.actorId, scope.loadingId, command.id);
      void readIssueGroup(scope, { status: "confirmed", invoice: { id: result.invoice.id, number: result.invoice.number } });
    }
  };
  const readIssueReceipt = async (scope: LoadingIssueScope, command: LoadingIssueRequest) => {
    if (!isCurrentIssue(scope)) return;
    try {
      const response = await accountingAPI.getLoadingDocumentIssueReceipt(scope.loadingId, command.id);
      confirmIssueReceipt(scope, command, response.data.data);
    } catch (error) {
      if (dispatchAccessDenied(error)) {
        if (lostDispatchIdentity(error)) discardIdentity();
        else clearIssueGroup(scope);
        setDispatchNotice(dispatchDeniedNotice);
        return;
      }
      setIssue(scope, { status: "unknown", command, receiptMissing: errorCode(error) === "LOADING_ISSUE_RECEIPT_MISSING" });
    }
  };
  const handleIssue = async (scope: LoadingIssueScope, command: LoadingIssueRequest, receiptOnly = false) => {
    if (dispatchPendingRef.current || !isCurrentIssue(scope)) return;
    if (!receiptOnly) {
      const previous = storedLoadingIssue(scope.actorId, scope.loadingId);
      if (previous && previous.id !== command.id) {
        setIssue(scope, { status: "unknown", command: previous, receiptMissing: false });
        return;
      }
      rememberLoadingIssue(scope.actorId, scope.loadingId, command);
    }
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
        if (dispatchAccessDenied(error)) {
          if (lostDispatchIdentity(error)) discardIdentity();
          else {
            if (isCurrentIssue(scope)) forgetLoadingIssue(scope.actorId, scope.loadingId, command.id);
            clearIssueGroup(scope);
          }
          setDispatchNotice(dispatchDeniedNotice);
        } else if (status && status >= 400 && status < 500 && status !== 408) {
          if (!isCurrentIssue(scope)) return;
          forgetLoadingIssue(scope.actorId, scope.loadingId, command.id);
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
    const selected = dispatchCandidates.find(candidate => candidate.id === id);
    if (selected?.loadingId) {
      const command = storedLoadingIssue(actorId, selected.loadingId);
      if (command) {
        const key = loadingIssueKey(actorId, selected.loadingId);
        setLoadingIssues(current => current[key] ? current : {
          ...current, [key]: { status: "unknown", command, receiptMissing: false },
        });
      }
    }
  };
  const pickupVerification = (id: string, command: "send" | "verify") => runDispatch(
    () => api.post(`/accounting/dispatch-candidates/${encodeURIComponent(id)}/pickup-verification/${command}`,
      command === "verify" ? { code: pickupCode } : {}),
    data => ({ kind: "success", text: data?.verified ? "شماره همراه تأیید شد." : "کد به شماره همراه ثبت‌شده در پذیرش ارسال شد." }),
    { loadingId: dispatchCandidates.find(row => row.id === id)?.loadingId },
  );
  const actionsBlocked = dispatchTimelineStale || dispatchPending;
  const referenceAction = (candidate?: SepidarInvoiceOwner): ErpAction[] => {
    if (!candidate?.canManageSepidarLoadingReference || !dispatchCapabilities.canManageAccountingCandidates) return [];
    const correction = Boolean(sepidarInvoicesOf(candidate).length || candidate.sepidarLoadingReferenceHistory?.length);
    return [{
      label: correction ? "اصلاح فاکتورهای سپیدار" : "ثبت فاکتور سپیدار",
      icon: FaFileInvoiceDollar,
      tone: "primary",
      disabled: actionsBlocked,
      onClick: () => setReferenceLoadingId(candidate.loadingId),
    }];
  };
  const referenceScope = registry.currentScope();
  const saveReference = (invoices: SepidarInvoice[], auditEntry: SepidarAuditEntry, correction: boolean) => {
    if (!referenceLoadingId || referenceScope !== registry.currentScope()) return;
    const rows = registry.rowsForGroup(referenceLoadingId).map(candidate => ({
      ...candidate, sepidarInvoices: invoices, sepidarLoadingReference: invoices[0]?.number ?? null,
      sepidarLoadingReferenceHistory: [auditEntry, ...(candidate.sepidarLoadingReferenceHistory ?? [])
        .filter((entry: SepidarAuditEntry) => entry.id !== auditEntry.id)],
    }));
    if (rows.length) {
      const result = registry.acceptGroup(registry.beginGroup(), referenceLoadingId, rows);
      if (result?.snapshot) setRegistry(result.snapshot);
    }
    setReferenceLoadingId(null);
    setDispatchNotice({ kind: "success", text: correction ? "فاکتورهای سپیدار اصلاح شدند." : "فاکتورهای سپیدار ثبت شدند." });
  };
  const canManageLoadingInvoices = (id: string) =>
    !actionsBlocked && dispatchCapabilities.canManageAccountingCandidates &&
    dispatchCandidates.some(candidate => candidate.loadingId === id) &&
    dispatchCandidates.every(candidate => candidate.loadingId !== id || candidate.canManage);
  const confirmationLoadingId = confirmation?.waybillId
    ? dispatchCandidates.find(candidate => candidate.waybills?.some(
      (waybill: { id: string }) => waybill.id === confirmation.waybillId,
    ))?.loadingId
    : undefined;
  const activeWaybillFor = (candidate: any) => candidate.waybills?.find(
    (waybill: any) => waybill.status === "ISSUED" || waybill.status === "EXIT_RECORDED",
  );
  const invoiceOnlyRows = new Map<string, any>();
  for (const { owner } of filteredCandidateRows) {
    const candidate: any = owner;
    if (!candidate.loadingId || !candidate.currentSalesInvoice) continue;
    const previous = invoiceOnlyRows.get(candidate.loadingId);
    if (!previous || activeWaybillFor(candidate)?.status === "ISSUED") {
      invoiceOnlyRows.set(candidate.loadingId, candidate);
    }
  }
  const openReason = (type: ReasonAction["type"], id: string, loadingId?: string) => {
    setDispatchReason("");
    setReasonAction({ type, id, loadingId });
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
      actions.push({ label: "بازگرداندن برای اصلاح", icon: FaReply, tone: "danger", disabled: actionsBlocked, onClick: () => openReason("reject", candidate.id, candidate.loadingId) });
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
          disabled: actionsBlocked, onClick: () => void beginConfirmation(waybill.id, pickup, candidate.loadingId) });
      }
      if (canManage) {
        if (!waybill.legacyReconstruction && !waybill.hasWaybillArtifact) {
          actions.push({ label: "بازسازی بارنامه قدیمی", icon: FaWrench, disabled: actionsBlocked, onClick: () => openReason("reconstruct", waybill.id, candidate.loadingId) });
        }
        actions.push(
          { label: "صدور نسخه جایگزین", icon: FaRedo, tone: "warning", disabled: actionsBlocked, onClick: () => openReason("replace", waybill.id, candidate.loadingId) },
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

  const totalCandidates = candidatePage?.total ?? filteredCandidateRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCandidates / dispatchPageSize));
  const currentPage = candidatePage?.page ?? Math.min(page, totalPages);
  const visibleCandidates = candidatePage ? filteredCandidateRows
    : filteredCandidateRows.slice((currentPage - 1) * dispatchPageSize, currentPage * dispatchPageSize);
  return (
    <ErpPage
      eyebrow="حسابداری"
      title="فرمان‌های ارسال"
      backHref="/dashboard/accounting"
      onBack={section === "confirmation" ? () => setSection("candidates") : undefined}
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: () => {
        void loadDispatch();
        setCaseRefresh(current => current + 1);
      }, tone: "neutral" }]}
    >
        <ErpSegmentedControl
          value={section}
          onChange={value => { setStatusFilter(""); setPage(1); setSection(value); }}
          options={[
            { value: "candidates", label: "صدور بارنامه" },
            { value: "confirmation", label: "تأیید راننده" },
            { value: "cases", label: "پرونده‌های ارسال" },
          ]}
        />
      {dispatchNotice && <ErpInlineState kind={dispatchNotice.kind} title={dispatchNotice.text} />}
      {section === "candidates" && <>
        <ErpFilters layout="wide-search" showLabels filters={visibleFilters(candidateRows)} />
        <ErpListContent rows={visibleCandidates} rowKey={row => row.id} mobileLayout="table"
          columns={dispatchTableColumns(false)} isLoading={loading && !candidateRows.length}
          emptyState={noRows("پرونده‌ای برای صدور بارنامه وجود ندارد")}
          rowActions={row => rowActions(row.owner)}
          footer={totalPages > 1 && <ErpPagination currentPage={currentPage} totalPages={totalPages}
            totalItems={totalCandidates} itemsPerPage={dispatchPageSize} onPageChange={setPage} itemLabel="پرونده" />} />
      </>}

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
              <div className="mt-1 text-sm sds-text-secondary">
                <span>{sepidarInvoiceLabel}</span>
                <SepidarInvoiceNumbers invoices={sepidarInvoicesOf(dispatchCandidates.find(candidate =>
                  candidate.waybills?.some((waybill: any) => waybill.id === confirmation.waybillId)))} />
              </div>
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
                        }, biometricAttemptNotice, { loadingId: confirmationLoadingId, confirmation: true })
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
                        { loadingId: confirmationLoadingId, confirmation: true },
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
                      { loadingId: confirmationLoadingId, confirmation: true },
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
                          { loadingId: confirmationLoadingId, confirmation: true },
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
                          loadingId: confirmationLoadingId,
                        });
                      }}
                    />
                  </div>
                </div>
              )}
            </ErpCard>
          )}

      {section === "cases" &&
        <RoleAwareDispatchCases
          workspace="accounting"
          refreshRevision={caseRefresh}
          onStaleChange={setDispatchTimelineStale}
          renderTable={({ cases, openCase }) => {
            const caseByCandidate = new Map(cases.map(item => [item.accountingCandidateId, item]));
            const rows: DispatchTableRow[] = Array.from(loadingGroups, ([id, candidates]) => {
              const members = currentLoadingCandidates(candidates);
              const owner = members[0];
              return { id, owner, members, statuses: owner.loadingStatus === "CANCELLED" ? ["CANCELLED"]
                : Array.from(new Set(members.map(member => activeWaybillFor(member)?.status === "EXIT_RECORDED" ? "EXIT_RECORDED" : member.status))) };
            });
            return <>
              <ErpFilters layout="wide-search" showLabels filters={visibleFilters(rows)} />
              <ErpListContent rows={rows.filter(candidateMatches)} rowKey={row => row.id} mobileLayout="table"
                columns={dispatchTableColumns(true)} rowActionMode="menu" isLoading={loading && !rows.length}
                emptyState={noRows("پرونده ارسالی در این دامنه وجود ندارد")}
                rowActions={row => [
                  ...row.members.flatMap((member, index): ErpAction[] => {
                    const savedCase = caseByCandidate.get(member.id);
                    const timeline: DispatchCaseRow | undefined = member.queueTurnId
                      ? { id: member.queueTurnId, loadingId: row.id, status: member.status }
                      : savedCase;
                    const driver = member.summary?.driverName || `راننده ${index + 1}`;
                    const details = {
                      label: row.members.length === 1 ? "جزئیات اقلام و اسناد بارگیری" : `اسناد بارگیری · ${driver}`,
                      icon: FaFileAlt, onClick: () => showCandidate(member.id),
                    };
                    return timeline ? [{
                      label: row.members.length === 1 ? "مشاهده مراحل ارسال" : `مراحل ارسال · ${driver}`,
                      icon: FaListAlt, onClick: () => openCase(timeline),
                    }, details] : [details];
                  }),
                  ...referenceAction(row.owner),
                ]} />
            </>;
          }}
        />}
      <ErpSheet open={Boolean(selectedCandidate)} onClose={() => setDetailCandidateId(null)}
        title="جزئیات اقلام و اسناد بارگیری" presentation="modal" size="wide" pending={dispatchPending}>
        {selectedCandidate && <div className="space-y-4">
          <div className="space-y-1">
            <strong>{selectedCandidate.summary?.driverName || "راننده نامشخص"}</strong>
            <div className="text-sm sds-text-secondary">
              <span>{sepidarInvoiceLabel}</span><SepidarInvoiceNumbers invoices={sepidarInvoicesOf(selectedCandidate)} showAmounts />
            </div>
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
            <ErpDisclosure title="سابقه فاکتورهای سپیدار" className="mt-3">
              <div className="space-y-3">{selectedCandidate.sepidarLoadingReferenceHistory.map((entry: SepidarAuditEntry) =>
                <div key={entry.id} className="space-y-1 border-b border-[var(--sds-border-default)] pb-2 text-sm sds-text-secondary">
                  <p>{new Date(entry.createdAt).toLocaleString("fa-IR")} · {entry.actorId}{entry.note && <> · {entry.note}</>}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>قبل<SepidarInvoiceNumbers invoices={sepidarInvoicesOf(entry.beforeState)} showAmounts /></div>
                    <div>بعد<SepidarInvoiceNumbers invoices={sepidarInvoicesOf(entry.afterState)} showAmounts /></div>
                  </div>
                </div>)}</div>
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
      {referenceLoadingId && <SepidarDispatchInvoices key={referenceLoadingId} loadingId={referenceLoadingId}
        contracts={contractsOf(currentLoadingCandidates(loadingGroups.get(referenceLoadingId) ?? []))}
        api={accountingAPI} blocked={actionsBlocked} onClose={() => setReferenceLoadingId(null)} onSaved={saveReference}
        onError={handleSepidarError} />}
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
    </ErpPage>
  );
}
