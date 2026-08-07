"use client";
import {
  ErpInput,
  ErpPressable,
  ErpSelect,
  ErpTextarea,
} from "@/components/erp";
import { useCallback, useEffect, useState } from "react";
import moment from "moment-jalaali";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FaArchive,
  FaBriefcase,
  FaChevronDown,
  FaChevronUp,
  FaPause,
  FaPlay,
  FaPlus,
  FaSearch,
  FaStop,
  FaSync,
  FaTrash,
  FaUndo,
  FaUserPlus,
  FaUsers,
} from "react-icons/fa";
import HrPersianCalendar from "@/features/hr/HrPersianCalendar";
import WorkScheduleEditor, {
  workScheduleFromApi,
  workSchedulePayload,
  type WorkScheduleValue,
} from "@/components/WorkScheduleEditor";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { hrAPI } from "@/lib/api";
import { hiringAPI } from "@/lib/hiringApi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";
import PermanentDeletionDialog from "@/features/hr/PermanentDeletionDialog";
import RetentionAction from "@/features/hr/RetentionActionSheet";
import {
  apiError,
  assignmentTypeLabel,
  dateFa,
  dateTimeFa,
  employmentStatusLabel,
  fieldClass,
  HrField,
  HrMessage,
  toIsoDate,
} from "@/features/hr/hrUi";

const today = () => moment().format("jYYYY/jMM/jDD");
const blankPerson = () => ({
  firstName: "",
  lastName: "",
  nationalCode: "",
  employeeNumber: "",
  userId: "",
  status: "ACTIVE",
  effectiveFrom: today(),
  positionId: "",
  responsibleSupervisorAssignmentId: "",
  confirmDuplicate: false,
  sourceCategory: "",
  reason: "",
});
const blankAssignment = () => ({
  positionId: "",
  type: "SECONDARY",
  effectiveFrom: today(),
  effectiveTo: "",
  responsibleSupervisorAssignmentId: "",
  scheduleContributing: false,
});

