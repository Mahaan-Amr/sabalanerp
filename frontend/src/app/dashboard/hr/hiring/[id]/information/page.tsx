"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  ErpBadge,
  ErpCard,
  ErpFieldView,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { dateTimeFa } from "@/features/hr/hrUi";
import { hrDisplayLabel } from "@/features/hr/hrDisplay";
import { hiringAPI, hiringError } from "@/lib/hiringApi";
import { formatDisplayNumber } from "@/lib/numberFormat";

const groupLabels: Record<string, string> = {
  PROFILE_IDENTITY: "هویت، تماس، سکونت و خانواده",
  EXPERIENCE_QUALIFICATIONS: "تجربه و صلاحیت‌ها",
  APPLICATION_ANSWERS: "پاسخ‌های فرم درخواست",
  DOCUMENT_EVIDENCE: "مدارک و شواهد",
};

const value = (input: unknown) => {
  if (input === null || input === undefined || input === "") return "—";
  if (typeof input === "boolean") return input ? "بله" : "خیر";
  return String(input);
};

const rial = (input: unknown) => {
  if (input === null || input === undefined || input === "") return "—";
  return `${formatDisplayNumber(input as string | number)} ریال`;
};

function RevisionHeader({ revision }: { revision: any }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <strong>نسخه {Number(revision.revisionNumber).toLocaleString("fa-IR")}</strong>
      <div className="flex gap-2">
        <ErpBadge tone={revision.status === "SUBMITTED" ? "success" : "neutral"}>{hrDisplayLabel(revision.status)}</ErpBadge>
        {revision.submittedAt && <span className="text-xs text-[var(--sds-text-secondary)]">{dateTimeFa(revision.submittedAt)}</span>}
      </div>
    </div>
  );
}

function ProfileGroup({ group }: { group: any }) {
  return <div className="space-y-3">{group.revisions.map((revision: any) => (
    <ErpCard key={revision.id} className="p-4">
      <RevisionHeader revision={revision} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ErpFieldView label="نام و نام خانوادگی" value={`${value(revision.identity.firstName)} ${value(revision.identity.lastName)}`} />
        <ErpFieldView label="تاریخ تولد" value={value(revision.identity.birthDate)} />
        <ErpFieldView label="کد ملی / شناسه" value={value(revision.identity.nationalCode || revision.identity.foreignIdentityNumber)} />
        <ErpFieldView label="شماره همراه" value={value(revision.contact.mobile)} />
        <ErpFieldView label="ایمیل" value={value(revision.contact.email)} />
        <ErpFieldView label="نشانی" value={value(revision.residence.address)} />
        <ErpFieldView label="کد پستی" value={value(revision.residence.postalCode)} />
        <ErpFieldView label="وضعیت تأهل" value={value(revision.family.maritalStatus)} />
        <ErpFieldView label="نام پدر" value={value(revision.family.fatherName)} />
      </div>
    </ErpCard>
  ))}</div>;
}

function ExperienceGroup({ group }: { group: any }) {
  return <div className="space-y-3">{group.revisions.map((revision: any) => (
    <ErpCard key={revision.id} className="p-4">
      <RevisionHeader revision={revision} />
      <div className="grid gap-3 sm:grid-cols-3">
        <ErpFieldView label="تحصیلات" value={value(revision.education.educationLevel)} />
        <ErpFieldView label="رشته" value={value(revision.education.fieldOfStudy)} />
        <ErpFieldView label="سال فراغت" value={value(revision.education.graduationYear)} />
      </div>
      <div className="mt-3 space-y-2">
        {(revision.workHistory || []).map((item: any, index: number) => (
          <ErpFieldView
            key={`${revision.id}-work-${index}`}
            label={`سابقه ${index + 1}: ${value(item.organization)}`}
            value={`${value(item.lastPosition)} · ${value(item.duration)} · آخرین حقوق و مزایا: ${rial(item.lastSalaryBenefits)}`}
          />
        ))}
      </div>
    </ErpCard>
  ))}</div>;
}

