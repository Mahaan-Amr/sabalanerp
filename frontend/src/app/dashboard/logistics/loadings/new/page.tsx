"use client";
import {
  ErpCheckboxControl,
  ErpField,
  ErpInput,
  ErpNeumorphicInteractiveCard,
  ErpNeumorphicWorkflowProgress,
  ErpNeumorphicWorkflowNavigation,
  ErpTextarea,
} from "@/components/erp";
import { LogisticsPage } from "@/features/logistics/LogisticsWorkspace";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FaBuilding,
  FaFileContract,
  FaRulerCombined,
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaClipboardList,
  FaEye,
  FaPlus,
  FaSave,
  FaSearch,
  FaTrash,
  FaTruck,
  FaUser,
  FaUsers,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpLoading,
  ErpSummaryGrid,
  ErpSection,
  ErpSegmentedControl,
} from "@/components/erp";
import { logisticsAPI } from "@/lib/api";
import { saveCanonicalLoadingDraft } from "@/features/logistics/canonicalLoadingDraftWorkflow";
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";
import {
  numberFa,
  unitLabels,
} from "../../logistics-ui";

type WizardStep =
  "customer" | "project" | "contracts" | "driver" | "quantities" | "review";
type QuantityMode = "linear" | "direct";

type DraftLine = {
  key: string;
  source: any;
  groupKey: string;
  groupDisplayName: string;
  groupSnapshot: any;
  mode: QuantityMode;
  quantity: string;
  khatRas: string;
  pieceCount: string;
  plus: string;
  minus: string;
  notes: string;
};

const emptyDriver = {
  firstName: "",
  lastName: "",
  vehiclePlate: "",
  vehicleType: "",
  phone: "",
  nationalCode: "",
};

const steps: Array<{ id: WizardStep; label: string }> = [
  { id: "customer", label: "مشتری" },
  { id: "project", label: "پروژه" },
  { id: "contracts", label: "قراردادها" },
  { id: "driver", label: "راننده" },
  { id: "quantities", label: "مقدار" },
  { id: "review", label: "بازبینی" },
];

const driverFields = [
  ["firstName", "نام"],
  ["lastName", "نام خانوادگی"],
  ["vehiclePlate", "شماره پلاک"],
  ["vehicleType", "نوع ماشین"],
  ["phone", "شماره تماس"],
  ["nationalCode", "کد ملی"],
] as const;

const compactValue = (value: any) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") return numberFa(value);
  return String(value);
};

const productIdentityParts = (snapshot: any = {}) =>
  [
    snapshot.productType,
    snapshot.width ? `عرض ${compactValue(snapshot.width)}` : "",
    snapshot.thickness ? `ضخامت ${compactValue(snapshot.thickness)}` : "",
    snapshot.length
      ? `طول ${compactValue(snapshot.length)}${snapshot.lengthUnit || ""}`
      : "",
    snapshot.squareMeters
      ? `${compactValue(snapshot.squareMeters)} متر مربع`
      : "",
    snapshot.quantity
      ? `مقدار قراردادی ${compactValue(snapshot.quantity)}`
      : "",
    snapshot.preparedUnit ? `واحد ${snapshot.preparedUnit}` : "",
  ].filter(Boolean);

const detailNames = (value: any, fallback: string) => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(
      (item) =>
        item?.namePersian ||
        item?.name ||
        item?.title ||
        item?.serviceName ||
        item?.toolName ||
        fallback,
    )
    .filter(Boolean);
};

const productDetailBadges = (snapshot: any = {}) =>
  [
    ...detailNames(snapshot.tools, "ابزار").map((name) => `ابزار: ${name}`),
    ...detailNames(snapshot.services, "خدمات").map((name) => `خدمات: ${name}`),
    snapshot.finishing
      ? `پرداخت: ${snapshot.finishing?.namePersian || snapshot.finishing?.name || snapshot.finishingName || "انتخاب شده"}`
      : "",
    snapshot.description ? `توضیح: ${snapshot.description}` : "",
  ].filter(Boolean);

const sourceWithGroup = (source: any, group: any) => ({
  ...source,
  groupKey: group.groupKey,
  groupDisplayName: group.displayName,
  groupSnapshot: group.productSnapshot,
});

