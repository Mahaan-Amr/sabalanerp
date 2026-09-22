"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { FaFingerprint, FaPause, FaPlay, FaUserCheck } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpFieldView,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpSection,
  ErpSegmentedControl,
  ErpSheet,
  ErpWorkspacePage,
} from "@/components/erp";
import { dispatchConfirmationAPI, dispatchMasterDataAPI } from "@/lib/api";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import { fromIsoDate, toIsoDate } from "@/features/hr/hrUi";
import {
  biometricEnrollmentPresentation,
  DriverEligibilitySection,
  driverEligibilitySections,
} from "@/features/hr/driverEligibilityPresentation";
import { biometricConnectorClient } from "@/lib/biometricConnector";
import {
  captureEnrollmentFingers,
  EnrollmentCaptureEvidence,
  EnrollmentFinger,
} from "@/features/biometric/driverEnrollmentWorkflow";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";

const today = () => new Date().toISOString().slice(0, 10);
const field = "space-y-1.5 text-sm font-medium sds-text-secondary";

const eligibilityLabel = (status?: string | null) => {
  if (status === "ELIGIBLE") return "مجاز به رانندگی";
  if (status === "SUSPENDED") return "صلاحیت تعلیق‌شده";
  return "بدون صلاحیت فعال";
};

const fingerLabel = (finger: string) =>
  finger === "RIGHT_INDEX"
    ? "انگشت اشاره راست"
    : finger === "LEFT_INDEX"
      ? "انگشت اشاره چپ"
      : finger;

