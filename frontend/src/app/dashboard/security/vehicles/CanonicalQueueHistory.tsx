"use client";

import { useEffect, useState } from "react";
import { FaClipboardList } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpPagination,
  ErpSheet,
  ErpSkeleton,
} from "@/components/erp";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { userFacingError } from "@/features/dispatch/userFacingError";
import type { createSecurityAPI } from "@/lib/api";

export const canonicalQueueStatusLabel: Record<string, string> = {
  WAITING_AT_GATE: "در انتظار گیت",
  AVAILABLE_FOR_LOADING: "آماده بارگیری",
  RESERVED_FOR_LOADING: "رزرو بارگیری",
  LOADING_FINALIZED: "بارگیری نهایی‌شده",
  EXIT_RECORDED: "خروج ثبت‌شده",
  CLOSED_WITHOUT_LOADING: "بسته‌شده بدون بارگیری",
  VOIDED: "باطل‌شده",
};

const eventLabel: Record<string, string> = {
  ADMITTED: "ثبت پذیرش",
  MADE_AVAILABLE_FOR_LOADING: "ورود برای بارگیری",
  RESERVED_FOR_LOADING: "رزرو بارگیری",
  RESERVATION_RELEASED: "آزادسازی رزرو",
  LOADING_FINALIZED: "نهایی‌سازی بارگیری",
  PHYSICAL_EXIT_RECORDED: "ثبت خروج فیزیکی",
  MANUAL_OUTAGE_EXIT_REGISTERED: "ثبت خروج دستی هنگام قطعی",
  RETURNED_TO_GATE_WAITING: "بازگشت به انتظار",
  RESERVATION_RELEASED_FOR_DEPARTURE: "آزادسازی رزرو هنگام خروج",
  CLOSED_WITHOUT_LOADING: "خروج بدون بارگیری",
  RESERVATION_RELEASED_FOR_VOID: "آزادسازی رزرو هنگام ابطال",
  VOIDED: "ابطال پذیرش",
  FINALIZED_LOADING_CANCELLED: "ابطال بارگیری نهایی‌شده",
  PROJECT_RETURN_CANCELLED_WITHOUT_DELIVERY: "لغو مرجوعی بدون تحویل",
  PROJECT_RETURN_RECEIVED: "ثبت تحویل مرجوعی",
  PROJECT_RETURN_TRANSFERRED_TO_LOADING: "انتقال از مرجوعی به صف بارگیری",
  PROJECT_RETURN_PERSONAL_COMPLETED: "ثبت اتمام مرجوعی خودروی شخصی",
};

type HistoryTurn = {
  id: string;
  status: string;
  admittedAt: string;
  driverSource: string;
  projectReturnStatus?: "CANCELLED_WITHOUT_DELIVERY" | "RECEIVED" | "AWAITING_RECEIPT" | null;
  projectReturnReleasedAt?: string | null;
  admissionSnapshot: {
    driver?: { firstName?: string; lastName?: string };
    plate?: { plate?: string };
  };
};

type QueueEvent = {
  id: string;
  eventType: string;
  toStatus: string;
  recordedAt: string;
  reason?: string | null;
};

type HistoryPage = {
  data: HistoryTurn[];
  pagination: { page: number; pageSize: number; total: number };
};

type ReadResult<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const formatTime = (value: string) => new Date(value).toLocaleString("fa-IR");
const turnLabel = (turn: HistoryTurn) => {
  const { driver, plate } = turn.admissionSnapshot;
  const name = [driver?.firstName, driver?.lastName].filter(Boolean).join(" ") || "راننده ثبت‌شده";
  return `${name} · ${plate?.plate || "بدون پلاک"}`;
};

