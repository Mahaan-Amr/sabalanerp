"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  FaBan,
  FaCheck,
  FaEdit,
  FaPlus,
  FaPrint,
  FaSync,
  FaTrash,
} from "react-icons/fa";
import {
  ErpActionMenu,
  ErpButton,
  ErpCard,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpSummaryGrid,
  ErpTextarea,
} from "@/components/erp";
import { dashboardAPI, logisticsAPI } from "@/lib/api";
import RoleAwareDispatchCases from "@/features/dispatch-case/RoleAwareDispatchCases";
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";
import {
  StatusBadge,
  dateFa,
  loadingDriversName,
  numberFa,
  unitLabels,
} from "../../logistics-ui";

type DetailSection = "summary" | "items" | "print" | "cases";
type DetailAction = "finalize" | "delete" | "cancel" | "correct" | null;

export default function LoadingDetailPage() {
  const mutationLock = useRef(false);
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<DetailSection>("summary");
  const [action, setAction] = useState<DetailAction>(null);
  const [loading, setLoading] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [correction, setCorrection] = useState({
    sourceContractItemId: "",
    loadingLineId: "",
    deltaQuantity: "",
    reason: "",
  });
  const [actionAvailability, setActionAvailability] = useState<any>({});

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      const [response, availability] = await Promise.all([
        logisticsAPI.getLoading(params.id),
        dashboardAPI.getActionAvailability("logistics"),
      ]);
      if (response.data.success) setLoading(response.data.data);
      setActionAvailability(availability.data.data || {});
    } catch (error: any) {
      setActionError(userFacingError(error, "اطلاعات بارگیری دریافت نشد."));
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!isLoading && loading && searchParams.get("print") === "1")
      window.setTimeout(() => window.print(), 250);
  }, [isLoading, loading, searchParams]);

  const runAction = async (command: () => Promise<any>): Promise<boolean> => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setActionError("");
    setSaving(true);
    try {
      await command();
      await load();
      return true;
    } catch (error: any) {
      setActionError(
        userFacingError(error, "عملیات انجام نشد. دوباره تلاش کنید."),
      );
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setActionError("");
    setSaving(true);
    try {
      await logisticsAPI.deleteLoading(loading.id);
      router.push("/dashboard/logistics/loadings");
    } catch (error: any) {
      setActionError(userFacingError(error, "حذف پیش‌نویس انجام نشد."));
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  if (isLoading) return <ErpLoading />;
  if (!loading)
    return (
      <ErpPage
        title="بارگیری پیدا نشد"
        backHref="/dashboard/logistics/loadings"
      >
        <div />
      </ErpPage>
    );

  const driver = loading.driverSnapshot || {};
  const assignedDrivers = loading.driverAssignments || [];
  const driverSummary = loadingDriversName(loading);
  const plateSummary = assignedDrivers.length
    ? assignedDrivers
        .map(
          (item: any) =>
            item.driverSnapshot?.vehiclePlate || item.vehiclePair?.vehiclePlate,
        )
        .filter(Boolean)
        .join("، ")
    : driver.vehiclePlate || "—";
  const vehicleTypeSummary = assignedDrivers.length
    ? assignedDrivers
        .map(
          (item: any) =>
            item.driverSnapshot?.vehicleType || item.vehiclePair?.vehicleType,
        )
        .filter(Boolean)
        .join("، ")
    : driver.vehicleType || "—";
  const phoneSummary = assignedDrivers.length
    ? assignedDrivers
        .map(
          (item: any) => item.driverSnapshot?.phone || item.vehiclePair?.phone,
        )
        .filter(Boolean)
        .join("، ")
    : driver.phone || "—";
  const canFinalize =
    actionAvailability.FINALIZE_LOADING?.enabled === true &&
    loading.status === "DRAFT";
  const canEditDraft =
    actionAvailability.EDIT_LOADING?.enabled === true &&
    loading.status === "DRAFT";
  const canCancel =
    actionAvailability.CANCEL_LOADING?.enabled === true &&
    loading.status !== "CANCELLED";
  const canCorrect =
    actionAvailability.CREATE_CORRECTION?.enabled === true &&
    loading.status === "FINALIZED";
  const actionMenu = [
    ...(canFinalize
      ? [
          {
            label: "نهایی‌سازی بارگیری",
            icon: FaCheck,
            tone: "success" as const,
            onClick: () => setAction("finalize"),
          },
        ]
      : []),
    ...(canCorrect
      ? [
          {
            label: "ثبت اصلاح مقدار",
            icon: FaPlus,
            tone: "warning" as const,
            onClick: () => setAction("correct"),
          },
        ]
      : []),
    ...(canCancel
      ? [
          {
            label: "لغو بارگیری",
            icon: FaBan,
            tone: "danger" as const,
            onClick: () => {
              setCancelReason("");
              setAction("cancel");
            },
          },
        ]
      : []),
    ...(canEditDraft
      ? [
          {
            label: "حذف پیش‌نویس",
            icon: FaTrash,
            tone: "danger" as const,
            onClick: () => setAction("delete"),
          },
        ]
      : []),
  ];
  const sheetError = actionError ? (
    <div aria-live="assertive">
      <ErpInlineState kind="error" title={actionError} />
    </div>
  ) : null;

  return (
    <ErpPage
      eyebrow="لجستیک"
      title={dispatchCaseReference(loading.loadingNumber)}
      description={`${loading.customer?.firstName || ""} ${loading.customer?.lastName || ""} · ${loading.project?.projectName || loading.project?.address || ""}`}
      backHref="/dashboard/logistics/loadings"
      actions={[
        ...(canEditDraft
          ? [
              {
                label: "ادامه ویرایش",
                icon: FaEdit,
                href: `/dashboard/logistics/loadings/new?draftId=${loading.id}`,
                tone: "primary" as const,
              },
            ]
          : []),
        {
          label: "چاپ",
          icon: FaPrint,
          onClick: () => window.print(),
          tone: "neutral",
        },
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, tone: "neutral" },
      ]}
    >
      {actionError && (
        <ErpInlineState
          kind="error"
          title={actionError}
          action={{ label: "تلاش مجدد", onClick: load }}
        />
      )}
      <ErpSegmentedControl
        value={section}
        onChange={setSection}
        options={[
          { value: "summary", label: "خلاصه" },
          { value: "items", label: "اقلام بارگیری" },
          { value: "print", label: "برگه چاپی" },
          { value: "cases", label: "مراحل ارسال" },
        ]}
      />

      {section === "summary" && (
        <ErpSection title="وضعیت بارگیری">
          {actionMenu.length > 0 && (
            <div className="mb-4 flex justify-end">
              <ErpActionMenu label="عملیات بارگیری" actions={actionMenu} />
            </div>
          )}
          <ErpSummaryGrid
            columns={3}
            items={[
              {
                label: "وضعیت",
                value: <StatusBadge status={loading.status} />,
              },
              { label: "تاریخ بارگیری", value: dateFa(loading.loadingDate) },
              { label: "راننده", value: driverSummary },
              { label: "پلاک", value: plateSummary },
              { label: "نوع خودرو", value: vehicleTypeSummary },
              { label: "شماره تماس", value: phoneSummary },
            ]}
          />
          {loading.status === "DRAFT" && (
            <ErpInlineState
              className="mt-4"
              kind="stale"
              title="این بارگیری هنوز پیش‌نویس است و مانده قرارداد را کاهش نمی‌دهد."
            />
          )}
          {loading.status === "FINALIZED" && (
            <ErpInlineState
              className="mt-4"
              kind="success"
              title="بارگیری نهایی شده است؛ ارسال فیزیکی فقط پس از ثبت خروج توسط گارد انجام می‌شود."
            />
          )}
        </ErpSection>
      )}

      {section === "items" && (
        <ErpSection title="اقلام بارگیری">
          <div className="space-y-3">
            {loading.lines.map((line: any) => (
              <ErpCard key={line.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold sds-text-primary">
                      {line.productSnapshot?.name ||
                        line.product?.namePersian ||
                        line.product?.name}
                    </p>
                    <p className="mt-1 text-xs sds-text-secondary">
                      قرارداد {line.sourceContract?.contractNumber}
                    </p>
                  </div>
                  <p className="rounded-lg bg-[var(--sds-accent)]/10 px-3 py-2 text-sm font-semibold sds-text-accent">
                    {numberFa(line.quantity)}{" "}
                    {unitLabels[line.unit] || "واحد ثبت‌شده"}
                  </p>
                </div>
                {(line.khatRas || line.pieceCount) && (
                  <p className="mt-3 text-sm sds-text-secondary">
                    خط راس {numberFa(line.khatRas)} × تعداد{" "}
                    {numberFa(line.pieceCount)} + اضافه {numberFa(line.plus)} -
                    کسر {numberFa(line.minus)}
                  </p>
                )}
                {line.corrections?.length > 0 && (
                  <ErpInlineState
                    className="mt-3"
                    kind="stale"
                    title={`اصلاحات: ${line.corrections.map((item: any) => `${numberFa(item.deltaQuantity)} ${unitLabels[item.unit] || "واحد ثبت‌شده"}`).join("، ")}`}
                  />
                )}
              </ErpCard>
            ))}
          </div>
        </ErpSection>
      )}

      {section === "print" && (
        <ErpSection
          title="برگه چاپی بارگیری"
          description="پیش‌نمایش سند؛ برای نسخه چاپی از دکمه «چاپ» بالای صفحه استفاده کنید."
        >
          <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 text-sm leading-7 sds-text-primary">
            <div className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
              <div>
                <h2 className="text-lg font-bold">برگه بارگیری سبلان</h2>
                <p>{dispatchCaseReference(loading.loadingNumber)}</p>
              </div>
              <p>{dateFa(loading.finalizedAt || loading.loadingDate)}</p>
            </div>
            <p>
              مشتری / پروژه:{" "}
              {loading.customer?.companyName ||
                `${loading.customer?.firstName || ""} ${loading.customer?.lastName || ""}`}{" "}
              · {loading.project?.projectName || loading.project?.address}
            </p>
            <p>
              راننده: {driverSummary} · پلاک: {plateSummary} · خودرو:{" "}
              {vehicleTypeSummary}
            </p>
            <div className="mt-4 space-y-2">
              {loading.lines.map((line: any, index: number) => (
                <div
                  key={line.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b border-[var(--sds-border-default)] py-2"
                >
                  <span>{(index + 1).toLocaleString("fa-IR")}</span>
                  <span>
                    {line.productSnapshot?.name ||
                      line.product?.namePersian ||
                      line.product?.name}{" "}
                    · قرارداد {line.sourceContract?.contractNumber}
                  </span>
                  <span>
                    {numberFa(line.quantity)}{" "}
                    {unitLabels[line.unit] || "واحد ثبت‌شده"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-8 grid grid-cols-2 gap-8 text-center md:grid-cols-4">
              <span>انبار</span>
              <span>راننده</span>
              <span>نگهبانی</span>
              <span>نماینده پروژه</span>
            </div>
          </div>
        </ErpSection>
      )}

      <div hidden={section !== "cases"}>
        <RoleAwareDispatchCases
          workspace="logistics"
          loadingId={params.id}
          onStaleChange={setDispatchTimelineStale}
        />
      </div>

      <ErpSheet
        open={action === "finalize"}
        onClose={() => {
          if (!saving) setAction(null);
        }}
        title="نهایی‌سازی بارگیری"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setAction(null)}
            />
            <ErpButton
              label="ثبت نهایی بارگیری"
              icon={FaCheck}
              tone="success"
              disabled={dispatchTimelineStale || saving || !canFinalize}
              onClick={async () => {
                if (
                  await runAction(() =>
                    logisticsAPI.finalizeLoading(loading.id),
                  )
                )
                  setAction(null);
              }}
            />
          </div>
        }
      >
        {sheetError}
        <ErpInlineState
          kind="stale"
          title="پس از نهایی‌سازی، اقلام و راننده این سند قابل ویرایش مستقیم نیستند. این اقدام هنوز به معنی خروج فیزیکی بار نیست."
        />
      </ErpSheet>
      <ErpSheet
        open={action === "delete"}
        onClose={() => {
          if (!saving) setAction(null);
        }}
        title="حذف پیش‌نویس"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setAction(null)}
            />
            <ErpButton
              label="حذف پیش‌نویس"
              icon={FaTrash}
              tone="danger"
              disabled={saving || !canEditDraft}
              onClick={() => void deleteDraft()}
            />
          </div>
        }
      >
        {sheetError}
        <p className="text-sm leading-7 sds-text-muted">
          این پیش‌نویس هنوز اثری بر مانده بارگیری ندارد و پس از حذف قابل بازیابی
          نیست.
        </p>
      </ErpSheet>
      <ErpSheet
        open={action === "cancel"}
        onClose={() => {
          if (!saving) {
            setAction(null);
            setCancelReason("");
          }
        }}
        title="لغو بارگیری"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setAction(null);
                setCancelReason("");
              }}
            />
            <ErpButton
              label="تأیید لغو"
              icon={FaBan}
              tone="danger"
              disabled={dispatchTimelineStale || saving || !cancelReason.trim()}
              onClick={async () => {
                if (
                  await runAction(() =>
                    logisticsAPI.cancelLoading(loading.id, cancelReason.trim()),
                  )
                ) {
                  setAction(null);
                  setCancelReason("");
                }
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {sheetError}
          <ErpField label="دلیل لغو" required>
            <ErpTextarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              rows={4}
            />
          </ErpField>
        </div>
      </ErpSheet>
      <ErpSheet
        open={action === "correct"}
        onClose={() => {
          if (!saving) setAction(null);
        }}
        title="اصلاح مقدار بارگیری"
        presentation="modal"
        pending={saving}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              variant="ghost"
              disabled={saving}
              onClick={() => setAction(null)}
            />
            <ErpButton
              label="ثبت اصلاح"
              icon={FaPlus}
              disabled={
                dispatchTimelineStale ||
                saving ||
                !correction.sourceContractItemId ||
                !correction.deltaQuantity ||
                !correction.reason.trim()
              }
              onClick={async () => {
                if (
                  await runAction(() =>
                    logisticsAPI.createCorrection(loading.id, correction),
                  )
                ) {
                  setAction(null);
                  setCorrection({
                    sourceContractItemId: "",
                    loadingLineId: "",
                    deltaQuantity: "",
                    reason: "",
                  });
                }
              }}
            />
          </div>
        }
      >
        <div className="space-y-4">
          {sheetError}
          <ErpField label="قلم بارگیری" required>
            <ErpSelect
              value={correction.sourceContractItemId}
              onChange={(event) => {
                const line = loading.lines.find(
                  (item: any) =>
                    item.sourceContractItemId === event.target.value,
                );
                setCorrection((current) => ({
                  ...current,
                  sourceContractItemId: event.target.value,
                  loadingLineId: line?.id || "",
                }));
              }}
            >
              <option value="">انتخاب کنید</option>
              {loading.lines.map((line: any) => (
                <option key={line.id} value={line.sourceContractItemId}>
                  {line.productSnapshot?.name || line.product?.namePersian} ·
                  قرارداد {line.sourceContract?.contractNumber}
                </option>
              ))}
            </ErpSelect>
          </ErpField>
          <ErpField label="مقدار تغییر" required>
            <ErpInput
              value={correction.deltaQuantity}
              onChange={(event) =>
                setCorrection((current) => ({
                  ...current,
                  deltaQuantity: event.target.value,
                }))
              }
              placeholder="برای کاهش از علامت منفی استفاده کنید"
            />
          </ErpField>
          <ErpField label="دلیل اصلاح" required>
            <ErpTextarea
              value={correction.reason}
              onChange={(event) =>
                setCorrection((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              rows={4}
            />
          </ErpField>
        </div>
      </ErpSheet>
    </ErpPage>
  );
}
