"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaSync } from "react-icons/fa";
import {
  ErpActionMenu,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
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
import { confirmationActionsFor } from "@/features/biometric/dispatchConfirmationPresentation";
import api, { accountingAPI, dispatchConfirmationAPI } from "@/lib/api";
import { biometricConnectorClient } from "@/lib/biometricConnector";

type DispatchNotice = { kind: "success" | "error"; text: string };
type DispatchSection = "candidates" | "confirmation" | "cases";
type ReasonAction = {
  type: "reject" | "void" | "replace" | "revoke" | "reconstruct";
  id: string;
};

const dispatchStatusLabels: Record<string, string> = {
  PENDING: "در انتظار بررسی",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "برای اصلاح بازگردانده‌شده",
};
const quantityUnitLabels: Record<string, string> = { meter: "متر طول", squareMeter: "متر مربع", count: "عدد", ton: "تن" };

export default function AccountingDispatchPage() {
  const [section, setSection] = useState<DispatchSection>("candidates");
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
    success: string,
  ): Promise<boolean> => {
    if (dispatchPendingRef.current) return false;
    dispatchPendingRef.current = true;
    setDispatchPending(true);
    setDispatchNotice(null);
    try {
      const response = await command();
      setDispatchNotice({ kind: "success", text: success });
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
    }, "تأیید راننده آماده انجام است.");
    if (succeeded) setSection("confirmation");
  };

  const runReasonAction = async () => {
    if (!reasonAction || !dispatchReason.trim()) return;
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
        "نامزد برای اصلاح بازگردانده شد.",
      );
    if (reasonAction.type === "void")
      succeeded = await runDispatch(
        () =>
          accountingAPI.voidDispatchWaybill(reasonAction.id, {
            reason,
            idempotencyKey: crypto.randomUUID(),
          }),
        "بارنامه با حفظ سابقه باطل شد.",
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
    if (reasonAction.type === "revoke")
      succeeded = await runDispatch(
        () =>
          dispatchConfirmationAPI.revokeAuthorization(reasonAction.id, reason),
        "مجوز خروج لغو شد.",
      );
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

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="فرمان‌های ارسال"
      backHref="/dashboard/accounting"
      actions={[
        {
          label: "به‌روزرسانی",
          icon: FaSync,
          onClick: loadDispatch,
          tone: "neutral",
        },
      ]}
    >
      <ErpSection
        title="ارسال محموله"
        description="هر بخش فقط کار مرتبط با همان مرحله را نشان می‌دهد."
      >
        {dispatchNotice && (
          <ErpInlineState
            kind={dispatchNotice.kind}
            title={dispatchNotice.text}
          />
        )}
        <ErpSegmentedControl
          value={section}
          onChange={setSection}
          options={[
            { value: "candidates", label: "صدور بارنامه" },
            { value: "confirmation", label: "تأیید راننده" },
            { value: "cases", label: "پرونده‌های ارسال" },
          ]}
        />

        {section === "candidates" &&
          (!dispatchCandidates.length ? (
            <ErpEmptyState title="پرونده‌ای برای صدور بارنامه وجود ندارد" />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {Object.values(dispatchCandidates.reduce<Record<string, any[]>>((groups, candidate) => {
                const key = candidate.loadingId || `candidate:${candidate.id}`;
                (groups[key] ||= []).push(candidate);
                return groups;
              }, Object.create(null) as Record<string, any[]>)).map((group) => {
                const first = group[0];
                return <ErpCard key={first.loadingId || first.id} className="space-y-3 p-4">
                  <strong>{first.summary?.loadingNumber ? dispatchCaseReference(first.summary.loadingNumber) : 'بارگیری'}</strong>
                  {group.map((candidate) => {
                const activeWaybill = candidate.waybills?.find(
                  (waybill: any) => waybill.status === "ISSUED" || waybill.status === "EXIT_RECORDED",
                );
                const detail = dispatchDetails[candidate.id];
                return (
                  <ErpCard key={candidate.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <strong>
                          {candidate.summary?.driverName || "راننده نامشخص"}
                        </strong>
                        <p className="mt-1 text-sm sds-text-secondary">
                          {[
                            candidate.summary?.loadingNumber &&
                              dispatchCaseReference(
                                candidate.summary.loadingNumber,
                              ),
                            candidate.summary?.plate &&
                              `پلاک ${candidate.summary.plate}`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "جزئیات تخصیص ثبت نشده است"}
                        </p>
                        <p className="mt-1 text-sm sds-text-secondary">
                          مشتری: {candidate.summary?.customerName || "ثبت نشده"} · پروژه: {candidate.summary?.projectName || "ثبت نشده"}
                        </p>
                        <p className="mt-1 text-sm sds-text-secondary">
                          آدرس پروژه: {candidate.summary?.projectAddress || "ثبت نشده"}
                        </p>
                      </div>
                      <ErpBadge
                        tone={
                          candidate.status === "ACCEPTED"
                            ? "success"
                            : candidate.status === "REJECTED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {dispatchStatusLabels[candidate.status] ||
                          operationalStatusLabel(candidate.status)}
                      </ErpBadge>
                    </div>
                    {detail?.contracts.length > 0 ? (
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
                    ) : candidate.lines?.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-[var(--sds-border-subtle)] pt-3">
                        <strong>اقلام این راننده</strong>
                        {candidate.lines.map((line: any, index: number) => (
                          <p key={index} className="text-sm sds-text-secondary">
                            قرارداد {line.contractNumber || "ثبت نشده"} · {line.productName || "محصول ثبت نشده"} · {line.quantity} {quantityUnitLabels[line.unit] || "واحد ثبت‌شده"}
                          </p>
                        ))}
                      </div>
                    )}
                    {!detail && <ErpInlineState kind="stale" title="جزئیات قیمت این پرونده در دسترس نیست؛ پیش از تصمیم اطلاعات حسابداری را بررسی کنید." />}
                    {candidate.status === "PENDING" &&
                      candidate.canManage &&
                      dispatchCapabilities.canManageAccountingCandidates && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ErpButton
                            label="بازگرداندن برای اصلاح"
                            tone="danger"
                            variant="outline"
                            disabled={dispatchTimelineStale || dispatchPending}
                            onClick={() => {
                              setDispatchReason("");
                              setReasonAction({
                                type: "reject",
                                id: candidate.id,
                              });
                            }}
                          />
                        </div>
                      )}
                    {activeWaybill && (
                      <div className="mt-3 space-y-2 border-t border-[var(--sds-border-subtle)] pt-3">
                        <p className="text-sm sds-text-secondary">
                          بارنامه شماره{" "}
                          {Number(activeWaybill.number).toLocaleString("fa-IR")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {activeWaybill.legacyReconstruction && <ErpButton label="مشاهده بارنامه بازسازی‌شده" variant="soft"
                            disabled={dispatchPending} onClick={() => void (async () => {
                              const preview = window.open('', '_blank');
                              if (!preview) { setDispatchNotice({ kind: 'error', text: 'مرورگر پنجره سند را مسدود کرد.' }); return; }
                              try {
                                const response = await api.get(`/accounting/dispatch-waybills/${encodeURIComponent(activeWaybill.id)}/reconstruction/pdf`, { responseType: 'blob' });
                                const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
                                preview.location.href = url;
                                window.setTimeout(() => URL.revokeObjectURL(url), 60000);
                              } catch (error) { preview.close(); setDispatchNotice({ kind: 'error', text: userFacingError(error, 'بارنامه بازسازی‌شده در دسترس نیست.') }); }
                            })()} />}
                          {activeWaybill.status === 'ISSUED' && dispatchCapabilities.canManageAccountingConfirmation && (
                            <ErpButton
                              label="تأیید هویت راننده"
                              variant="soft"
                              disabled={
                                dispatchTimelineStale || dispatchPending
                              }
                              onClick={() =>
                                void beginConfirmation(activeWaybill.id)
                              }
                            />
                          )}
                          {activeWaybill.status === 'ISSUED' && candidate.canManage &&
                            dispatchCapabilities.canManageAccountingCandidates && (
                              <ErpActionMenu
                                label="اقدامات بارنامه"
                                actions={[
                                  ...(!activeWaybill.legacyReconstruction &&
                                    dispatchDetails[candidate.id]?.bundle?.artifacts.filter(artifact => artifact.kind === 'WAYBILL').length !== 1 ? [{
                                      label: "بازسازی بارنامه قدیمی",
                                      onClick: () => { setDispatchReason(''); setReasonAction({ type: 'reconstruct' as const, id: activeWaybill.id }); },
                                    }] : []),
                                  {
                                    label: "صدور نسخه جایگزین",
                                    tone: "warning",
                                    onClick: () => {
                                      setDispatchReason("");
                                      setReasonAction({
                                        type: "replace",
                                        id: activeWaybill.id,
                                      });
                                    },
                                  },
                                  {
                                    label: "ابطال بارنامه",
                                    tone: "danger",
                                    onClick: () => {
                                      setDispatchReason("");
                                      setReasonAction({
                                        type: "void",
                                        id: activeWaybill.id,
                                      });
                                    },
                                  },
                                ]}
                              />
                            )}
                        </div>
                      </div>
                    )}
                  </ErpCard>
                );
                  })}
                  {first.loadingId && <SalesDispatchInvoices workspace="accounting" loadingId={first.loadingId}
                    canManage={group.every((candidate) => candidate.canManage) && dispatchCapabilities.canManageAccountingCandidates && !dispatchTimelineStale && !dispatchPending}
                    documentBlockReason={group.some(candidate => candidate.status === 'ACCEPTED' &&
                      !candidate.waybills?.some((waybill: any) => ['ISSUED', 'EXIT_RECORDED'].includes(waybill.status) && waybill.legacyReconstruction) &&
                      dispatchDetails[candidate.id]?.bundle?.artifacts.filter(artifact => artifact.kind === 'WAYBILL').length !== 1)
                      ? 'فایل بارنامه موجود نیست؛ برای بارنامه قدیمی، صدور اسناد نسخه بازسازی‌شده را ایجاد می‌کند.' : undefined}
                    onIssueAll={async () => {
                      try { await accountingAPI.issueLoadingDocuments(first.loadingId); await loadDispatch(); }
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
                        const response = await api.post(`/accounting/loadings/${encodeURIComponent(first.loadingId)}/print-documents`, {}, { responseType: 'blob' });
                        const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
                        preview.location.href = url;
                        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
                      } catch (error) { preview.close(); throw error; }
                    }}
                    refreshKey={dispatchCandidates}/>}
                </ErpCard>;
              })}
            </div>
          ))}

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
              <p className="mt-1 text-sm sds-text-muted">
                یک انگشت ثبت‌شده را انتخاب کنید و تا پایان بررسی روی حسگر نگه
                دارید.
              </p>
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
                        }, "اثر انگشت راننده بررسی شد.")
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
      </ErpSection>

      <div hidden={section !== "cases"}>
        <RoleAwareDispatchCases
          workspace="accounting"
          onStaleChange={setDispatchTimelineStale}
        />
      </div>
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
                ? "ابطال بارنامه"
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
              label="تأیید و ثبت"
              tone={reasonAction?.type === "replace" || reasonAction?.type === "reconstruct" ? "warning" : "danger"}
              disabled={
                dispatchTimelineStale ||
                dispatchPending ||
                !dispatchReason.trim()
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
            دلیل این تصمیم در سابقه پرونده باقی می‌ماند.
          </p>
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
            value={dispatchReason}
            onChange={(event) => setDispatchReason(event.target.value)}
          />
        </div>
      </ErpSheet>
    </ErpPage>
  );
}
