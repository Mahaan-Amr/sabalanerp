"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FaCarSide,
  FaCheck,
  FaClipboardList,
  FaClock,
  FaPlus,
  FaRedo,
  FaSearch,
  FaTruck,
  FaUserShield,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpField,
  ErpInput,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpSearchableSelect,
  ErpSheet,
  ErpSkeleton,
  ErpWorkspacePage,
  erpFieldLabelClassName,
} from "@/components/erp";
import { createCrmAPI, createDispatchConfirmationAPI, createSecurityAPI, type CrmCustomerOption } from "@/lib/api";
import { useActorScopedHttp } from "@/hooks/useActorScopedHttp";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import {
  WORKSPACES,
  WORKSPACE_PERMISSIONS,
  useWorkspace,
} from "@/contexts/WorkspaceContext";
import { projectReturnStatuses, type ProjectReturnStatus } from "@/features/stone-returns/projectReturnVisitApi";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { useAuth } from "@/contexts/AuthContext";
import CanonicalQueueHistory, { canonicalQueueStatusLabel } from "./CanonicalQueueHistory";
import { userFacingError } from "@/features/dispatch/userFacingError";
import CompanyPlateFields from "@/features/dispatch-master-data/CompanyPlateFields";
import {
  completeCompanyPlate,
  emptyCompanyPlate,
  formatCompanyPlate,
} from "@/features/dispatch-master-data/companyVehicleEntry";

const labelClass = erpFieldLabelClassName;
const emptyAdmissionOptions = { internalAssignments: [], externalDrivers: [], externalVehicles: [] };

const emptyPair = {
  firstName: "",
  lastName: "",
  vehiclePlate: "",
  vehiclePlateKind: "STANDARD",
  vehicleType: "",
  phone: "",
  nationalCode: "",
  homeAddress: "",
  relativePhone: "",
  notes: "",
};

const emptyInbound = {
  purpose: "OUTSIDE_PURCHASE",
  vehiclePairId: "",
  customerId: "",
  notes: "",
  driverSnapshot: { ...emptyPair },
  documentSnapshot: {
    hasPurchaseInvoice: false,
    purchaseInvoiceNumber: "",
    hasWaybill: false,
    waybillNumber: "",
  },
  settlementSnapshot: {
    amount: "",
    accountOrCardNumber: "",
    ownerName: "",
  },
};

const purposeLabel: Record<string, string> = {
  OUTSIDE_PURCHASE: "خرید بیرونی",
  SALES_RETURN: "برگشت از فروش",
  CONSIGNMENT: "امانی",
  SALES_EXIT: "خروج کالا برای فروش",
  CUSTOMER_PERSONAL_CAR_EXIT: "خروج با سواری شخصی مشتری",
};

const statusLabel: Record<string, string> = {
  ENTRY_RECORDED: "ثبت ورود",
  INFO_COMPLETED: "تکمیل اطلاعات",
  ENTRY_VOIDED: "لغو ورود",
  READY_TO_EXIT: "آماده خروج",
  EXITED: "خارج شد",
  EXIT_VOIDED: "لغو خروج",
};
const queueStatusLabel: Record<string, string> = {
  WAITING: "در انتظار",
  ENTERED_LOADING_AREA: "وارد محوطه بارگیری",
  RESERVED: "رزرو شده",
  DISPATCHED: "اعزام شده",
  OUT_OF_QUEUE: "خارج از صف",
};
const statusTone = (status: string) => {
  if (status === "EXITED" || status === "INFO_COMPLETED")
    return "success" as const;
  if (status.includes("VOIDED")) return "danger" as const;
  if (status === "ENTRY_RECORDED" || status === "READY_TO_EXIT")
    return "warning" as const;
  return "neutral" as const;
};

type AdmissionSource = "INTERNAL" | "EXTERNAL" | "CUSTOMER_PICKUP" | "PERSONAL_PICKUP";

type VehicleSection =
  | "registry"
  | "queue"
  | "movements"
  | "inbound"
  | "sales-exit"
  | "exceptions"
  | "cases";

export default function SecurityVehiclesPage() {
  const { user } = useAuth();
  const { hasPermission, loading: permissionsLoading } = useWorkspace();
  const canViewQueue = hasPermission(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW);
  const canEditQueue = hasPermission(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT);
  if (!user) return null;
  return (
    <SecurityVehicleWorkspace
      key={JSON.stringify([user.id, user.role, canViewQueue, canEditQueue])}
      actorId={user.id}
      canViewQueue={canViewQueue}
      canEditQueue={canEditQueue}
      permissionsLoading={permissionsLoading}
    />
  );
}

