"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaArchive,
  FaEdit,
  FaLink,
  FaPlus,
  FaSync,
  FaTruck,
  FaUserCheck,
} from "react-icons/fa";
import {
  ErpAction,
  ErpActionMenu,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpDisclosure,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpSection,
  ErpSegmentedControl,
  ErpSearchableSelect,
  ErpSheet,
  ErpTextarea,
  ErpWorkspacePage,
} from "@/components/erp";
import UnifiedVehicleRegistry, { RegistrySource } from "./UnifiedVehicleRegistry";
import { externalOperationsApi } from "./externalOperationsApi";
import { dispatchMasterDataAPI } from "@/lib/api";
import { assertSuccessfulOperationalResponse } from "@/lib/operationalError";
import { hrOperationsError } from "@/features/dispatch-master-data/hrOperationsError";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import { dateTimeFa, fromIsoDate, toIsoDate } from "@/features/hr/hrUi";
import { readinessBlockerLabel } from "@/features/dispatch-master-data/readinessPresentation";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import CompanyPlateFields from "@/features/dispatch-master-data/CompanyPlateFields";
import {
  emptyCompanyPlate,
  completeCompanyPlate,
  formatCompanyPlate,
  manufactureYears,
  validManufactureYear,
} from "@/features/dispatch-master-data/companyVehicleEntry";
import { currentEffectivePlate } from "@/features/dispatch-master-data/vehicleAssignmentOptions";
import {
  assignmentDateTime,
  tehranToday,
  vehicleOperationsCalendarMaxYear,
} from "@/features/dispatch-master-data/vehicleOperationsCalendar";

const field = "space-y-1.5 text-sm font-medium sds-text-secondary";
const newVehicle = () => ({
  id: "",
  fleetCode: "",
  vehicleType: "",
  make: "",
  model: "",
  manufactureYear: "",
  vin: "",
  notes: "",
  registrationReference: "",
  plate: emptyCompanyPlate,
});
const newAssignment = () => ({
  driverId: "",
  vehicleId: "",
  mode: "now" as "now" | "future",
  date: tehranToday(new Date(Date.now() + 86400000)),
  time: "08:00",
  endDate: "",
  endTime: "08:00",
});
const personName = (driver: any) =>
  driver?.personnel
    ? driver.personnel.firstName + " " + driver.personnel.lastName
    : driver ? `${driver.firstName || ""} ${driver.lastName || ""}`.trim() : "راننده";
const vehicleName = (vehicle: any) =>
  currentEffectivePlate(
    { ...vehicle, plates: vehicle?.plates || [] },
    new Date().toISOString(),
  )?.plate ||
  vehicle?.fleetCode ||
  "خودرو";
const planLabel = (plan: any) =>
  personName(plan.driver) +
  " · " +
  vehicleName(plan.vehicle) +
  " · " +
  (plan.action === "END" ? "پایان تخصیص: " : "شروع تخصیص: ") +
  dateTimeFa(plan.effectiveFrom);
const isPending = (plan: any) =>
  ["PLANNED", "NEEDS_ATTENTION"].includes(plan.status);

