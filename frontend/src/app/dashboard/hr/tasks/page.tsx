"use client";
import { ErpInlineState } from "@/components/erp";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FaCheck,
  FaClipboardList,
  FaExternalLinkAlt,
  FaPlay,
  FaSave,
  FaSync,
} from "react-icons/fa";
import PersianCalendarComponent from "@/components/PersianCalendar";
import { askSecurityAction } from "@/components/SecurityNoticeHost";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpField,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { dateFa, toIsoDate } from "@/features/hr/hrUi";
import { hiringAPI, hiringError } from "@/lib/hiringApi";

const statusLabels: Record<string, string> = {
  PENDING: "در انتظار",
  IN_PROGRESS: "در حال انجام",
  COMPLETE: "انجام‌شده",
  WAIVED: "صرف‌نظرشده",
};
const userName = (user: any) =>
  user
    ? `${user.firstName} ${user.lastName}`.trim() || user.username
    : "بدون مسئول";

export default function HrTasksPage() {
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope") || "mine";
  const [items, setItems] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    dueDate: "",
    assignedToUserId: "",
    destinationHref: "/dashboard/hr/hiring",
    assignmentReason: "",
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const summary = await hiringAPI.workItemSummary();
      const manager = Boolean(summary.data.data.canManage);
      setCanManage(manager);
      const requests: Promise<any>[] = [
        hiringAPI.workItems({
          scope: manager ? scope : "mine",
          status: "OPEN",
        }),
      ];
      if (manager) requests.push(hiringAPI.workItemUsers());
      const [work, userRows] = await Promise.all(requests);
      setItems(work.data.data);
      setCurrentUserId(work.data.meta.currentUserId);
      if (manager) {
        setUsers(userRows.data.data);
      }
    } catch (cause) {
      setError(hiringError(cause));
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setBusy(true);
      setError("");
      setMessage("");
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (cause) {
      setError(hiringError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <ErpPage
      title="وظایف منابع انسانی"
      eyebrow="منابع انسانی"
      backHref="/dashboard/hr"
      actions={[
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, tone: "neutral" },
      ]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      {message && <ErpInlineState kind="success" title={message} />}
      {loading && <ErpLoading />}

      <div className="flex flex-wrap gap-2">
        <ErpButton
          label="وظایف من"
          href="/dashboard/hr/tasks?scope=mine"
          tone={scope === "mine" ? "primary" : "neutral"}
          variant={scope === "mine" ? "soft" : "ghost"}
        />
        {canManage && (
          <ErpButton
            label="بدون مسئول"
            href="/dashboard/hr/tasks?scope=unassigned"
            tone={scope === "unassigned" ? "primary" : "neutral"}
            variant={scope === "unassigned" ? "soft" : "ghost"}
          />
        )}
        {canManage && (
          <ErpButton
            label="همه وظایف باز"
            href="/dashboard/hr/tasks?scope=all"
            tone={scope === "all" ? "primary" : "neutral"}
            variant={scope === "all" ? "soft" : "ghost"}
          />
        )}
      </div>

      <ErpSection
        title={
          scope === "mine"
            ? "وظایف من"
            : scope === "unassigned"
              ? "صف بدون مسئول"
              : "همه وظایف باز"
        }
      >
        <div className="space-y-3">
          {items.map((item) => (
              <HrWorkItemRow
              key={item.id}
              item={item}
              users={users}
              canManage={canManage}
              currentUserId={currentUserId}
              busy={busy}
              run={run}
            />
          ))}
          {!items.length && (
            <ErpEmptyState
              icon={FaClipboardList}
              title="وظیفه بازی وجود ندارد"
            />
          )}
        </div>
      </ErpSection>

      {canManage && (
        <ErpSection title="ایجاد وظیفه">
          <ErpCard className="grid gap-3 p-4 md:grid-cols-2">
            <ErpField label="عنوان" required>
              <ErpInput
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </ErpField>
            <ErpField label="مسئول">
              <ErpSelect
                value={form.assignedToUserId}
                onChange={(event) =>
                  setForm({ ...form, assignedToUserId: event.target.value })
                }
              >
                <option value="">بدون مسئول</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userName(user)}
                  </option>
                ))}
              </ErpSelect>
            </ErpField>
            <ErpField label="مهلت" required>
              <PersianCalendarComponent
                value={form.dueDate}
                onChange={(dueDate) => setForm({ ...form, dueDate })}
              />
            </ErpField>
            <ErpField label="مقصد" required>
              <ErpSelect
                value={form.destinationHref}
                onChange={(event) =>
                  setForm({ ...form, destinationHref: event.target.value })
                }
              >
                <option value="/dashboard/hr/hiring">جذب و پرونده‌ها</option>
                <option value="/dashboard/hr/personnel">پرسنل</option>
                <option value="/dashboard/hr/structure">ساختار سازمانی</option>
                <option value="/dashboard/hr/migration">مهاجرت و تطبیق</option>
              </ErpSelect>
            </ErpField>
            <div className="md:col-span-2">
              <ErpField label="شرح">
                <ErpTextarea
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </ErpField>
            </div>
            <div className="md:col-span-2">
              <ErpField label="دلیل تخصیص">
                <ErpInput
                  value={form.assignmentReason}
                  onChange={(event) =>
                    setForm({ ...form, assignmentReason: event.target.value })
                  }
                />
              </ErpField>
            </div>
            <div className="md:col-span-2">
              <ErpButton
                label="ثبت وظیفه"
                icon={FaSave}
                disabled={busy || form.title.trim().length < 3 || !form.dueDate}
                onClick={async () => {
                  if (
                    await run(
                      () =>
                        hiringAPI.createWorkItem({
                          ...form,
                          dueDate: toIsoDate(form.dueDate),
                        }),
                      "وظیفه ثبت شد.",
                    )
                  )
                    setForm({
                      title: "",
                      description: "",
                      dueDate: "",
                      assignedToUserId: "",
                      destinationHref: "/dashboard/hr/hiring",
                      assignmentReason: "",
                    });
                }}
              />
            </div>
          </ErpCard>
        </ErpSection>
      )}

    </ErpPage>
  );
}