const lineFromSource = (source: any): DraftLine => ({
  key: `${source.contractItemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  source,
  groupKey: source.groupKey || `${source.productId}-${source.contractItemId}`,
  groupDisplayName:
    source.groupDisplayName || source.productSnapshot?.name || "محصول",
  groupSnapshot: source.groupSnapshot || source.productSnapshot,
  mode: source.unit === "meter" ? "linear" : "direct",
  quantity: "",
  khatRas: "",
  pieceCount: "",
  plus: "0",
  minus: "0",
  notes: "",
});

const lineFromLoadingLine = (line: any): DraftLine => {
  const sourceSnapshot = line.sourceSnapshot || {};
  const productSnapshot = line.productSnapshot || {};
  const source = {
    contractId: line.sourceContractId,
    contractNumber:
      sourceSnapshot.contractNumber ||
      line.sourceContract?.contractNumber ||
      "",
    contractItemId: line.sourceContractItemId,
    contractedQuantity:
      sourceSnapshot.contractedQuantity ||
      line.sourceContractItem?.quantity ||
      0,
    remainingQuantity: sourceSnapshot.remainingQuantity || line.quantity,
    unit: line.unit,
    unitLabel: unitLabels[line.unit] || "واحد ثبت‌شده",
    productSnapshot,
    groupKey:
      sourceSnapshot.groupKey ||
      `${line.productId}-${line.sourceContractItemId}`,
    groupDisplayName: productSnapshot.name || "محصول",
    groupSnapshot: productSnapshot,
  };

  return {
    key: line.id || `${line.sourceContractItemId}-${Date.now()}`,
    source,
    groupKey: source.groupKey,
    groupDisplayName: source.groupDisplayName,
    groupSnapshot: productSnapshot,
    mode: line.khatRas || line.pieceCount ? "linear" : "direct",
    quantity:
      line.khatRas || line.pieceCount ? "" : String(line.quantity || ""),
    khatRas: line.khatRas ? String(line.khatRas) : "",
    pieceCount: line.pieceCount ? String(line.pieceCount) : "",
    plus: String(line.plus || 0),
    minus: String(line.minus || 0),
    notes: line.notes || "",
  };
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

export default function NewLoadingPage() {
  const mutationLock = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draftId");

  const [activeQuantityDriverId, setActiveQuantityDriverId] = useState("");
  const [step, setStep] = useState<WizardStep>("customer");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [remaining, setRemaining] = useState<any>(null);
  const [expandedContracts, setExpandedContracts] = useState<
    Record<string, boolean>
  >({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);
  const [driverLineInputs, setDriverLineInputs] = useState<
    Record<string, Record<string, Partial<DraftLine>>>
  >({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectingProjectId, setSelectingProjectId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedProject = remaining?.project || draft?.project || projects.find(project => project.id === draft?.projectId);

  const selectedSourceIds = useMemo(
    () => new Set(lines.map((line) => line.source.contractItemId)),
    [lines],
  );
  const selectedDrivers = useMemo(
    () =>
      selectedDriverIds
        .map((id) => drivers.find((driver) => driver.id === id))
        .filter(Boolean),
    [drivers, selectedDriverIds],
  );

  const contracts = useMemo(() => {
    const byContract = new Map<string, any>();
    for (const group of remaining?.groups || []) {
      for (const rawSource of group.sources || []) {
        if (Number(rawSource.remainingQuantity || 0) <= 0) continue;
        const source = sourceWithGroup(rawSource, group);
        if (!byContract.has(source.contractId)) {
          byContract.set(source.contractId, {
            id: source.contractId,
            contractNumber: source.contractNumber,
            contractStatus: source.contractStatus,
            rows: [],
          });
        }
        byContract.get(source.contractId).rows.push(source);
      }
    }
    return Array.from(byContract.values()).sort((a, b) =>
      String(a.contractNumber).localeCompare(String(b.contractNumber)),
    );
  }, [remaining]);

  const groupedLines = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        displayName: string;
        snapshot: any;
        unit: string;
        unitLabel: string;
        lines: DraftLine[];
      }
    >();
    for (const line of lines) {
      if (!groups.has(line.groupKey)) {
        groups.set(line.groupKey, {
          key: line.groupKey,
          displayName: line.groupDisplayName,
          snapshot: line.groupSnapshot,
          unit: line.source.unit,
          unitLabel: unitLabels[line.source.unit] || "واحد ثبت‌شده",
          lines: [],
        });
      }
      groups.get(line.groupKey)!.lines.push(line);
    }
    return Array.from(groups.values());
  }, [lines]);

  const filteredDrivers = useMemo(() => {
    const search = normalizeSearch(driverSearch);
    const visible = drivers.filter(
      (driver) =>
        driver.queueStatus === "ENTERED_LOADING_AREA" ||
        driver.queueStatus === "RESERVED" ||
        selectedDriverIds.includes(driver.id),
    );
    if (!search) return visible;
    return visible.filter((driver) =>
      [
        driver.firstName,
        driver.lastName,
        driver.phone,
        driver.nationalCode,
        driver.vehiclePlate,
        driver.vehicleType,
        driver.reservedLoading?.loadingNumber,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(search),
      ),
    );
  }, [drivers, driverSearch, selectedDriverIds]);

  const loadCustomers = async () => {
    setError("");
    try {
      const response = await logisticsAPI.getLoadableCustomers(
        customerSearch ? { search: customerSearch } : undefined,
      );
      if (response.data.success) setCustomers(response.data.data);
    } catch (err: any) {
      setError(
        userFacingError(err, "دریافت مشتری‌های قابل بارگیری ناموفق بود."),
      );
    }
  };

  const loadCustomerProjects = async (customer: any) => {
    setError("");
    setSelectedCustomer(customer);
    setProjects([]);
    setDraft(null);
    setRemaining(null);
    setLines([]);
    try {
      const response = await logisticsAPI.getCustomerProjects(customer.id);
      if (response.data.success) setProjects(response.data.data);
      setStep("project");
    } catch (err: any) {
      setError(
        userFacingError(err, "دریافت پروژه‌های قابل بارگیری ناموفق بود."),
      );
    }
  };

  const loadRemaining = async (projectId: string) => {
    const response = await logisticsAPI.getRemaining(projectId);
    if (response.data.success) setRemaining(response.data.data);
  };

  const loadDrivers = async (loadingId?: string) => {
    const response = await logisticsAPI.getDrivers(
      loadingId ? { loadingId } : undefined,
    );
    if (response.data.success) setDrivers(response.data.data);
  };

  const syncDriverState = (loadingDraft: any, draftLines: DraftLine[]) => {
    const canonicalIds = (loadingDraft?.guardQueueTurns || [])
      .filter(
        (turn: any) =>
          turn.status === "RESERVED_FOR_LOADING" &&
          turn.loadingId === loadingDraft.id,
      )
      .map((turn: any) => turn.id);
    const canonicalDraftIds = (
      loadingDraft?.canonicalAllocationDrafts || []
    ).map((allocation: any) => allocation.queueTurnId);
    const legacyIds = (loadingDraft?.driverAssignments || [])
      .map((assignment: any) => assignment.queueTurnId)
      .filter(Boolean);
    setSelectedDriverIds(
      Array.from(
        new Set([...canonicalIds, ...canonicalDraftIds, ...legacyIds]),
      ),
    );

    const lineKeyBySourceId = new Map(
      draftLines.map((line) => [line.source.contractItemId, line.key]),
    );
    const restoredInputs: Record<
      string,
      Record<string, Partial<DraftLine>>
    > = {};
    for (const allocation of loadingDraft?.canonicalAllocationDrafts || []) {
      restoredInputs[allocation.queueTurnId] = {};
      for (const line of allocation.lines || []) {
        const lineKey = lineKeyBySourceId.get(line.sourceContractItemId);
        if (!lineKey) continue;
        restoredInputs[allocation.queueTurnId][lineKey] = {
          mode: "direct",
          quantity: String(line.quantity),
        };
      }
    }
    setDriverLineInputs(restoredInputs);
  };

  useEffect(() => {
    loadCustomers();
    loadDrivers();
  }, []);

  useEffect(() => {
    if (!draft?.id || step !== "driver") return undefined;
    void loadDrivers(draft.id);
    const handle = window.setInterval(() => {
      void loadDrivers(draft.id);
    }, 5000);
    return () => window.clearInterval(handle);
  }, [draft?.id, step]);

  useEffect(() => {
    if (!draftId) return;
    const loadDraft = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await logisticsAPI.getLoading(draftId);
        if (!response.data.success) return;
        const loadingDraft = response.data.data;
        setDraft(loadingDraft);
        setSelectedCustomer({
          id: loadingDraft.customerId,
          customerName:
            `${loadingDraft.customer?.firstName || ""} ${loadingDraft.customer?.lastName || ""}`.trim(),
          companyName: loadingDraft.customer?.companyName,
        });
        setProjects([
          {
            id: loadingDraft.projectId,
            projectName: loadingDraft.project?.projectName,
            address: loadingDraft.project?.address,
            city: loadingDraft.project?.city,
            customerId: loadingDraft.customerId,
          },
        ]);
        setNotes(loadingDraft.notes || "");
        const draftLines = (loadingDraft.lines || []).map(lineFromLoadingLine);
        syncDriverState(loadingDraft, draftLines);
        setLines(draftLines);
        await loadDrivers(loadingDraft.id);
        await loadRemaining(loadingDraft.projectId);
        setMessage("پیش‌نویس بارگیری برای ویرایش باز شد.");
        const hasReservedDriver = (loadingDraft.guardQueueTurns || []).some(
          (turn: any) =>
            turn.status === "RESERVED_FOR_LOADING" &&
            turn.loadingId === loadingDraft.id,
        );
        setStep(
          (loadingDraft.lines || []).length
            ? hasReservedDriver || loadingDraft.vehiclePairId
              ? "quantities"
              : "driver"
            : "contracts",
        );
      } catch (err: any) {
        setError(userFacingError(err, "دریافت پیش‌نویس ناموفق بود."));
      } finally {
        setLoading(false);
      }
    };
    loadDraft();
  }, [draftId]);

  const selectProject = async (projectId: string, forceNew = false) => {
    setError("");
    setMessage("");
    setSelectingProjectId(projectId);
    try {
      const response = await logisticsAPI.createOrResumeDraft(projectId, {
        forceNew,
      });
      if (!response.data.success) return;
      const loadingDraft = response.data.data;
      setDraft(loadingDraft);
      setNotes(loadingDraft.notes || "");
      const draftLines = (loadingDraft.lines || []).map(lineFromLoadingLine);
      syncDriverState(loadingDraft, draftLines);
      setLines(draftLines);
      await loadRemaining(projectId);
      setMessage(
        response.data.resumed
          ? "پیش‌نویس فعال این پروژه ادامه داده شد."
          : "پیش‌نویس بارگیری ساخته شد.",
      );
      setStep("contracts");
    } catch (err: any) {
      setError(userFacingError(err, "ساخت پیش‌نویس ناموفق بود."));
    } finally {
      setSelectingProjectId("");
    }
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const toggleSource = (source: any) => {
    if (selectedSourceIds.has(source.contractItemId)) {
      setLines((current) =>
        current.filter(
          (line) => line.source.contractItemId !== source.contractItemId,
        ),
      );
      return;
    }
    setLines((current) => [...current, lineFromSource(source)]);
  };

  const calculateLineQuantity = (line: DraftLine) => {
    if (line.mode === "linear") {
      const khatRas = Number(line.khatRas || 0);
      const pieceCount = Number(line.pieceCount || 0);
      const plus = Number(line.plus || 0);
      const minus = Number(line.minus || 0);
      return Math.max(0, khatRas * pieceCount + plus - minus);
    }
    return Number(line.quantity || 0);
  };

  const lineWithDriverInput = (
    driverIdValue: string,
    line: DraftLine,
  ): DraftLine => ({
    ...line,
    ...(driverLineInputs[driverIdValue]?.[line.key] || {}),
  });

  const calculateDriverLineQuantity = (
    driverIdValue: string,
    line: DraftLine,
  ) => calculateLineQuantity(lineWithDriverInput(driverIdValue, line));

  const calculateTotalLineQuantity = (line: DraftLine) =>
    selectedDriverIds.reduce(
      (sum, id) => sum + calculateDriverLineQuantity(id, line),
      0,
    );

  const driverCarriesAny = (driverIdValue: string) =>
    lines.some((line) => calculateDriverLineQuantity(driverIdValue, line) > 0);

  const updateDriverLineInput = (
    driverIdValue: string,
    lineKey: string,
    patch: Partial<DraftLine>,
  ) => {
    setDriverLineInputs((current) => ({
      ...current,
      [driverIdValue]: {
        ...(current[driverIdValue] || {}),
        [lineKey]: { ...(current[driverIdValue]?.[lineKey] || {}), ...patch },
      },
    }));
  };

  const fillLineWithRemaining = (line: DraftLine) => {
    updateLine(line.key, {
      mode: "direct",
      quantity: String(line.source.remainingQuantity || ""),
      khatRas: "",
      pieceCount: "",
      plus: "0",
      minus: "0",
    });
  };

  const buildLoadingPayload = () => ({
    projectId: draft?.projectId,
    notes,
    lines: lines.map((line) => {
      const quantity = selectedDriverIds.length
        ? calculateTotalLineQuantity(line)
        : calculateLineQuantity(line);
      return {
        sourceContractItemId: line.source.contractItemId,
        unit: line.source.unit,
        quantity,
        khatRas: null,
        pieceCount: null,
        plus: 0,
        minus: 0,
        productSnapshot: line.source.productSnapshot,
        sourceSnapshot: {
          contractId: line.source.contractId,
          contractNumber: line.source.contractNumber,
          contractItemId: line.source.contractItemId,
          contractedQuantity: line.source.contractedQuantity,
          remainingQuantity: line.source.remainingQuantity,
          groupKey: line.groupKey,
        },
        notes: line.notes,
      };
    }),
  });

  const buildCanonicalAllocations = () =>
    selectedDriverIds.map((queueTurnId) => ({
      queueTurnId,
      lines: lines.map((line) => {
        const driverLine = lineWithDriverInput(queueTurnId, line);
        return {
          sourceContractItemId: line.source.contractItemId,
          unit: line.source.unit,
          quantity: calculateLineQuantity(driverLine),
          khatRas: driverLine.mode === "linear" ? driverLine.khatRas : null,
          pieceCount:
            driverLine.mode === "linear" ? driverLine.pieceCount : null,
          plus: driverLine.mode === "linear" ? driverLine.plus : 0,
          minus: driverLine.mode === "linear" ? driverLine.minus : 0,
          productSnapshot: line.source.productSnapshot,
          sourceSnapshot: {
            contractId: line.source.contractId,
            contractNumber: line.source.contractNumber,
            contractItemId: line.source.contractItemId,
            contractedQuantity: line.source.contractedQuantity,
            remainingQuantity: line.source.remainingQuantity,
            groupKey: line.groupKey,
          },
          notes: driverLine.notes,
        };
      }),
    }));

  const saveDraft = async (lockOwned = false) => {
    if (!draft?.id) return false;
    if (!lockOwned && mutationLock.current) return false;
    if (!lockOwned) mutationLock.current = true;
    setError("");
    setSaving(true);
    try {
      const reservedTurnIds = (draft.guardQueueTurns || [])
        .filter(
          (turn: any) =>
            turn.status === "RESERVED_FOR_LOADING" &&
            turn.loadingId === draft.id,
        )
        .map((turn: any) => turn.id);
      const response = await saveCanonicalLoadingDraft({
        api: logisticsAPI,
        loadingId: draft.id,
        loadingPayload: buildLoadingPayload(),
        selectedTurnIds: selectedDriverIds,
        reservedTurnIds,
        allocations: hasValidLineQuantities ? buildCanonicalAllocations() : [],
      });
      if (response.data.success) {
        setDraft(response.data.data);
        await loadDrivers(draft.id);
        setMessage("پیش‌نویس ذخیره شد.");
        return true;
      }
    } catch (err: any) {
      setError(userFacingError(err, "ذخیره پیش‌نویس ناموفق بود."));
      try {
        const refreshed = await logisticsAPI.getLoading(draft.id);
        if (refreshed.data.success) setDraft(refreshed.data.data);
        await loadDrivers(draft.id);
      } catch {
        // Keep the original actionable save error when recovery refresh also fails.
      }
    } finally {
      if (!lockOwned) {
        mutationLock.current = false;
        setSaving(false);
      }
    }
    return false;
  };

  const toggleSelectedDriver = (driver: any) => {
    const selected = selectedDriverIds.includes(driver.id);
    if (
      !selected &&
      driver.queueStatus === "RESERVED" &&
      driver.reservedLoading?.id !== draft?.id
    )
      return;
    setSelectedDriverIds((current) =>
      selected
        ? current.filter((id) => id !== driver.id)
        : [...current, driver.id],
    );
    if (selected) {
      setDriverLineInputs((current) => {
        const next = { ...current };
        delete next[driver.id];
        return next;
      });
    }
  };

  const hasValidLineQuantities =
    lines.length > 0 &&
    selectedDriverIds.length > 0 &&
    lines.every((line) => calculateTotalLineQuantity(line) > 0) &&
    selectedDriverIds.every((id) => driverCarriesAny(id));
  const blockers = useMemo(() => {
    const items: string[] = [];
    if (!draft?.projectId) items.push("پروژه انتخاب نشده است.");
    if (!lines.length) items.push("حداقل یک ردیف بارگیری لازم است.");
    if (!selectedDriverIds.length)
      items.push("حداقل یک راننده وارد محوطه بارگیری باید انتخاب شود.");
    if (
      selectedDriverIds.length &&
      lines.some((line) => calculateTotalLineQuantity(line) <= 0)
    )
      items.push("جمع مقدار هر ردیف بین رانندگان باید بیشتر از صفر باشد.");
    if (selectedDriverIds.some((id) => !driverCarriesAny(id)))
      items.push("هر راننده انتخاب‌شده باید حداقل یک مقدار مثبت حمل کند.");
    return items;
  }, [draft, lines, selectedDriverIds, driverLineInputs]);

  const canEnterStep = (target: WizardStep) => {
    if (target === "customer") return true;
    if (target === "project") return Boolean(selectedCustomer);
    if (target === "contracts") return Boolean(draft?.id);
    if (target === "driver") return Boolean(draft?.id && lines.length);
    if (target === "quantities")
      return Boolean(draft?.id && lines.length && selectedDriverIds.length);
    return Boolean(draft?.id);
  };

  const blockedStepReason = (target: WizardStep) => {
    if (canEnterStep(target)) return undefined;
    if (target === "project") return "ابتدا مشتری را انتخاب کنید.";
    if (target === "contracts")
      return "ابتدا پروژه را انتخاب و پیش‌نویس را ایجاد کنید.";
    if (target === "driver")
      return "ابتدا حداقل یک ردیف قرارداد را انتخاب کنید.";
    if (target === "quantities") return "ابتدا راننده را انتخاب کنید.";
    return "ابتدا اطلاعات مراحل قبل را کامل کنید.";
  };

  const finalize = async () => {
    if (blockers.length) {
      setError("موارد لازم برای نهایی‌سازی را تکمیل کنید.");
      return;
    }
    if (mutationLock.current) return;
    mutationLock.current = true;
    setSaving(true);
    try {
      const saved = await saveDraft(true);
      if (!saved) return;
      const response = await logisticsAPI.finalizeLoading(draft.id);
      if (response.data.success)
        router.push(`/dashboard/logistics/loadings/${draft.id}`);
    } catch (err: any) {
      setError(userFacingError(err, "نهایی‌سازی ناموفق بود."));
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (step === "customer" && !selectedCustomer) {
      setError("ابتدا مشتری دارای مانده بارگیری را انتخاب کنید.");
      return;
    }
    if (step === "project" && !draft?.id) {
      setError("ابتدا پروژه را انتخاب کنید.");
      return;
    }
    if (step === "contracts" && !lines.length) {
      setError("حداقل یک ردیف از قراردادها را انتخاب کنید.");
      return;
    }
    if (step === "quantities" && !hasValidLineQuantities) {
      setError("مقدار همه ردیف‌ها باید بیشتر از صفر باشد.");
      return;
    }
    if (step === "driver" && !selectedDriverIds.length) {
      setError("حداقل یک راننده وارد محوطه بارگیری را انتخاب کنید.");
      return;
    }
    setError("");
    if (draft?.id && step !== "customer" && step !== "project") {
      const saved = await saveDraft();
      if (!saved) return;
    }
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.min(index + 1, steps.length - 1)].id);
  };

  const navigateToStep = async (target: WizardStep) => {
    if (target === step || !canEnterStep(target)) return;
    if (draft?.id && step !== "customer" && step !== "project") {
      const saved = await saveDraft();
      if (!saved) return;
    }
    setStep(target);
  };

  const goBack = async () => {
    if (draft?.id && step !== "customer" && step !== "project") {
      await saveDraft();
    }
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.max(index - 1, 0)].id);
  };

  const renderStepNav = () => (
    <ErpNeumorphicWorkflowProgress
      ariaLabel="مراحل بارگیری"
      currentStep={steps.findIndex(item => item.id === step)}
      clickable
      steps={steps.map((item, index) => ({
        id: index, label: item.label,
        icon: [FaUser, FaBuilding, FaFileContract, FaTruck, FaRulerCombined, FaCheck][index],
        disabled: !canEnterStep(item.id), disabledReason: blockedStepReason(item.id),
      }))}
      onStepClick={index => { void navigateToStep(steps[index].id); }}
    />
  );

  const renderCustomerStep = () => (
    <ErpSection
      title="انتخاب مشتری"
      description="فقط مشتری‌هایی نمایش داده می‌شوند که حداقل یک پروژه با مانده مثبت بارگیری دارند."
    >
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ErpField label="جستجوی مشتری">
          <ErpInput
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") loadCustomers();
            }}
          />
        </ErpField>
        <ErpButton label="جستجو" icon={FaSearch} onClick={loadCustomers} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {customers.map((customer) => (
          <ErpNeumorphicInteractiveCard
            key={customer.id}
            type="button"
            onClick={() => loadCustomerProjects(customer)}
            aria-pressed={selectedCustomer?.id === customer.id}
            className={`min-w-0 p-4 text-right ${
              selectedCustomer?.id === customer.id
                ? "border-[var(--sds-accent)] bg-[var(--sds-accent-soft)]"
                : "border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  {customer.customerName}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)]">
                  {[
                    customer.companyName,
                    customer.brandName,
                    customer.primaryPhone,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "بدون اطلاعات تکمیلی"}
                </p>
                {customer.projectManagerName && (
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                    مدیر پروژه: {customer.projectManagerName}{" "}
                    {customer.projectManagerNumber
                      ? `· ${customer.projectManagerNumber}`
                      : ""}
                  </p>
                )}
              </div>
              <ErpBadge tone="success">
                {numberFa(customer.loadableProjectCount, 0)} پروژه قابل بارگیری
              </ErpBadge>
            </div>
          </ErpNeumorphicInteractiveCard>
        ))}
        {!customers.length && (
          <ErpEmptyState icon={FaUser} title="مشتری قابل بارگیری پیدا نشد" />
        )}
      </div>
    </ErpSection>
  );

  const renderProjectStep = () => (
    <ErpSection
      title="انتخاب پروژه"
      description="فقط پروژه‌هایی که مانده مثبت بارگیری دارند قابل انتخاب هستند."
    >
      {selectedCustomer && (
        <ErpInlineState
          kind="success"
          className="mb-4"
          title={`مشتری انتخاب‌شده: ${selectedCustomer.customerName || selectedCustomer.companyName}`}
        />
      )}
      <div className="flex flex-col gap-2">
        {projects.map((project) => (
          <ErpNeumorphicInteractiveCard key={project.id} onClick={() => selectProject(project.id)} disabled={Boolean(selectingProjectId)} aria-pressed={draft?.projectId === project.id} className="p-4 text-right disabled:opacity-60">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  {project.projectName || project.address}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)]">
                  {[project.city, project.address].filter(Boolean).join(" · ")}
                </p>
                {(project.projectManagerName ||
                  project.projectManagerNumber) && (
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                    مدیر پروژه:{" "}
                    {[project.projectManagerName, project.projectManagerNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <ErpBadge tone="success">
                  {numberFa(project.remainingCount, 0)} گروه مانده
                </ErpBadge>
                <ErpBadge tone="primary">{selectingProjectId === project.id ? "در حال انتخاب..." : "انتخاب"}</ErpBadge>
              </div>
            </div>
          </ErpNeumorphicInteractiveCard>
        ))}
        {!projects.length && (
          <ErpEmptyState
            icon={FaTruck}
            title="این مشتری پروژه قابل بارگیری ندارد"
          />
        )}
      </div>
    </ErpSection>
  );

  const renderContractsStep = () => (
    <ErpSection
      title="انتخاب ردیف‌های قرارداد"
      description="فقط ردیف‌های دارای مانده قابل انتخاب‌اند."
    >
      {!remaining ? (
        <ErpEmptyState
          icon={FaClipboardList}
          title="ابتدا پروژه را انتخاب کنید"
        />
      ) : contracts.length === 0 ? (
        <ErpEmptyState
          icon={FaClipboardList}
          title="قرارداد قابل بارگیری برای این پروژه وجود ندارد"
        />
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => {
            const isOpen = expandedContracts[contract.id] ?? true;
            const selectedCount = contract.rows.filter((row: any) =>
              selectedSourceIds.has(row.contractItemId),
            ).length;
            return (
              <ErpCard key={contract.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                      قرارداد {contract.contractNumber}
                    </p>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                      {numberFa(contract.rows.length, 0)} ردیف قابل بارگیری ·{" "}
                      {numberFa(selectedCount, 0)} انتخاب‌شده
                    </p>
                  </div>
                  <ErpButton
                    label={isOpen ? "بستن جزئیات" : "مشاهده محصولات"}
                    icon={isOpen ? FaChevronUp : FaEye}
                    onClick={() =>
                      setExpandedContracts((current) => ({
                        ...current,
                        [contract.id]: !isOpen,
                      }))
                    }
                    tone="neutral"
                  />
                </div>
                {isOpen && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--sds-border-default)] text-xs text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)]">
                          <th className="px-3 py-3 text-right">محصول</th>
                          <th className="px-3 py-3 text-center">مانده</th>
                          <th className="px-3 py-3 text-left">انتخاب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contract.rows.map((source: any) => {
                          const selected = selectedSourceIds.has(
                            source.contractItemId,
                          );
                          const details = productDetailBadges(
                            source.productSnapshot,
                          );
                          return (
                            <tr
                              key={source.contractItemId}
                              className="border-b border-[var(--sds-border-default)] align-top dark:border-[var(--sds-border-strong)]"
                            >
                              <td className="px-3 py-4 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                                {source.productSnapshot?.name ||
                                  source.groupDisplayName}
                                <p className="mt-1 text-xs font-normal leading-6 sds-text-secondary">{productIdentityParts(
                                  source.productSnapshot,
                                ).join(" · ") || "بدون مشخصات"}</p>
                                <div className="flex max-w-md flex-wrap gap-1">
                                  {details.length ? (
                                    details.slice(0, 5).map((detail) => (
                                      <ErpBadge key={detail} tone="info">
                                        {detail}
                                      </ErpBadge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-[var(--sds-text-muted)]">
                                      بدون جزئیات افزوده
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-4 text-center">
                                <ErpBadge tone="success">
                                  {numberFa(source.remainingQuantity)}{" "}
                                  {source.unitLabel}
                                </ErpBadge>
                              </td>
                              <td className="px-3 py-4 text-left">
                                <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                                  <ErpCheckboxControl aria-label={`انتخاب ${source.productSnapshot?.name || source.groupDisplayName} از قرارداد ${contract.contractNumber}`} checked={selected} onChange={() => toggleSource(source)} />
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </ErpCard>
            );
          })}
        </div>
      )}
    </ErpSection>
  );

  const renderLineQuantityInputs = (line: DraftLine) => (
    <div className="sds-neumorphic-card mt-3 min-w-0 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
            قرارداد {line.source.contractNumber}
          </p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
            مانده قابل بارگیری: {numberFa(line.source.remainingQuantity)}{" "}
            {line.source.unitLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ErpButton
            label="پر کردن با کل مانده"
            onClick={() => fillLineWithRemaining(line)}
            tone="neutral"
            variant="soft"
          />
          <ErpButton
            label="حذف"
            icon={FaTrash}
            onClick={() => removeLine(line.key)}
            tone="danger"
            variant="soft"
          />
        </div>
      </div>
      {line.source.unit === "meter" && (
        <div className="mt-3">
          <ErpSegmentedControl<QuantityMode>
            value={line.mode}
            onChange={(value) => updateLine(line.key, { mode: value })}
            options={[
              { value: "linear", label: "خط راس" },
              { value: "direct", label: "مقدار مستقیم" },
            ]}
          />
        </div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        {line.mode === "linear" ? (
          <>
            <ErpField label="خط راس">
              <ErpInput
                value={line.khatRas}
                onChange={(event) =>
                  updateLine(line.key, { khatRas: event.target.value })
                }
              />
            </ErpField>
            <ErpField label="تعداد">
              <ErpInput
                value={line.pieceCount}
                onChange={(event) =>
                  updateLine(line.key, { pieceCount: event.target.value })
                }
              />
            </ErpField>
            <ErpField label="اضافه">
              <ErpInput
                value={line.plus}
                onChange={(event) =>
                  updateLine(line.key, { plus: event.target.value })
                }
              />
            </ErpField>
            <ErpField label="کسر">
              <ErpInput
                value={line.minus}
                onChange={(event) =>
                  updateLine(line.key, { minus: event.target.value })
                }
              />
            </ErpField>
          </>
        ) : (
          <ErpField label="مقدار مستقیم">
            <ErpInput
              value={line.quantity}
              onChange={(event) =>
                updateLine(line.key, { quantity: event.target.value })
              }
            />
          </ErpField>
        )}
      </div>
      <p className="mt-2 text-xs font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
        مقدار محاسبه‌شده: {numberFa(calculateLineQuantity(line))}{" "}
        {unitLabels[line.source.unit] || "واحد ثبت‌شده"}
      </p>
    </div>
  );

  const renderDriverLineQuantityInputs = (driver: any, line: DraftLine) => {
    const driverLine = lineWithDriverInput(driver.id, line);
    const update = (patch: Partial<DraftLine>) =>
      updateDriverLineInput(driver.id, line.key, patch);
    return (
      <div className="sds-neumorphic-card mt-3 min-w-0 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
              قرارداد {line.source.contractNumber}
            </p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
              مانده قابل بارگیری: {numberFa(line.source.remainingQuantity)}{" "}
              {line.source.unitLabel}
            </p>
          </div>
          <ErpBadge
            tone={
              calculateDriverLineQuantity(driver.id, line) > 0
                ? "success"
                : "neutral"
            }
          >
            مقدار این راننده:{" "}
            {numberFa(calculateDriverLineQuantity(driver.id, line))}{" "}
            {unitLabels[line.source.unit] || "واحد ثبت‌شده"}
          </ErpBadge>
        </div>
        {line.source.unit === "meter" && (
          <div className="mt-3">
            <ErpSegmentedControl<QuantityMode>
              value={driverLine.mode}
              onChange={(value) => update({ mode: value })}
              options={[
                { value: "linear", label: "خط راس" },
                { value: "direct", label: "مقدار مستقیم" },
              ]}
            />
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          {driverLine.mode === "linear" ? (
            <>
              <ErpField label="خط راس">
                <ErpInput
                  value={driverLine.khatRas}
                  onChange={(event) => update({ khatRas: event.target.value })}
                />
              </ErpField>
              <ErpField label="تعداد">
                <ErpInput
                  value={driverLine.pieceCount}
                  onChange={(event) =>
                    update({ pieceCount: event.target.value })
                  }
                />
              </ErpField>
              <ErpField label="اضافه">
                <ErpInput
                  value={driverLine.plus}
                  onChange={(event) => update({ plus: event.target.value })}
                />
              </ErpField>
              <ErpField label="کسر">
                <ErpInput
                  value={driverLine.minus}
                  onChange={(event) => update({ minus: event.target.value })}
                />
              </ErpField>
            </>
          ) : (
            <ErpField label="مقدار مستقیم">
              <ErpInput
                value={driverLine.quantity}
                onChange={(event) => update({ quantity: event.target.value })}
              />
            </ErpField>
          )}
        </div>
      </div>
    );
  };

  const renderQuantitiesStep = () => (
    <ErpSection
      title="مقداردهی بر اساس راننده"
      description="برای هر راننده مشخص کنید چه مقدار از هر ردیف را حمل می‌کند. خالی یا صفر یعنی آن راننده آن ردیف را حمل نمی‌کند."
    >
      {groupedLines.length === 0 ? (
        <ErpEmptyState
          icon={FaClipboardList}
          title="هنوز ردیفی انتخاب نشده است"
          action={{
            label: "رفتن به قراردادها",
            onClick: () => setStep("contracts"),
            icon: FaPlus,
          }}
        />
      ) : selectedDrivers.length === 0 ? (
        <ErpEmptyState
          icon={FaTruck}
          title="راننده‌ای انتخاب نشده است"
          action={{
            label: "رفتن به راننده",
            onClick: () => setStep("driver"),
            icon: FaTruck,
          }}
        />
      ) : (
        <div className="space-y-4">
          <ErpSegmentedControl
            value={selectedDrivers.some(driver => driver.id === activeQuantityDriverId) ? activeQuantityDriverId : selectedDrivers[0]?.id || ""}
            onChange={setActiveQuantityDriverId}
            options={selectedDrivers.map(driver => ({ value: driver.id, label: [driver.firstName, driver.lastName].filter(Boolean).join(" ") }))}
          />
          {selectedDrivers.filter(driver => driver.id === (selectedDrivers.some(candidate => candidate.id === activeQuantityDriverId) ? activeQuantityDriverId : selectedDrivers[0]?.id)).map((driver) => (
            <ErpCard key={driver.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                    {driver.firstName} {driver.lastName}
                  </p>
                  <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                    {driver.vehiclePlate} · {driver.vehicleType}
                  </p>
                </div>
                <ErpBadge
                  tone={driverCarriesAny(driver.id) ? "success" : "warning"}
                >
                  {driverCarriesAny(driver.id) ? "دارای مقدار" : "بدون مقدار"}
                </ErpBadge>
              </div>
              <div className="mt-3 space-y-3">
                {groupedLines.map((group) => (
                  <div
                    key={`${driver.id}-${group.key}`}
                    className="rounded-xl border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]"
                  >
                    <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                      {group.displayName}
                    </p>
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                      {productIdentityParts(group.snapshot).join(" · ") ||
                        "بدون مشخصات"}
                    </p>
                    {group.lines.map((line) => (
                      <div key={`${driver.id}-${line.key}`}>
                        {renderDriverLineQuantityInputs(driver, line)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ErpCard>
          ))}
          <ErpCard className="p-4" tone="info">
            <p className="mb-3 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
              جمع ردیف‌ها
            </p>
            <div className="space-y-2">
              {lines.map((line) => (
                <div
                  key={line.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--sds-surface-raised)] p-3 text-sm dark:bg-[var(--sds-surface-raised)]"
                >
                  <span>
                    قرارداد {line.source.contractNumber} ·{" "}
                    {line.groupDisplayName}
                  </span>
                  <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                    {numberFa(calculateTotalLineQuantity(line))}{" "}
                    {unitLabels[line.source.unit] || "واحد ثبت‌شده"}
                  </span>
                </div>
              ))}
            </div>
          </ErpCard>
        </div>
      )}
    </ErpSection>
  );

  const renderDriverStep = () => (
    <ErpSection
      title="انتخاب رانندگان آماده بارگیری"
      description="می‌توانید چند راننده آماده بارگیری انتخاب کنید."
    >
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ErpField label="جستجوی راننده">
        <ErpInput
          value={driverSearch}
          onChange={(event) => setDriverSearch(event.target.value)}
          placeholder="نام، موبایل، کد ملی، پلاک یا نوع خودرو"
        />
        </ErpField>
        <ErpButton
          label="به‌روزرسانی"
          icon={FaSearch}
          variant="soft"
          onClick={() => {
            void loadDrivers();
          }}
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filteredDrivers.map((driver) => {
          const selected = selectedDriverIds.includes(driver.id);
          const reservedForOther =
            driver.queueStatus === "RESERVED" &&
            driver.reservedLoading?.id !== draft?.id &&
            !selected;
          return (
            <ErpNeumorphicInteractiveCard
              key={driver.id}
              type="button"
              onClick={() => toggleSelectedDriver(driver)}
              disabled={reservedForOther}
              aria-pressed={selected}
              className={`min-w-0 p-4 text-right disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "border-[var(--sds-accent)] bg-[var(--sds-accent-soft)]"
                  : "border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                    {driver.firstName} {driver.lastName}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)]">
                    {[
                      driver.vehiclePlate,
                      driver.vehicleType,
                      driver.phone,
                      driver.nationalCode,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {driver.enteredLoadingAreaAt && (
                    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                      ورود برای بارگیری:{" "}
                      {new Date(driver.enteredLoadingAreaAt).toLocaleString(
                        "fa-IR",
                      )}
                    </p>
                  )}
                </div>
                <ErpBadge
                  tone={
                    selected
                      ? "success"
                      : reservedForOther
                        ? "warning"
                        : "neutral"
                  }
                >
                  {selected
                    ? "انتخاب شده"
                    : reservedForOther
                      ? `رزرو شده برای ${driver.reservedLoading?.loadingNumber ? dispatchCaseReference(driver.reservedLoading.loadingNumber) : "بارگیری دیگر"}`
                      : "آماده بارگیری"}
                </ErpBadge>
              </div>
            </ErpNeumorphicInteractiveCard>
          );
        })}
        {!filteredDrivers.length && (
          <ErpEmptyState
            icon={FaUsers}
            title="راننده آماده بارگیری وجود ندارد"
            description="گارد باید از نوبت‌دهی روی «ورود برای بارگیری» کلیک کند."
          />
        )}
      </div>
      {selectedDrivers.length > 0 && (
        <ErpCard className="mt-4 p-4" tone="info">
          <p className="mb-3 font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
            رانندگان انتخاب‌شده
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {selectedDrivers.map((driver) => (
              <div
                key={driver.id}
                className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 text-sm dark:bg-[var(--sds-surface-raised)]"
              >
                <span className="font-semibold">
                  {driver.firstName} {driver.lastName}
                </span>
                <span className="block text-xs text-[var(--sds-text-secondary)]">
                  {driver.vehiclePlate} · {driver.vehicleType}
                </span>
              </div>
            ))}
          </div>
        </ErpCard>
      )}
    </ErpSection>
  );

  const renderReviewStep = () => (
    <ErpSection title="بازبینی و نهایی‌سازی">
      <div className="space-y-4">
        <div className="space-y-3">
          <ErpSummaryGrid columns={4} items={[
            { label: "مشتری", value: selectedCustomer?.customerName || remaining?.project?.customerName || "انتخاب نشده" },
            { label: "پروژه", value: selectedProject?.projectName || selectedProject?.address || "—" },
            { label: "رانندگان", value: selectedDrivers.length ? selectedDrivers.map(driver => [driver.firstName, driver.lastName, driver.vehiclePlate, driver.vehicleType].filter(Boolean).join(" · ")).join("، ") : "انتخاب نشده" },
            { label: "اقلام بار", value: `${numberFa(lines.length, 0)} ردیف` },
          ]} />
          <div className="overflow-x-auto"><table className="w-full text-right text-sm">
            <thead><tr className="sds-text-secondary"><th className="p-3">محصول / قرارداد</th>{selectedDrivers.map(driver => <th key={driver.id} className="p-3">{driver.firstName} {driver.lastName}</th>)}<th className="p-3">جمع</th></tr></thead>
            <tbody>{lines.map(line => <tr key={line.key} className="border-t border-[var(--sds-border-subtle)]"><td className="p-3">{line.groupDisplayName}<p className="text-xs sds-text-secondary">قرارداد {line.source.contractNumber}</p></td>{selectedDrivers.map(driver => <td key={driver.id} className="p-3">{numberFa(calculateDriverLineQuantity(driver.id, line))}</td>)}<td className="p-3">{numberFa(calculateTotalLineQuantity(line))} {unitLabels[line.source.unit] || "واحد ثبت‌شده"}</td></tr>)}</tbody>
          </table></div>
          <ErpField label="یادداشت">
            <ErpTextarea
              className="min-h-28"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </ErpField>
        </div>
        <ErpCard className="p-4">
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
            آمادگی نهایی‌سازی
          </p>
          <div className="mt-3 space-y-2">
            {blockers.length === 0 ? (
              <ErpInlineState kind="success" title="همه موارد تکمیل است." />
            ) : (
              blockers.map((blocker) => (
                <ErpInlineState key={blocker} kind="stale" title={blocker} />
              ))
            )}
          </div>
        </ErpCard>
      </div>
    </ErpSection>
  );

  if (loading) return <ErpLoading />;

  return (
    <LogisticsPage
      eyebrow="لجستیک"
      title="بارگیری جدید"
      backHref="/dashboard/logistics/loadings"
      actions={[
        {
          label: saving ? "در حال ذخیره..." : "ذخیره پیش‌نویس",
          icon: FaSave,
          onClick: saveDraft,
          disabled: saving || !draft?.id,
          tone: "neutral",
        },
      ]}
    >
      {renderStepNav()}
      {message && <ErpInlineState kind="success" title={message} />}
      {error && <ErpInlineState kind="error" title={error} />}

      {selectedCustomer && selectedProject && !["customer", "project"].includes(step) && (
        <div className="flex flex-wrap gap-6 text-sm sds-text-secondary">
          <div>مشتری: <strong className="sds-text-primary">{selectedCustomer.customerName || selectedCustomer.companyName}</strong></div>
          <div>پروژه: <strong className="sds-text-primary">{selectedProject.projectName || selectedProject.address}</strong></div>
          {draft?.loadingNumber && <div>{dispatchCaseReference(draft.loadingNumber)}</div>}
        </div>
      )}
      {step === "customer" && renderCustomerStep()}
      {step === "project" && renderProjectStep()}
      {step === "contracts" && renderContractsStep()}
      {step === "quantities" && renderQuantitiesStep()}
      {step === "driver" && renderDriverStep()}
      {step === "review" && renderReviewStep()}

      <ErpNeumorphicWorkflowNavigation
        primaryLabel={step === "review" ? "نهایی‌سازی" : "بعدی"}
        primaryIcon={step === "review" ? FaCheck : FaArrowLeft}
        previousLabel="قبلی" previousIcon={FaArrowRight}
        counterLabel={`مرحله ${(steps.findIndex(item => item.id === step) + 1).toLocaleString("fa-IR")} از ۶`}
        onPrimary={() => { void (step === "review" ? finalize() : goNext()); }}
        onPrevious={() => { void goBack(); }}
        primaryDisabled={step === "review" && blockers.length > 0}
        previousDisabled={step === "customer" || saving}
        pending={saving}
      />
    </LogisticsPage>
  );
}