export default function HrPersonnelPage() {
  const searchParams = useSearchParams();
  const relationshipStatus = searchParams.get("relationshipStatus") || "";
  const attention = searchParams.get("attention") || "";
  const [rows, setRows] = useState<any[]>([]);
  const [foundation, setFoundation] = useState<any>({
    positions: [],
    availableUsers: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(blankPerson);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignmentRelationship, setAssignmentRelationship] = useState<
    string | null
  >(null);
  const [assignment, setAssignment] = useState(blankAssignment);
  const [assignmentSupervisors, setAssignmentSupervisors] = useState<any[]>([]);
  const [endDates, setEndDates] = useState<Record<string, string>>({});
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [archiveView, setArchiveView] = useState(false);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, total: 0, totalPages: 1 });
  const [deletionTarget, setDeletionTarget] = useState<any>(null);
  const [retentionTarget, setRetentionTarget] = useState<any>(null);
  const [showExceptionalForm, setShowExceptionalForm] = useState(false);
  const canCreateExceptionalPersonnel = authorities.includes("HR_MANAGER");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [people, base, authorityResponse] = await Promise.all([
        hrAPI.getPersonnel({
          ...(search ? { search } : {}),
          archived: archiveView,
          ...(relationshipStatus ? { relationshipStatus } : {}),
          ...(attention ? { attention } : {}),
          page,
          pageSize: 50,
        }),
        hrAPI.getFoundation(),
        hiringAPI.myAuthorities(),
      ]);
      setRows(people.data.data);
      setMeta(
        people.data.meta || {
          page: 1,
          total: people.data.data.length,
          totalPages: 1,
        },
      );
      setFoundation(base.data.data);
      setAuthorities(authorityResponse.data.data || []);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [search, archiveView, page, relationshipStatus, attention]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchDraft.trim());
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) setExpanded(focus);
  }, []);
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!form.positionId || !form.effectiveFrom) return setSupervisors([]);
      try {
        const response = await hrAPI.getSupervisorCandidates({
          positionId: form.positionId,
          effectiveFrom: toIsoDate(form.effectiveFrom),
        });
        setSupervisors(response.data.data);
      } catch {
        setSupervisors([]);
      }
    };
    void fetchCandidates();
  }, [form.positionId, form.effectiveFrom]);
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!assignment.positionId || !assignment.effectiveFrom)
        return setAssignmentSupervisors([]);
      try {
        const response = await hrAPI.getSupervisorCandidates({
          positionId: assignment.positionId,
          effectiveFrom: toIsoDate(assignment.effectiveFrom),
          effectiveTo: assignment.effectiveTo
            ? toIsoDate(assignment.effectiveTo)
            : undefined,
        });
        setAssignmentSupervisors(response.data.data);
      } catch {
        setAssignmentSupervisors([]);
      }
    };
    void fetchCandidates();
  }, [assignment.positionId, assignment.effectiveFrom, assignment.effectiveTo]);

  const run = async (
    action: () => Promise<any>,
    message: string,
    reset?: () => void,
  ) => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      await action();
      reset?.();
      setSuccess(message);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const changeArchiveState = async (person: any) => {
    setRetentionTarget(person);
  };

  const confirmRetentionAction = async ({
    reason,
    effectiveDate,
  }: {
    reason: string;
    effectiveDate?: string;
  }) => {
    if (!retentionTarget) return;
    if (retentionTarget.archivedAt) {
      await run(
        () => hrAPI.restorePersonnel(retentionTarget.id, reason),
        "پرسنل از بایگانی بازیابی شد.",
        () => setRetentionTarget(null),
      );
      return;
    }
    await run(
      () =>
        hrAPI.archivePersonnel(retentionTarget.id, {
          reason,
          effectiveDate: toIsoDate(effectiveDate || ""),
        }),
      "پرسنل بایگانی و دسترسی‌های مرتبط غیرفعال شد.",
      () => setRetentionTarget(null),
    );
  };

  const permanentlyDelete = async (person: any) => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const preview = (await hrAPI.getPersonnelDeletionPreview(person.id)).data
        .data;
      setDeletionTarget({ person, preview });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const submitSearch = () => {
    const nextSearch = searchDraft.trim();
    setPage(1);
    if (nextSearch === search) void load();
    else setSearch(nextSearch);
  };

  const confirmPermanentDeletion = async (payload: any) => {
    if (!deletionTarget) return;
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      await hrAPI.permanentlyDeletePersonnel(deletionTarget.person.id, payload);
      setDeletionTarget(null);
      setSuccess("پرسنل و همه سوابق مرتبط به‌صورت دائمی حذف شد.");
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !rows.length) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · پرسنل"
      title="پرسنل و روابط استخدامی"
      description="هویت فرد از دسترسی سامانه جداست؛ رابطه استخدامی و تخصیص جایگاه تاریخ خود را حفظ می‌کنند."
      metrics={[
        { label: archiveView ? "پرسنل بایگانی" : "پرسنل فهرست", value: meta.total.toLocaleString("fa-IR"), tone: archiveView ? "warning" : "primary" },
        { label: "جایگاه فعال", value: foundation.positions.filter((item: any) => item.isActive).length.toLocaleString("fa-IR"), tone: "neutral" },
      ]}
      actions={[
        ...(canCreateExceptionalPersonnel
          ? [{
              label: "ثبت استثنایی پرسنل",
              icon: FaUserPlus,
              onClick: () => setShowExceptionalForm(true),
              tone: "success" as const,
            }]
          : []),
        {
          label: archiveView ? "فهرست فعال" : "بایگانی پرسنل",
          icon: archiveView ? FaUndo : FaArchive,
          onClick: () => {
            setPage(1);
            setArchiveView((value) => !value);
          },
          tone: "neutral",
        },
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, tone: "neutral" },
      ]}
      backHref="/dashboard/hr"
    >
      {error && <HrMessage>{error}</HrMessage>}
      {success && <HrMessage tone="success">{success}</HrMessage>}

      {canCreateExceptionalPersonnel ? (showExceptionalForm ? (
        <ErpSection
          title="ثبت استثنایی پرسنل"
          description="فقط برای مهاجرت داده، اصلاح سابقه یا انتقال سازمانی؛ جذب عادی باید از پرونده متقاضی انجام شود."
        >
          <ErpCard className="p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <HrField label="نام" required>
                <ErpInput
                  className={fieldClass}
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                />
              </HrField>
              <HrField label="نام خانوادگی" required>
                <ErpInput
                  className={fieldClass}
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                />
              </HrField>
              <HrField label="کد ملی" hint="در ثبت اولیه می‌تواند خالی بماند.">
                <ErpInput
                  className={fieldClass}
                  inputMode="numeric"
                  value={form.nationalCode}
                  onChange={(e) =>
                    setForm({ ...form, nationalCode: e.target.value })
                  }
                />
              </HrField>
              <HrField label="شماره پرسنلی">
                <ErpInput
                  className={fieldClass}
                  value={form.employeeNumber}
                  onChange={(e) =>
                    setForm({ ...form, employeeNumber: e.target.value })
                  }
                />
              </HrField>
              <HrField label="وضعیت شروع" required>
                <ErpSelect
                  className={fieldClass}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="ACTIVE">فعال</option>
                  <option value="PLANNED">برنامه‌ریزی‌شده</option>
                </ErpSelect>
              </HrField>
              <HrField label="تاریخ شروع" required>
                <HrPersianCalendar
                  value={form.effectiveFrom}
                  onChange={(effectiveFrom) =>
                    setForm({ ...form, effectiveFrom })
                  }
                />
              </HrField>
              <HrField label="جایگاه اصلی" required>
                <ErpSelect
                  className={fieldClass}
                  value={form.positionId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      positionId: e.target.value,
                      responsibleSupervisorAssignmentId: "",
                    })
                  }
                >
                  <option value="">انتخاب جایگاه</option>
                  {foundation.positions
                    .filter((item: any) => item.isActive && item.vacancy > 0)
                    .map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.title} · {item.vacancy.toLocaleString("fa-IR")}{" "}
                        جای خالی
                      </option>
                    ))}
                </ErpSelect>
              </HrField>
              <HrField
                label="کاربر سامانه"
                hint="اختیاری؛ تنها برای دسترسی ERP."
              >
                <ErpSelect
                  className={fieldClass}
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                >
                  <option value="">بدون حساب کاربری</option>
                  {foundation.availableUsers.map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.firstName} {item.lastName} · {item.username}
                    </option>
                  ))}
                </ErpSelect>
              </HrField>
              {supervisors.length > 1 && (
                <div className="md:col-span-2">
                  <HrField
                    label="سرپرست مسئول"
                    required
                    hint="جایگاه سرپرست چند متصدی دارد؛ یک فرد را صریح انتخاب کنید."
                  >
                    <ErpSelect
                      className={fieldClass}
                      value={form.responsibleSupervisorAssignmentId}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          responsibleSupervisorAssignmentId: e.target.value,
                        })
                      }
                    >
                      <option value="">انتخاب سرپرست</option>
                      {supervisors.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.positionTitle}
                        </option>
                      ))}
                    </ErpSelect>
                  </HrField>
                </div>
              )}
              <label className="flex items-center gap-2 self-end rounded-xl border border-[var(--sds-border-default)] px-3 py-2.5 text-sm dark:border-[var(--sds-border-strong)]">
                <ErpInput
                  type="checkbox"
                  checked={form.confirmDuplicate}
                  onChange={(e) =>
                    setForm({ ...form, confirmDuplicate: e.target.checked })
                  }
                />
                نام‌های مشابه را بررسی کرده‌ام
              </label>
              <HrField label="منبع ثبت استثنایی" required>
                <ErpSelect
                  className={fieldClass}
                  value={form.sourceCategory}
                  onChange={(e) =>
                    setForm({ ...form, sourceCategory: e.target.value })
                  }
                >
                  <option value="">انتخاب منبع</option>
                  <option value="DATA_MIGRATION">مهاجرت داده</option>
                  <option value="HISTORICAL_CORRECTION">اصلاح سابقه</option>
                  <option value="ORGANIZATIONAL_TRANSFER">
                    انتقال سازمانی
                  </option>
                </ErpSelect>
              </HrField>
              <div className="md:col-span-2 xl:col-span-3">
                <HrField
                  label="دلیل ثبت استثنایی"
                  required
                  hint="این توضیح به‌صورت دائمی در رویداد ممیزی نگهداری می‌شود."
                >
                  <ErpTextarea
                    className={fieldClass}
                    rows={2}
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                  />
                </HrField>
              </div>
            </div>
            <div className="mt-4">
              <ErpButton
                label="ثبت استثنایی پرسنل"
                icon={FaUserPlus}
                disabled={
                  saving ||
                  !form.firstName.trim() ||
                  !form.lastName.trim() ||
                  !form.positionId ||
                  !form.effectiveFrom ||
                  !form.sourceCategory ||
                  form.reason.trim().length < 10 ||
                  (supervisors.length > 1 &&
                    !form.responsibleSupervisorAssignmentId)
                }
                onClick={() =>
                  run(
                    () =>
                      hrAPI.createExceptionalPersonnel({
                        ...form,
                        effectiveFrom: toIsoDate(form.effectiveFrom),
                      }),
                    "پرسنل استثنایی، رابطه استخدامی، تخصیص اصلی و رویداد ممیزی ثبت شد.",
                    () => {
                      setForm(blankPerson());
                      setShowExceptionalForm(false);
                    },
                  )
                }
              />
            </div>
          </ErpCard>
        </ErpSection>
      ) : null) : (
        <ErpSection
          title="ایجاد پرسنل جدید"
          description="مسیر عادی ایجاد پرسنل از پرونده جذب و پس از تکمیل کنترل‌های استخدام انجام می‌شود."
        >
          <ErpCard className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              برای نیروی جدید، ابتدا پرونده متقاضی را ایجاد و چرخه جذب را کامل
              کنید.
            </p>
            <Link
              className="rounded-xl bg-[var(--sds-success)] px-4 py-2 text-sm font-bold text-[var(--sds-text-inverse)]"
              href="/dashboard/hr/hiring"
            >
              رفتن به جذب و پرونده‌های متقاضیان
            </Link>
          </ErpCard>
        </ErpSection>
      )}

      <ErpSection
        title={archiveView ? "بایگانی پرسنل" : "فهرست پرسنل"}
        description={`${meta.total.toLocaleString("fa-IR")} پرونده`}
        actions={[
          {
            label: "جستجو",
            icon: FaSearch,
            onClick: submitSearch,
            tone: "neutral",
          },
        ]}
      >
        {(relationshipStatus || attention) && (
          <ErpCard className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--sds-text-primary)]">
              <span>فیلتر فعال:</span>
              <ErpBadge tone="info">
                {attention === "missing-primary"
                  ? "فاقد تخصیص اصلی"
                  : employmentStatusLabel[relationshipStatus] || relationshipStatus}
              </ErpBadge>
            </div>
            <ErpButton label="حذف فیلتر" href="/dashboard/hr/personnel" tone="neutral" variant="ghost" />
          </ErpCard>
        )}
        <div className="mb-4">
          <ErpInput
            aria-label="جستجوی پرسنل"
            className={fieldClass}
            value={searchDraft}
            onChange={(e) => {
              setSearchDraft(e.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              submitSearch();
            }}
          />
        </div>
        <div className="space-y-3">
          {rows.map((person) => (
            <PersonnelCard
              key={person.id}
              person={person}
              open={expanded === person.id}
              onToggle={() =>
                setExpanded(expanded === person.id ? null : person.id)
              }
              saving={saving}
              foundation={foundation}
              assignment={assignment}
              setAssignment={setAssignment}
              assignmentRelationship={assignmentRelationship}
              setAssignmentRelationship={setAssignmentRelationship}
              assignmentSupervisors={assignmentSupervisors}
              endDates={endDates}
              setEndDates={setEndDates}
              run={run}
              authorities={authorities}
              changeArchiveState={changeArchiveState}
              permanentlyDelete={permanentlyDelete}
            />
          ))}
          {!rows.length && (
            <ErpEmptyState
              icon={FaUsers}
              title="پرسنلی برای نمایش وجود ندارد"
            />
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--sds-text-secondary)]">
          <span>
            صفحه {meta.page.toLocaleString("fa-IR")} از{" "}
            {meta.totalPages.toLocaleString("fa-IR")}
          </span>
          <div className="flex gap-2">
            <ErpPressable
              type="button"
              className="rounded-lg border px-3 py-2 disabled:opacity-50"
              disabled={loading || page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              صفحه قبل
            </ErpPressable>
            <ErpPressable
              type="button"
              className="rounded-lg border px-3 py-2 disabled:opacity-50"
              disabled={loading || page >= meta.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              صفحه بعد
            </ErpPressable>
          </div>
        </div>
      </ErpSection>
      {deletionTarget && (
        <PermanentDeletionDialog
          title="حذف دائمی شخص و همه سوابق مرتبط"
          preview={deletionTarget.preview}
          busy={saving}
          onClose={() => setDeletionTarget(null)}
          onConfirm={confirmPermanentDeletion}
        />
      )}
      {retentionTarget && (
        <RetentionAction
          title={
            retentionTarget.archivedAt
              ? "بازیابی پرسنل از بایگانی"
              : "بایگانی پرسنل"
          }
          targetName={`${retentionTarget.firstName} ${retentionTarget.lastName}`}
          busy={saving}
          confirmLabel={retentionTarget.archivedAt ? "بازیابی" : "بایگانی"}
          confirmTone={retentionTarget.archivedAt ? "success" : "warning"}
          effectiveDate={retentionTarget.archivedAt ? undefined : today()}
          onClose={() => setRetentionTarget(null)}
          onConfirm={confirmRetentionAction}
        />
      )}
    </ErpPage>
  );
}

function PersonnelCard(props: any) {
  const {
    person,
    open,
    onToggle,
    saving,
    foundation,
    assignment,
    setAssignment,
    assignmentRelationship,
    setAssignmentRelationship,
    assignmentSupervisors,
    endDates,
    setEndDates,
    run,
    authorities,
    changeArchiveState,
    permanentlyDelete,
  } = props;
  const relationship = person.hrEmploymentRelationships?.[0];
  const primary = relationship?.assignments?.find(
    (item: any) => item.type === "PRIMARY" && !item.effectiveTo,
  );
  return (
    <ErpCard className="p-4">
      <ErpPressable
        type="button"
        className="flex w-full items-start justify-between gap-3 text-right"
        onClick={onToggle}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">
              {person.firstName} {person.lastName}
            </p>
            <ErpBadge
              tone={
                relationship?.status === "ACTIVE"
                  ? "success"
                  : relationship?.status === "PLANNED"
                    ? "info"
                    : relationship?.status === "SUSPENDED"
                      ? "warning"
                      : "neutral"
              }
            >
              {relationship
                ? employmentStatusLabel[relationship.status]
                : "فاقد رابطه استخدامی"}
            </ErpBadge>
            {person.user && (
              <ErpBadge tone={person.user.isActive ? "primary" : "neutral"}>
                ERP: {person.user.username}
              </ErpBadge>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
            {person.employeeNumber || "بدون شماره پرسنلی"} ·{" "}
            {primary
              ? `${primary.position.title} / ${primary.position.organizationalUnit.name}`
              : "فاقد تخصیص اصلی جاری"}
          </p>
        </div>
        {open ? <FaChevronUp /> : <FaChevronDown />}
      </ErpPressable>
      {relationship?.hiringApplication && (
        <Link
          className="mt-2 inline-block text-xs font-bold text-[var(--sds-success)] hover:underline"
          href={`/dashboard/hr/hiring/${relationship.hiringApplication.id}`}
        >
          ایجادشده از پرونده جذب · مشاهده پرونده
        </Link>
      )}
      {(person.retentionCapabilities?.canArchive ||
        person.retentionCapabilities?.canRestore) && (
        <div className="mt-3">
          <ErpButton
            label={person.archivedAt ? "بازیابی از بایگانی" : "بایگانی"}
            icon={person.archivedAt ? FaUndo : FaArchive}
            tone="warning"
            variant="soft"
            disabled={saving}
            onClick={() => changeArchiveState(person)}
          />
        </div>
      )}
      <div className="mt-2">
        <ErpButton label="صلاحیت رانندگی" icon={FaUserPlus} variant="soft" href={`/dashboard/hr/personnel/${person.id}/driver-eligibility`} />
      </div>
      {person.retentionCapabilities?.canPermanentlyDelete && (
        <div className="mt-2">
          <ErpButton
            label="حذف دائمی"
            icon={FaTrash}
            tone="danger"
            variant="soft"
            disabled={saving}
            onClick={() => permanentlyDelete(person)}
          />
        </div>
      )}
      {person.archivedAt && (
        <p className="mt-2 text-xs text-[var(--sds-text-secondary)]">
          بایگانی‌شده در {dateTimeFa(person.archivedAt)} توسط{" "}
          {person.archivedByDisplayName || "کاربر نامشخص"} · دلیل:{" "}
          {person.archiveReason || "ثبت نشده"}
        </p>
      )}
      {!relationship?.hiringApplication &&
        person.hrPersonnelAudits?.[0]?.eventType ===
          "EXCEPTIONAL_PERSONNEL_REGISTERED" && (
          <p className="mt-2 text-xs font-bold text-[var(--sds-warning)]">
            ثبت استثنایی · {person.hrPersonnelAudits[0].reason}
          </p>
        )}
      {open && !person.archivedAt && (
        <div className="mt-4 border-t border-[var(--sds-border-default)] pt-4 dark:border-[var(--sds-border-strong)]">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Info label="کد ملی" value={person.nationalCode || "ثبت نشده"} />
            <Info
              label="شروع رابطه"
              value={dateFa(relationship?.effectiveFrom)}
            />
            <Info
              label="وضعیت"
              value={
                relationship ? employmentStatusLabel[relationship.status] : "—"
              }
            />
            <Info
              label="تعداد تخصیص‌ها"
              value={(relationship?.assignments?.length || 0).toLocaleString(
                "fa-IR",
              )}
            />
          </div>
          <PersonnelScheduleEditor
            key={`${person.workSchedules?.[0]?.id || "new-schedule"}-${person.workScheduleChanges?.[0]?.id || "no-change"}`}
            person={person}
            saving={saving}
            run={run}
          />
          {relationship && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {relationship.status === "PLANNED" &&
                  !relationship.hiringApplication && (
                    <ErpButton
                      label="فعال‌سازی"
                      icon={FaPlay}
                      tone="success"
                      variant="soft"
                      onClick={() =>
                        run(
                          () =>
                            hrAPI.updateRelationshipStatus(relationship.id, {
                              status: "ACTIVE",
                            }),
                          "رابطه استخدامی فعال شد.",
                        )
                      }
                    />
                  )}
                {relationship.status === "PLANNED" &&
                  relationship.hiringApplication && (
                    <Link
                      className="rounded-xl bg-[var(--sds-success-surface)] px-3 py-2 text-sm font-bold text-[var(--sds-success)]"
                      href={`/dashboard/hr/hiring/${relationship.hiringApplication.id}`}
                    >
                      تکمیل پیش‌نیازها و فعال‌سازی در پرونده جذب
                    </Link>
                  )}
                {relationship.status === "ACTIVE" && (
                  <ErpButton
                    label="تعلیق"
                    icon={FaPause}
                    tone="warning"
                    variant="soft"
                    onClick={() =>
                      run(
                        () =>
                          hrAPI.updateRelationshipStatus(relationship.id, {
                            status: "SUSPENDED",
                          }),
                        "رابطه استخدامی معلق شد.",
                      )
                    }
                  />
                )}
                {relationship.status === "SUSPENDED" && (
                  <ErpButton
                    label="بازگشت به فعال"
                    icon={FaPlay}
                    tone="success"
                    variant="soft"
                    onClick={() =>
                      run(
                        () =>
                          hrAPI.updateRelationshipStatus(relationship.id, {
                            status: "ACTIVE",
                          }),
                        "رابطه استخدامی دوباره فعال شد.",
                      )
                    }
                  />
                )}
                <ErpButton
                  label="افزودن مسئولیت"
                  icon={FaPlus}
                  variant="soft"
                  onClick={() => {
                    setAssignmentRelationship(
                      assignmentRelationship === relationship.id
                        ? null
                        : relationship.id,
                    );
                    setAssignment(blankAssignment());
                  }}
                />
              </div>
              {assignmentRelationship === relationship.id && (
                <AssignmentForm
                  relationship={relationship}
                  saving={saving}
                  foundation={foundation}
                  assignment={assignment}
                  setAssignment={setAssignment}
                  supervisors={assignmentSupervisors}
                  run={run}
                  close={() => setAssignmentRelationship(null)}
                />
              )}
              <div className="mt-4 space-y-2">
                {relationship.assignments.map((item: any) => (
                  <AssignmentRow
                    key={item.id}
                    item={item}
                    endDate={endDates[item.id] || ""}
                    setEndDate={(value: string) =>
                      setEndDates({ ...endDates, [item.id]: value })
                    }
                    run={run}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </ErpCard>
  );
}

function PersonnelScheduleEditor({ person, saving, run }: any) {
  const schedule = person.workSchedules?.[0];
  const change = person.workScheduleChanges?.[0];
  const draftSchedule =
    change?.effectiveFrom && Array.isArray(change.daysJson)
      ? { effectiveFrom: change.effectiveFrom, days: change.daysJson }
      : schedule;
  const [value, setValue] = useState<WorkScheduleValue>(() =>
    workScheduleFromApi(draftSchedule),
  );
  const [proposalNote, setProposalNote] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const capabilities = person.workScheduleCapabilities || {};

  return (
    <div className="mt-4">
      <div className="rounded-xl border border-[var(--sds-border-default)] p-3 text-sm dark:border-[var(--sds-border-strong)]">
        <p className="font-bold">گردش تغییر ساعت کاری</p>
        <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
          سرپرست مسئول پیشنهاد می‌دهد؛ کارشناس منابع انسانی آماده و ارسال
          می‌کند؛ مدیر منابع انسانی دیگری تأیید می‌کند.
        </p>
        <p className="mt-2">
          وضعیت آخرین درخواست:{" "}
          {change ? hrDisplayLabel(change.status) : "بدون درخواست باز"}
        </p>
        {change?.returnReason && (
          <p className="mt-1 text-[var(--sds-danger)]">
            دلیل بازگشت: {change.returnReason}
          </p>
        )}
      </div>
      {capabilities.canPropose && (
        <div className="mt-3 space-y-3">
          <WorkScheduleEditor value={value} onChange={setValue} />
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <ErpInput
              className={fieldClass}
              placeholder="دلیل پیشنهاد سرپرست مسئول"
              value={proposalNote}
              onChange={(event) => setProposalNote(event.target.value)}
            />
            <ErpButton
              label="ثبت پیشنهاد توسط سرپرست مسئول"
              disabled={saving || !proposalNote.trim() || !value.effectiveDate}
              onClick={() =>
                run(
                  () =>
                    hrAPI.proposePersonnelWorkSchedule(person.id, {
                      ...workSchedulePayload(value),
                      proposalNote: proposalNote.trim(),
                    }),
                  "پیشنهاد تغییر ساعت کاری ثبت شد.",
                )
              }
            />
          </div>
        </div>
      )}
      {change && capabilities.canPrepare && (
        <div className="mt-3">
          <WorkScheduleEditor value={value} onChange={setValue} />
          <div className="mt-3 flex flex-wrap gap-2">
            <ErpButton
              label="ذخیره پیش‌نویس توسط کارشناس منابع انسانی"
              icon={FaSync}
              disabled={saving || !value.effectiveDate}
              onClick={() =>
                run(
                  () =>
                    hrAPI.preparePersonnelWorkSchedule(
                      person.id,
                      change.id,
                      workSchedulePayload(value),
                    ),
                  "پیش‌نویس برنامه کاری ذخیره شد.",
                )
              }
            />
            {capabilities.canSubmit && (
              <ErpButton
                label="ارسال برای تأیید مدیر منابع انسانی"
                disabled={saving}
                onClick={() =>
                  run(
                    () =>
                      hrAPI.submitPersonnelWorkSchedule(person.id, change.id),
                    "برنامه کاری برای تأیید ارسال شد.",
                  )
                }
                tone="success"
              />
            )}
          </div>
        </div>
      )}
      {change?.status === "SUBMITTED" &&
        (capabilities.canApprove || capabilities.canReturn) && (
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <ErpInput
              className={fieldClass}
              placeholder="دلیل بازگرداندن برای اصلاح"
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
            />
            {capabilities.canReturn && (
              <ErpButton
                label="بازگرداندن"
                disabled={saving || !returnReason.trim()}
                onClick={() =>
                  run(
                    () =>
                      hrAPI.returnPersonnelWorkSchedule(
                        person.id,
                        change.id,
                        returnReason,
                      ),
                    "برنامه کاری برای اصلاح بازگردانده شد.",
                  )
                }
                tone="warning"
              />
            )}
            {capabilities.canApprove && (
              <ErpButton
                label="تأیید و ایجاد نسخه اجرایی"
                disabled={saving}
                onClick={() =>
                  run(
                    () =>
                      hrAPI.approvePersonnelWorkSchedule(person.id, change.id),
                    "نسخه اجرایی برنامه کاری تأیید شد.",
                  )
                }
                tone="success"
              />
            )}
          </div>
        )}
      {!change && schedule && (
        <div className="mt-3">
          <WorkScheduleEditor
            value={workScheduleFromApi(schedule)}
            onChange={() => undefined}
          />
        </div>
      )}
    </div>
  );
}

function AssignmentForm({
  relationship,
  saving,
  foundation,
  assignment,
  setAssignment,
  supervisors,
  run,
  close,
}: any) {
  const hasCurrentPrimary = relationship.assignments.some(
    (item: any) => item.type === "PRIMARY" && !item.effectiveTo,
  );
  const saveAssignment = () => {
    const payload = {
      ...assignment,
      effectiveFrom: toIsoDate(assignment.effectiveFrom),
      effectiveTo: assignment.effectiveTo
        ? toIsoDate(assignment.effectiveTo)
        : null,
    };
    if (assignment.type === "PRIMARY" && hasCurrentPrimary)
      return hrAPI.transferPrimaryAssignment(relationship.id, payload);
    return hrAPI.createAssignment(relationship.id, payload);
  };
  return (
    <ErpCard tone="primary" className="mt-4 p-4">
      <p className="mb-3 font-bold">تخصیص ثانویه یا سرپرستی موقت</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HrField label="نوع" required>
          <ErpSelect
            className={fieldClass}
            value={assignment.type}
            onChange={(e) =>
              setAssignment({ ...assignment, type: e.target.value })
            }
          >
            <option value="PRIMARY">
              {hasCurrentPrimary ? "انتقال/ارتقای جایگاه اصلی" : "تخصیص اصلی"}
            </option>
            <option value="SECONDARY">ثانویه (مصرف ظرفیت)</option>
            <option value="ACTING">سرپرستی موقت (بدون مصرف ظرفیت)</option>
          </ErpSelect>
        </HrField>
        <HrField label="جایگاه" required>
          <ErpSelect
            className={fieldClass}
            value={assignment.positionId}
            onChange={(e) =>
              setAssignment({
                ...assignment,
                positionId: e.target.value,
                responsibleSupervisorAssignmentId: "",
              })
            }
          >
            <option value="">انتخاب جایگاه</option>
            {foundation.positions
              .filter(
                (item: any) =>
                  item.isActive &&
                  (assignment.type === "ACTING" || item.vacancy > 0),
              )
              .map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </ErpSelect>
        </HrField>
        <HrField label="شروع" required>
          <HrPersianCalendar
            value={assignment.effectiveFrom}
            onChange={(effectiveFrom) =>
              setAssignment({ ...assignment, effectiveFrom })
            }
          />
        </HrField>
        <HrField label="پایان">
          <HrPersianCalendar
            value={assignment.effectiveTo}
            onChange={(effectiveTo) =>
              setAssignment({ ...assignment, effectiveTo })
            }
          />
        </HrField>
        {supervisors.length > 1 && (
          <HrField label="سرپرست مسئول" required>
            <ErpSelect
              className={fieldClass}
              value={assignment.responsibleSupervisorAssignmentId}
              onChange={(e) =>
                setAssignment({
                  ...assignment,
                  responsibleSupervisorAssignmentId: e.target.value,
                })
              }
            >
              <option value="">انتخاب</option>
              {supervisors.map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </ErpSelect>
          </HrField>
        )}
        <label className="flex items-center gap-2 self-end rounded-xl border border-[var(--sds-border-default)] px-3 py-2.5 text-sm dark:border-[var(--sds-border-strong)]">
          <ErpInput
            type="checkbox"
            checked={assignment.scheduleContributing}
            onChange={(e) =>
              setAssignment({
                ...assignment,
                scheduleContributing: e.target.checked,
              })
            }
          />
          ساعات آن جزو برنامه مورد انتظار باشد
        </label>
      </div>
      <div className="mt-3">
        <ErpButton
          label={
            assignment.type === "PRIMARY" && hasCurrentPrimary
              ? "ثبت انتقال/ارتقا"
              : "ثبت تخصیص"
          }
          icon={FaBriefcase}
          disabled={
            saving ||
            !assignment.positionId ||
            !assignment.effectiveFrom ||
            (supervisors.length > 1 &&
              !assignment.responsibleSupervisorAssignmentId)
          }
          onClick={() =>
            run(
              saveAssignment,
              assignment.type === "PRIMARY" && hasCurrentPrimary
                ? "تخصیص اصلی پیشین بسته و تخصیص جدید ثبت شد."
                : "تخصیص تاریخ‌دار ثبت شد.",
              close,
            )
          }
        />
      </div>
    </ErpCard>
  );
}

function AssignmentRow({ item, endDate, setEndDate, run }: any) {
  const supervisor =
    item.responsibleSupervisorAssignment?.employmentRelationship?.personnel;
  return (
    <div className="rounded-xl border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {item.position.title}{" "}
            <ErpBadge
              tone={
                item.type === "PRIMARY"
                  ? "primary"
                  : item.type === "ACTING"
                    ? "warning"
                    : "info"
              }
            >
              {assignmentTypeLabel[item.type]}
            </ErpBadge>
          </p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
            {dateFa(item.effectiveFrom)} تا {dateFa(item.effectiveTo)} · سرپرست
            مسئول:{" "}
            {supervisor
              ? `${supervisor.firstName} ${supervisor.lastName}`
              : "تعیین نشده"}
          </p>
        </div>
        {!item.effectiveTo && item.type !== "PRIMARY" && (
          <div className="flex items-end gap-2">
            <div className="w-40">
              <HrPersianCalendar
                value={endDate}
                onChange={setEndDate}
                placeholder="تاریخ پایان"
              />
            </div>
            <ErpButton
              label="پایان تخصیص"
              icon={FaStop}
              tone="danger"
              variant="ghost"
              disabled={!endDate}
              onClick={() =>
                run(
                  () => hrAPI.endAssignment(item.id, toIsoDate(endDate)),
                  "تخصیص در تاریخ انتخاب‌شده پایان یافت.",
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--sds-surface-subtle)] p-3 dark:bg-[var(--sds-surface-raised)]">
      <p className="text-xs text-[var(--sds-text-secondary)]">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
