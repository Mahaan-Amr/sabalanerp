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
import { dispatchCaseReference } from "@/features/dispatch-case/dispatchCasePresentation";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";
import { confirmationActionsFor } from "@/features/biometric/dispatchConfirmationPresentation";
import { accountingAPI, dispatchConfirmationAPI } from "@/lib/api";
import { biometricConnectorClient } from "@/lib/biometricConnector";

type DispatchNotice = { kind: "success" | "error"; text: string };
type DispatchSection = "candidates" | "confirmation" | "cases";
type ReasonAction = {
  type: "reject" | "void" | "replace" | "revoke";
  id: string;
};

const dispatchStatusLabels: Record<string, string> = {
  PENDING: "در انتظار بررسی",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "برای اصلاح بازگردانده‌شده",
};

export default function AccountingDispatchPage() {
  const [section, setSection] = useState<DispatchSection>("candidates");
  const [loading, setLoading] = useState(true);
  const [dispatchCandidates, setDispatchCandidates] = useState<any[]>([]);
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
      const [candidates, capabilities] = await Promise.allSettled([
        accountingAPI.getDispatchCandidates(),
        dispatchConfirmationAPI.getCapabilities(),
      ]);
      if (candidates.status === "fulfilled" && candidates.value.data.success)
        setDispatchCandidates(candidates.value.data.data || []);
      if (
        capabilities.status === "fulfilled" &&
        capabilities.value.data.success
      )
        setDispatchCapabilities(capabilities.value.data.data);
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
      } catch {
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
              {dispatchCandidates.map((candidate) => {
                const activeWaybill = candidate.waybills?.find(
                  (waybill: any) => waybill.status === "ISSUED",
                );
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
                    {candidate.status === "PENDING" &&
                      candidate.canManage &&
                      dispatchCapabilities.canManageAccountingCandidates && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ErpButton
                            label="پذیرش و صدور بارنامه"
                            disabled={dispatchTimelineStale || dispatchPending}
                            onClick={() =>
                              void runDispatch(
                                () =>
                                  accountingAPI.decideDispatchCandidate(
                                    candidate.id,
                                    {
                                      action: "ACCEPT",
                                      reason: "",
                                      idempotencyKey: crypto.randomUUID(),
                                    },
                                  ),
                                "پرونده پذیرفته و بارنامه صادر شد.",
                              )
                            }
                          />
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
                          {dispatchCapabilities.canManageAccountingConfirmation && (
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
                          {candidate.canManage &&
                            dispatchCapabilities.canManageAccountingCandidates && (
                              <ErpActionMenu
                                label="اقدامات بارنامه"
                                actions={[
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
              tone={reasonAction?.type === "replace" ? "warning" : "danger"}
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