function SecurityVehicleWorkspace({ actorId, canViewQueue, canEditQueue, permissionsLoading }: {
  actorId: string;
  canViewQueue: boolean;
  canEditQueue: boolean;
  permissionsLoading: boolean;
}) {
  const api = useActorScopedHttp(actorId);
  const crmAPI = useMemo(() => createCrmAPI(api), [api]);
  const securityAPI = useMemo(() => createSecurityAPI(api), [api]);
  const dispatchConfirmationAPI = useMemo(() => createDispatchConfirmationAPI(api), [api]);
  const mutationLock = useRef(false);
  const readSequence = useRef(0);
  const currentSection = useRef<VehicleSection>("queue");
  const router = useRouter();
  const pathname = usePathname();
  const [pairs, setPairs] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [queueTurns, setQueueTurns] = useState<any[]>([]);
  const [queueHistory, setQueueHistory] = useState<any[]>([]);
  const [canonicalQueue, setCanonicalQueue] = useState<any[]>([]);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [authorizedExits, setAuthorizedExits] = useState<any[]>([]);
  const [admissionOptions, setAdmissionOptions] = useState<any>(emptyAdmissionOptions);
  const [admissionSource, setAdmissionSource] = useState<AdmissionSource>("INTERNAL");
  const [admissionPurpose, setAdmissionPurpose] = useState<"LOADING" | "PROJECT_RETURN">("LOADING");
  const [internalDriverId, setInternalDriverId] = useState("");
  const [externalDriverId, setExternalDriverId] = useState("");
  const [externalVehicleId, setExternalVehicleId] = useState("");
  const [pickupVehicleType, setPickupVehicleType] = useState("");
  const [pickupPlate, setPickupPlate] = useState(emptyCompanyPlate);
  const [pickupPhone, setPickupPhone] = useState("");
  const admissionReady = admissionSource === "INTERNAL" ? Boolean(internalDriverId)
    : admissionSource === "EXTERNAL" ? Boolean(externalDriverId && externalVehicleId)
    : admissionSource === "PERSONAL_PICKUP" ? completeCompanyPlate(pickupPlate)
    : Boolean(pickupVehicleType && completeCompanyPlate(pickupPlate) && pickupPhone.trim());
  const [queueReason, setQueueReason] = useState("");
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [queueActionTarget, setQueueActionTarget] = useState<{
    mode: "return" | "close";
    turn: any;
  } | null>(null);
  const [admissionOpen, setAdmissionOpen] = useState(false);
  const [projectReturnExit, setProjectReturnExit] = useState<{ id: string; driverName: string; plate: string } | null>(null);
  const [exitTarget, setExitTarget] = useState<any>(null);
  const [customers, setCustomers] = useState<CrmCustomerOption[]>([]);
  const customerSearchRequest = useRef<AbortController>();
  const [customerSearch, setCustomerSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [inboundForm, setInboundForm] = useState<any>(emptyInbound);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [authorizationToRevoke, setAuthorizationToRevoke] = useState("");
  const [canApproveDispatchConfirmation, setCanApproveDispatchConfirmation] =
    useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<VehicleSection>("queue");
  const [queryReady, setQueryReady] = useState(false);

  const selectSection = (section: VehicleSection) => {
    if (section === currentSection.current) return;
    currentSection.current = section;
    readSequence.current += 1;
    setLoading(false);
    setActiveSection(section);
  };

  const loadData = useCallback(async (silent = false) => {
    if (!canViewQueue) return;
    const request = ++readSequence.current;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    const applyRead = async (
      pending: Promise<{ data: { success: boolean; data: any } }>,
      update: (data: any) => void,
      empty: unknown = [],
    ) => {
      try {
        const { data } = await pending;
        if (request !== readSequence.current) return;
        if (!data.success) throw new Error("Guard vehicle read failed");
        update(data.data);
      } catch (error: any) {
        if (request !== readSequence.current) return;
        if ([401, 403].includes(error?.response?.status)) update(empty);
        setError("بخشی از اطلاعات خودرویی دریافت نشد؛ اطلاعات موفق نمایش داده می‌شود.");
      }
    };

    switch (currentSection.current) {
      case "queue": {
        const options = canEditQueue
          ? applyRead(securityAPI.getCanonicalQueueAdmissionOptions(), setAdmissionOptions, emptyAdmissionOptions)
          : undefined;
        await applyRead(securityAPI.getCanonicalDriverQueue(), setCanonicalQueue);
        if (request === readSequence.current) setLoading(false);
        await options;
        break;
      }
      case "sales-exit":
        await applyRead(securityAPI.getAuthorizedPhysicalExits(), setAuthorizedExits);
        break;
      case "movements":
        await applyRead(securityAPI.getVehicleMovements({ limit: 50 }), setMovements);
        break;
      case "registry":
        await Promise.all([
          applyRead(securityAPI.getVehiclePairs({ includeInactive: true }), setPairs),
          applyRead(securityAPI.getDriverQueue(), setQueueTurns),
          applyRead(securityAPI.getDriverQueue(true), setQueueHistory),
        ]);
        break;
    }
    if (request === readSequence.current) setLoading(false);
  }, [canEditQueue, canViewQueue, securityAPI]);

  const refreshSection = () => {
    if (currentSection.current === "movements") setHistoryRefresh(refresh => refresh + 1);
    void loadData();
  };

  useEffect(() => {
    if (!permissionsLoading && canViewQueue && queryReady) void loadData();
    return () => { readSequence.current += 1; };
  }, [permissionsLoading, canViewQueue, queryReady, activeSection, loadData]);

  useEffect(() => {
    dispatchConfirmationAPI
      .getCapabilities()
      .then((response) =>
        setCanApproveDispatchConfirmation(
          Boolean(response.data.data.canApproveGuardConfirmation),
        ),
      )
      .catch(() => setCanApproveDispatchConfirmation(false));
  }, [dispatchConfirmationAPI]);

  useEffect(() => {
    if (activeSection !== "queue" || permissionsLoading || !canViewQueue || !queryReady) return;
    const timer = window.setInterval(() => {
      void loadData(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeSection, canViewQueue, permissionsLoading, queryReady, loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const operation = params.get("operation") as VehicleSection | null;
    if (
      operation &&
      [
        "registry",
        "queue",
        "movements",
        "inbound",
        "sales-exit",
        "exceptions",
        "cases",
      ].includes(operation)
    )
      selectSection(operation);
    else if (params.get("view") === "history") selectSection("movements");
    setQueryReady(true);
  }, []);

  useEffect(() => {
    if (!queryReady) return;
    const params = new URLSearchParams();
    if (activeSection === "movements") params.set("view", "history");
    else if (activeSection !== "queue") params.set("operation", activeSection);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [activeSection, pathname, queryReady, router]);

  useEffect(() => () => customerSearchRequest.current?.abort(), []);

  const searchCustomers = async () => {
    const search = customerSearch.trim();
    if (!search) return;
    customerSearchRequest.current?.abort();
    const controller = new AbortController();
    customerSearchRequest.current = controller;
    try {
      const { data } = await crmAPI.getCustomerOptions({ search, limit: 10 }, controller.signal);
      if (!controller.signal.aborted && data.success) setCustomers(data.data);
    } catch {
      if (!controller.signal.aborted) {
        setCustomers([]);
        setError('جست‌وجوی مشتری انجام نشد.');
      }
    }
  };

  const recordInbound = async () => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    try {
      await securityAPI.createInboundVehicleMovement({
        ...inboundForm,
        customerId:
          inboundForm.purpose === "SALES_RETURN"
            ? inboundForm.customerId
            : null,
      });
      setInboundForm(emptyInbound);
      setMessage("ورود خودروی پر ثبت شد.");
      await loadData();
    } catch (err: any) {
      setError(userFacingError(err, "ثبت ورود خودروی پر ناموفق بود."));
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const completeMovement = async (movement: any) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    try {
      await securityAPI.completeVehicleMovement(movement.id, {
        documentSnapshot: movement.documentSnapshot || {},
        settlementSnapshot: movement.settlementSnapshot || {},
        notes: movement.notes,
      });
      setMessage("اطلاعات تردد تکمیل شد.");
      await loadData(true);
    } catch (err: any) {
      setError(userFacingError(err, "تکمیل اطلاعات تردد ناموفق بود."));
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const admitQueueTurn = async () => {
    if (!admissionReady) return false;
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    try {
      const purpose = admissionPurpose === "PROJECT_RETURN" ? admissionPurpose : undefined;
      const plate = formatCompanyPlate(pickupPlate);
      if (admissionSource === "PERSONAL_PICKUP") {
        await securityAPI.admitCanonicalQueueTurn({ source: admissionSource, purpose: "PROJECT_RETURN", plate });
      } else if (admissionSource === "CUSTOMER_PICKUP") {
        await securityAPI.admitCanonicalQueueTurn({ source: admissionSource, purpose, plate, vehicleType: pickupVehicleType, phone: pickupPhone.trim() });
      } else {
        const internal = admissionSource === "INTERNAL";
        await securityAPI.admitCanonicalQueueTurn({
          source: admissionSource, purpose, driverId: internal ? internalDriverId : externalDriverId,
          vehicleId: internal ? undefined : externalVehicleId,
        });
      }
      setAdmissionSource("INTERNAL");
      setAdmissionPurpose("LOADING");
      setInternalDriverId("");
      setExternalDriverId("");
      setExternalVehicleId("");
      setPickupVehicleType("");
      setPickupPlate(emptyCompanyPlate);
      setPickupPhone("");
      setMessage(admissionPurpose === "PROJECT_RETURN" ? "ورود برای مرجوعی ثبت شد." : "پذیرش راننده و خودرو در صف ثبت شد.");
      await loadData(true);
      return true;
    } catch (err: any) {
      setError(userFacingError(err, "ثبت پذیرش صف ناموفق بود."));
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const runQueueCommand = async (
    command: () => Promise<any>,
    successMessage: string,
    consumesReason = false,
  ) => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    try {
      await command();
      if (consumesReason) setQueueReason("");
      setMessage(successMessage);
      await loadData(true);
      return true;
    } catch (err: any) {
      setError(userFacingError(err, "تغییر وضعیت صف ناموفق بود."));
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const recordAuthorizedExit = async (authorizationId: string) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    try {
      const response =
        await securityAPI.recordAuthorizedPhysicalExit(authorizationId);
      const smsStatus = response.data?.data?.smsIntent?.status;
      setMessage(
        smsStatus === "NEEDS_ATTENTION"
          ? "خروج فیزیکی ثبت شد؛ ارسال پیامک خریدار نیاز به پیگیری دارد."
          : "خروج فیزیکی با مجوز معتبر ثبت شد و پیامک خریدار در صف ارسال قرار گرفت.",
      );
      setExitTarget(null);
      await loadData(true);
    } catch (err: any) {
      setError(
        userFacingError(err, "مجوز خروج دیگر معتبر نیست؛ فهرست به‌روز شد."),
      );
      setExitTarget(null);
      await loadData(true);
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  return (
    <ErpWorkspacePage
      className="guard-workspace"
      title="تردد خودروها"
      primaryAction={
        canEditQueue
          ? {
              label: "مدیریت رانندگان و خودروها",
              icon: FaUserShield,
              href: "/dashboard/security/external-registry",
              variant: "solid",
            }
          : undefined
      }
      secondaryActions={[
        { label: "به‌روزرسانی", icon: FaRedo, onClick: refreshSection },
      ]}
    >
      {(!queryReady || permissionsLoading || (loading && activeSection === "queue" && !canonicalQueue.length)) ? (
        <ErpSkeleton lines={6} />
      ) : (
        <>
          {message && <ErpInlineState kind="success" title={message} />}
          {error && (
            <ErpInlineState
              kind={canonicalQueue.length || pairs.length || movements.length ? "stale" : "error"}
              title={error}
              action={{ label: "تلاش مجدد", onClick: refreshSection }}
            />
          )}

          <ErpSegmentedControl<VehicleSection>
            value={activeSection}
            onChange={selectSection}
            options={[
              { value: "queue", label: "پذیرش راننده", icon: FaClock },
              { value: "sales-exit", label: "خروج مجاز", icon: FaCheck },
              { value: "inbound", label: "ثبت ورود", icon: FaTruck },
              {
                value: "movements",
                label: "سوابق تردد",
                icon: FaClipboardList,
              },
              {
                value: "cases",
                label: "پرونده‌های ارسال",
                icon: FaClipboardList,
              },
              ...(canApproveDispatchConfirmation
                ? [
                    {
                      value: "exceptions" as const,
                      label: "رسیدگی استثنایی",
                      icon: FaUserShield,
                    },
                  ]
                : []),
              { value: "registry", label: "سوابق قدیمی", icon: FaCarSide },
            ]}
          />

          {activeSection === "queue" && (
            <ErpSection
              title="رانندگان حاضر"
              description="ابتدا راننده را پذیرش کنید؛ سپس فقط اقدام مناسب وضعیت فعلی او نمایش داده می‌شود."
              actions={
                canEditQueue
                  ? [
                      {
                        label: "پذیرش راننده",
                        icon: FaPlus,
                        onClick: () => setAdmissionOpen(true),
                      },
                    ]
                  : undefined
              }
            >
              <div className="space-y-4">
                {!canonicalQueue.length ? (
                  <ErpEmptyState
                    icon={FaClock}
                    title="مراجعه جاری در صف وجود ندارد"
                  />
                ) : (
                  <div className="space-y-3">
                    {canonicalQueue.map((turn) => {
                      const snapshot = turn.admissionSnapshot || {};
                      const personal = turn.driverSource === "PERSONAL_PICKUP";
                      const completedPersonalReturn = personal && Boolean(turn.projectReturnReleasedAt);
                      const waitingForReturn = turn.status === "WAITING_AT_GATE" && (personal || !turn.projectReturnReleasedAt);
                      const returnStatus = waitingForReturn
                        ? projectReturnStatuses[turn.projectReturnStatus as ProjectReturnStatus] : undefined;
                      const canFinishReturn = returnStatus && turn.projectReturnStatus !== "AWAITING_RECEIPT";
                      const driverName =
                        [snapshot.driver?.firstName, snapshot.driver?.lastName]
                          .filter(Boolean)
                          .join(" ") || "راننده ثبت‌شده";
                      return (
                        <ErpCard key={turn.id} className="p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-semibold sds-text-primary">
                                {driverName} ·{" "}
                                {snapshot.plate?.plate || "بدون پلاک"}
                              </p>
                              <p className="mt-1 text-sm sds-text-muted">
                                {snapshot.vehicle?.vehicleType || "خودرو"} ·
                                پذیرش{" "}
                                {new Date(turn.admittedAt).toLocaleString(
                                  "fa-IR",
                                )}
                              </p>
                            </div>
                            <ErpBadge
                              tone={
                                returnStatus?.tone || (turn.status === "AVAILABLE_FOR_LOADING"
                                  ? "success"
                                  : turn.status === "RESERVED_FOR_LOADING"
                                    ? "warning"
                                    : "neutral")
                              }
                            >
                              {completedPersonalReturn ? "اتمام مرجوعی ثبت شد" : returnStatus?.label || canonicalQueueStatusLabel[turn.status] ||
                                operationalStatusLabel(turn.status)}
                            </ErpBadge>
                          </div>
                          {canEditQueue && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {canFinishReturn && (
                                <ErpButton label="خروج مرجوعی" icon={FaCheck} tone="success"
                                  disabled={dispatchTimelineStale || saving}
                                  onClick={() => {
                                    setError("");
                                    setProjectReturnExit({ id: turn.id, driverName, plate: snapshot.plate?.plate || "" });
                                  }} />
                              )}
                              {canFinishReturn && !personal && (
                                <ErpButton label="انتقال به صف بارگیری" variant="soft"
                                  disabled={dispatchTimelineStale || saving}
                                  onClick={() => runQueueCommand(
                                    () => securityAPI.transferProjectReturnToLoading(turn.id),
                                    "راننده به صف بارگیری منتقل شد.",
                                  )} />
                              )}
                              {canFinishReturn && personal && !completedPersonalReturn && (
                                <ErpButton label="ثبت اتمام مرجوعی" variant="soft"
                                  disabled={dispatchTimelineStale || saving}
                                  onClick={() => runQueueCommand(
                                    () => securityAPI.completePersonalProjectReturn(turn.id),
                                    "اتمام مرجوعی خودروی شخصی ثبت شد.",
                                  )} />
                              )}
                              {turn.status === "WAITING_AT_GATE" && !returnStatus && (
                                <ErpButton
                                  label="ورود برای بارگیری"
                                  icon={FaCheck}
                                  variant="solid"
                                  disabled={dispatchTimelineStale || saving}
                                  onClick={() =>
                                    runQueueCommand(
                                      () =>
                                        securityAPI.makeCanonicalQueueTurnAvailable(
                                          turn.id,
                                        ),
                                      "راننده وارد محوطه بارگیری شد.",
                                    )
                                  }
                                />
                              )}
                              {turn.status === "AVAILABLE_FOR_LOADING" && (
                                <ErpButton
                                  label="بازگشت به انتظار"
                                  icon={FaRedo}
                                  variant="soft"
                                  disabled={dispatchTimelineStale || saving}
                                  onClick={() => {
                                    setQueueReason("");
                                    setQueueActionTarget({
                                      mode: "return",
                                      turn,
                                    });
                                  }}
                                />
                              )}{" "}
                              {[
                                "WAITING_AT_GATE",
                                "AVAILABLE_FOR_LOADING",
                                "RESERVED_FOR_LOADING",
                              ].includes(turn.status) && !returnStatus && (
                                <>
                                  <ErpButton
                                    label="خروج بدون بارگیری"
                                    tone="warning"
                                    variant="ghost"
                                    disabled={dispatchTimelineStale || saving}
                                    onClick={() => {
                                      setQueueReason("");
                                      setQueueActionTarget({
                                        mode: "close",
                                        turn,
                                      });
                                    }}
                                  />
                                  <ErpButton
                                    label="ابطال پذیرش"
                                    tone="danger"
                                    variant="ghost"
                                    disabled={dispatchTimelineStale || saving}
                                    onClick={() => {
                                      setQueueReason("");
                                      setVoidTarget(turn);
                                    }}
                                  />
                                </>
                              )}
                            </div>
                          )}
                        </ErpCard>
                      );
                    })}
                  </div>
                )}
              </div>
            </ErpSection>
          )}
          <ErpSheet
            open={admissionOpen}
            onClose={() => {
              if (!saving) setAdmissionOpen(false);
            }}
            title="پذیرش راننده و خودرو"
            presentation="modal"
            pending={saving}
            footer={
              <div className="flex justify-end gap-2">
                <ErpButton
                  label="انصراف"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setAdmissionOpen(false)}
                />
                <ErpButton
                  label="ثبت پذیرش"
                  icon={FaPlus}
                  disabled={
                    dispatchTimelineStale ||
                    saving ||
                    !admissionReady
                  }
                  onClick={async () => {
                    if (await admitQueueTurn()) setAdmissionOpen(false);
                  }}
                />
              </div>
            }
          >
            <div className="space-y-4">
              {error && <ErpInlineState kind="error" title={error} />}
              <label>
                <span className={labelClass}>هدف ورود</span>
                <ErpSearchableSelect aria-label="هدف ورود" searchable={false} value={admissionPurpose} onChange={event => {
                  const purpose = event.target.value === "PROJECT_RETURN" ? "PROJECT_RETURN" : "LOADING";
                  setAdmissionPurpose(purpose);
                  if (purpose === "LOADING" && admissionSource === "PERSONAL_PICKUP") setAdmissionSource("INTERNAL");
                }}>
                  <option value="LOADING">بارگیری</option>
                  <option value="PROJECT_RETURN">مرجوعی پروژه</option>
                </ErpSearchableSelect>
              </label>
              <ErpSegmentedControl<AdmissionSource>
                value={admissionSource}
                onChange={setAdmissionSource}
                options={[
                  { value: "INTERNAL", label: "راننده داخلی" },
                  { value: "EXTERNAL", label: "راننده بیرونی" },
                  { value: "CUSTOMER_PICKUP", label: "راننده متفرقه" },
                  ...(admissionPurpose === "PROJECT_RETURN" ? [{ value: "PERSONAL_PICKUP" as const, label: "خودروی شخصی" }] : []),
                ]}
              />
              {admissionSource === "PERSONAL_PICKUP" ? (
                <CompanyPlateFields dropdownLetter label="شماره پلاک" value={pickupPlate} onChange={setPickupPlate} />
              ) : admissionSource === "CUSTOMER_PICKUP" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className={labelClass}>نوع خودرو</span>
                    <ErpSearchableSelect aria-label="نوع خودرو" searchable={false} value={pickupVehicleType} onChange={event => setPickupVehicleType(event.target.value)}>
                      <option value="">انتخاب کنید</option>
                      <option value="کامیون">کامیون</option>
                      <option value="وانت">وانت</option>
                    </ErpSearchableSelect>
                  </label>
                  <CompanyPlateFields
                    dropdownLetter
                    label="شماره پلاک"
                    value={pickupPlate}
                    onChange={setPickupPlate}
                  />
                  <label>
                    <span className={labelClass}>شماره همراه مشتری یا راننده</span>
                    <ErpInput type="tel" dir="ltr" value={pickupPhone} maxLength={20}
                      onChange={event => setPickupPhone(event.target.value)} />
                  </label>
                </div>
              ) : admissionSource === "INTERNAL" ? (
                <label>
                  <span className={labelClass}>راننده و خودروی آماده</span>
                  <ErpSearchableSelect
                    aria-label="راننده و خودروی آماده" value={internalDriverId}
                    onChange={(event) =>
                      setInternalDriverId(event.target.value)
                    }
                  >
                    <option value="">انتخاب کنید</option>
                    {admissionOptions.internalAssignments.map((option: any) => (
                      <option key={option.assignmentId} value={option.driverId}>
                        {option.driverName} · {option.plate} ·{" "}
                        {option.fleetCode}
                      </option>
                    ))}
                  </ErpSearchableSelect>
                </label>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className={labelClass}>راننده</span>
                    <ErpSearchableSelect
                      aria-label="راننده" value={externalDriverId}
                      onChange={(event) => {
                        setExternalDriverId(event.target.value);
                        setExternalVehicleId(admissionOptions.externalDrivers.find((d: any) => d.id === event.target.value)?.vehicleId || "");
                      }}
                    >
                      <option value="">انتخاب کنید</option>
                      {admissionOptions.externalDrivers.map((option: any) => (
                        <option key={option.id} value={option.id}>
                          {option.firstName} {option.lastName}
                        </option>
                      ))}
                    </ErpSearchableSelect>
                  </label>
                  <label>
                    <span className={labelClass}>خودرو</span>
                    <ErpSearchableSelect
                      aria-label="خودرو" value={externalVehicleId}
                      disabled
                      onChange={(event) =>
                        setExternalVehicleId(event.target.value)
                      }
                    >
                      <option value="">انتخاب کنید</option>
                      {admissionOptions.externalVehicles.filter((option: any) => option.id === externalVehicleId).map((option: any) => (
                        <option key={option.id} value={option.id}>
                          {option.vehicleType} · {option.plate}
                        </option>
                      ))}
                    </ErpSearchableSelect>
                  </label>
                </div>
              )}
            </div>
          </ErpSheet>
          <ErpSheet open={Boolean(projectReturnExit)} onClose={() => setProjectReturnExit(null)}
            title="تأیید خروج مرجوعی" presentation="modal" pending={saving}
            footer={<div className="flex flex-wrap justify-end gap-2">
              <ErpButton label="انصراف" variant="ghost" disabled={saving} onClick={() => setProjectReturnExit(null)} />
              <ErpButton label="ثبت خروج فیزیکی" tone="success" disabled={dispatchTimelineStale || saving}
                onClick={async () => {
                  if (projectReturnExit && await runQueueCommand(
                    () => securityAPI.recordProjectReturnExit(projectReturnExit.id),
                    "خروج خودرو از مراجعهٔ مرجوعی ثبت شد.",
                  )) setProjectReturnExit(null);
                }} />
            </div>}>
            {error && <ErpInlineState kind="error" title={error} />}
            <p>{projectReturnExit?.driverName} · {projectReturnExit?.plate}</p>
          </ErpSheet>
          <ErpSheet
            open={Boolean(queueActionTarget)}
            onClose={() => {
              if (!saving) {
                setQueueActionTarget(null);
                setQueueReason("");
              }
            }}
            title={
              queueActionTarget?.mode === "return"
                ? "بازگشت راننده به انتظار"
                : "خروج بدون بارگیری"
            }
            presentation="modal"
            pending={saving}
            footer={
              <div className="flex justify-end gap-2">
                <ErpButton
                  label="انصراف"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setQueueActionTarget(null);
                    setQueueReason("");
                  }}
                />
                <ErpButton
                  label="تأیید و ثبت"
                  tone={
                    queueActionTarget?.mode === "close" ? "warning" : "primary"
                  }
                  disabled={
                    dispatchTimelineStale || saving || !queueReason.trim()
                  }
                  onClick={async () => {
                    if (!queueActionTarget) return;
                    const { mode, turn } = queueActionTarget;
                    const succeeded = await runQueueCommand(
                      () =>
                        mode === "return"
                          ? securityAPI.returnCanonicalQueueTurnToWaiting(
                              turn.id,
                              queueReason.trim(),
                            )
                          : securityAPI.closeCanonicalQueueTurnWithoutLoading(
                              turn.id,
                              queueReason.trim(),
                            ),
                      mode === "return"
                        ? "مراجعه به انتظار گیت بازگشت."
                        : "مراجعه بدون بارگیری بسته شد.",
                      true,
                    );
                    if (succeeded) setQueueActionTarget(null);
                  }}
                />
              </div>
            }
          >
            <div className="space-y-4">
              {error && <ErpInlineState kind="error" title={error} />}
              <label>
                <span className={labelClass}>دلیل</span>
                <ErpInput
                  value={queueReason}
                  onChange={(event) => setQueueReason(event.target.value)}
                />
              </label>
            </div>
          </ErpSheet>
          <ErpSheet
            open={Boolean(voidTarget)}
            onClose={() => {
              if (!saving) {
                setVoidTarget(null);
                setQueueReason("");
              }
            }}
            title="تأیید ابطال پذیرش"
            presentation="modal"
            dismissible={!saving}
            footer={
              <div className="flex justify-end gap-2">
                <ErpButton
                  label="انصراف"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setVoidTarget(null);
                    setQueueReason("");
                  }}
                />
                <ErpButton
                  label="تأیید ابطال"
                  tone="danger"
                  variant="solid"
                  disabled={
                    dispatchTimelineStale || saving || !queueReason.trim()
                  }
                  onClick={async () => {
                    if (
                      await runQueueCommand(
                        () =>
                          securityAPI.voidCanonicalQueueTurn(
                            voidTarget.id,
                            queueReason.trim(),
                          ),
                        "پذیرش با حفظ سابقه باطل شد.",
                        true,
                      )
                    )
                      setVoidTarget(null);
                  }}
                />
              </div>
            }
          >
            <div className="space-y-4">
              {error && <ErpInlineState kind="error" title={error} />}
              <p className="text-sm leading-7 sds-text-muted">
                این مراجعه از صف جاری خارج می‌شود و برای حفظ زنجیره حسابرسی قابل
                حذف یا بازگردانی نیست.
              </p>
              <label>
                <span className={labelClass}>دلیل ابطال</span>
                <ErpInput
                  value={queueReason}
                  onChange={(event) => setQueueReason(event.target.value)}
                />
              </label>
            </div>
          </ErpSheet>
          <ErpSheet
            open={Boolean(exitTarget)}
            onClose={() => {
              if (!saving) setExitTarget(null);
            }}
            title="تأیید خروج فیزیکی"
            presentation="modal"
            dismissible={!saving}
            footer={
              <div className="flex justify-end gap-2">
                <ErpButton
                  label="انصراف"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setExitTarget(null)}
                />
                <ErpButton
                  label="ثبت خروج فیزیکی"
                  tone="success"
                  variant="solid"
                  disabled={dispatchTimelineStale || saving}
                  onClick={() => void recordAuthorizedExit(exitTarget.id)}
                />
              </div>
            }
          >
            <div className="space-y-4">
              {error && <ErpInlineState kind="error" title={error} />}
              <p className="text-sm leading-7 sds-text-muted">
                این فرمان مجوز یک‌بارمصرف را مصرف می‌کند و عبور محموله از گیت را
                به‌صورت تغییرناپذیر ثبت می‌کند.
              </p>
            </div>
          </ErpSheet>

          {activeSection === "registry" && (
            <ErpSection
              title="سوابق صف قدیمی"
              description="مدل ترکیبی قدیمی فقط برای مشاهده سابقه حفظ شده و هیچ عملیات یا پذیرش جدیدی از این صفحه انجام نمی‌شود."
            >
              <div className="space-y-3">
                {Array.from(
                  new Map(
                    [...queueTurns, ...queueHistory].map((turn) => [
                      turn.id,
                      turn,
                    ]),
                  ).values(),
                ).map((turn) => (
                  <ErpCard key={turn.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {turn.vehiclePair.firstName}{" "}
                          {turn.vehiclePair.lastName} ·{" "}
                          {turn.vehiclePair.vehiclePlate}
                        </p>
                        <p className="mt-1 text-xs sds-text-muted">
                          ورود:{" "}
                          {new Date(turn.enteredAt).toLocaleString("fa-IR")}
                          {turn.loading
                            ? ` · ${dispatchCaseReference(turn.loading.loadingNumber)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ErpBadge tone="warning">فقط سابقه</ErpBadge>
                        <ErpBadge tone="neutral">
                          {queueStatusLabel[turn.status] ||
                            operationalStatusLabel(turn.status)}
                        </ErpBadge>
                      </div>
                    </div>
                  </ErpCard>
                ))}
              </div>
              {!queueTurns.length && !queueHistory.length && (
                <ErpEmptyState icon={FaClock} title="سابقه‌ای وجود ندارد" />
              )}
            </ErpSection>
          )}
          {activeSection === "registry" && (
            <ErpSection
              title="سوابق ترکیبی قدیمی"
              description="این رکوردها و تصاویرشان فقط شواهد تاریخی هستند. برای عملیات جدید از رجیستر مستقل راننده و خودرو استفاده کنید."
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {pairs.map((pair) => (
                  <ErpCard key={pair.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:break-words">
                      <div>
                        <p className="font-semibold sds-text-primary">
                          {pair.firstName} {pair.lastName}
                        </p>
                        <p className="mt-1 text-sm sds-text-muted">
                          {pair.vehicleType} · {pair.vehiclePlate}
                        </p>
                        <p className="mt-1 text-xs sds-text-muted">
                          {pair.phone} · {pair.nationalCode}
                        </p>
                      </div>
                      <ErpBadge tone="warning">فقط سابقه</ErpBadge>
                    </div>
                  </ErpCard>
                ))}
              </div>
              {!pairs.length && (
                <ErpEmptyState
                  icon={FaCarSide}
                  title="سابقه ترکیبی وجود ندارد"
                />
              )}
            </ErpSection>
          )}
          {activeSection === "inbound" && (
            <ErpSection title="تراکنش ورودی">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label>
                  <span className={labelClass}>نوع ورود</span>
                  <ErpSearchableSelect
                    aria-label="نوع ورود" searchable={false} value={inboundForm.purpose}
                    onChange={(event) =>
                      setInboundForm((current: any) => ({
                        ...current,
                        purpose: event.target.value,
                      }))
                    }
                  >
                    <option value="OUTSIDE_PURCHASE">خرید بیرونی</option>
                    <option value="SALES_RETURN">برگشت از فروش</option>
                    <option value="CONSIGNMENT" disabled>
                      امانی - در دست تعریف
                    </option>
                  </ErpSearchableSelect>
                </label>
                <ErpCard className="p-3 text-sm sds-text-secondary">
                  راننده و خودرو برای ورود جدید به‌صورت تصویر لحظه‌ای ثبت
                  می‌شوند؛ رجیستر ترکیبی قدیمی قابل انتخاب نیست.
                </ErpCard>
                {inboundForm.purpose === "SALES_RETURN" && (
                  <label>
                    <span className={labelClass}>مشتری برگشت از فروش</span>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <ErpInput
                        value={customerSearch}
                        onChange={(event) => {
                          customerSearchRequest.current?.abort();
                          setCustomerSearch(event.target.value);
                        }}
                      />
                      <ErpButton
                        label="جستجو"
                        icon={FaSearch}
                        onClick={searchCustomers}
                      />
                    </div>
                  </label>
                )}
              </div>

              {inboundForm.purpose === "SALES_RETURN" &&
                customers.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {customers.map((customer) => (
                      <ErpPressable
                        key={customer.id}
                        onClick={() =>
                          setInboundForm((current: any) => ({
                            ...current,
                            customerId: customer.id,
                          }))
                        }
                        variant={
                          inboundForm.customerId === customer.id
                            ? "soft"
                            : "outline"
                        }
                        tone="primary"
                        className="h-auto p-3 text-right text-sm"
                      >
                        <span className="font-semibold">
                          {customer.firstName} {customer.lastName}
                        </span>
                        <span className="block text-xs sds-text-muted">
                          {customer.companyName || "بدون شرکت"}
                        </span>
                      </ErpPressable>
                    ))}
                  </div>
                )}

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {!inboundForm.vehiclePairId &&
                  Object.entries({
                    firstName: "نام راننده",
                    lastName: "نام خانوادگی",
                    vehiclePlate: "پلاک",
                    vehicleType: "نوع خودرو",
                    phone: "موبایل",
                    nationalCode: "کد ملی",
                  }).map(([field, label]) => (
                    <label key={field}>
                      <span className={labelClass}>{label}</span>
                      <ErpInput
                        value={inboundForm.driverSnapshot[field] || ""}
                        onChange={(event) =>
                          setInboundForm((current: any) => ({
                            ...current,
                            driverSnapshot: {
                              ...current.driverSnapshot,
                              [field]: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                <label>
                  <span className={labelClass}>شماره فاکتور خرید</span>
                  <ErpInput
                    value={inboundForm.documentSnapshot.purchaseInvoiceNumber}
                    disabled={inboundForm.purpose === "SALES_RETURN"}
                    onChange={(event) =>
                      setInboundForm((current: any) => ({
                        ...current,
                        documentSnapshot: {
                          ...current.documentSnapshot,
                          hasPurchaseInvoice: Boolean(event.target.value),
                          purchaseInvoiceNumber: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span className={labelClass}>شماره بارنامه</span>
                  <ErpInput
                    value={inboundForm.documentSnapshot.waybillNumber}
                    onChange={(event) =>
                      setInboundForm((current: any) => ({
                        ...current,
                        documentSnapshot: {
                          ...current.documentSnapshot,
                          hasWaybill: Boolean(event.target.value),
                          waybillNumber: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span className={labelClass}>مبلغ تسویه بارنامه</span>
                  <ErpInput numberFormat="money"
                    value={inboundForm.settlementSnapshot.amount}
                    onChange={(event) =>
                      setInboundForm((current: any) => ({
                        ...current,
                        settlementSnapshot: {
                          ...current.settlementSnapshot,
                          amount: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="mt-3">
                <ErpButton
                  label="ثبت ورود"
                  icon={FaTruck}
                  onClick={recordInbound}
                  disabled={
                    saving ||
                    (inboundForm.purpose === "SALES_RETURN" &&
                      !inboundForm.customerId)
                  }
                  variant="solid"
                />
              </div>
            </ErpSection>
          )}

          {activeSection === "sales-exit" && (
            <ErpSection
              title="خروج مجاز گیت"
            >
              {authorizedExits.length === 0 ? (
                <ErpEmptyState
                  icon={FaCarSide}
                  title="مجوز معتبر برای خروج وجود ندارد"
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {authorizedExits.map((authorization) => {
                    const snapshot = authorization.admissionSnapshot || {};
                    return (
                      <ErpCard key={authorization.id} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:break-words">
                          <div>
                            <p className="font-semibold sds-text-primary">
                              بارنامه {authorization.dispatchNumber}
                            </p>
                            <p className="mt-1 text-sm sds-text-muted">
                              {snapshot.driver?.firstName}{" "}
                              {snapshot.driver?.lastName} ·{" "}
                              {authorization.summary?.driverSource === "PERSONAL_PICKUP" ? "سواری" : snapshot.plate?.plate || "بدون پلاک"}
                            </p>
                            {authorization.summary?.personalPickup && <div className="mt-2 space-y-1 text-sm sds-text-secondary">
                              <p>مشتری: {authorization.summary.customerName}</p>
                              {authorization.summary.personalPickup.partners.map((partner: any) => <p key={partner.caseId}>همکار: {partner.name}</p>)}
                              <p>قرارداد: {authorization.summary.personalPickup.contracts.map((contract: any) => contract.number).join("، ")}</p>
                            </div>}
                            <p className="mt-1 text-xs sds-text-muted">
                              اعتبار تا{" "}
                              {new Date(
                                authorization.validUntil,
                              ).toLocaleString("fa-IR")}
                            </p>
                          </div>
                          <ErpBadge tone="success">مجوز معتبر</ErpBadge>
                        </div>
                        {canEditQueue && (
                          <div className="mt-3">
                            <ErpButton
                              label="ثبت خروج"
                              icon={FaCheck}
                              onClick={() => setExitTarget(authorization)}
                              disabled={dispatchTimelineStale || saving}
                              variant="solid"
                              tone="success"
                            />
                          </div>
                        )}
                      </ErpCard>
                    );
                  })}
                </div>
              )}
            </ErpSection>
          )}

          {activeSection === "movements" && (
            <ErpSection title="سوابق تردد">
              <div className="space-y-3">
                {canViewQueue && <CanonicalQueueHistory refresh={historyRefresh} securityAPI={securityAPI} />}
                {loading && !movements.length && <ErpSkeleton lines={3} />}
                {movements.map((movement) => (
                  <ErpCard key={movement.id} className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold sds-text-primary">
                          {movement.movementNumber} ·{" "}
                          {purposeLabel[movement.purpose] || "تردد ثبت‌شده"}
                        </p>
                        <p className="mt-1 text-sm sds-text-muted">
                          {movement.vehiclePair
                            ? `${movement.vehiclePair.firstName} ${movement.vehiclePair.lastName} · ${movement.vehiclePair.vehiclePlate}`
                            : movement.customer
                              ? `${movement.customer.firstName} ${movement.customer.lastName}`
                              : "تردد متفرقه"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ErpBadge
                          tone={
                            movement.direction === "INBOUND" ? "info" : "purple"
                          }
                        >
                          {movement.direction === "INBOUND" ? "ورود" : "خروج"}
                        </ErpBadge>
                        <ErpBadge tone={statusTone(movement.status)}>
                          {statusLabel[movement.status] ||
                            operationalStatusLabel(movement.status)}
                        </ErpBadge>
                      </div>
                    </div>
                    {movement.direction === "INBOUND" &&
                      movement.status === "ENTRY_RECORDED" && (
                        <div className="mt-3">
                          <ErpButton
                            label="تکمیل اطلاعات"
                            icon={FaCheck}
                            onClick={() => completeMovement(movement)}
                            disabled={saving}
                            tone="success"
                            variant="soft"
                          />
                        </div>
                      )}
                  </ErpCard>
                ))}
              </div>
            </ErpSection>
          )}
          {previewUrl && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="پیش‌نمایش تصویر"
              className="fixed inset-0 z-[100] grid place-items-center bg-[var(--sds-surface-overlay)] p-4"
            >
              <ErpPressable
                aria-label="بستن پیش‌نمایش"
                onClick={() => setPreviewUrl("")}
                className="absolute inset-0 h-full w-full cursor-default rounded-none bg-transparent"
              />
              <div className="relative z-10 max-h-full max-w-5xl">
                <img
                  src={previewUrl}
                  alt="پیش‌نمایش تصویر"
                  className="max-h-[90vh] max-w-full rounded-xl object-contain"
                />
                <ErpPressable
                  onClick={() => setPreviewUrl("")}
                  tone="primary"
                  variant="solid"
                  className="absolute left-2 top-2 px-3 py-2 font-semibold"
                >
                  بستن
                </ErpPressable>
              </div>
            </div>
          )}
        </>
      )}
      {activeSection === "exceptions" && canApproveDispatchConfirmation && (
        <ErpSection
          title="رسیدگی استثنایی خروج"
          description="لغو مجوز خروج با ثبت دلیل انجام می‌شود."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ErpField label="دلیل لغو مجوز خروج">
              <ErpInput value={queueReason} onChange={(event) => setQueueReason(event.target.value)} />
            </ErpField>
            <ErpInput
              aria-label="شناسه مجوز خروج برای لغو"
              value={authorizationToRevoke}
              onChange={(event) => setAuthorizationToRevoke(event.target.value)}
            />
            <ErpButton
              label="لغو مجوز توسط گارد"
              tone="danger"
              variant="outline"
              disabled={
                dispatchTimelineStale ||
                saving ||
                !authorizationToRevoke.trim() ||
                !queueReason.trim()
              }
              onClick={async () => {
                if (mutationLock.current) return;
                mutationLock.current = true;
                setSaving(true);
                setError("");
                try {
                  await dispatchConfirmationAPI.revokeAuthorizationAsGuard(
                    authorizationToRevoke.trim(),
                    queueReason.trim(),
                  );
                  setMessage("مجوز خروج توسط گارد لغو شد.");
                  setAuthorizationToRevoke("");
                } catch (err: any) {
                  setError(userFacingError(err, "لغو مجوز انجام نشد."));
                } finally {
                  mutationLock.current = false;
                  setSaving(false);
                }
              }}
            />
          </div>
        </ErpSection>
      )}
      <div hidden={activeSection !== "cases"}>
        <RoleAwareDispatchCases
          workspace="security"
          onStaleChange={setDispatchTimelineStale}
        />
      </div>
    </ErpWorkspacePage>
  );
}
