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
  ErpActionMenu,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpWorkspacePage,
} from "@/components/erp";
import { dispatchMasterDataAPI } from "@/lib/api";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import { fromIsoDate, toIsoDate } from "@/features/hr/hrUi";
import {
  assignableVehiclesAt,
  currentEffectivePlate,
} from "@/features/dispatch-master-data/vehicleAssignmentOptions";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";

const today = () => new Date().toISOString().slice(0, 10);
const vehicleInitial = {
  fleetCode: "",
  vehicleType: "",
  make: "",
  model: "",
  vin: "",
  plate: "",
  effectiveFrom: today(),
  reason: "ثبت خودروی ناوگان",
};
const assignmentInitial = {
  driverId: "",
  vehicleId: "",
  effectiveFrom: today(),
  reason: "تخصیص عملیاتی خودرو",
};
const plateInitial = {
  vehicleId: "",
  plate: "",
  effectiveFrom: today(),
  reason: "تغییر پلاک خودرو",
};
const profileInitial = {
  driverId: "",
  licenceNumber: "",
  licenceClass: "",
  licenceExpiresAt: "",
  notes: "",
  reason: "به‌روزرسانی مشخصات رانندگی",
};

const field = "space-y-1.5 text-sm font-medium sds-text-secondary";
const errorText = (error: any) =>
  userFacingError(error, "انجام عملیات ممکن نشد.");