type Confirmation = {
  title: string;
  lines: string[];
  action: () => Promise<any>;
  success: string;
  tone?: "danger" | "warning" | "success";
};
export default function VehicleOperationsWorkspace({ initialSource = "INTERNAL", workspace = "hr" }: { initialSource?: "INTERNAL" | "EXTERNAL"; workspace?: "hr" | "security" }) {
 const [source, setSource] = useState<RegistrySource>(initialSource);
 if (source === "ALL") return <UnifiedVehicleRegistry workspace={workspace} onSourceChange={setSource} />;
 return <VehicleOperationsRuntime key={source} external={source === "EXTERNAL"} workspace={workspace} onSourceChange={setSource} />;
}
function VehicleOperationsRuntime({ external, workspace, onSourceChange }: {external: boolean; workspace: "hr" | "security"; onSourceChange: (value: RegistrySource) => void}) {
 const operationsApi = external ? externalOperationsApi : dispatchMasterDataAPI;
 const [externalIdentity, setExternalIdentity] = useState({ firstName: "", lastName: "", nationalCode: "", phone: "" });
  const mutationLock = useRef(false);
  const [section, setSection] = useState<
    "drivers" | "vehicles" | "assignments" | "dispatch"
  >("drivers");
  const [drivers, setDrivers] = useState<any[]>([]);
  const [legacyPairs, setLegacyPairs] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [personnelId, setPersonnelId] = useState("");
  const [capabilities, setCapabilities] = useState({
    canManageEligibility: false,
    canManageProfiles: false,
    canManageCompanyVehicles: false,
    canManagePlates: false,
    canManageAssignments: false,
  });
  const [showArchived, setShowArchived] = useState(false);
  const [vehicleForm, setVehicleForm] = useState(newVehicle);
  const [profileForm, setProfileForm] = useState({
    driverId: "",
    licenceNumber: "",
    licenceClass: "",
    licenceExpiresAt: "",
    notes: "",
  });
  const [plateForm, setPlateForm] = useState({
    vehicleId: "",
    plate: emptyCompanyPlate,
  });
  const [assignmentForm, setAssignmentForm] = useState(newAssignment);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [dialog, setDialog] = useState<
    "driver" | "profile" | "vehicle" | "plate" | "confirm" | null
  >(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const maxYear = vehicleOperationsCalendarMaxYear();

  const load = useCallback(async () => {
    try {
      const [driverResponse, vehicleResponse, assignmentResponse] =
        await Promise.all([
          operationsApi.getVehicleOperationsDrivers(),
          operationsApi.getCompanyVehicles({ archived: "include" }),
          operationsApi.getVehicleAssignments(),
        ]);
      [driverResponse, vehicleResponse, assignmentResponse].forEach(
        assertSuccessfulOperationalResponse,
      );
      setDrivers(driverResponse.data.data || []);
      setLegacyPairs(external ? (driverResponse.data.legacyPairs || []) : []);
      setVehicles(vehicleResponse.data.data || []);
      setAssignments(assignmentResponse.data.data.assignments || []);
      setPlans(assignmentResponse.data.data.plans || []);
      setCapabilities(
        driverResponse.data.capabilities || vehicleResponse.data.capabilities,
      );
      return true;
    } catch (requestError) {
      setError(
        hrOperationsError(requestError, {
          failedAction: "دریافت فهرست رانندگان و خودروها",
          nextStep: "به‌روزرسانی را دوباره بزنید",
        }),
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [operationsApi, external]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!mutationLock.current && document.visibilityState === "visible")
        void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);
  const close = () => {
    if (!saving) {
      setDialog(null);
      setConfirmation(null);
    }
  };
  const run = async (action: () => Promise<any>, success: string) => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await action();
      assertSuccessfulOperationalResponse(response);
      setMessage(response.data.message || success);
      const refreshed = await load();
      if (!refreshed)
        setMessage(
          (response.data.message || success) +
            " دریافت فهرست تازه ناموفق بود؛ به‌روزرسانی را بزنید.",
        );
      return true;
    } catch (requestError) {
      setError(
        hrOperationsError(requestError, {
          failedAction: "ذخیره تغییرات",
          nextStep: "اطلاعات و وضعیت فعلی را بررسی کنید",
          preserveInput: true,
          uncertainMutation: true,
        }),
      );
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };
  const confirm = (value: Confirmation) => {
    setError("");
    setConfirmation(value);
    setDialog("confirm");
  };
  const pendingPlansFor = (kind: "driver" | "vehicle", id: string) =>
    plans.filter(
      (plan) =>
        isPending(plan) &&
        (kind === "driver" ? plan.driverId === id : plan.vehicleId === id),
    );
  const startAssignment = (driver: any) => {
    setAssignmentForm({ ...newAssignment(), driverId: driver.id });
    setEditingPlan(null);
    setError("");
    setSection("assignments");
  };
  const endAssignment = (assignment: any) => {
    const endPlans = plans.filter(
      (plan) => isPending(plan) && plan.assignmentId === assignment.id,
    );
    confirm({
      title: "پایان تخصیص خودرو",
      tone: "warning",
      lines: [
        personName(assignment.driver) + " · " + vehicleName(assignment.vehicle),
        "تخصیص از همین لحظه پایان می‌یابد؛ سابقه حفظ می‌شود.",
        ...endPlans.map((plan) => "لغو برنامه: " + planLabel(plan)),
      ],
      action: () =>
        operationsApi.endVehicleAssignment(assignment.id, {
          confirmed: true,
          cancelPlanIds: endPlans.map((plan) => plan.id),
        }),
      success: "تخصیص خودرو پایان یافت.",
    });
  };
  const changeStatus = (
    kind: "driver" | "vehicle",
    record: any,
    status: string,
  ) => {
    const related = pendingPlansFor(kind, record.id);
    const ending = status === "ARCHIVED";
    confirm({
      title: ending
        ? kind === "driver"
          ? "پایان فعالیت رانندگی"
          : "بایگانی خودرو"
        : status === "DRAFT"
          ? "بازگردانی به پیش‌نویس"
          : "تغییر وضعیت",
      tone: ending ? "danger" : "success",
      lines: [
        kind === "driver" ? personName(record) : vehicleName(record),
        ...(ending
          ? [
              kind === "driver"
                ? external ? "راننده بایگانی و تخصیص جاری بسته می‌شود؛ سوابق حفظ می‌شوند." : "صلاحیت پایان می‌یابد، پروفایل بایگانی و تخصیص جاری بسته می‌شود؛ پرونده پرسنل باقی می‌ماند."
                : "خودرو بایگانی و تخصیص جاری پایان می‌یابد؛ سوابق حفظ می‌شوند.",
              ...related.map((plan) => "لغو برنامه: " + planLabel(plan)),
            ]
          : [
              status === "DRAFT"
                ? "به پیش‌نویس بازمی‌گردد؛ تخصیص قبلی خودکار باز نمی‌شود."
                : "وضعیت جدید: " + operationalStatusLabel(status),
            ]),
      ],
      action: () =>
        kind === "driver"
          ? ending
            ? operationsApi.endInternalDriverActivity(record.id, {
                confirmed: true,
                cancelPlanIds: related.map((plan) => plan.id),
              })
            : operationsApi.transitionInternalDrivingProfile(
                record.id,
                { status },
              )
          : operationsApi.transitionCompanyVehicleStatus(record.id, {
              status,
              confirmed: true,
              cancelPlanIds: ending ? related.map((plan) => plan.id) : [],
            }),
      success: "وضعیت ثبت شد.",
    });
  };
  const assignmentPayload = () => ({
    driverId: assignmentForm.driverId,
    vehicleId: assignmentForm.vehicleId,
    effectiveFrom:
      assignmentForm.mode === "now"
        ? "NOW"
        : assignmentDateTime(assignmentForm.date, assignmentForm.time),
    effectiveTo: assignmentForm.endDate
      ? assignmentDateTime(assignmentForm.endDate, assignmentForm.endTime)
      : null,
  });
  const prepareAssignment = async (executePlan?: any) => {
    if (mutationLock.current) return;
    const payload = executePlan
      ? {
          driverId: executePlan.driverId,
          vehicleId: executePlan.vehicleId,
          effectiveFrom: "NOW",
          effectiveTo: executePlan.effectiveTo,
          ignorePlanId: executePlan.id,
        }
      : { ...assignmentPayload(), ignorePlanId: editingPlan?.id };
    if (
      !editingPlan &&
      !executePlan &&
      payload.effectiveFrom === "NOW" &&
      !payload.effectiveTo &&
      drivers.find((driver) => driver.id === payload.driverId)
        ?.currentAssignment?.vehicleId === payload.vehicleId
    ) {
      await run(
        () => operationsApi.assignCompanyVehicle(payload),
        "این خودرو از قبل به این راننده تخصیص دارد.",
      );
      return;
    }
    mutationLock.current = true;
    setSaving(true);
    setError("");
    try {
      const response =
        await operationsApi.previewVehicleAssignment(payload);
      assertSuccessfulOperationalResponse(response);
      const preview = response.data.data;
      const endOnly =
        payload.effectiveFrom === "NOW" &&
        Boolean(payload.effectiveTo) &&
        preview.current.length === 1 &&
        preview.current[0].driverId === payload.driverId &&
        preview.current[0].vehicleId === payload.vehicleId;
      const input = {
        ...payload,
        confirmed: true,
        expectedAssignmentIds: preview.current.map((item: any) => item.id),
        cancelPlanIds: preview.conflictingPlans.map((plan: any) => plan.id),
        expectedUpdatedAt: (executePlan || editingPlan)?.updatedAt,
      };
      confirm({
        title: executePlan
          ? "اجرای برنامه تخصیص"
          : editingPlan
            ? "تأیید تغییر برنامه"
            : endOnly
              ? "برنامه پایان تخصیص"
              : "تأیید تخصیص خودرو",
        lines: [
          personName(preview.driver) + " ← " + vehicleName(preview.vehicle),
          ...(endOnly
            ? ["تخصیص جاری تا موعد پایان حفظ می‌شود."]
            : [
                "شروع: " +
                  (payload.effectiveFrom === "NOW"
                    ? "همین حالا"
                    : dateTimeFa(payload.effectiveFrom)),
              ]),
          ...(payload.effectiveTo
            ? ["پایان برنامه‌ریزی‌شده: " + dateTimeFa(payload.effectiveTo)]
            : []),
          ...(endOnly
            ? []
            : preview.current.map(
                (item: any) =>
                  "پایان تخصیص قبلی: " +
                  personName(item.driver) +
                  " · " +
                  vehicleName(item.vehicle),
              )),
          ...(preview.anticipatedPlans || []).map(
            (plan: any) =>
              "تخصیص قبلی طبق این برنامه پیش از موعد پایان می‌یابد: " +
              planLabel(plan),
          ),
          ...preview.conflictingPlans.map(
            (plan: any) =>
              "با تأیید شما این برنامه لغو می‌شود: " + planLabel(plan),
          ),
        ],
        action: () =>
          executePlan
            ? operationsApi.executeVehicleAssignmentPlan(
                executePlan.id,
                input,
              )
            : editingPlan
              ? operationsApi.updateVehicleAssignmentPlan(
                  editingPlan.id,
                  input,
                )
              : operationsApi.assignCompanyVehicle(input),
        success: "تخصیص یا برنامه خودرو ثبت شد.",
      });
    } catch (requestError) {
      setError(
        hrOperationsError(requestError, {
          failedAction: "بررسی تخصیص",
          nextStep: "شرایط راننده، خودرو و برنامه‌های موجود را بررسی کنید",
          preserveInput: true,
        }),
      );
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };
  const editPlan = (plan: any) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(plan.effectiveFrom));
    const part = (name: string) =>
      parts.find((item) => item.type === name)?.value || "";
    const endParts = plan.effectiveTo
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tehran",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(plan.effectiveTo))
      : [];
    const endPart = (name: string) =>
      endParts.find((item) => item.type === name)?.value || "";
    setAssignmentForm({
      driverId: plan.driverId,
      vehicleId: plan.vehicleId,
      mode: "future",
      date: part("year") + "-" + part("month") + "-" + part("day"),
      time: part("hour") + ":" + part("minute"),
      endDate: plan.effectiveTo
        ? endPart("year") + "-" + endPart("month") + "-" + endPart("day")
        : "",
      endTime: plan.effectiveTo
        ? endPart("hour") + ":" + endPart("minute")
        : "08:00",
    });
    setEditingPlan(plan);
    setError("");
    setSection("assignments");
  };
  const errorState = error ? (
    <ErpInlineState kind="error" title={error} />
  ) : null;
  const footer = (label: string, action: () => void, disabled = false) => (
    <div className="flex flex-wrap justify-end gap-2">
      <ErpButton
        label="انصراف"
        variant="ghost"
        disabled={saving}
        onClick={close}
      />
      <ErpButton
        label={label}
        variant="solid"
        disabled={saving || dispatchTimelineStale || disabled}
        onClick={action}
      />
    </div>
  );
  const identityFields = (Object.entries({firstName: "نام", lastName: "نام خانوادگی", nationalCode: "کد ملی", phone: "شماره همراه"}) as [keyof typeof externalIdentity, string][]).map(([key, label]) =>
    <label key={key} className={field}>{label}<ErpInput required value={externalIdentity[key]} onChange={e => setExternalIdentity({...externalIdentity, [key]: e.target.value})} /></label>);
  if (loading) return <ErpLoading />;
  return (
    <ErpWorkspacePage
      title="عملیات رانندگان و خودروها"
      backHref={workspace === "security" ? "/dashboard/security" : "/dashboard/hr"}
      secondaryActions={[
        {
          label: "به‌روزرسانی",
          icon: FaSync,
          onClick: () => {
            setError("");
            void load();
          },
        },
      ]}
      className="pb-24 lg:pb-4"
    >
      {!dialog && errorState}
      {message && <ErpInlineState kind="success" title={message} />}
      {error && !dialog && (
        <ErpButton
          label="مشاهده پرونده‌های ارسال"
          variant="ghost"
          onClick={() => setSection("dispatch")}
        />
      )}
      <ErpSegmentedControl value={(external ? "EXTERNAL" : "INTERNAL") as RegistrySource} onChange={onSourceChange} options={[
        { value: "ALL", label: "همه" }, { value: "INTERNAL", label: "داخلی / شرکتی" }, { value: "EXTERNAL", label: "بیرونی" },
      ]} />
      <ErpSegmentedControl
        value={section}
        onChange={setSection}
        options={[
          { value: "drivers", label: external ? "رانندگان بیرونی" : "رانندگان داخلی" },
          { value: "vehicles", label: external ? "خودروهای بیرونی" : "خودروهای شرکت" },
          { value: "assignments", label: "تخصیص خودرو" },
          { value: "dispatch", label: "پرونده‌های ارسال" },
        ]}
      />
      {section === "drivers" && (
        <ErpSection
          title={external ? "رانندگان بیرونی" : "رانندگان داخلی"}
          actions={[
            ...((external ? capabilities.canManageProfiles : capabilities.canManageEligibility)
              ? [
                  {
                    label: "افزودن راننده",
                    icon: FaPlus,
                    onClick: async () => {
                      setError("");
                      setPersonnelId("");
                      setExternalIdentity({firstName: "", lastName: "", nationalCode: "", phone: ""});
                      setDialog("driver");
                      if (external) return;
                      try {
                        const response =
                          await operationsApi.getDriverPersonnelCandidates();
                        assertSuccessfulOperationalResponse(response);
                        setCandidates(response.data.data);
                      } catch (err) {
                        setError(
                          hrOperationsError(err, {
                            failedAction: "دریافت پرسنل",
                            nextStep: "دریافت پرسنل را دوباره امتحان کنید",
                          }),
                        );
                      }
                    },
                  },
                ]
              : []),
            {
              label: showArchived ? "پنهان‌کردن بایگانی" : "نمایش بایگانی",
              icon: FaArchive,
              onClick: () => setShowArchived((value) => !value),
            },
          ]}
        >
          {!drivers.length && (
            <ErpEmptyState
              title={external ? "راننده بیرونی ثبت نشده است" : "راننده داخلی ثبت نشده است"}
              icon={FaUserCheck}
            />
          )}
          <div className="space-y-3">
            {drivers
              .filter((driver) => showArchived || driver.status !== "ARCHIVED")
              .map((driver) => {
                const actions: ErpAction[] = [];
                if (
                  capabilities.canManageProfiles &&
                  driver.status !== "ARCHIVED"
                )
                  actions.push({
                    label: "ویرایش مشخصات رانندگی",
                    icon: FaEdit,
                    onClick: () => {
                      setError("");
                      setExternalIdentity({ firstName: driver.firstName || "", lastName: driver.lastName || "", nationalCode: driver.nationalCode || "", phone: driver.phone || "" });
                      setProfileForm({
                        driverId: driver.id,
                        licenceNumber: driver.licenceNumber || "",
                        licenceClass: driver.licenceClass || "",
                        licenceExpiresAt:
                          driver.licenceExpiresAt?.slice(0, 10) || "",
                        notes: driver.notes || "",
                      });
                      setDialog("profile");
                    },
                  });
                if (
                  (external ? capabilities.canManageEligibility : capabilities.canManageProfiles) &&
                  driver.status !== "ACTIVE"
                )
                  actions.push({
                    label:
                      driver.status === "ARCHIVED"
                        ? "بازیابی پیش‌نویس"
                        : "فعال‌سازی پروفایل",
                    icon: FaSync,
                    onClick: () =>
                      changeStatus(
                        "driver",
                        driver,
                        driver.status === "ARCHIVED" ? "DRAFT" : "ACTIVE",
                      ),
                  });
                if (
                  capabilities.canManageProfiles &&
                  capabilities.canManageEligibility &&
                  capabilities.canManageAssignments &&
                  driver.status !== "ARCHIVED"
                )
                  actions.push({
                    label: "پایان فعالیت رانندگی",
                    tone: "danger",
                    onClick: () => changeStatus("driver", driver, "ARCHIVED"),
                  });
                if (
                  capabilities.canManageAssignments &&
                  driver.status !== "ARCHIVED"
                )
                  actions.push({
                    label: driver.currentAssignment
                      ? "تغییر خودرو"
                      : "تخصیص خودرو",
                    icon: FaLink,
                    onClick: () => startAssignment(driver),
                  });
                if (
                  capabilities.canManageAssignments &&
                  driver.currentAssignment
                )
                  actions.push({
                    label: "پایان تخصیص",
                    tone: "warning",
                    onClick: () =>
                      endAssignment({ ...driver.currentAssignment, driver }),
                  });
                if (external && capabilities.canManageProfiles && driver.status === "DRAFT") actions.push({
                  label: "حذف پیش‌نویس راننده", tone: "danger", onClick: () => confirm({title: "حذف پیش‌نویس راننده", tone: "danger", lines: [personName(driver), "فقط پیش‌نویس بدون سابقه وابسته حذف می‌شود."], action: () => dispatchMasterDataAPI.deleteExternalDriverDraft(driver.id, ""), success: "پیش‌نویس راننده حذف شد."}),
                });
                return (
                  <ErpCard key={driver.id} className="p-4">
                    <ErpBadge tone="info">{external ? "بیرونی" : "داخلی"}</ErpBadge>
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <ErpButton
                            label={personName(driver)}
                            href={
                              external ? `/dashboard/${workspace}/external-drivers/${driver.id}` : "/dashboard/hr/personnel/" + driver.personnelId + "/driver-eligibility"
                            }
                            variant="ghost"
                          />
                          <ErpBadge
                            tone={
                              driver.readiness.status === "READY"
                                ? "success"
                                : "warning"
                            }
                          >
                            {driver.readiness.status === "READY"
                              ? "آماده"
                              : "نیازمند اقدام"}
                          </ErpBadge>
                          <ErpBadge tone="info">
                            {operationalStatusLabel(driver.status)}
                          </ErpBadge>
                          <ErpBadge
                            tone={
                              driver.currentEligibility?.status === "ELIGIBLE"
                                ? "success"
                                : "warning"
                            }
                          >
                            {operationalStatusLabel(
                              driver.currentEligibility?.status,
                            )}
                          </ErpBadge>
                        </div>
                        <p className="mt-1 text-sm sds-text-secondary">
                          گواهینامه {driver.licenceNumber || "ثبت نشده"}
                          {driver.licenceExpiresAt
                            ? " · معتبر تا " +
                              new Date(
                                driver.licenceExpiresAt,
                              ).toLocaleDateString("fa-IR", {
                                timeZone: "Asia/Tehran",
                              })
                            : ""}
                          {driver.currentAssignment
                            ? " · " +
                              vehicleName(driver.currentAssignment.vehicle)
                            : " · بدون خودروی فعال"}
                        </p>
                        {driver.readiness.blockers.length > 0 && (
                          <p className="mt-2 text-xs sds-text-secondary">
                            نیازمند رسیدگی:{" "}
                            {driver.readiness.blockers
                              .map(readinessBlockerLabel)
                              .join("، ")}
                          </p>
                        )}
                      </div>
                      {actions.length > 0 && (
                        <ErpActionMenu
                          label="عملیات راننده"
                          actions={actions}
                          portal
                        />
                      )}
                    </div>
                  </ErpCard>
                );
              })}
          </div>
        </ErpSection>
      )}
      {section === "vehicles" && (
        <ErpSection
          title="ناوگان شرکت"
          actions={[
            ...(capabilities.canManageCompanyVehicles
              ? [
                  {
                    label: "افزودن خودرو",
                    icon: FaPlus,
                    onClick: () => {
                      setError("");
                      setVehicleForm(newVehicle());
                      setDialog("vehicle");
                    },
                  },
                ]
              : []),
            {
              label: showArchived ? "پنهان‌کردن بایگانی" : "نمایش بایگانی",
              icon: FaArchive,
              onClick: () => setShowArchived((value) => !value),
            },
          ]}
        >
          {!vehicles.length && (
            <ErpEmptyState title={external ? "خودروی بیرونی ثبت نشده است" : "خودروی شرکت ثبت نشده است"} icon={FaTruck} />
          )}
          <div className="space-y-3">
            {vehicles
              .filter(
                (vehicle) => showArchived || vehicle.status !== "ARCHIVED",
              )
              .map((vehicle) => {
                const actions: ErpAction[] = [];
                if (
                  capabilities.canManageCompanyVehicles &&
                  vehicle.status !== "ARCHIVED"
                )
                  actions.push({
                    label: "ویرایش مشخصات خودرو",
                    icon: FaEdit,
                    onClick: () => {
                      setError("");
                      setVehicleForm({
                        ...newVehicle(),
                        ...vehicle,
                        manufactureYear: vehicle.manufactureYear
                          ? String(vehicle.manufactureYear)
                          : "",
                        registrationReference: vehicle.documents?.find((d: any) => d.documentType === "VEHICLE_REGISTRATION")?.reference || "",
                        fleetCode: vehicle.fleetCode || "",
                        make: vehicle.make || "",
                        model: vehicle.model || "",
                        vin: vehicle.vin || "",
                        notes: vehicle.notes || "",
                        plate: emptyCompanyPlate,
                      });
                      setDialog("vehicle");
                    },
                  });
                if (
                  capabilities.canManagePlates &&
                  vehicle.status !== "ARCHIVED"
                )
                  actions.push({
                    label: "ثبت پلاک جدید",
                    icon: FaEdit,
                    onClick: () => {
                      setError("");
                      setPlateForm({
                        vehicleId: vehicle.id,
                        plate: emptyCompanyPlate,
                      });
                      setDialog("plate");
                    },
                  });
                if (capabilities.canManageCompanyVehicles) {
                  const next =
                    vehicle.status === "DRAFT"
                      ? "ACTIVE"
                      : vehicle.status === "ACTIVE"
                        ? "OUT_OF_SERVICE"
                        : ["OUT_OF_SERVICE", "RESTRICTED"].includes(vehicle.status)
                          ? "ACTIVE"
                          : "DRAFT";
                  actions.push({
                    label:
                      vehicle.status === "DRAFT"
                        ? "فعال‌سازی"
                        : vehicle.status === "ACTIVE"
                          ? "خارج از سرویس"
                          : ["OUT_OF_SERVICE", "RESTRICTED"].includes(vehicle.status)
                            ? "بازگشت به سرویس"
                            : "بازیابی پیش‌نویس",
                    icon: FaSync,
                    onClick: () => changeStatus("vehicle", vehicle, next),
                  });
                  if (
                    ["DRAFT", "ACTIVE", "OUT_OF_SERVICE", "RESTRICTED"].includes(
                      vehicle.status,
                    ) &&
                    capabilities.canManageAssignments
                  )
                    actions.push({
                      label: "بایگانی خودرو",
                      tone: "danger",
                      onClick: () =>
                        changeStatus("vehicle", vehicle, "ARCHIVED"),
                    });
                  if (vehicle.status === "DRAFT")
                    actions.push({
                      label: "حذف پیش‌نویس",
                      tone: "danger",
                      onClick: () =>
                        confirm({
                          title: "حذف پیش‌نویس خودرو",
                          tone: "danger",
                          lines: [
                            vehicleName(vehicle),
                            "فقط پیش‌نویس بدون سابقه وابسته قابل حذف دائمی است.",
                          ],
                          action: () =>
                            operationsApi.deleteCompanyVehicleDraft(
                              vehicle.id,
                            ),
                          success: "پیش‌نویس خودرو حذف شد.",
                        }),
                    });
                }
                return (
                  <ErpCard key={vehicle.id} className="p-4">
                    <ErpBadge tone="info">{external ? "بیرونی" : "شرکتی"}</ErpBadge>
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold sds-text-primary">
                            {vehicle.fleetCode} · {vehicle.vehicleType}
                          </p>
                          <ErpBadge
                            tone={
                              vehicle.status === "ACTIVE"
                                ? "success"
                                : "warning"
                            }
                          >
                            {operationalStatusLabel(vehicle.status)}
                          </ErpBadge>
                        </div>
                        <p className="mt-1 text-sm sds-text-secondary">
                          {currentEffectivePlate(
                            vehicle,
                            new Date().toISOString(),
                          )?.plate ? (
                            <span
                              dir="ltr"
                              className="inline-flex gap-1"
                              aria-label={vehicleName(vehicle)}
                            >
                              {vehicleName(vehicle)
                                .trim()
                                .split(/\s+/)
                                .map((part: string, index: number) => (
                                  <bdi key={index}>{part}</bdi>
                                ))}
                            </span>
                          ) : (
                            "بدون پلاک"
                          )}
                          {vehicle.make ? " · " + vehicle.make : ""}
                          {vehicle.manufactureYear
                            ? " · سال ساخت " +
                              Number(vehicle.manufactureYear).toLocaleString(
                                "fa-IR",
                                { useGrouping: false },
                              )
                            : ""}
                          {vehicle.model
                            ? " · مدل ثبت‌شده قبلی: " + vehicle.model
                            : ""}
                        </p>
                      </div>
                      {actions.length > 0 && (
                        <ErpActionMenu
                          label="عملیات خودرو"
                          actions={actions}
                          portal
                        />
                      )}
                    </div>
                  </ErpCard>
                );
              })}
          </div>
        </ErpSection>
      )}
      {section === "assignments" && (
        <div className="space-y-5">
          {capabilities.canManageAssignments && (
            <ErpSection
              title={editingPlan ? "ویرایش برنامه تخصیص" : "تخصیص خودرو"}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className={field}>
                  راننده
                  <ErpSearchableSelect
                    required
                    disabled={saving || editingPlan?.action === "END"}
                    value={assignmentForm.driverId}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        driverId: event.target.value,
                      })
                    }
                  >
                    <option value="">انتخاب راننده</option>
                    {drivers
                      .filter(
                        (driver) =>
                          driver.status === "ACTIVE" &&
                          driver.currentEligibility?.status === "ELIGIBLE",
                      )
                      .map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {personName(driver)}
                        </option>
                      ))}
                  </ErpSearchableSelect>
                </label>
                <label className={field}>
                  خودرو
                  <ErpSearchableSelect
                    required
                    disabled={saving || editingPlan?.action === "END"}
                    value={assignmentForm.vehicleId}
                    onChange={(event) =>
                      setAssignmentForm({
                        ...assignmentForm,
                        vehicleId: event.target.value,
                      })
                    }
                  >
                    <option value="">انتخاب خودرو</option>
                    {vehicles
                      .filter((vehicle) => vehicle.status === "ACTIVE")
                      .map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.fleetCode} · {vehicleName(vehicle)}
                        </option>
                      ))}
                  </ErpSearchableSelect>
                </label>
                <div className="md:col-span-2">
                  <ErpSegmentedControl
                    value={assignmentForm.mode}
                    onChange={(mode) =>
                      setAssignmentForm({ ...assignmentForm, mode })
                    }
                    options={[
                      {
                        value: "now",
                        label: "همین حالا",
                        disabled: Boolean(editingPlan),
                      },
                      { value: "future", label: "برنامه آینده" },
                    ]}
                  />
                </div>
                {assignmentForm.mode === "future" && (
                  <>
                    <label className={field}>
                      {editingPlan?.action === "END"
                        ? "تاریخ پایان برنامه"
                        : "شروع تخصیص"}
                      <HrPersianCalendar
                        maxYear={maxYear}
                        disablePastDates
                        value={fromIsoDate(assignmentForm.date)}
                        onChange={(value) =>
                          setAssignmentForm({
                            ...assignmentForm,
                            date: toIsoDate(value),
                          })
                        }
                      />
                    </label>
                    <label className={field}>
                      ساعت شروع به وقت تهران
                      <ErpInput
                        type="time"
                        value={assignmentForm.time}
                        onChange={(event) =>
                          setAssignmentForm({
                            ...assignmentForm,
                            time: event.target.value,
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {editingPlan?.action !== "END" && (
                  <>
                    <label className={field}>
                      پایان تخصیص (اختیاری)
                      <HrPersianCalendar
                        maxYear={maxYear}
                        clearable
                        disablePastDates
                        value={fromIsoDate(assignmentForm.endDate)}
                        onChange={(value) =>
                          setAssignmentForm({
                            ...assignmentForm,
                            endDate: toIsoDate(value),
                          })
                        }
                      />
                    </label>
                    {assignmentForm.endDate && (
                      <label className={field}>
                        ساعت پایان به وقت تهران
                        <ErpInput
                          type="time"
                          value={assignmentForm.endTime}
                          onChange={(event) =>
                            setAssignmentForm({
                              ...assignmentForm,
                              endTime: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <ErpButton
                    label={editingPlan ? "بررسی تغییر برنامه" : "ثبت تخصیص"}
                    icon={FaLink}
                    disabled={
                      saving ||
                      dispatchTimelineStale ||
                      !assignmentForm.driverId ||
                      !assignmentForm.vehicleId
                    }
                    onClick={() => {
                      if (editingPlan?.action === "END")
                        confirm({
                          title: "تغییر موعد پایان تخصیص",
                          lines: [
                            planLabel(editingPlan),
                            "موعد جدید: " +
                              dateTimeFa(
                                assignmentDateTime(
                                  assignmentForm.date,
                                  assignmentForm.time,
                                ),
                              ),
                          ],
                          action: () =>
                            operationsApi.updateVehicleAssignmentPlan(
                              editingPlan.id,
                              {
                                effectiveFrom: assignmentDateTime(
                                  assignmentForm.date,
                                  assignmentForm.time,
                                ),
                                confirmed: true,
                                expectedUpdatedAt: editingPlan.updatedAt,
                              },
                            ),
                          success: "برنامه پایان تخصیص تغییر کرد.",
                        });
                      else void prepareAssignment();
                    }}
                  />
                  {editingPlan && (
                    <ErpButton
                      label="انصراف از ویرایش برنامه"
                      variant="ghost"
                      onClick={() => {
                        setEditingPlan(null);
                        setAssignmentForm(newAssignment());
                      }}
                    />
                  )}
                </div>
              </div>
            </ErpSection>
          )}
          <ErpSection title="تخصیص‌ها و سوابق">
            <div className="space-y-3">
              {assignments.map((assignment) => (
                <ErpCard key={assignment.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="sds-text-primary">
                        {personName(assignment.driver)} ·{" "}
                        {vehicleName(assignment.vehicle)}
                      </p>
                      <p className="text-sm sds-text-secondary">
                        {dateTimeFa(assignment.effectiveFrom)} تا{" "}
                        {assignment.effectiveTo
                          ? dateTimeFa(assignment.effectiveTo)
                          : "اکنون"}
                      </p>
                    </div>
                    {!assignment.effectiveTo &&
                      capabilities.canManageAssignments && (
                        <ErpButton
                          label="پایان تخصیص"
                          tone="warning"
                          disabled={saving}
                          onClick={() => endAssignment(assignment)}
                        />
                      )}
                  </div>
                </ErpCard>
              ))}
              {!assignments.length && (
                <ErpEmptyState title="تخصیصی ثبت نشده است" />
              )}
            </div>
          </ErpSection>
          <ErpSection title="برنامه‌های تخصیص">
            <div className="space-y-3">
              {plans.map((plan) => (
                <ErpCard key={plan.id} className="p-4">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:justify-between">
                    <div className="min-w-0">
                      <p className="sds-text-primary">{planLabel(plan)}</p>
                      <ErpBadge
                        tone={
                          plan.status === "NEEDS_ATTENTION"
                            ? "warning"
                            : plan.status === "APPLIED"
                              ? "success"
                              : "info"
                        }
                      >
                        {
                          (
                            {
                              PLANNED: "برنامه آینده",
                              NEEDS_ATTENTION: "نیازمند رسیدگی",
                              APPLIED: "اجراشده",
                              CANCELLED: "لغوشده",
                            } as Record<string, string>
                          )[plan.status]
                        }
                      </ErpBadge>
                      {plan.blockedReason && (
                        <p className="mt-2 text-sm sds-text-secondary">
                          {plan.blockedReason}
                        </p>
                      )}
                    </div>
                    {isPending(plan) && capabilities.canManageAssignments && (
                      <ErpActionMenu
                        label="عملیات برنامه"
                        portal
                        actions={[
                          {
                            label: "ویرایش برنامه",
                            icon: FaEdit,
                            onClick: () => editPlan(plan),
                          },
                          {
                            label: "لغو برنامه",
                            tone: "danger",
                            onClick: () =>
                              confirm({
                                title: "لغو برنامه تخصیص",
                                tone: "danger",
                                lines: [
                                  planLabel(plan),
                                  "برنامه لغو می‌شود؛ سابقه آن باقی می‌ماند.",
                                ],
                                action: () =>
                                  operationsApi.cancelVehicleAssignmentPlan(
                                    plan.id,
                                    {
                                      confirmed: true,
                                      expectedUpdatedAt: plan.updatedAt,
                                    },
                                  ),
                                success: "برنامه لغو شد.",
                              }),
                          },
                          ...(new Date(plan.effectiveFrom) <= new Date()
                            ? [
                                {
                                  label: "بررسی و اجرا",
                                  icon: FaLink,
                                  onClick: () =>
                                    plan.action === "END"
                                      ? confirm({
                                          title: "اجرای پایان تخصیص",
                                          lines: [
                                            planLabel(plan),
                                            "تخصیص از همین لحظه پایان می‌یابد.",
                                          ],
                                          action: () =>
                                            operationsApi.executeVehicleAssignmentPlan(
                                              plan.id,
                                              {
                                                confirmed: true,
                                                expectedUpdatedAt:
                                                  plan.updatedAt,
                                              },
                                            ),
                                          success: "پایان تخصیص اجرا شد.",
                                        })
                                      : void prepareAssignment(plan),
                                },
                              ]
                            : []),
                        ]}
                      />
                    )}
                  </div>
                </ErpCard>
              ))}
              {!plans.length && (
                <ErpEmptyState title="برنامه تخصیصی ثبت نشده است" />
              )}
            </div>
          </ErpSection>
        </div>
      )}
      {external && legacyPairs.length > 0 && <ErpDisclosure title="سوابق ترکیبی قدیمی">
        <div className="space-y-2">{legacyPairs.map(pair => <ErpCard key={pair.id} className="p-3">
          <div className="flex flex-wrap items-center gap-2"><span>{pair.firstName} {pair.lastName} · <bdi dir="ltr">{pair.vehiclePlate}</bdi></span><ErpBadge tone="warning">فقط سابقه</ErpBadge></div>
        </ErpCard>)}</div>
      </ErpDisclosure>}
      <div hidden={section !== "dispatch"}>
        <RoleAwareDispatchCases
          workspace="vehicle-operations"
          onStaleChange={setDispatchTimelineStale}
        />
      </div>
      <ErpSheet
        open={dialog === "driver"}
        onClose={close}
        title={external ? "افزودن راننده بیرونی" : "افزودن راننده داخلی"}
        presentation="modal"
        pending={saving}
        footer={footer(
          "ثبت پیش‌نویس راننده",
          () => {
            void run(
              () => external ? dispatchMasterDataAPI.createExternalDriver(externalIdentity) : operationsApi.createInternalDriver({ personnelId }),
              "راننده به‌صورت پیش‌نویس ثبت شد؛ مشخصات گواهینامه را تکمیل کنید.",
            ).then((ok) => {
              if (ok) setDialog(null);
            });
          },
          external ? Object.values(externalIdentity).some(v => !v.trim()) : !personnelId,
        )}
      >
        {error && <div id="hr-driver-error">{errorState}</div>}
        {external ? <div className="grid gap-4 sm:grid-cols-2">{identityFields}</div> : <>        <label className={field}>
          پرسنل
          <ErpSearchableSelect
            aria-describedby={error ? "hr-driver-error" : undefined}
            value={personnelId}
            onChange={(event) => setPersonnelId(event.target.value)}
          >
            <option value="">انتخاب پرسنل</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName}
              </option>
            ))}
          </ErpSearchableSelect>
        </label></>}

      </ErpSheet>
      <ErpSheet
        open={dialog === "profile"}
        onClose={close}
        title="ویرایش مشخصات رانندگی"
        presentation="modal"
        pending={saving}
        footer={footer("ذخیره تغییرات", () => {
          void run(
            () =>
              operationsApi.updateInternalDrivingProfile(
                profileForm.driverId,
                external ? { ...profileForm, ...externalIdentity } : profileForm,
              ),
            "مشخصات رانندگی ذخیره شد.",
          ).then((ok) => {
            if (ok) setDialog(null);
          });
        })}
      >
        <div className="space-y-4">
          {error && <div id="hr-profile-error">{errorState}</div>}
          {external && <div className="grid gap-4 sm:grid-cols-2">{identityFields}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              شماره گواهینامه
              <ErpInput
                aria-describedby={error ? "hr-profile-error" : undefined}
                value={profileForm.licenceNumber}
                onChange={(event) =>
                  setProfileForm({
                    ...profileForm,
                    licenceNumber: event.target.value,
                  })
                }
              />
            </label>
            <label className={field}>
              پایه گواهینامه
              <ErpInput
                aria-describedby={error ? "hr-profile-error" : undefined}
                value={profileForm.licenceClass}
                onChange={(event) =>
                  setProfileForm({
                    ...profileForm,
                    licenceClass: event.target.value,
                  })
                }
              />
            </label>
            <label className={field}>
              اعتبار گواهینامه
              <HrPersianCalendar
                maxYear={maxYear}
                clearable
                value={fromIsoDate(profileForm.licenceExpiresAt)}
                onChange={(value) =>
                  setProfileForm({
                    ...profileForm,
                    licenceExpiresAt: toIsoDate(value),
                  })
                }
              />
            </label>
            <label className={field}>
              توضیحات
              <ErpTextarea
                aria-describedby={error ? "hr-profile-error" : undefined}
                value={profileForm.notes}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, notes: event.target.value })
                }
              />
            </label>
          </div>
        </div>
      </ErpSheet>
      <ErpSheet
        open={dialog === "vehicle"}
        onClose={close}
        title={
          vehicleForm.id ? (external ? "ویرایش مشخصات خودروی بیرونی" : "ویرایش مشخصات خودروی شرکت") : (external ? "افزودن خودروی بیرونی" : "افزودن خودروی شرکت")
        }
        presentation="modal"
        pending={saving}
        footer={footer(
          vehicleForm.id ? "ذخیره تغییرات خودرو" : "ثبت خودرو",
          () => {
            const data = {
              fleetCode: vehicleForm.fleetCode,
              ...(external ? { registrationReference: vehicleForm.registrationReference } : {}),
              vehicleType: vehicleForm.vehicleType,
              make: vehicleForm.make,
              ...(vehicleForm.model ? { model: vehicleForm.model } : {}),
              manufactureYear: Number(vehicleForm.manufactureYear),
              vin: vehicleForm.vin,
              notes: vehicleForm.notes,
              ...(vehicleForm.id
                ? {}
                : { plate: formatCompanyPlate(vehicleForm.plate) }),
            };
            void run(
              () =>
                vehicleForm.id
                  ? operationsApi.updateCompanyVehicle(vehicleForm.id, {
                      ...data,
                      model: vehicleForm.model,
                    })
                  : operationsApi.createCompanyVehicle(data),
              "اطلاعات خودرو ثبت شد.",
            ).then((ok) => {
              if (ok) setDialog(null);
            });
          },
          (!external && !vehicleForm.fleetCode.trim()) ||
            !vehicleForm.vehicleType.trim() ||
            !validManufactureYear(vehicleForm.manufactureYear) ||
            (!vehicleForm.id && !completeCompanyPlate(vehicleForm.plate)),
        )}
      >
        <div className="space-y-4">
          {error && <div id="hr-vehicle-error">{errorState}</div>}
          {external && <label className={field}>شماره مدرک خودرو<ErpInput value={vehicleForm.registrationReference} onChange={e => setVehicleForm({...vehicleForm, registrationReference: e.target.value})} /></label>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              کد ناوگان
              <ErpInput
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                required
                value={vehicleForm.fleetCode}
                onChange={(event) =>
                  setVehicleForm({
                    ...vehicleForm,
                    fleetCode: event.target.value,
                  })
                }
              />
            </label>
            <label className={field}>
              نوع خودرو
              <ErpInput
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                required
                value={vehicleForm.vehicleType}
                onChange={(event) =>
                  setVehicleForm({
                    ...vehicleForm,
                    vehicleType: event.target.value,
                  })
                }
              />
            </label>
            <label className={field}>
              سازنده
              <ErpInput
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                value={vehicleForm.make}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, make: event.target.value })
                }
              />
            </label>
            <label className={field}>
              مدل
              <ErpInput
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                value={vehicleForm.model}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, model: event.target.value })
                }
              />
            </label>
            <label className={field}>
              سال ساخت
              <ErpSearchableSelect
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                required
                disabled={saving}
                value={vehicleForm.manufactureYear}
                onChange={(event) =>
                  setVehicleForm({
                    ...vehicleForm,
                    manufactureYear: event.target.value,
                  })
                }
              >
                <option value="" disabled>
                  انتخاب سال ساخت
                </option>
                {manufactureYears().map((year) => (
                  <option key={year} value={year}>
                    {year.toLocaleString("fa-IR", { useGrouping: false })}
                  </option>
                ))}
              </ErpSearchableSelect>
            </label>
            <label className={field}>
              توضیحات
              <ErpTextarea
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                value={vehicleForm.notes}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, notes: event.target.value })
                }
              />
            </label>
            <label className={field}>
              شماره شاسی
              <ErpInput
                aria-describedby={error ? "hr-vehicle-error" : undefined}
                value={vehicleForm.vin}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, vin: event.target.value })
                }
              />
            </label>
            {!vehicleForm.id && (
              <div className="min-w-0">
                <CompanyPlateFields
                  label="پلاک"
                  disabled={saving}
                  value={vehicleForm.plate}
                  onChange={(plate) =>
                    setVehicleForm({ ...vehicleForm, plate })
                  }
                />
              </div>
            )}
          </div>
        </div>
      </ErpSheet>
      <ErpSheet
        open={dialog === "plate"}
        onClose={close}
        title="ثبت پلاک جدید"
        presentation="modal"
        pending={saving}
        footer={footer(
          "ثبت پلاک",
          () => {
            void run(
              () =>
                operationsApi.changeCompanyVehiclePlate(
                  plateForm.vehicleId,
                  { plate: formatCompanyPlate(plateForm.plate) },
                ),
              "پلاک جدید ثبت شد.",
            ).then((ok) => {
              if (ok) setDialog(null);
            });
          },
          !completeCompanyPlate(plateForm.plate),
        )}
      >
        <div className="space-y-4">
          {error && <div id="hr-plate-error">{errorState}</div>}
          <CompanyPlateFields
            label="پلاک جدید"
            disabled={saving}
            value={plateForm.plate}
            onChange={(plate) => setPlateForm({ ...plateForm, plate })}
          />
        </div>
      </ErpSheet>
      <ErpSheet
        open={dialog === "confirm"}
        onClose={close}
        title={confirmation?.title || "تأیید تغییر"}
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={close}
            />
            <ErpButton
              label="تأیید و ثبت"
              tone={confirmation?.tone || "success"}
              variant="solid"
              disabled={saving || dispatchTimelineStale}
              onClick={() => {
                if (confirmation)
                  void run(confirmation.action, confirmation.success).then(
                    (ok) => {
                      if (ok) {
                        setDialog(null);
                        setConfirmation(null);
                        setEditingPlan(null);
                        setAssignmentForm(newAssignment());
                      }
                    },
                  );
              }}
            />
          </div>
        }
      >
        <div className="space-y-3">
          {errorState}
          {confirmation?.lines.map((line, index) => (
            <p key={index} className="text-sm leading-7 sds-text-secondary">
              {line}
            </p>
          ))}
        </div>
      </ErpSheet>
    </ErpWorkspacePage>
  );
}
