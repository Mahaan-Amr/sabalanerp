'use client';
import { ErpInput, ErpPressable, ErpSelect } from '@/components/erp';
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FaPlus, FaSync } from "react-icons/fa";
import { ErpButton, ErpCard, ErpLoading, ErpPage, ErpSheet } from "@/components/erp";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { HR_HIRING_METRIC_VIEWS } from "@/features/hr-hiring/hrHiringMetricViews";

const field =
  "w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]";

export default function CollateralTemplatesPage() {
  const searchParams = useSearchParams();
  const activeView = searchParams.get("view") === HR_HIRING_METRIC_VIEWS.activeCollateralTemplates;
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [items, setItems] = useState<any[]>([
    {
      type: "PROMISSORY_NOTE",
      label: "سفته",
      required: true,
      defaultAmountRials: "",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      setRows((await hiringAPI.collateralTemplates(activeView ? { view: HR_HIRING_METRIC_VIEWS.activeCollateralTemplates } : undefined)).data.data);
    } catch (e) {
      setError(hiringError(e));
    }
  }, [activeView]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    try {
      setBusy(true);
      setError("");
      await hiringAPI.createCollateralTemplate({ name, items });
      setName("");
      setCreateOpen(false);
      await load();
    } catch (e) {
      setError(hiringError(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (row: any) => {
    try {
      setBusy(true);
      await hiringAPI.setCollateralTemplateActive(row.id, !row.isActive);
      await load();
    } catch (e) {
      setError(hiringError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!rows) return <ErpLoading />;
  return (
    <ErpPage
      eyebrow="امور مالی · استخدام"
      title="قالب‌های چک‌لیست وثیقه"
      description="هر تغییر یک نسخه جدید و غیرقابل بازنویسی می‌سازد."
      backHref="/dashboard/hr/hiring"
      metrics={[
        { label: "قالب ثبت‌شده", value: rows.length.toLocaleString("fa-IR"), tone: "primary" },
        { label: "قالب فعال", value: rows.filter((row) => row.isActive).length.toLocaleString("fa-IR"), tone: "success" },
      ]}
      actions={[
        { label: "قالب جدید", icon: FaPlus, onClick: () => setCreateOpen(true), tone: "success" },
        { label: "به‌روزرسانی", icon: FaSync, onClick: load },
      ]}
    >
      {error && (
        <p className="rounded-xl bg-[var(--sds-danger-surface)] p-3 text-[var(--sds-danger)]">{error}</p>
      )}
      <ErpSheet open={createOpen} onClose={() => setCreateOpen(false)} title="قالب جدید وثیقه">
      <ErpCard className="space-y-3 p-4">
        <ErpInput
          className={field}
          placeholder="نام قالب"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {items.map((item, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-4">
            <ErpSelect
              className={field}
              value={item.type}
              onChange={(e) =>
                setItems(
                  items.map((x, i) =>
                    i === index ? { ...x, type: e.target.value } : x,
                  ),
                )
              }
            >
              <option value="PROMISSORY_NOTE">سفته</option>
              <option value="CHEQUE">چک</option>
              <option value="GUARANTEE">ضمانت‌نامه</option>
              <option value="UNDERTAKING">تعهدنامه</option>
              <option value="OTHER">سایر</option>
            </ErpSelect>
            <ErpInput
              className={field}
              placeholder="عنوان قلم"
              value={item.label}
              onChange={(e) =>
                setItems(
                  items.map((x, i) =>
                    i === index ? { ...x, label: e.target.value } : x,
                  ),
                )
              }
            />
            <ErpInput
              className={field}
              inputMode="numeric"
              placeholder="مبلغ پیش‌فرض ریال"
              value={item.defaultAmountRials}
              onChange={(e) =>
                setItems(
                  items.map((x, i) =>
                    i === index
                      ? {
                          ...x,
                          defaultAmountRials: e.target.value.replace(/\D/g, ""),
                        }
                      : x,
                  ),
                )
              }
            />
            <label className="flex items-center gap-2">
              <ErpInput
                type="checkbox"
                checked={item.required}
                onChange={(e) =>
                  setItems(
                    items.map((x, i) =>
                      i === index ? { ...x, required: e.target.checked } : x,
                    ),
                  )
                }
              />
              الزامی
            </label>
          </div>
        ))}
        <div className="flex gap-2">
          <ErpButton
            label="افزودن قلم"
            icon={FaPlus}
            onClick={() =>
              setItems([
                ...items,
                {
                  type: "OTHER",
                  label: "",
                  required: true,
                  defaultAmountRials: "",
                },
              ])
            }
          />
          <ErpButton
            label="ذخیره نسخه جدید"
            disabled={busy || !name || items.some((item) => !item.label)}
            onClick={save}
            tone="success"
          />
        </div>
      </ErpCard>
      </ErpSheet>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <ErpCard key={row.id} className="p-4">
            <div className="flex justify-between">
              <b>{row.name}</b>
              <span className="flex items-center gap-2">
                نسخه {row.version}
                <ErpPressable type="submit"
                  disabled={busy}
                  onClick={() => toggle(row)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  {row.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}
                </ErpPressable>
              </span>
            </div>
            <ul className="mt-2 text-sm">
              {row.items.map((item: any) => (
                <li key={item.id}>
                  • {item.label}
                  {item.required ? " (الزامی)" : ""}
                </li>
              ))}
            </ul>
          </ErpCard>
        ))}
      </div>
    </ErpPage>
  );
}