export default function CanonicalQueueHistory({ refresh, securityAPI }: {
  refresh: number;
  securityAPI: Pick<ReturnType<typeof createSecurityAPI>, "getCanonicalDriverQueueHistory" | "getCanonicalDriverQueueEvents">;
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<ReadResult<HistoryPage>>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<ReadResult<QueueEvent[]>>({ status: "loading" });
  const [eventRetry, setEventRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setHistory({ status: "loading" });
    securityAPI.getCanonicalDriverQueueHistory(page, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setHistory({ status: "ready", data });
          setSelectedId(current => data.data.some((turn: HistoryTurn) => turn.id === current) ? current : null);
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setHistory({ status: "error", message: userFacingError(error, "سوابق نوبت‌ها دریافت نشد.") });
          setSelectedId(null);
        }
      });
    return () => controller.abort();
  }, [page, refresh, retry, securityAPI]);

  const selected = history.status === "ready" ? history.data.data.find(turn => turn.id === selectedId) : undefined;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setEvents({ status: "loading" });
    securityAPI.getCanonicalDriverQueueEvents(selectedId, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setEvents({ status: "ready", data: data.data });
      })
      .catch(error => {
        if (!controller.signal.aborted) setEvents({ status: "error", message: userFacingError(error, "رویدادهای نوبت دریافت نشد.") });
      });
    return () => controller.abort();
  }, [selectedId, eventRetry, refresh, securityAPI]);

  return (
    <>
      {history.status === "loading" && <ErpSkeleton lines={3} />}
      {history.status === "error" && (
        <ErpInlineState kind="error" title={history.message} action={{ label: "تلاش مجدد", onClick: () => setRetry(value => value + 1) }} />
      )}
      {history.status === "ready" && (
        <>
          {!history.data.data.length && <ErpEmptyState icon={FaClipboardList} title="سابقه‌ای برای نوبت‌ها وجود ندارد" />}
          {history.data.data.map(turn => (
            <ErpCard key={turn.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 break-words">
                  <p className="text-sm sds-text-primary">{turnLabel(turn)}</p>
                  <p className="mt-1 text-xs sds-text-muted">پذیرش {formatTime(turn.admittedAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {turn.projectReturnStatus === "CANCELLED_WITHOUT_DELIVERY" && <ErpBadge tone="neutral">مرجوعی لغو شد</ErpBadge>}
                  {turn.projectReturnStatus === "RECEIVED" && <ErpBadge tone="success">تحویل مرجوعی ثبت شد</ErpBadge>}
                  {turn.projectReturnReleasedAt && turn.driverSource !== "PERSONAL_PICKUP" && (
                    <ErpBadge tone="info">منتقل‌شده از مرجوعی</ErpBadge>
                  )}
                  <ErpBadge tone={turn.status === "VOIDED" ? "danger" : "neutral"}>
                    {canonicalQueueStatusLabel[turn.status] || operationalStatusLabel(turn.status)}
                  </ErpBadge>
                </div>
              </div>
              <ErpButton
                className="mt-2"
                label="رویدادهای نوبت"
                icon={FaClipboardList}
                variant="ghost"
                onClick={() => {
                  setEvents({ status: "loading" });
                  setSelectedId(turn.id);
                }}
              />
            </ErpCard>
          ))}
          <ErpPagination
            currentPage={history.data.pagination.page}
            totalPages={Math.max(1, Math.ceil(history.data.pagination.total / history.data.pagination.pageSize))}
            totalItems={history.data.pagination.total}
            itemsPerPage={history.data.pagination.pageSize}
            itemLabel="نوبت"
            onPageChange={setPage}
          />
        </>
      )}

      <ErpSheet open={Boolean(selectedId)} presentation="modal" title="رویدادهای نوبت"
        onClose={() => setSelectedId(null)}>
        {selectedId && !selected && <ErpSkeleton lines={3} />}
        {selected && (
          <div className="space-y-3">
            <p className="font-semibold sds-text-primary">{turnLabel(selected)}</p>
            {events.status === "loading" && <ErpSkeleton lines={3} />}
            {events.status === "error" && (
              <ErpInlineState kind="error" title={events.message} action={{ label: "تلاش مجدد", onClick: () => {
                setEvents({ status: "loading" });
                setEventRetry(value => value + 1);
              } }} />
            )}
            {events.status === "ready" && (
              events.data.length ? (
                <ol aria-label="ترتیب رویدادها" className="space-y-2">
                  {events.data.map(event => (
                    <li key={event.id}>
                      <ErpCard className="p-3">
                        <p className="font-medium sds-text-primary">
                          {eventLabel[event.eventType] || canonicalQueueStatusLabel[event.toStatus] || operationalStatusLabel(event.toStatus)}
                        </p>
                        <time dateTime={event.recordedAt} className="text-sm sds-text-muted">{formatTime(event.recordedAt)}</time>
                        {event.reason && <p className="mt-1 break-words text-sm sds-text-secondary">{event.reason}</p>}
                      </ErpCard>
                    </li>
                  ))}
                </ol>
              ) : <ErpEmptyState icon={FaClipboardList} title="رویدادی برای این نوبت ثبت نشده است" />
            )}
          </div>
        )}
      </ErpSheet>
    </>
  );
}
