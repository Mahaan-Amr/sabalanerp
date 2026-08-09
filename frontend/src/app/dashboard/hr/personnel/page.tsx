"use client";
import {
  ErpInput,
  ErpCheckbox,
  ErpPressable,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
} from "@/components/erp";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import moment from "moment-jalaali";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FaArchive,
  FaArrowRight,
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
  parsePersonnelListState,
  personnelListSearch,
  type PersonnelListState,
} from "@/features/hr/personnelListState";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const listState = useMemo(
    () => parsePersonnelListState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const {
    relationshipStatus,
    attention,
    organizationalUnitId,
    workplaceId,
    costCenterId,
    dependencyAt,
  } = listState;
  const replaceListState = useCallback(
    (patch: Partial<PersonnelListState>) => {
      const query = personnelListSearch({ ...listState, ...patch });
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [listState, pathname, router],
  );
  const [rows, setRows] = useState<any[]>([]);
  const [foundation, setFoundation] = useState<any>({
    positions: [],
    availableUsers: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchDraft, setSearchDraft] = useState(listState.search);
  const [form, setForm] = useState(blankPerson);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [assignmentRelationship, setAssignmentRelationship] = useState<
    string | null
  >(null);
  const [assignment, setAssignment] = useState(blankAssignment);
  const [assignmentSupervisors, setAssignmentSupervisors] = useState<any[]>([]);
  const [endDates, setEndDates] = useState<Record<string, string>>({});
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [meta, setMeta] = useState({ page: 1, total: 0, totalPages: 1 });
  const [deletionTarget, setDeletionTarget] = useState<any>(null);
  const [retentionTarget, setRetentionTarget] = useState<any>(null);
  const [scheduleData, setScheduleData] = useState<any>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [confirmDiscardSchedule, setConfirmDiscardSchedule] = useState(false);
  const [exceptionalOpenedHere, setExceptionalOpenedHere] = useState(false);
  const [confirmDiscardExceptional, setConfirmDiscardExceptional] = useState(false);
  const lastSuccessfulView = useRef(false);
  const expanded = listState.focus || null;
  const archiveView = listState.view === "archived";
  const page = listState.page;
  const search = listState.search;
  const showExceptionalForm = listState.panel === "exceptional";
  const canCreateExceptionalPersonnel = authorities.includes("HR_MANAGER");
  const authoritySignature = authorities.join("|");
  const scheduleTarget = rows.find((person) => person.id === expanded) || null;

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
          ...(organizationalUnitId ? { organizationalUnitId } : {}),
          ...(workplaceId ? { workplaceId } : {}),
          ...(costCenterId ? { costCenterId } : {}),
          ...(dependencyAt ? { dependencyAt } : {}),
          page,
          ...(expanded ? { focus: expanded } : {}),
        }),
        hrAPI.getFoundation(),
        hiringAPI.myAuthorities(),
      ]);
      const nextMeta = people.data.meta || {
          page: 1,
          total: people.data.data.length,
          totalPages: 1,
        };
      setRows(people.data.data);
      setMeta(nextMeta);
      setFoundation(base.data.data);
      setAuthorities(authorityResponse.data.data || []);
      lastSuccessfulView.current = true;
      if (nextMeta.page !== page || nextMeta.focus === "removed") {
        replaceListState({
          page: nextMeta.page,
          ...(nextMeta.focus === "removed" ? { focus: "", panel: "" } : {}),
        });
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [search, archiveView, page, relationshipStatus, attention, organizationalUnitId, workplaceId, costCenterId, dependencyAt, expanded, replaceListState]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextSearch = searchDraft.trim();
      if (nextSearch !== listState.search) {
        replaceListState({ search: nextSearch, page: 1, focus: "", panel: "" });
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [listState.search, replaceListState, searchDraft]);
  useEffect(() => {
    setSearchDraft(listState.search);
  }, [listState.search]);
  useEffect(() => {
    if (!expanded || loading) return;
    const control = document.querySelector<HTMLElement>(`[data-personnel-id="${CSS.escape(expanded)}"] button`);
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: "center" });
  }, [expanded, loading, rows]);
  useEffect(() => {
    const key = `hr-personnel-scroll:${pathname}?${personnelListSearch({ ...listState, focus: "", panel: "" })}`;
    const restore = sessionStorage.getItem(key);
    if (restore && !expanded) window.requestAnimationFrame(() => window.scrollTo({ top: Number(restore) || 0 }));
    const remember = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      window.removeEventListener("scroll", remember);
    };
  }, [expanded, listState, pathname]);
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

  const loadSchedule = useCallback(async () => {
    if (!expanded || listState.panel !== "schedule") {
      setScheduleData(null);
      return;
    }
    try {
      setScheduleLoading(true);
      const response = await hrAPI.getPersonnelWorkSchedule(expanded);
      setScheduleData(response.data.data);
    } catch (err) {
      setScheduleData(null);
      setError(apiError(err));
      if ([401, 403, 404].includes(Number((err as any)?.response?.status))) {
        replaceListState({ panel: "", focus: "" });
      }
    } finally {
      setScheduleLoading(false);
    }
  }, [expanded, listState.panel, replaceListState]);

  useEffect(() => {
    void loadSchedule();
  }, [authoritySignature, loadSchedule]);
  useEffect(() => {
    if (!lastSuccessfulView.current || !showExceptionalForm || canCreateExceptionalPersonnel) return;
    setForm(blankPerson());
    replaceListState({ panel: "" });
  }, [canCreateExceptionalPersonnel, replaceListState, showExceptionalForm]);

  const run = async (
    action: () => Promise<any>,
    message: string,
    reset?: (response?: any) => void,
  ) => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const response = await action();
      reset?.(response);
      setSuccess(message);
      await load();
      if (listState.panel === "schedule") await loadSchedule();
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
    if (nextSearch === search) void load();
    else replaceListState({ search: nextSearch, page: 1, focus: "", panel: "" });
  };

  const openExceptionalRegistration = () => {
    const query = personnelListSearch({ ...listState, panel: "exceptional" });
    setExceptionalOpenedHere(true);
    router.push(`${pathname}?${query}`, { scroll: false });
  };
  const exceptionalDirty = JSON.stringify(form) !== JSON.stringify(blankPerson());
  const closeExceptionalRegistration = () => {
    if (saving) return;
    if (exceptionalDirty) {
      setConfirmDiscardExceptional(true);
      return;
    }
    if (exceptionalOpenedHere) router.back();
    else replaceListState({ panel: "" });
  };
  const discardExceptionalRegistration = () => {
    setForm(blankPerson());
    setConfirmDiscardExceptional(false);
    if (exceptionalOpenedHere) router.back();
    else replaceListState({ panel: "" });
  };
  const openSchedule = (person: any) => {
    setScheduleDirty(false);
    replaceListState({ focus: person.id, panel: "schedule" });
  };
  const closeSchedule = () => {
    if (saving) return;
    if (scheduleDirty) {
      setConfirmDiscardSchedule(true);
      return;
    }
    setScheduleData(null);
    replaceListState({ panel: "" });
  };
  const discardSchedule = () => {
    setScheduleDirty(false);
    setConfirmDiscardSchedule(false);
    setScheduleData(null);
    replaceListState({ panel: "" });
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
  if (!loading && error && !lastSuccessfulView.current) {
    return (
      <ErpPage
        eyebrow="منابع انسانی · پرسنل"
        title="فهرست پرسنل"
        actions={[{ label: "بازگشت", href: listState.origin || "/dashboard/hr", icon: FaArrowRight, tone: "neutral" }]}
      >
        <ErpEmptyState
          icon={FaUsers}
          title="فهرست پرسنل در دسترس نیست"
          description={error}
          action={{ label: "تلاش دوباره", onClick: load }}
        />
      </ErpPage>
    );
  }

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
        {
          label: "بازگشت",
          href: listState.origin || "/dashboard/hr",
          icon: FaArrowRight,
          tone: "neutral",
        },
        ...(canCreateExceptionalPersonnel
          ? [{
              label: "ثبت استثنایی پرسنل",
              icon: FaUserPlus,
              onClick: openExceptionalRegistration,
              tone: "success" as const,
            }]
          : []),
        {
          label: archiveView ? "فهرست فعال" : "بایگانی پرسنل",
          icon: archiveView ? FaUndo : FaArchive,
          onClick: () => replaceListState({
            view: archiveView ? "active" : "archived",
            page: 1,
            focus: "",
            panel: "",
          }),
          tone: "neutral",
        },
        { label: "به‌روزرسانی", icon: FaSync, onClick: load, tone: "neutral" },
      ]}
    >
      {error && <HrMessage>{error}</HrMessage>}
      {success && <HrMessage tone="success">{success}</HrMessage>}

      {canCreateExceptionalPersonnel ? (
        <ErpSheet
          open={showExceptionalForm}
          onClose={closeExceptionalRegistration}
          dismissible={!saving}
          title="ثبت استثنایی پرسنل"
        >
          <p className="mb-4 text-sm text-[var(--sds-text-secondary)]">
            فقط برای مهاجرت داده، اصلاح سابقه یا انتقال سازمانی؛ جذب عادی باید از پرونده متقاضی انجام شود.
          </p>
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
              <ErpCheckbox
                  className="self-end rounded-xl border border-[var(--sds-border-default)] px-3 py-2.5 dark:border-[var(--sds-border-strong)]"
                  label="نام‌های مشابه را بررسی کرده‌ام"
                  checked={form.confirmDuplicate}
                  onChange={(e) =>
                    setForm({ ...form, confirmDuplicate: e.target.checked })
                  }
              />
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
                    (response) => {
                      setForm(blankPerson());
                      setExceptionalOpenedHere(false);
                      replaceListState({
                        view: "active",
                        page: 1,
                        focus: response?.data?.data?.id || "",
                        panel: "",
                      });
                    },
                  )
                }
              />
            </div>
          </ErpCard>
        </ErpSheet>
      ) : (
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
              onToggle={() => replaceListState({
                focus: expanded === person.id ? "" : person.id,
                panel: "",
              })}
              onOpenSchedule={() => openSchedule(person)}
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
              onClick={() => replaceListState({ page: page - 1, focus: "", panel: "" })}
            >
              صفحه قبل
            </ErpPressable>
            <ErpPressable
              type="button"
              className="rounded-lg border px-3 py-2 disabled:opacity-50"
              disabled={loading || page >= meta.totalPages}
              onClick={() => replaceListState({ page: page + 1, focus: "", panel: "" })}
            >
              صفحه بعد
            </ErpPressable>
          </div>
        </div>
      </ErpSection>
      <ErpSheet
        open={listState.panel === "schedule" && Boolean(expanded)}
        onClose={closeSchedule}
        dismissible={!saving}
        title={scheduleTarget ? `برنامه کاری ${scheduleTarget.firstName} ${scheduleTarget.lastName}` : "برنامه کاری"}
      >
        {scheduleLoading && !scheduleData ? <ErpLoading /> : null}
        {scheduleData && scheduleTarget ? (
          <PersonnelScheduleEditor
            key={`${scheduleData.workSchedules?.[0]?.id || "new-schedule"}-${scheduleData.workScheduleChanges?.[0]?.id || "no-change"}`}
            person={{ ...scheduleTarget, ...scheduleData }}
            saving={saving}
            run={run}
            onDirtyChange={setScheduleDirty}
          />
        ) : null}
      </ErpSheet>
      <ErpSheet
        open={confirmDiscardExceptional}
        onClose={() => setConfirmDiscardExceptional(false)}
        title="کنار گذاشتن اطلاعات ثبت‌نشده؟"
        presentation="modal"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="ادامه ویرایش" variant="ghost" onClick={() => setConfirmDiscardExceptional(false)} />
            <ErpButton label="کنار گذاشتن" tone="danger" onClick={discardExceptionalRegistration} />
          </div>
        )}
      >
        <p className="text-sm text-[var(--sds-text-secondary)]">اطلاعات واردشده ذخیره نشده است.</p>
      </ErpSheet>
      <ErpSheet
        open={confirmDiscardSchedule}
        onClose={() => setConfirmDiscardSchedule(false)}
        title="بستن برنامه کاری بدون ذخیره؟"
        presentation="modal"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="ادامه ویرایش" variant="ghost" onClick={() => setConfirmDiscardSchedule(false)} />
            <ErpButton label="کنار گذاشتن" tone="danger" onClick={discardSchedule} />
          </div>
        )}
      >
        <p className="text-sm text-[var(--sds-text-secondary)]">تغییرهای ثبت‌نشده برنامه کاری از بین می‌رود.</p>
      </ErpSheet>
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
    onOpenSchedule,
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
    <div data-personnel-id={person.id}>
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
          <div className="mt-4">
            <ErpButton
              label="مشاهده برنامه کاری"
              variant="soft"
              tone="info"
              disabled={saving}
              onClick={onOpenSchedule}
            />
          </div>
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
    </div>
  );
}

function PersonnelScheduleEditor({ person, saving, run, onDirtyChange }: any) {
  const schedule = person.workSchedules?.[0];
  const change = person.workScheduleChanges?.[0];
  const initialValue = useMemo(
    () => workScheduleFromApi(
      change?.effectiveFrom && Array.isArray(change.daysJson)
        ? { effectiveFrom: change.effectiveFrom, days: change.daysJson }
        : schedule,
    ),
    [change?.daysJson, change?.effectiveFrom, schedule],
  );
  const [value, setValue] = useState<WorkScheduleValue>(() =>
    initialValue,
  );
  const [proposalNote, setProposalNote] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const capabilities = person.workScheduleCapabilities || {};

  useEffect(() => {
    onDirtyChange?.(
      JSON.stringify(value) !== JSON.stringify(initialValue) ||
      Boolean(proposalNote.trim()) ||
      Boolean(returnReason.trim()),
    );
  }, [initialValue, onDirtyChange, proposalNote, returnReason, value]);

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