function HrWorkItemRow({ item, users, canManage, currentUserId, busy, run }: any) {
  const [assignee, setAssignee] = useState(item.assignedToUserId || "");
  const [reason, setReason] = useState("");
  const tone =
    item.status === "IN_PROGRESS"
      ? "info"
      : item.dueDate && new Date(item.dueDate) < new Date()
        ? "danger"
        : "warning";
  return (
    <ErpCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-[var(--sds-text-primary)]">
              {item.title}
            </h3>
            <ErpBadge tone={tone}>
              {statusLabels[item.status] || item.status}
            </ErpBadge>
          </div>
          <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
            مسئول: {userName(item.assignedTo)} · مهلت: {dateFa(item.dueDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ErpButton
            label="بازکردن"
            icon={FaExternalLinkAlt}
            href={item.destinationHref}
            tone="neutral"
            variant="outline"
          />
          {item.status === "PENDING" && item.assignedToUserId === currentUserId && (
            <ErpButton
              label="شروع"
              icon={FaPlay}
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    hiringAPI.updateWorkItem(item.id, {
                      status: "IN_PROGRESS",
                    }),
                  "وظیفه شروع شد.",
                )
              }
            />
          )}
          {item.sourceType !== "HIRING_ACTION" && item.assignedToUserId === currentUserId && (
            <ErpButton
              label="انجام شد"
              icon={FaCheck}
              tone="success"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    hiringAPI.updateWorkItem(item.id, { status: "COMPLETE" }),
                  "وظیفه انجام شد.",
                )
              }
            />
          )}
        </div>
      </div>
      {canManage && item.sourceType !== "HIRING_ACTION" && (
        <div className="mt-4 grid gap-2 border-t border-[var(--sds-border-subtle)] pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <ErpSelect
            aria-label="مسئول جدید"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">بدون مسئول</option>
            {users.map((user: any) => (
              <option key={user.id} value={user.id}>
                {userName(user)}
              </option>
            ))}
          </ErpSelect>
          <ErpInput
            aria-label="دلیل تغییر"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <ErpButton
            label="تخصیص"
            disabled={
              busy ||
              assignee === (item.assignedToUserId || "") ||
              reason.trim().length < 3
            }
            onClick={() =>
              run(
                () =>
                  hiringAPI.updateWorkItem(item.id, {
                    assignedToUserId: assignee || null,
                    reason,
                  }),
                "مسئول وظیفه تغییر کرد.",
              )
            }
          />
          <ErpButton
            label="صرف‌نظر"
            tone="danger"
            variant="outline"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              const confirmed = await askSecurityAction({
                title: "صرف‌نظر از وظیفه؟",
                description: `این اقدام با دلیل «${reason.trim()}» در سابقه ممیزی ثبت می‌شود.`,
              });
              if (!confirmed) return;
              await run(
                () => hiringAPI.updateWorkItem(item.id, { status: "WAIVED", reason }),
                "وظیفه با ثبت دلیل کنار گذاشته شد.",
              );
            }}
          />
        </div>
      )}
    </ErpCard>
  );
}