function AnswersGroup({ group }: { group: any }) {
  return <div className="space-y-3">{group.revisions.map((revision: any) => (
    <ErpCard key={revision.id} className="p-4">
      <RevisionHeader revision={revision} />
      <div className="grid gap-3 sm:grid-cols-2">
        <ErpFieldView label="نوع همکاری" value={value(revision.cooperationType)} />
        <ErpFieldView label="مدت همکاری" value={value(revision.cooperationDuration)} />
        <ErpFieldView label="سمت درخواستی" value={value(revision.requestedPosition)} />
        <ErpFieldView label="حقوق درخواستی" value={rial(revision.desiredSalary)} />
      </div>
      <div className="mt-3 space-y-2">
        {(revision.answers || []).map((answer: string, index: number) => (
          <ErpFieldView key={`${revision.id}-answer-${index}`} label={`پاسخ ${index + 1}`} value={value(answer)} />
        ))}
      </div>
    </ErpCard>
  ))}</div>;
}

function EvidenceGroup({ group }: { group: any }) {
  return (
    <div className="space-y-3">
      {(group.documents || []).map((document: any) => (
        <ErpCard key={document.id} className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <ErpFieldView label="عنوان" value={document.customTitle || hrDisplayLabel(document.category)} />
            <ErpFieldView label="نسخه" value={Number(document.version).toLocaleString("fa-IR")} />
            <ErpFieldView label="نوع شاهد" value={hrDisplayLabel(document.inspectionSource)} />
            <ErpFieldView label="فایل" value={value(document.originalName)} hint={document.inspectionSource === "ORIGINAL_SEEN" && !document.originalName ? "اصل مدرک مشاهده شده و الزاماً فایل ندارد." : undefined} />
            <ErpFieldView label="وضعیت" value={hrDisplayLabel(document.status)} />
            <ErpFieldView label="یادداشت" value={value(document.note)} />
          </div>
        </ErpCard>
      ))}
      {(group.assessments || []).map((assessment: any) => (
        <ErpCard key={assessment.id} className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <ErpFieldView label="ارزیابی" value={hrDisplayLabel(assessment.type)} />
            <ErpFieldView label="نسخه" value={Number(assessment.version || 1).toLocaleString("fa-IR")} />
            <ErpFieldView label="زمان ثبت" value={assessment.recordedAt ? dateTimeFa(assessment.recordedAt) : "—"} />
            <ErpFieldView label="فایل شاهد" value={value(assessment.originalName)} />
          </div>
        </ErpCard>
      ))}
      {(group.preIdentityEvidence || []).map((item: any) => (
        <ErpCard key={item.id} className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <ErpFieldView label="شاهد پیش از احراز هویت" value={item.title} />
            <ErpFieldView label="وضعیت" value={hrDisplayLabel(item.status)} />
            <ErpFieldView label="فایل شاهد" value={value(item.originalName)} />
            <ErpFieldView label="یادداشت نتیجه" value={value(item.resultNote)} />
          </div>
        </ErpCard>
      ))}
      {!group.documents?.length && !group.assessments?.length && !group.preIdentityEvidence?.length && (
        <ErpInlineState kind="empty" title="مدرک یا شاهدی در این پرونده ثبت نشده است." />
      )}
    </div>
  );
}

export default function ApplicantFullInformationPage() {
  const id = String(useParams().id);
  const searchParams = useSearchParams();
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");

  useEffect(() => {
    hiringAPI.getFullInformation(id)
      .then((response) => setData(response.data.data))
      .catch((cause) => setError(hiringError(cause)));
  }, [id]);

  if (!data && !error) return <ErpLoading />;
  const returnTo = searchParams.get("returnTo");
  const backHref = `/dashboard/hr/hiring/${id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;

  return (
    <ErpPage
      eyebrow="منابع انسانی · پرونده متقاضی"
      title="اطلاعات کامل متقاضی"
      description={data ? `${data.candidateName} · ${data.positionTitle}` : "نمایش مجوزمحور اطلاعات پرونده"}
      backHref={backHref}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      {data?.groups.map((group: any) => (
        <ErpSection key={group.key} title={groupLabels[group.key]}>
          {group.status === "RESTRICTED" ? (
            <ErpInlineState kind="permission" title="این گروه اطلاعات برای مجوز فعلی قابل مشاهده نیست." />
          ) : group.key === "PROFILE_IDENTITY" ? (
            <ProfileGroup group={group} />
          ) : group.key === "EXPERIENCE_QUALIFICATIONS" ? (
            <ExperienceGroup group={group} />
          ) : group.key === "APPLICATION_ANSWERS" ? (
            <AnswersGroup group={group} />
          ) : (
            <EvidenceGroup group={group} />
          )}
        </ErpSection>
      ))}
    </ErpPage>
  );
}