export default function VehicleOperationsPage() {
  const mutationLock = useRef(false);
  const [section, setSection] = useState<
    "drivers" | "vehicles" | "assignments" | "dispatch"
  >("drivers");
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState({
    canManageProfiles: false,
    canManageCompanyVehicles: false,
    canManagePlates: false,
    canManageAssignments: false,
  });
  const [showArchivedVehicles, setShowArchivedVehicles] = useState(false);
  const [vehicleForm, setVehicleForm] = useState(vehicleInitial);
  const [assignmentForm, setAssignmentForm] = useState(assignmentInitial);
  const [plateForm, setPlateForm] = useState(plateInitial);
  const [profileForm, setProfileForm] = useState(profileInitial);
  const [changeReason, setChangeReason] = useState("");
  const [dialog, setDialog] = useState<
    "profile" | "vehicle" | "plate" | "status" | null
  >(null);
  const [statusTarget, setStatusTarget] = useState<{
    kind: "driver" | "vehicle";
    record: any;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [driverResponse, vehicleResponse] = await Promise.all([
        dispatchMasterDataAPI.getVehicleOperationsDrivers(),
        dispatchMasterDataAPI.getCompanyVehicles({
          archived: showArchivedVehicles ? "include" : "exclude",
        }),
      ]);
      setDrivers(driverResponse.data.data || []);
      setVehicles(vehicleResponse.data.data || []);
      setCapabilities(
        driverResponse.data.capabilities ||
          vehicleResponse.data.capabilities || {
            canManageProfiles: false,
            canManageCompanyVehicles: false,
            canManagePlates: false,
            canManageAssignments: false,
          },
      );
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [showArchivedVehicles]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<any>, success: string) => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (requestError) {
      setError(errorText(requestError));
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;
  const activeVehicleCount = vehicles.filter(
    (vehicle) => vehicle.status === "ACTIVE",
  ).length;
  const assignableVehicles = assignableVehiclesAt(
    vehicles,
    assignmentForm.effectiveFrom,
  );
  const unavailableVehicleCount =
    activeVehicleCount - assignableVehicles.length;
  const selectedVehicleIsAssignable = assignableVehicles.some(
    (vehicle) => vehicle.id === assignmentForm.vehicleId,
  );

  return (
    <ErpWorkspacePage
      title="عملیات رانندگان و خودروها"
      context="هویت راننده از پرسنل و هویت خودرو از ناوگان مستقل می‌ماند؛ سوابق تغییر نمی‌کنند."
      backHref="/dashboard/hr"
      secondaryActions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: load }]}
      className="pb-24 lg:pb-4"
    >
      {error && (
        <ErpInlineState kind="error" title={`عملیات انجام نشد: ${error}`} />
      )}
      {message && <ErpInlineState kind="success" title={message} />}

      <ErpSegmentedControl
        value={section}
        onChange={setSection}
        options={[
          { value: "drivers", label: "رانندگان داخلی" },
          { value: "vehicles", label: "خودروهای شرکت" },
          { value: "assignments", label: "تخصیص خودرو" },
          { value: "dispatch", label: "پرونده‌های ارسال" },
        ]}
      />

      {section === "drivers" && (
        <div className="grid grid-cols-1 gap-5">
          <ErpSection title="رانندگان داخلی">
            {!drivers.length ? (
              <ErpEmptyState
                title="راننده داخلی ثبت نشده است"
                icon={FaUserCheck}
              />
            ) : (
              <div className="space-y-3">
                {drivers.map((driver) => {
                  return (
                    <ErpCard key={driver.id} className="p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold sds-text-primary">
                              {driver.personnel.firstName}{" "}
                              {driver.personnel.lastName}
                            </p>
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
                          <p className="mt-1 text-sm sds-text-muted">
                            گواهینامه {driver.licenceNumber || "ثبت نشده"}
                            {driver.licenceExpiresAt
                              ? ` · معتبر تا ${new Date(driver.licenceExpiresAt).toLocaleDateString("fa-IR")}`
                              : ""}
                            {driver.currentAssignment
                              ? ` · ${driver.currentAssignment.vehicle.plates[0]?.plate || driver.currentAssignment.vehicle.fleetCode}`
                              : " · بدون خودروی فعال"}
                          </p>
                          {driver.readiness.blockers.length > 0 && (
                            <p className="mt-2 text-xs sds-text-muted">
                              نیازمند رسیدگی:{" "}
                              {driver.readiness.blockers.join("، ")}
                            </p>
                          )}
                        </div>
                        {capabilities.canManageProfiles && (
                          <ErpActionMenu
                            label="عملیات راننده"
                            actions={[
                              {
                                label: "ویرایش مشخصات رانندگی",
                                icon: FaEdit,
                                onClick: () => {
                                  setProfileForm({
                                    ...profileInitial,
                                    driverId: driver.id,
                                    licenceNumber: driver.licenceNumber || "",
                                    licenceClass: driver.licenceClass || "",
                                    licenceExpiresAt:
                                      driver.licenceExpiresAt?.slice(0, 10) ||
                                      "",
                                    notes: driver.notes || "",
                                  });
                                  setDialog("profile");
                                },
                              },
                              {
                                label:
                                  driver.status === "DRAFT"
                                    ? "فعال‌سازی پروفایل"
                                    : driver.status === "ACTIVE"
                                      ? "بایگانی پروفایل"
                                      : "بازیابی پیش‌نویس",
                                icon: FaSync,
                                tone:
                                  driver.status === "ACTIVE"
                                    ? "warning"
                                    : "success",
                                onClick: () => {
                                  setStatusTarget({
                                    kind: "driver",
                                    record: driver,
                                  });
                                  setChangeReason("");
                                  setDialog("status");
                                },
                              },
                            ]}
                          />
                        )}
                      </div>
                    </ErpCard>
                  );
                })}
              </div>
            )}
          </ErpSection>
        </div>
      )}

      {section === "vehicles" && (
        <div className="grid grid-cols-1 gap-5">
          <ErpSection
            title="ناوگان شرکت"
            actions={[
              ...(capabilities.canManageCompanyVehicles
                ? [
                    {
                      label: "افزودن خودرو",
                      icon: FaPlus,
                      onClick: () => {
                        setVehicleForm(vehicleInitial);
                        setDialog("vehicle");
                      },
                    },
                  ]
                : []),
              {
                label: showArchivedVehicles
                  ? "پنهان‌کردن بایگانی"
                  : "نمایش بایگانی",
                icon: FaArchive,
                variant: "outline",
                onClick: () => setShowArchivedVehicles((value) => !value),
              },
            ]}
          >
            {!vehicles.length ? (
              <ErpEmptyState title="خودروی شرکت ثبت نشده است" icon={FaTruck} />
            ) : (
              <div className="space-y-3">
                {vehicles.map((vehicle) => (
                  <ErpCard key={vehicle.id} className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
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
                          <ErpBadge tone="info">ناوگان شرکت</ErpBadge>
                        </div>
                        <p className="mt-1 text-sm sds-text-muted">
                          {vehicle.plates[0]?.plate || "بدون پلاک"}
                          {vehicle.make
                            ? ` · ${vehicle.make} ${vehicle.model || ""}`
                            : ""}
                        </p>
                      </div>
                      {(capabilities.canManageCompanyVehicles ||
                        capabilities.canManagePlates) && (
                        <ErpActionMenu
                          label="عملیات خودرو"
                          actions={[
                            ...(capabilities.canManagePlates
                              ? [
                                  {
                                    label: "ثبت پلاک جدید",
                                    icon: FaEdit,
                                    onClick: () => {
                                      setPlateForm({
                                        ...plateInitial,
                                        vehicleId: vehicle.id,
                                      });
                                      setDialog("plate");
                                    },
                                  },
                                ]
                              : []),
                            ...(capabilities.canManageCompanyVehicles
                              ? [
                                  {
                                    label:
                                      vehicle.status === "DRAFT"
                                        ? "فعال‌سازی"
                                        : vehicle.status === "ACTIVE"
                                          ? "خارج از سرویس"
                                          : vehicle.status === "OUT_OF_SERVICE"
                                            ? "بازگشت به سرویس"
                                            : "بازیابی پیش‌نویس",
                                    icon: FaSync,
                                    tone:
                                      vehicle.status === "ACTIVE"
                                        ? ("warning" as const)
                                        : ("success" as const),
                                    onClick: () => {
                                      setStatusTarget({
                                        kind: "vehicle",
                                        record: vehicle,
                                      });
                                      setChangeReason("");
                                      setDialog("status");
                                    },
                                  },
                                ]
                              : []),
                          ]}
                        />
                      )}
                    </div>
                  </ErpCard>
                ))}
              </div>
            )}
          </ErpSection>
        </div>
      )}

      {section === "assignments" && capabilities.canManageAssignments && (
        <ErpSection
          title="تخصیص فعال راننده و خودرو"
          description="تخصیص جدید، تخصیص فعال قبلی هر دو طرف را در همان زمان می‌بندد و سابقه را نگه می‌دارد."
        >
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  dispatchMasterDataAPI.assignCompanyVehicle(assignmentForm),
                "تخصیص خودرو ثبت شد.",
              ).then((ok) => {
                if (ok) setAssignmentForm(assignmentInitial);
              });
            }}
          >
            {unavailableVehicleCount > 0 && (
              <div className="md:col-span-2">
                <ErpInlineState
                  kind="stale"
                  title={`${unavailableVehicleCount} خودروی فعال در تاریخ انتخاب‌شده پلاک معتبر ندارد و قابل تخصیص نیست؛ ابتدا در بخش «خودروهای شرکت» پلاک و تاریخ شروع اعتبار را ثبت کنید.`}
                />
              </div>
            )}
            <label className={field}>
              راننده
              <ErpSelect
                required
                value={assignmentForm.driverId}
                onChange={(event) =>
                  setAssignmentForm({
                    ...assignmentForm,
                    driverId: event.target.value,
                  })
                }
              >
                <option value="">انتخاب کنید</option>
                {drivers
                  .filter(
                    (driver) =>
                      driver.currentEligibility?.status === "ELIGIBLE",
                  )
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.personnel.firstName} {driver.personnel.lastName}
                    </option>
                  ))}
              </ErpSelect>
            </label>
            <label className={field}>
              خودرو
              <ErpSelect
                required
                value={assignmentForm.vehicleId}
                onChange={(event) =>
                  setAssignmentForm({
                    ...assignmentForm,
                    vehicleId: event.target.value,
                  })
                }
              >
                <option value="">انتخاب کنید</option>
                {assignableVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.fleetCode} ·{" "}
                    {
                      currentEffectivePlate(
                        vehicle,
                        assignmentForm.effectiveFrom,
                      )?.plate
                    }
                  </option>
                ))}
              </ErpSelect>
            </label>
            <label className={field}>
              شروع تخصیص
              <HrPersianCalendar
                value={fromIsoDate(assignmentForm.effectiveFrom)}
                onChange={(value) => {
                  const effectiveFrom = toIsoDate(value);
                  const vehicleId = assignableVehiclesAt(
                    vehicles,
                    effectiveFrom,
                  ).some((vehicle) => vehicle.id === assignmentForm.vehicleId)
                    ? assignmentForm.vehicleId
                    : "";
                  setAssignmentForm({
                    ...assignmentForm,
                    effectiveFrom,
                    vehicleId,
                  });
                }}
              />
            </label>
            <label className={field}>
              دلیل
              <ErpInput
                required
                value={assignmentForm.reason}
                onChange={(event) =>
                  setAssignmentForm({
                    ...assignmentForm,
                    reason: event.target.value,
                  })
                }
              />
            </label>
            <ErpButton
              label="ثبت تخصیص"
              icon={FaLink}
              disabled={
                dispatchTimelineStale ||
                saving ||
                !assignmentForm.driverId ||
                !selectedVehicleIsAssignable
              }
              className="md:col-span-2"
              onClick={() =>
                void run(
                  () =>
                    dispatchMasterDataAPI.assignCompanyVehicle(assignmentForm),
                  "تخصیص خودرو ثبت شد.",
                ).then((ok) => {
                  if (ok) setAssignmentForm(assignmentInitial);
                })
              }
            />
          </form>
        </ErpSection>
      )}
      <div hidden={section !== "dispatch"}>
        <RoleAwareDispatchCases
          workspace="vehicle-operations"
          onStaleChange={setDispatchTimelineStale}
        />
      </div>

      <ErpSheet
        open={dialog === "profile"}
        onClose={() => {
          if (!saving) setDialog(null);
        }}
        title="ویرایش مشخصات رانندگی"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setDialog(null)}
            />
            <ErpButton
              label="ذخیره تغییرات"
              icon={FaSync}
              disabled={
                dispatchTimelineStale ||
                saving ||
                !profileForm.driverId ||
                !profileForm.licenceNumber ||
                !profileForm.licenceClass ||
                !profileForm.reason.trim()
              }
              onClick={async () => {
                const ok = await run(
                  () =>
                    dispatchMasterDataAPI.updateInternalDrivingProfile(
                      profileForm.driverId,
                      profileForm,
                    ),
                  "مشخصات رانندگی به‌روزرسانی شد.",
                );
                if (ok) {
                  setDialog(null);
                  setProfileForm(profileInitial);
                }
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <ErpInlineState kind="error" title={`عملیات انجام نشد: ${error}`} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              شماره گواهینامه
              <ErpInput
                required
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
                required
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
                value={fromIsoDate(profileForm.licenceExpiresAt)}
                onChange={(value) =>
                  setProfileForm({
                    ...profileForm,
                    licenceExpiresAt: toIsoDate(value),
                  })
                }
                clearable
              />
            </label>
            <label className={field}>
              دلیل ویرایش
              <ErpInput
                required
                value={profileForm.reason}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, reason: event.target.value })
                }
              />
            </label>
          </div>
        </div>
      </ErpSheet>

      <ErpSheet
        open={dialog === "vehicle"}
        onClose={() => {
          if (!saving) setDialog(null);
        }}
        title="افزودن خودروی شرکت"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setDialog(null)}
            />
            <ErpButton
              label="ثبت خودرو"
              icon={FaTruck}
              disabled={
                dispatchTimelineStale ||
                saving ||
                !vehicleForm.fleetCode.trim() ||
                !vehicleForm.vehicleType.trim() ||
                !vehicleForm.plate.trim() ||
                !vehicleForm.reason.trim()
              }
              onClick={async () => {
                const ok = await run(
                  () => dispatchMasterDataAPI.createCompanyVehicle(vehicleForm),
                  "خودروی شرکت ثبت شد.",
                );
                if (ok) {
                  setDialog(null);
                  setVehicleForm(vehicleInitial);
                }
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <ErpInlineState kind="error" title={`عملیات انجام نشد: ${error}`} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              کد ناوگان
              <ErpInput
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
                value={vehicleForm.make}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, make: event.target.value })
                }
              />
            </label>
            <label className={field}>
              مدل
              <ErpInput
                value={vehicleForm.model}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, model: event.target.value })
                }
              />
            </label>
            <label className={field}>
              شماره شاسی
              <ErpInput
                value={vehicleForm.vin}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, vin: event.target.value })
                }
              />
            </label>
            <label className={field}>
              پلاک
              <ErpInput
                required
                value={vehicleForm.plate}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, plate: event.target.value })
                }
              />
            </label>
            <label className={field}>
              شروع اعتبار پلاک
              <HrPersianCalendar
                value={fromIsoDate(vehicleForm.effectiveFrom)}
                onChange={(value) =>
                  setVehicleForm({
                    ...vehicleForm,
                    effectiveFrom: toIsoDate(value),
                  })
                }
              />
            </label>
            <label className={field}>
              دلیل
              <ErpInput
                required
                value={vehicleForm.reason}
                onChange={(event) =>
                  setVehicleForm({ ...vehicleForm, reason: event.target.value })
                }
              />
            </label>
          </div>
        </div>
      </ErpSheet>

      <ErpSheet
        open={dialog === "plate"}
        onClose={() => {
          if (!saving) setDialog(null);
        }}
        title="ثبت پلاک جدید"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setDialog(null)}
            />
            <ErpButton
              label="ثبت پلاک"
              icon={FaPlus}
              disabled={
                dispatchTimelineStale ||
                saving ||
                !plateForm.vehicleId ||
                !plateForm.plate.trim() ||
                !plateForm.reason.trim()
              }
              onClick={async () => {
                const ok = await run(
                  () =>
                    dispatchMasterDataAPI.changeCompanyVehiclePlate(
                      plateForm.vehicleId,
                      plateForm,
                    ),
                  "پلاک جدید ثبت شد.",
                );
                if (ok) {
                  setDialog(null);
                  setPlateForm(plateInitial);
                }
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <ErpInlineState kind="error" title={`عملیات انجام نشد: ${error}`} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              پلاک جدید
              <ErpInput
                required
                value={plateForm.plate}
                onChange={(event) =>
                  setPlateForm({ ...plateForm, plate: event.target.value })
                }
              />
            </label>
            <label className={field}>
              شروع اعتبار
              <HrPersianCalendar
                value={fromIsoDate(plateForm.effectiveFrom)}
                onChange={(value) =>
                  setPlateForm({
                    ...plateForm,
                    effectiveFrom: toIsoDate(value),
                  })
                }
              />
            </label>
            <label className={`${field} sm:col-span-2`}>
              دلیل تغییر
              <ErpInput
                required
                value={plateForm.reason}
                onChange={(event) =>
                  setPlateForm({ ...plateForm, reason: event.target.value })
                }
              />
            </label>
          </div>
        </div>
      </ErpSheet>

      <ErpSheet
        open={dialog === "status"}
        onClose={() => {
          if (!saving) setDialog(null);
        }}
        title="تغییر وضعیت"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setDialog(null)}
            />
            <ErpButton
              label="تأیید تغییر وضعیت"
              icon={FaSync}
              tone="warning"
              disabled={
                dispatchTimelineStale ||
                saving ||
                !statusTarget ||
                !changeReason.trim()
              }
              onClick={async () => {
                if (!statusTarget) return;
                let ok = false;
                if (statusTarget.kind === "driver") {
                  const driver = statusTarget.record;
                  ok = await run(
                    () =>
                      dispatchMasterDataAPI.transitionInternalDrivingProfile(
                        driver.id,
                        {
                          status:
                            driver.status === "DRAFT"
                              ? "ACTIVE"
                              : driver.status === "ACTIVE"
                                ? "ARCHIVED"
                                : "DRAFT",
                          reason: changeReason.trim(),
                        },
                      ),
                    "وضعیت پروفایل ثبت شد.",
                  );
                } else {
                  const vehicle = statusTarget.record;
                  ok = await run(
                    () =>
                      dispatchMasterDataAPI.transitionCompanyVehicleStatus(
                        vehicle.id,
                        {
                          status:
                            vehicle.status === "DRAFT"
                              ? "ACTIVE"
                              : vehicle.status === "ACTIVE"
                                ? "OUT_OF_SERVICE"
                                : vehicle.status === "OUT_OF_SERVICE"
                                  ? "ACTIVE"
                                  : "DRAFT",
                          effectiveFrom: new Date().toISOString(),
                          reason: changeReason.trim(),
                        },
                      ),
                    "وضعیت خودرو ثبت شد.",
                  );
                }
                if (ok) {
                  setDialog(null);
                  setStatusTarget(null);
                  setChangeReason("");
                }
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <ErpInlineState kind="error" title={`عملیات انجام نشد: ${error}`} />
          )}
          <ErpInlineState
            kind="stale"
            title={
              statusTarget
                ? `وضعیت «${operationalStatusLabel(statusTarget.record.status)}» تغییر خواهد کرد.`
                : "رکوردی انتخاب نشده است."
            }
          />
          <label className={field}>
            دلیل تغییر وضعیت
            <ErpInput
              required
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
            />
          </label>
        </div>
      </ErpSheet>
    </ErpWorkspacePage>
  );
}
