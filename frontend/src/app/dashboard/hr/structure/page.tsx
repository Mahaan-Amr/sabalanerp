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
  FaEdit,
  FaTrash,
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
  ErpSheet,
} from "@/components/erp";
import { hrAPI } from "@/lib/api";
import {
  apiError,
  fieldClass,
  fromIsoDate,
  HrField,
  HrMessage,
  toIsoDate,
  unitTypeLabel,
} from "@/features/hr/hrUi";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";

type Tab = "units" | "jobs" | "positions" | "contexts";
type BlockedDependency = { kind: string; count: number; href: string };
type FoundationEntityType = "organizational-unit" | "job" | "position" | "workplace" | "cost-center";
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
  const [editTarget, setEditTarget] = useState<{ entityType: FoundationEntityType; item: any; form: any } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ entityType: FoundationEntityType; item: any } | null>(null);
  const [deleteForm, setDeleteForm] = useState({ confirmationCode: "", reason: "", adminPassword: "" });
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
  const openEdit = (entityType: FoundationEntityType, item: any) => setEditTarget({
    entityType,
    item,
    form: {
      name: item.name || item.title || "",
      description: item.description || "",
      responsibilities: item.responsibilities || "",
      type: item.type || "DEPARTMENT",
      parentId: item.parentId || "",
      jobId: item.jobId || "",
      organizationalUnitId: item.organizationalUnitId || "",
      workplaceId: item.workplaceId || "",
      costCenterId: item.costCenterId || "",
      supervisorPositionId: item.supervisorPositionId || "",
      capacity: item.capacity ?? 1,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      reason: "اصلاح از مدیریت ساختار",
      expectedUpdatedAt: item.updatedAt,
    },
  });
  const saveEdit = () => {
    if (!editTarget) return Promise.resolve();
    const { entityType, item, form } = editTarget;
    const action = entityType === "organizational-unit"
      ? () => hrAPI.updateOrganizationalUnit(item.id, { ...form, name: form.name })
      : entityType === "job"
        ? () => hrAPI.updateJob(item.id, { ...form, title: form.name })
        : entityType === "position"
          ? () => {
              const { capacity: _capacity, ...structuralForm } = form;
              return hrAPI.updatePosition(item.id, { ...structuralForm, title: form.name });
            }
          : entityType === "workplace"
            ? () => hrAPI.updateWorkplace(item.id, { ...form, name: form.name })
            : () => hrAPI.updateCostCenter(item.id, { ...form, name: form.name });
    return run(action, "اطلاعات سازمانی به‌روزرسانی شد.", () => setEditTarget(null));
  };
  const saveEditCapacity = () => {
    if (!editTarget || editTarget.entityType !== "position") return Promise.resolve();
    const { item, form } = editTarget;
    return run(
      () => hrAPI.changePositionCapacity(item.id, {
        newCapacity: Number(form.capacity),
        effectiveAt: form.effectiveFrom,
        reason: form.reason,
        expectedUpdatedAt: item.updatedAt,
        idempotencyKey: crypto.randomUUID(),
      }),
      "تغییر ظرفیت جایگاه ثبت شد.",
      () => setEditTarget(null),
    );
  };
  const permanentlyDelete = () => {
    if (!deleteTarget) return Promise.resolve();
    return run(
      () => hrAPI.permanentlyDeleteFoundation(deleteTarget.entityType, deleteTarget.item.id, {
        ...deleteForm,
        entityId: deleteTarget.item.id,
        expectedUpdatedAt: deleteTarget.item.updatedAt,
      }),
      "رکورد بدون سابقه برای همیشه حذف شد.",
      () => {
        setDeleteTarget(null);
        setDeleteForm({ confirmationCode: "", reason: "", adminPassword: "" });
      },
    );
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
                  onEdit={() => openEdit("organizational-unit", item)}
                  onDelete={() => setDeleteTarget({ entityType: "organizational-unit", item })}
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
                  onEdit={() => openEdit("job", item)}
                  onDelete={() => setDeleteTarget({ entityType: "job", item })}
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
                        label="ویرایش"
                        icon={FaEdit}
                        variant="ghost"
                        onClick={() => openEdit("position", item)}
                      />
                      <ErpButton
                        label="حذف دائمی"
                        icon={FaTrash}
                        tone="danger"
                        variant="ghost"
                        onClick={() => setDeleteTarget({ entityType: "position", item })}
                      />
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
            entityType="workplace"
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
            onEdit={(item: any) => openEdit("workplace", item)}
            onDelete={(item: any) => setDeleteTarget({ entityType: "workplace", item })}
          />
          <CatalogSection
            title="مراکز هزینه"
            entityType="cost-center"
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
            onEdit={(item: any) => openEdit("cost-center", item)}
            onDelete={(item: any) => setDeleteTarget({ entityType: "cost-center", item })}
          />
        </div>
      )}
      <ErpSheet
        open={Boolean(editTarget)}
        onClose={() => { if (!saving) setEditTarget(null); }}
        title="ویرایش تعریف سازمانی"
        presentation="modal"
        dismissible={!saving}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={saving} onClick={() => setEditTarget(null)} />
            <ErpButton label="ذخیره تغییرات" icon={FaEdit} disabled={saving || !editTarget?.form.name.trim()} onClick={saveEdit} />
          </div>
        }
      >
        {editTarget && (
          <div className="space-y-3">
            <HrField label={editTarget.entityType === "job" || editTarget.entityType === "position" ? "عنوان" : "نام"} required>
              <ErpInput value={editTarget.form.name} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, name: event.target.value } })} />
            </HrField>
            {editTarget.entityType === "organizational-unit" && (
              <>
                <HrField label="نوع" required>
                  <ErpSelect value={editTarget.form.type} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, type: event.target.value } })}>
                    {Object.entries(unitTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </ErpSelect>
                </HrField>
                <HrField label="واحد والد">
                  <ErpSelect value={editTarget.form.parentId} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, parentId: event.target.value } })}>
                    <option value="">بدون والد</option>
                    {data.organizationalUnits.filter((item: any) => item.id !== editTarget.item.id && item.isActive).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </ErpSelect>
                </HrField>
              </>
            )}
            {editTarget.entityType === "position" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <HrField label="شغل" required><ErpSelect value={editTarget.form.jobId} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, jobId: event.target.value } })}>{data.jobs.filter((item: any) => item.isActive).map((item: any) => <option key={item.id} value={item.id}>{item.title}</option>)}</ErpSelect></HrField>
                <HrField label="واحد سازمانی" required><ErpSelect value={editTarget.form.organizationalUnitId} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, organizationalUnitId: event.target.value } })}>{data.organizationalUnits.filter((item: any) => item.isActive).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</ErpSelect></HrField>
                <HrField label="جایگاه سرپرست"><ErpSelect value={editTarget.form.supervisorPositionId} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, supervisorPositionId: event.target.value } })}><option value="">بدون سرپرست</option>{data.positions.filter((item: any) => item.id !== editTarget.item.id && item.isActive).map((item: any) => <option key={item.id} value={item.id}>{item.title}</option>)}</ErpSelect></HrField>
                <HrField label="محل کار"><ErpSelect value={editTarget.form.workplaceId} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, workplaceId: event.target.value } })}><option value="">بدون پیش‌فرض</option>{data.workplaces.filter((item: any) => item.isActive).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</ErpSelect></HrField>
                <HrField label="مرکز هزینه"><ErpSelect value={editTarget.form.costCenterId} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, costCenterId: event.target.value } })}><option value="">بدون پیش‌فرض</option>{data.costCenters.filter((item: any) => item.isActive).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</ErpSelect></HrField>
                <HrField label="ظرفیت جایگاه" required>
                  <div className="flex gap-2">
                    <ErpInput type="number" min={1} step={1} value={editTarget.form.capacity} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, capacity: Number(event.target.value) } })} />
                    <ErpButton
                      label="ثبت ظرفیت"
                      variant="outline"
                      disabled={saving || !Number.isInteger(Number(editTarget.form.capacity)) || Number(editTarget.form.capacity) < 1 || Number(editTarget.form.capacity) === Number(editTarget.item.capacity) || !editTarget.form.reason.trim()}
                      onClick={saveEditCapacity}
                    />
                  </div>
                </HrField>
              </div>
            )}
            {editTarget.entityType !== "position" && (
              <HrField label="توضیح"><ErpTextarea value={editTarget.form.description} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, description: event.target.value } })} /></HrField>
            )}
            {editTarget.entityType === "job" && (
              <HrField label="مسئولیت‌ها"><ErpTextarea value={editTarget.form.responsibilities} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, responsibilities: event.target.value } })} /></HrField>
            )}
            <HrField label="تاریخ اثر" required><HrPersianCalendar value={fromIsoDate(editTarget.form.effectiveFrom)} onChange={(value) => setEditTarget({ ...editTarget, form: { ...editTarget.form, effectiveFrom: toIsoDate(value) } })} disablePastDates /></HrField>
            <HrField label="دلیل تغییر" required><ErpTextarea value={editTarget.form.reason} onChange={(event) => setEditTarget({ ...editTarget, form: { ...editTarget.form, reason: event.target.value } })} /></HrField>
          </div>
        )}
      </ErpSheet>
      <ErpSheet
        open={Boolean(deleteTarget)}
        onClose={() => { if (!saving) setDeleteTarget(null); }}
        title="حذف دائمی تعریف بدون سابقه"
        presentation="modal"
        dismissible={!saving}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={saving} onClick={() => setDeleteTarget(null)} />
            <ErpButton label="حذف دائمی" icon={FaTrash} tone="danger" disabled={saving || !deleteForm.reason.trim() || deleteForm.confirmationCode !== deleteTarget?.item.code || !deleteForm.adminPassword} onClick={permanentlyDelete} />
          </div>
        }
      >
        {deleteTarget && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--sds-text-secondary)]">حذف فقط وقتی انجام می‌شود که هیچ ارجاع جاری یا تاریخی وجود نداشته باشد. کد دقیق رکورد را وارد کنید: <b>{deleteTarget.item.code}</b></p>
            <HrField label="کد تأیید" required><ErpInput value={deleteForm.confirmationCode} onChange={(event) => setDeleteForm({ ...deleteForm, confirmationCode: event.target.value })} /></HrField>
            <HrField label="دلیل حذف" required><ErpTextarea value={deleteForm.reason} onChange={(event) => setDeleteForm({ ...deleteForm, reason: event.target.value })} /></HrField>
            <HrField label="رمز عبور مدیر سامانه" required><ErpInput type="password" value={deleteForm.adminPassword} onChange={(event) => setDeleteForm({ ...deleteForm, adminPassword: event.target.value })} /></HrField>
          </div>
        )}
      </ErpSheet>
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
        <HrPersianCalendar value={fromIsoDate(form.effectiveFrom)} onChange={(value) => setForm({ ...form, effectiveFrom: toIsoDate(value) })} disablePastDates />
      </HrField>
    </>
  );
}
function ItemCard({
  title,
  meta,
  active,
  onToggle,
  onEdit,
  onDelete,
}: {
  title: string;
  meta: string;
  active: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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
          {onEdit && <ErpButton label="ویرایش" icon={FaEdit} variant="ghost" onClick={onEdit} />}
          {onDelete && <ErpButton label="حذف دائمی" icon={FaTrash} tone="danger" variant="ghost" onClick={onDelete} />}
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
  entityType: _entityType,
  rows,
  form,
  setForm,
  saving,
  onCreate,
  onToggle,
  onEdit,
  onDelete,
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
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
          />
        ))}
      </div>
    </ErpSection>
  );
}
