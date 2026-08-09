"use client";
import { ErpInput, ErpSelect, ErpTextarea } from "@/components/erp";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FaBuilding,
  FaBriefcase,
  FaMapMarkerAlt,
  FaPlus,
  FaPowerOff,
  FaSitemap,
  FaSync,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
} from "@/components/erp";
import { hrAPI } from "@/lib/api";
import {
  apiError,
  fieldClass,
  HrField,
  HrMessage,
  unitTypeLabel,
} from "@/features/hr/hrUi";

type Tab = "units" | "jobs" | "positions" | "contexts";
type BlockedDependency = { kind: string; count: number; href: string };
const creationLifecycle = () => ({ status: "ACTIVE", effectiveFrom: new Date().toISOString().slice(0, 10) });
const blankUnit = { code: "", name: "", type: "DEPARTMENT", parentId: "", ...creationLifecycle() };
const blankJob = { code: "", title: "", description: "", responsibilities: "", ...creationLifecycle() };
const blankPosition = {
  code: "",
  title: "",
  jobId: "",
  organizationalUnitId: "",
  workplaceId: "",
  costCenterId: "",
  supervisorPositionId: "",
  capacity: 1,
  ...creationLifecycle(),
};

export default function HrStructurePage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const inactiveOnly = searchParams.get("view") === "inactive";
  const parentId = searchParams.get("parentId") || "";
  const dependencyAt = searchParams.get("dependencyAt") || "";
  const visible = (rows: any[]) =>
    inactiveOnly ? rows.filter((item) => !item.isActive) : rows;
  const [tab, setTab] = useState<Tab>("units");
  const [data, setData] = useState<any>({
    organizationalUnits: [],
    workplaces: [],
    costCenters: [],
    jobs: [],
    positions: [],
  });
  const visibleUnits = visible(data.organizationalUnits).filter((item: any) => !parentId || (dependencyAt ? item.dependencyParentIdsFrom?.includes(parentId) : item.parentId === parentId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [blockedDependencies, setBlockedDependencies] = useState<BlockedDependency[]>([]);
  const [unit, setUnit] = useState(blankUnit);
  const [job, setJob] = useState(blankJob);
  const [position, setPosition] = useState(blankPosition);
  const [workplace, setWorkplace] = useState({
    code: "",
    name: "",
    description: "",
    ...creationLifecycle(),
  });
  const [costCenter, setCostCenter] = useState({
    code: "",
    name: "",
    description: "",
    ...creationLifecycle(),
  });
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData((await hrAPI.getFoundation(dependencyAt ? { dependencyAt } : undefined)).data.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [dependencyAt]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      requestedTab &&
      ["units", "jobs", "positions", "contexts"].includes(requestedTab)
    )
      setTab(requestedTab as Tab);
  }, [requestedTab]);
  const run = async (
    action: () => Promise<any>,
    message: string,
    reset?: () => void,
  ) => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      setBlockedDependencies([]);
      await action();
      reset?.();
      setSuccess(message);
      await load();
    } catch (err) {
      setError(apiError(err));
      const dependencies = (err as any)?.response?.data?.dependencies;
      setBlockedDependencies(Array.isArray(dependencies) ? dependencies : []);
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <ErpLoading />;
  return (
    <ErpPage
      eyebrow="منابع انسانی · پایه سازمان"
      title="ساختار سازمانی و جایگاه‌ها"
      description="شغل ماهیت کار است؛ جایگاه محل آن کار در ساختار و دارای ظرفیت مستقل است."
      metrics={[
        { label: "واحد سازمانی", value: data.organizationalUnits.length.toLocaleString("fa-IR"), tone: "primary" },
        { label: "شغل", value: data.jobs.length.toLocaleString("fa-IR"), tone: "neutral" },
        { label: "جایگاه", value: data.positions.length.toLocaleString("fa-IR"), tone: "neutral" },
      ]}
      actions={[
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, tone: "neutral" },
      ]}
      backHref="/dashboard/hr"
    >
      {error && <HrMessage>{error}</HrMessage>}
      {success && <HrMessage tone="success">{success}</HrMessage>}
      {blockedDependencies.length > 0 && (
        <ErpCard className="space-y-3 p-4">
          <p className="text-sm font-semibold text-[var(--sds-text-primary)]">وابستگی‌های مانع غیرفعال‌سازی</p>
          <div className="flex flex-wrap gap-2">
            {blockedDependencies.map((dependency) => (
              <ErpButton
                key={`${dependency.kind}:${dependency.href}`}
                label={`${dependency.kind} · ${dependency.count.toLocaleString("fa-IR")}`}
                href={dependency.href}
                tone="warning"
                variant="outline"
              />
            ))}
          </div>
        </ErpCard>
      )}
      {inactiveOnly && (
        <ErpCard className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--sds-text-primary)]">
            <span>فیلتر فعال:</span>
            <ErpBadge tone="warning">تعاریف غیرفعال</ErpBadge>
          </div>
          <ErpButton label="حذف فیلتر" href="/dashboard/hr/structure" tone="neutral" variant="ghost" />
        </ErpCard>
      )}
      <ErpSegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "units", label: "واحدهای سازمانی", icon: FaSitemap },
          { value: "jobs", label: "شغل‌ها", icon: FaBriefcase },
          { value: "positions", label: "جایگاه‌ها", icon: FaBuilding },
          {
            value: "contexts",
            label: "محل و مرکز هزینه",
            icon: FaMapMarkerAlt,
          },
        ]}
      />
      {tab === "units" && (
        <ErpSection
          title="واحدهای سازمانی"
          description="یک سلسله‌مراتب نوع‌دار؛ محل کار و مرکز هزینه جدا می‌مانند."
        >
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
            <div className="space-y-3">
              {visibleUnits.map((item: any) => (
                <ItemCard
                  key={item.id}
                  title={item.name}
                  meta={`${item.code} · ${unitTypeLabel[item.type] || item.type}${item.parentId ? ` · زیرمجموعه ${data.organizationalUnits.find((p: any) => p.id === item.parentId)?.name || "—"}` : ""}`}
                  active={item.isActive}
                  onToggle={() =>
                    run(
                      () =>
                        hrAPI.changeFoundationLifecycle("organizational-unit", item.id, {
                          status: item.isActive ? "INACTIVE" : "ACTIVE",
                          effectiveFrom: new Date().toISOString().slice(0, 10),
                          reason: item.isActive ? "غیرفعال‌سازی از مدیریت ساختار" : "فعال‌سازی از مدیریت ساختار",
                          expectedUpdatedAt: item.updatedAt,
                          idempotencyKey: crypto.randomUUID(),
                        }),
                      "وضعیت واحد به‌روزرسانی شد.",
                    )
                  }
                />
              ))}
              {!visibleUnits.length && (
                <ErpEmptyState icon={FaSitemap} title="واحدی تعریف نشده است" />
              )}
            </div>
            <ErpCard className="p-4">
              <FormTitle>تعریف واحد</FormTitle>
              <div className="space-y-3">
                <HrField label="کد" required>
                  <ErpInput
                    className={fieldClass}
                    value={unit.code}
                    onChange={(e) => setUnit({ ...unit, code: e.target.value })}
                  />
                </HrField>
                <HrField label="نام فارسی" required>
                  <ErpInput
                    className={fieldClass}
                    value={unit.name}
                    onChange={(e) => setUnit({ ...unit, name: e.target.value })}
                  />
                </HrField>
                <HrField label="نوع" required>
                  <ErpSelect
                    className={fieldClass}
                    value={unit.type}
                    onChange={(e) => setUnit({ ...unit, type: e.target.value })}
                  >
                    {Object.entries(unitTypeLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </ErpSelect>
                </HrField>
                <HrField label="واحد والد">
                  <ErpSelect
                    className={fieldClass}
                    value={unit.parentId}
                    onChange={(e) =>
                      setUnit({ ...unit, parentId: e.target.value })
                    }
                  >
                    <option value="">بدون والد</option>
                    {data.organizationalUnits
                      .filter((x: any) => x.isActive)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </ErpSelect>
                </HrField>
                <CreationLifecycleFields form={unit} setForm={setUnit} />
                <ErpButton
                  label="ثبت واحد"
                  icon={FaPlus}
                  disabled={saving || !unit.code.trim() || !unit.name.trim()}
                  onClick={() =>
                    run(
                      () => hrAPI.createOrganizationalUnit(unit),
                      "واحد سازمانی ثبت شد.",
                      () => setUnit(blankUnit),
                    )
                  }
                />
              </div>
            </ErpCard>
          </div>
        </ErpSection>
      )}
      {tab === "jobs" && (
        <ErpSection
          title="شغل‌ها"
          description="تعریف قابل استفاده مجدد از ماهیت و مسئولیت‌های کار."
        >
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
            <div className="space-y-3">
              {visible(data.jobs).map((item: any) => (
                <ItemCard
                  key={item.id}
                  title={item.title}
                  meta={`${item.code}${item.description ? ` · ${item.description}` : ""}`}
                  active={item.isActive}
                  onToggle={() =>
                    run(
                      () =>
                        hrAPI.changeFoundationLifecycle("job", item.id, {
                          status: item.isActive ? "INACTIVE" : "ACTIVE",
                          effectiveFrom: new Date().toISOString().slice(0, 10),
                          reason: item.isActive ? "غیرفعال‌سازی از مدیریت ساختار" : "فعال‌سازی از مدیریت ساختار",
                          expectedUpdatedAt: item.updatedAt,
                          idempotencyKey: crypto.randomUUID(),
                        }),
                      "وضعیت شغل به‌روزرسانی شد.",
                    )
                  }
                />
              ))}
              {!visible(data.jobs).length && (
                <ErpEmptyState icon={FaBriefcase} title="شغلی تعریف نشده است" />
              )}
            </div>
            <ErpCard className="p-4">
              <FormTitle>تعریف شغل</FormTitle>
              <div className="space-y-3">
                <HrField label="کد" required>
                  <ErpInput
                    className={fieldClass}
                    value={job.code}
                    onChange={(e) => setJob({ ...job, code: e.target.value })}
                  />
                </HrField>
                <HrField label="عنوان" required>
                  <ErpInput
                    className={fieldClass}
                    value={job.title}
                    onChange={(e) => setJob({ ...job, title: e.target.value })}
                  />
                </HrField>
                <HrField label="شرح">
                  <ErpTextarea
                    className={fieldClass}
                    value={job.description}
                    onChange={(e) =>
                      setJob({ ...job, description: e.target.value })
                    }
                  />
                </HrField>
                <HrField label="مسئولیت‌ها">
                  <ErpTextarea
                    className={fieldClass}
                    value={job.responsibilities}
                    onChange={(e) =>
                      setJob({ ...job, responsibilities: e.target.value })
                    }
                  />
                </HrField>
                <CreationLifecycleFields form={job} setForm={setJob} />
                <ErpButton
                  label="ثبت شغل"
                  icon={FaPlus}
                  disabled={saving || !job.code.trim() || !job.title.trim()}
                  onClick={() =>
                    run(
                      () => hrAPI.createJob(job),
                      "شغل ثبت شد.",
                      () => setJob(blankJob),
                    )
                  }
                />
              </div>
            </ErpCard>
          </div>
        </ErpSection>
      )}
      {tab === "positions" && (
        <ErpSection
          title="جایگاه‌های سازمانی"
          description="ظرفیت فعال و متعهد، سرپرست ساختاری و زمینه پیش‌فرض هر جایگاه."
        >
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.65fr)]">
            <div className="space-y-3">
              {visible(data.positions).map((item: any) => (
                <ErpCard key={item.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{item.title}</p>
                      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                        {item.code} · {item.job.title} ·{" "}
                        {item.organizationalUnit.name}
                      </p>
                      <p className="mt-2 text-xs text-[var(--sds-text-secondary)]">
                        سرپرست ساختاری:{" "}
                        {item.supervisorPosition?.title || "ندارد"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ErpBadge tone={item.vacancy ? "warning" : "success"}>
                        {item.occupancy.active.toLocaleString("fa-IR")} فعال ·{" "}
                        {item.occupancy.committed.toLocaleString("fa-IR")} متعهد
                        · {item.vacancy.toLocaleString("fa-IR")} خالی
                      </ErpBadge>
                      <ErpButton
                        label={item.isActive ? "غیرفعال" : "فعال"}
                        icon={FaPowerOff}
                        tone={item.isActive ? "danger" : "success"}
                        variant="ghost"
                        onClick={() =>
                          run(
                            () =>
                              hrAPI.changeFoundationLifecycle("position", item.id, {
                                status: item.isActive ? "INACTIVE" : "ACTIVE",
                                effectiveFrom: new Date().toISOString().slice(0, 10),
                                reason: item.isActive ? "غیرفعال‌سازی از مدیریت ساختار" : "فعال‌سازی از مدیریت ساختار",
                                expectedUpdatedAt: item.updatedAt,
                                idempotencyKey: crypto.randomUUID(),
                              }),
                            "وضعیت جایگاه به‌روزرسانی شد.",
                          )
                        }
                      />
                    </div>
                  </div>
                </ErpCard>
              ))}
              {!visible(data.positions).length && (
                <ErpEmptyState
                  icon={FaBuilding}
                  title="جایگاهی تعریف نشده است"
                  description="ابتدا شغل و واحد سازمانی را بسازید."
                />
              )}
            </div>
            <ErpCard className="p-4">
              <FormTitle>تعریف جایگاه</FormTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <HrField label="کد" required>
                  <ErpInput
                    className={fieldClass}
                    value={position.code}
                    onChange={(e) =>
                      setPosition({ ...position, code: e.target.value })
                    }
                  />
                </HrField>
                <HrField label="عنوان" required>
                  <ErpInput
                    className={fieldClass}
                    value={position.title}
                    onChange={(e) =>
                      setPosition({ ...position, title: e.target.value })
                    }
                  />
                </HrField>
                <HrField label="شغل" required>
                  <ErpSelect
                    className={fieldClass}
                    value={position.jobId}
                    onChange={(e) =>
                      setPosition({ ...position, jobId: e.target.value })
                    }
                  >
                    <option value="">انتخاب شغل</option>
                    {data.jobs
                      .filter((x: any) => x.isActive)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </ErpSelect>
                </HrField>
                <HrField label="واحد سازمانی" required>
                  <ErpSelect
                    className={fieldClass}
                    value={position.organizationalUnitId}
                    onChange={(e) =>
                      setPosition({
                        ...position,
                        organizationalUnitId: e.target.value,
                      })
                    }
                  >
                    <option value="">انتخاب واحد</option>
                    {data.organizationalUnits
                      .filter((x: any) => x.isActive)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </ErpSelect>
                </HrField>
                <HrField label="ظرفیت" required>
                  <ErpInput
                    type="number"
                    min={1}
                    className={fieldClass}
                    value={position.capacity}
                    onChange={(e) =>
                      setPosition({
                        ...position,
                        capacity: Number(e.target.value),
                      })
                    }
                  />
                </HrField>
                <HrField label="جایگاه سرپرست">
                  <ErpSelect
                    className={fieldClass}
                    value={position.supervisorPositionId}
                    onChange={(e) =>
                      setPosition({
                        ...position,
                        supervisorPositionId: e.target.value,
                      })
                    }
                  >
                    <option value="">بدون سرپرست</option>
                    {data.positions
                      .filter((x: any) => x.isActive)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </ErpSelect>
                </HrField>
                <HrField label="محل کار">
                  <ErpSelect
                    className={fieldClass}
                    value={position.workplaceId}
                    onChange={(e) =>
                      setPosition({ ...position, workplaceId: e.target.value })
                    }
                  >
                    <option value="">بدون پیش‌فرض</option>
                    {data.workplaces
                      .filter((x: any) => x.isActive)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </ErpSelect>
                </HrField>
                <HrField label="مرکز هزینه">
                  <ErpSelect
                    className={fieldClass}
                    value={position.costCenterId}
                    onChange={(e) =>
                      setPosition({ ...position, costCenterId: e.target.value })
                    }
                  >
                    <option value="">بدون پیش‌فرض</option>
                    {data.costCenters
                      .filter((x: any) => x.isActive)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </ErpSelect>
                </HrField>
                <CreationLifecycleFields form={position} setForm={setPosition} />
              </div>
              <div className="mt-4">
                <ErpButton
                  label="ثبت جایگاه"
                  icon={FaPlus}
                  disabled={
                    saving ||
                    !position.code.trim() ||
                    !position.title.trim() ||
                    !position.jobId ||
                    !position.organizationalUnitId
                  }
                  onClick={() =>
                    run(
                      () => hrAPI.createPosition(position),
                      "جایگاه ثبت شد.",
                      () => setPosition(blankPosition),
                    )
                  }
                />
              </div>
            </ErpCard>
          </div>
        </ErpSection>
      )}
      {tab === "contexts" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <CatalogSection
            title="محل‌های کار"
            rows={visible(data.workplaces)}
            form={workplace}
            setForm={setWorkplace}
            saving={saving}
            onCreate={() =>
              run(
                () => hrAPI.createWorkplace(workplace),
                "محل کار ثبت شد.",
                () => setWorkplace({ code: "", name: "", description: "", ...creationLifecycle() }),
              )
            }
            onToggle={(item: any) =>
              run(
                () =>
                  hrAPI.changeFoundationLifecycle("workplace", item.id, {
                    status: item.isActive ? "INACTIVE" : "ACTIVE",
                    effectiveFrom: new Date().toISOString().slice(0, 10),
                    reason: item.isActive ? "غیرفعال‌سازی از مدیریت ساختار" : "فعال‌سازی از مدیریت ساختار",
                    expectedUpdatedAt: item.updatedAt,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                "وضعیت محل کار به‌روزرسانی شد.",
              )
            }
          />
          <CatalogSection
            title="مراکز هزینه"
            rows={visible(data.costCenters)}
            form={costCenter}
            setForm={setCostCenter}
            saving={saving}
            onCreate={() =>
              run(
                () => hrAPI.createCostCenter(costCenter),
                "مرکز هزینه ثبت شد.",
                () => setCostCenter({ code: "", name: "", description: "", ...creationLifecycle() }),
              )
            }
            onToggle={(item: any) =>
              run(
                () =>
                  hrAPI.changeFoundationLifecycle("cost-center", item.id, {
                    status: item.isActive ? "INACTIVE" : "ACTIVE",
                    effectiveFrom: new Date().toISOString().slice(0, 10),
                    reason: item.isActive ? "غیرفعال‌سازی از مدیریت ساختار" : "فعال‌سازی از مدیریت ساختار",
                    expectedUpdatedAt: item.updatedAt,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                "وضعیت مرکز هزینه به‌روزرسانی شد.",
              )
            }
          />
        </div>
      )}
    </ErpPage>
  );
}

function FormTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
      {children}
    </h3>
  );
}
function CreationLifecycleFields({ form, setForm }: { form: any; setForm: (value: any) => void }) {
  return (
    <>
      <HrField label="وضعیت آغاز" required>
        <ErpSelect value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
          <option value="ACTIVE">فعال</option>
          <option value="INACTIVE">غیرفعال</option>
        </ErpSelect>
      </HrField>
      <HrField label={form.status === "ACTIVE" ? "تاریخ فعال‌سازی" : "تاریخ ثبت وضعیت"} required>
        <ErpInput type="date" min={new Date().toISOString().slice(0, 10)} value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} />
      </HrField>
    </>
  );
}
function ItemCard({
  title,
  meta,
  active,
  onToggle,
}: {
  title: string;
  meta: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <ErpCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{title}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
            {meta}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ErpBadge tone={active ? "success" : "neutral"}>
            {active ? "فعال" : "غیرفعال"}
          </ErpBadge>
          <ErpButton
            label={active ? "غیرفعال" : "فعال"}
            icon={FaPowerOff}
            tone={active ? "danger" : "success"}
            variant="ghost"
            onClick={onToggle}
          />
        </div>
      </div>
    </ErpCard>
  );
}
function CatalogSection({
  title,
  rows,
  form,
  setForm,
  saving,
  onCreate,
  onToggle,
}: any) {
  return (
    <ErpSection title={title}>
      <div className="space-y-3">
        <ErpCard className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HrField label="کد" required>
              <ErpInput
                className={fieldClass}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </HrField>
            <HrField label="نام" required>
              <ErpInput
                className={fieldClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </HrField>
            <div className="sm:col-span-2">
              <HrField label="توضیح">
                <ErpInput
                  className={fieldClass}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </HrField>
            </div>
            <CreationLifecycleFields form={form} setForm={setForm} />
          </div>
          <div className="mt-3">
            <ErpButton
              label="ثبت"
              icon={FaPlus}
              disabled={saving || !form.code.trim() || !form.name.trim()}
              onClick={onCreate}
            />
          </div>
        </ErpCard>
        {rows.map((item: any) => (
          <ItemCard
            key={item.id}
            title={item.name}
            meta={`${item.code}${item.description ? ` · ${item.description}` : ""}`}
            active={item.isActive}
            onToggle={() => onToggle(item)}
          />
        ))}
      </div>
    </ErpSection>
  );
}