export default function PersonnelDriverEligibilityPage() {
  const personnelId = String(useParams<{ id: string }>().id);
  const [record, setRecord] = useState<any>(null);
  const [capabilities, setCapabilities] = useState({
    canManageEligibility: false,
    canManageBiometricEnrollment: false,
  });
  const [section, setSection] = useState<DriverEligibilitySection>("status");
  const [eligibilityDialogOpen, setEligibilityDialogOpen] = useState(false);
  const [deactivationDialogOpen, setDeactivationDialogOpen] = useState(false);
  const [imagesRequested, setImagesRequested] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [confirmationPhone, setConfirmationPhone] = useState("");
  const [biometricDeactivationReason, setBiometricDeactivationReason] =
    useState("");
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [pendingFinger, setPendingFinger] = useState<EnrollmentFinger | null>(
    null,
  );
  const [captureEvidence, setCaptureEvidence] = useState<
    EnrollmentCaptureEvidence[]
  >([]);
  const [enrollmentImages, setEnrollmentImages] = useState<
    Record<string, string>
  >({});
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const placementResolver = useRef<{
    finger: EnrollmentFinger;
    resolve: () => void;
  } | null>(null);
  const mutationLock = useRef(false);

  const requestFingerPlacement = useCallback(
    (finger: EnrollmentFinger) =>
      new Promise<void>((resolve) => {
        placementResolver.current = { finger, resolve };
        setPendingFinger(finger);
      }),
    [],
  );

  const confirmFingerPlacement = () => {
    const pending = placementResolver.current;
    if (!pending) return;
    placementResolver.current = null;
    setPendingFinger(null);
    pending.resolve();
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response =
        await dispatchMasterDataAPI.getPersonnelDriverEligibility(personnelId);
      setRecord(response.data.data);
      setCapabilities(
        response.data.capabilities || {
          canManageEligibility: false,
          canManageBiometricEnrollment: false,
        },
      );
      setEnrollmentId(response.data.data.activeBiometricEnrollment?.id || null);
    } catch (error: any) {
      setNotice({
        kind: "error",
        text: userFacingError(error, "دریافت صلاحیت رانندگی ممکن نشد."),
      });
    } finally {
      setLoading(false);
    }
  }, [personnelId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setImagesRequested(false);
    setEnrollmentImages({});
  }, [enrollmentId]);

  const shouldLoadEnrollmentImages = Boolean(enrollmentId) && imagesRequested;
  useEffect(() => {
    const enrollment = record?.activeBiometricEnrollment;
    const templates = Array.isArray(enrollment?.templates)
      ? enrollment.templates.filter(
          (item: any) => item.imageMimeType === "image/png",
        )
      : [];
    let disposed = false;
    const urls: string[] = [];
    setEnrollmentImages({});
    if (shouldLoadEnrollmentImages && enrollment?.id && templates.length) {
      void Promise.all(
        templates.map(async (item: any) => {
          const response = await dispatchConfirmationAPI.getEnrollmentImage(
            enrollment.id,
            item.finger,
          );
          const url = URL.createObjectURL(response.data);
          urls.push(url);
          return [item.finger, url] as const;
        }),
      )
        .then((entries) => {
          if (!disposed) setEnrollmentImages(Object.fromEntries(entries));
        })
        .catch(() => {
          if (!disposed)
            setNotice({
              kind: "error",
              text: "دریافت تصویر اثر انگشت ممکن نشد.",
            });
        });
    }
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [record?.activeBiometricEnrollment, shouldLoadEnrollmentImages]);

  const run = async (
    action: () => Promise<any>,
    message: string,
  ): Promise<boolean> => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setSaving(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: message });
      await load();
      return true;
    } catch (error: any) {
      setNotice({
        kind: "error",
        text: userFacingError(error, "عملیات انجام نشد."),
      });
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;
  if (!record)
    return (
      <ErpInlineState kind="error" title={notice?.text || "پرسنل پیدا نشد."} />
    );

  const driver = record.driver;
  const eligibility = driver?.currentEligibility;
  const eligible = eligibility?.status === "ELIGIBLE";
  const enrollment = record.activeBiometricEnrollment;
  const enrollmentView = biometricEnrollmentPresentation({
    hasActiveEnrollment: Boolean(enrollmentId),
    imagesRequested,
  });
  const templates = Array.isArray(enrollment?.templates)
    ? enrollment.templates
    : [];
  const imageTemplates = templates.filter(
    (item: any) => item.imageMimeType === "image/png",
  );
  const closeEligibilityDialog = () => {
    if (saving) return;
    setEligibilityDialogOpen(false);
    setReason("");
    setEffectiveFrom(today());
  };
  const closeDeactivationDialog = () => {
    if (saving) return;
    setDeactivationDialogOpen(false);
    setBiometricDeactivationReason("");
  };
  const submitEligibility = async () => {
    if (!reason.trim()) return;
    const succeeded = await run(
      () =>
        driver
          ? dispatchMasterDataAPI.transitionInternalDriverEligibility(
              driver.id,
              {
                status: eligible ? "SUSPENDED" : "ELIGIBLE",
                effectiveFrom,
                reason: reason.trim(),
              },
            )
          : dispatchMasterDataAPI.createInternalDriver({
              personnelId,
              effectiveFrom,
              reason: reason.trim(),
            }),
      driver ? "وضعیت صلاحیت ثبت شد." : "راننده داخلی تعریف شد.",
    );
    if (succeeded) closeEligibilityDialog();
  };
  const enrollDriver = async () => {
    if (!confirmationPhone.trim()) return;
    const succeeded = await run(async () => {
      setCaptureEvidence([]);
      const captures = await captureEnrollmentFingers({
        personnelId,
        getConnectorStatus: biometricConnectorClient.status,
        createEnrollmentCommand:
          dispatchConfirmationAPI.createEnrollmentCommand,
        executeConnectorCommand: biometricConnectorClient.execute,
        requestFingerPlacement,
        onCaptureComplete: (evidence) =>
          setCaptureEvidence((current) => [...current, evidence]),
      });
      return dispatchConfirmationAPI.enrollInternalDriver(personnelId, {
        confirmationPhone: confirmationPhone.trim(),
        captures,
      });
    }, "ثبت بیومتریک ذخیره شد.");
    if (succeeded) setConfirmationPhone("");
  };
  const deactivateEnrollment = async () => {
    if (!enrollmentId || !biometricDeactivationReason.trim()) return;
    const succeeded = await run(
      () =>
        dispatchConfirmationAPI.deactivateEnrollment(
          enrollmentId,
          biometricDeactivationReason.trim(),
        ),
      "ثبت بیومتریک غیرفعال شد.",
    );
    if (succeeded) closeDeactivationDialog();
  };

  return (
    <ErpWorkspacePage
      title="صلاحیت رانندگی پرسنل"
      context={`${record.personnel.firstName} ${record.personnel.lastName} · ${record.personnel.employeeNumber || "بدون شماره پرسنلی"}`}
      backHref="/dashboard/hr/personnel"
      className="pb-24 lg:pb-4"
    >
      {notice && <ErpInlineState kind={notice.kind} title={notice.text} />}

      <ErpSegmentedControl
        value={section}
        onChange={setSection}
        options={driverEligibilitySections}
      />

      {section === "status" && (
        <ErpSection
          title="وضعیت راننده"
          actions={
            capabilities.canManageEligibility
              ? [
                  {
                    label: driver ? "تغییر وضعیت" : "تعریف راننده",
                    icon: driver ? (eligible ? FaPause : FaPlay) : FaUserCheck,
                    variant: "outline",
                    tone: eligible ? "warning" : "success",
                    onClick: () => setEligibilityDialogOpen(true),
                  },
                ]
              : undefined
          }
        >
          <ErpCard className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ErpFieldView
                label="راننده داخلی"
                value={driver ? "تعریف شده" : "تعریف نشده"}
                tone={driver ? "success" : "warning"}
              />
              <ErpFieldView
                label="صلاحیت جاری"
                value={eligibilityLabel(eligibility?.status)}
                tone={eligible ? "success" : "warning"}
              />
              <ErpFieldView
                label="تاریخ اثر"
                value={
                  eligibility?.effectiveFrom
                    ? new Date(eligibility.effectiveFrom).toLocaleDateString(
                        "fa-IR",
                      )
                    : "ثبت نشده"
                }
              />
              <ErpFieldView
                label="دلیل"
                value={eligibility?.reason || "ثبت نشده"}
              />
            </div>
          </ErpCard>
        </ErpSection>
      )}

      {section === "biometric" && !driver && (
        <ErpEmptyState
          icon={FaUserCheck}
          title="ابتدا راننده داخلی را تعریف کنید"
          description="ثبت بیومتریک فقط برای راننده داخلی دارای پرونده صلاحیت انجام می‌شود."
          action={{
            label: "رفتن به وضعیت راننده",
            onClick: () => setSection("status"),
          }}
        />
      )}

      {section === "biometric" &&
        driver &&
        !capabilities.canManageBiometricEnrollment && (
          <ErpInlineState
            kind="permission"
            title="اجازه مدیریت ثبت بیومتریک این راننده را ندارید."
          />
        )}

      {section === "biometric" &&
        driver &&
        capabilities.canManageBiometricEnrollment &&
        enrollmentView.showActiveSummary && (
          <ErpSection
            title="بیومتریک فعال"
            actions={[
              ...(imageTemplates.length
                ? [
                    {
                      label: imagesRequested
                        ? "پنهان‌کردن تصاویر"
                        : "مشاهده تصاویر",
                      icon: FaFingerprint,
                      variant: "outline" as const,
                      onClick: () => setImagesRequested((value) => !value),
                    },
                  ]
                : []),
              {
                label: "غیرفعال‌سازی",
                icon: FaPause,
                tone: "danger" as const,
                variant: "ghost" as const,
                onClick: () => setDeactivationDialogOpen(true),
              },
            ]}
          >
            <ErpInlineState
              kind="success"
              title="ثبت بیومتریک راننده فعال است."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((item: any) => (
                <ErpCard key={item.finger} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold sds-text-primary">
                      {fingerLabel(item.finger)}
                    </p>
                    <ErpBadge tone="success">ثبت‌شده</ErpBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.captureQuality && (
                      <ErpBadge
                        tone={
                          item.captureQuality.state === "ACCEPTED"
                            ? "success"
                            : "warning"
                        }
                      >
                        کیفیت {item.captureQuality.score}
                      </ErpBadge>
                    )}
                    {item.liveness && (
                      <ErpBadge
                        tone={
                          item.liveness.state === "LIVE" ? "success" : "warning"
                        }
                      >
                        زنده‌بودن{" "}
                        {item.liveness.state === "LIVE"
                          ? "تأیید شد"
                          : operationalStatusLabel(item.liveness.state)}
                      </ErpBadge>
                    )}
                  </div>
                </ErpCard>
              ))}
            </div>

            {imagesRequested && imageTemplates.length > 0 && (
              <ErpCard className="p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {imageTemplates.map((item: any) => (
                    <div key={item.finger} className="space-y-2 text-center">
                      <p className="text-sm font-medium sds-text-secondary">
                        {fingerLabel(item.finger)}
                      </p>
                      {enrollmentImages[item.finger] ? (
                        <Image
                          unoptimized
                          src={enrollmentImages[item.finger]}
                          alt={`اثر انگشت ${fingerLabel(item.finger)}`}
                          width={item.imageWidth}
                          height={item.imageHeight}
                          className="mx-auto max-h-52 w-auto rounded-lg object-contain"
                        />
                      ) : (
                        <ErpLoading />
                      )}
                      <p className="text-xs sds-text-muted">
                        {item.imageWidth}×{item.imageHeight} پیکسل
                      </p>
                    </div>
                  ))}
                </div>
              </ErpCard>
            )}
          </ErpSection>
        )}

      {section === "biometric" &&
        driver &&
        capabilities.canManageBiometricEnrollment &&
        enrollmentView.showEnrollmentForm && (
          <ErpSection
            title="ثبت بیومتریک"
            description="شماره تأیید راننده را وارد کنید؛ سامانه دو انگشت را مرحله‌به‌مرحله ثبت می‌کند."
          >
            <div className="max-w-xl space-y-4">
              <label className={field}>
                شماره تأیید راننده
                <ErpInput
                  value={confirmationPhone}
                  onChange={(event) => setConfirmationPhone(event.target.value)}
                />
              </label>
              <div className="flex justify-end">
                <ErpButton
                  label="شروع ثبت بیومتریک"
                  icon={FaFingerprint}
                  disabled={
                    dispatchTimelineStale || saving || !confirmationPhone.trim()
                  }
                  onClick={() => void enrollDriver()}
                />
              </div>
              {pendingFinger && (
                <ErpCard className="space-y-3 p-4">
                  <ErpInlineState
                    kind="stale"
                    title={
                      pendingFinger === "RIGHT_INDEX"
                        ? "انگشت اشاره راست را روی حسگر قرار دهید؛ سپس اسکن را شروع کنید."
                        : "انگشت راست را بردارید و انگشت اشاره چپ را روی حسگر قرار دهید."
                    }
                  />
                  <ErpButton
                    label={
                      pendingFinger === "RIGHT_INDEX"
                        ? "اسکن انگشت راست"
                        : "اسکن انگشت چپ"
                    }
                    icon={FaFingerprint}
                    onClick={confirmFingerPlacement}
                  />
                </ErpCard>
              )}
              {captureEvidence.length > 0 && (
                <ErpCard className="space-y-2 p-4">
                  {captureEvidence.map((evidence) => (
                    <div
                      key={evidence.finger}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-medium sds-text-primary">
                        {fingerLabel(evidence.finger)}
                      </span>
                      <ErpBadge tone="success">
                        کیفیت{" "}
                        {evidence.qualityScore ??
                          operationalStatusLabel(evidence.qualityState)}
                      </ErpBadge>
                      <ErpBadge tone="success">
                        زنده‌بودن{" "}
                        {evidence.livenessState === "LIVE"
                          ? "تأیید شد"
                          : operationalStatusLabel(evidence.livenessState)}
                      </ErpBadge>
                    </div>
                  ))}
                </ErpCard>
              )}
            </div>
          </ErpSection>
        )}

      <div hidden={section !== "dispatch"}>
        <RoleAwareDispatchCases
          workspace="hr"
          subjectId={personnelId}
          onStaleChange={setDispatchTimelineStale}
        />
      </div>

      <ErpSheet
        open={eligibilityDialogOpen}
        onClose={closeEligibilityDialog}
        title={
          !driver
            ? "تعریف راننده داخلی"
            : eligible
              ? "تعلیق صلاحیت رانندگی"
              : "بازگردانی صلاحیت رانندگی"
        }
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={closeEligibilityDialog}
            />
            <ErpButton
              label={
                !driver
                  ? "تعریف راننده"
                  : eligible
                    ? "ثبت تعلیق"
                    : "بازگردانی صلاحیت"
              }
              icon={!driver ? FaUserCheck : eligible ? FaPause : FaPlay}
              tone={eligible ? "warning" : "success"}
              variant="solid"
              disabled={dispatchTimelineStale || saving || !reason.trim()}
              onClick={() => void submitEligibility()}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {notice?.kind === "error" && (
            <ErpInlineState kind="error" title={notice.text} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}>
              تاریخ اثر
              <HrPersianCalendar
                value={fromIsoDate(effectiveFrom)}
                onChange={(value) => setEffectiveFrom(toIsoDate(value))}
                disablePastDates
              />
            </label>
            <label className={field}>
              دلیل
              <ErpInput
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
        </div>
      </ErpSheet>

      <ErpSheet
        open={deactivationDialogOpen}
        onClose={closeDeactivationDialog}
        title="غیرفعال‌سازی ثبت بیومتریک"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={closeDeactivationDialog}
            />
            <ErpButton
              label="تأیید غیرفعال‌سازی"
              icon={FaPause}
              tone="danger"
              variant="solid"
              disabled={
                dispatchTimelineStale ||
                saving ||
                !biometricDeactivationReason.trim()
              }
              onClick={() => void deactivateEnrollment()}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {notice?.kind === "error" && (
            <ErpInlineState kind="error" title={notice.text} />
          )}
          <p className="text-sm leading-7 sds-text-muted">
            پس از غیرفعال‌سازی، برای تأییدهای بعدی باید ثبت بیومتریک جدید انجام
            شود. سابقه قبلی حذف نمی‌شود.
          </p>
          <label className={field}>
            دلیل غیرفعال‌سازی
            <ErpInput
              required
              value={biometricDeactivationReason}
              onChange={(event) =>
                setBiometricDeactivationReason(event.target.value)
              }
            />
          </label>
        </div>
      </ErpSheet>
    </ErpWorkspacePage>
  );
}
