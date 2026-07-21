"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FaCheck, FaFileUpload, FaSync } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpLoading,
  ErpPage,
  ErpSection,
} from "@/components/erp";
import { hiringAPI, hiringError } from "@/lib/hiringApi";

const field =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const identityFields = [
  "firstName",
  "lastName",
  "birthDate",
  "birthPlace",
  "fatherName",
  "nationalCode",
  "foreignIdentity",
  "militaryStatus",
  "address",
  "postalCode",
  "mobile",
  "educationLevel",
  "maritalStatus",
  "birthCertificateExplanations",
];
const documentCategories = [
  "BIRTH_CERTIFICATE_ALL_PAGES",
  "BIRTH_CERTIFICATE_EXPLANATIONS",
  "NATIONAL_ID_FRONT",
  "NATIONAL_ID_BACK",
  "MILITARY",
  "EDUCATION",
  "PHOTO",
  "OTHER",
];

export default function HiringCasePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [correction, setCorrection] = useState({ fields: "", reason: "" });
  const [document, setDocument] = useState<any>({
    category: "BIRTH_CERTIFICATE_ALL_PAGES",
    side: "",
    inspectionSource: "ORIGINAL_SEEN",
    file: null,
  });
  const [components, setComponents] = useState([
    { label: "حقوق پایه", category: "BASE_SALARY", amountRials: "" },
    { label: "مزایا", category: "FIXED_BENEFIT", amountRials: "" },
  ]);
  const [collateral, setCollateral] = useState<any>({
    itemId: "",
    type: "PROMISSORY_NOTE",
    amountRials: "",
    identifier: "",
    issuerOrGuarantor: "",
    custodyLocation: "",
    receivedAt: "",
    file: null,
  });
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [assessment, setAssessment] = useState<any>({
    assessmentType: "DISC",
    resultJson: "{}",
    file: null,
  });
  const [handover, setHandover] = useState({
    returnedTo: "",
    returnEvidenceNote: "",
    file: null as File | null,
  });
  const [collateralIssue, setCollateralIssue] = useState("");
  const [closure, setClosure] = useState({ outcome: "REJECTED", reason: "" });
  const [task, setTask] = useState({
    title: "",
    ownerAuthority: "HR_MANAGER",
    dueDate: "",
    activationBlocker: false,
    assignToHire: true,
  });
  const [conversion, setConversion] = useState({
    scheduledStartDate: "",
    insuranceDueDate: "",
  });
  const [contract, setContract] = useState<any>({
    contractNumber: "",
    effectiveFrom: "",
    effectiveTo: "",
    file: null,
  });
  const [insurance, setInsurance] = useState({
    status: "NOT_STARTED",
    effectiveDate: "",
    dueDate: "",
    note: "",
  });
  const [payrollDate, setPayrollDate] = useState("");
  const load = async () => {
    try {
      setError("");
      const result = await hiringAPI.get(id);
      setData(result.data.data);
      const currentCompensation = result.data.data.compensationSnapshots?.[0];
      if (Array.isArray(currentCompensation?.componentsJson))
        setComponents(currentCompensation.componentsJson);
      if (result.data.data.insuranceEnrollment)
        setInsurance({
          ...insurance,
          ...result.data.data.insuranceEnrollment,
          effectiveDate:
            result.data.data.insuranceEnrollment.effectiveDate?.slice(0, 10) ||
            "",
          dueDate:
            result.data.data.insuranceEnrollment.dueDate?.slice(0, 10) || "",
        });
    } catch (e) {
      setError(hiringError(e));
    }
  };
  useEffect(() => {
    void load();
    void hiringAPI
      .myAuthorities()
      .then((result) => setAuthorities(result.data.data))
      .catch(() => setAuthorities([]));
    void hiringAPI
      .collateralTemplates()
      .then((result) => {
        setTemplates(result.data.data);
        setTemplateId(result.data.data[0]?.id || "");
      })
      .catch(() => undefined);
    // `load` intentionally follows the route id; recreating it is harmless but would retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setBusy(true);
      setError("");
      await action();
      setMessage(success);
      await load();
    } catch (e) {
      setError(hiringError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <ErpLoading />;
  const form = data.formRevisions?.[0]?.dataJson || {};
  const compensation = data.compensationSnapshots?.[0];
  const latestContract = data.contracts?.[0];
  const hasAuthority = (...values: string[]) =>
    values.some((value) => authorities.includes(value));
  const canHrSensitive = hasAuthority("HR_PROCESSOR", "HR_MANAGER");
  const canFinance = hasAuthority("FINANCE_RECORDER", "FINANCE_MANAGER");
  const uploadDocument = () => {
    const fd = new FormData();
    fd.append("category", document.category);
    if (document.side) fd.append("side", document.side);
    fd.append("inspectionSource", document.inspectionSource);
    fd.append("file", document.file);
    return run(() => hiringAPI.uploadDocument(id, fd), "سند هویتی ثبت شد.");
  };
  const addCollateral = () => {
    const fd = new FormData();
    Object.entries(collateral).forEach(([key, value]) => {
      if (key !== "file" && value != null) fd.append(key, String(value));
    });
    if (collateral.file) fd.append("file", collateral.file);
    return run(() => hiringAPI.addCollateral(id, fd), "وثیقه ثبت شد.");
  };
  const returnCollateral = (itemId: string) => {
    const fd = new FormData();
    fd.append("returnedTo", handover.returnedTo);
    fd.append("returnEvidenceNote", handover.returnEvidenceNote);
    if (handover.file) fd.append("file", handover.file);
    return hiringAPI.returnCollateral(id, itemId, fd);
  };
  const uploadContract = () => {
    const fd = new FormData();
    Object.entries(contract).forEach(([key, value]) => {
      if (key !== "file" && value) fd.append(key, String(value));
    });
    fd.append("file", contract.file);
    return run(() => hiringAPI.uploadContract(id, fd), "قرارداد بارگذاری شد.");
  };
  const addAssessment = () => {
    const fd = new FormData();
    fd.append("assessmentType", assessment.assessmentType);
    fd.append("resultJson", assessment.resultJson);
    if (assessment.file) fd.append("file", assessment.file);
    return run(() => hiringAPI.addAssessment(id, fd), "نتیجه ارزیابی ثبت شد.");
  };
  const download = async (request: () => Promise<any>, fileName: string) => {
    try {
      const response = await request();
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(hiringError(e));
    }
  };
  return (
    <ErpPage
      eyebrow="منابع انسانی · پرونده استخدام"
      title={`${data.candidate.firstName} ${data.candidate.lastName}`}
      description={`${data.position.title} · ${data.candidate.mobile}`}
      backHref="/dashboard/hr/hiring"
      actions={[{ label: "به‌روزرسانی", icon: FaSync, onClick: load }]}
    >
      {error && (
        <p className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>
      )}
      {message && (
        <p className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
          {message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Metric label="مرحله" value={data.stage} />
        <Metric label="هویت" value={data.identityClearance} />
        <Metric label="جبران" value={data.compensationClearance} />
        <Metric label="وثیقه" value={data.collateralClearance} />
        <Metric label="قرارداد" value={data.contractClearance} />
        <Metric
          label="اشتغال"
          value={data.employmentRelationship?.status || "CANDIDATE"}
        />
      </div>
      {canHrSensitive && (
        <>
          <ErpSection
            title="فرم متقاضی و کنترل اطلاعات"
            description="HR پاسخ متقاضی را ویرایش نمی‌کند؛ فیلدهای دارای اشکال برای نسخه بعدی بازگردانده می‌شوند."
          >
            <ErpCard className="p-4">
              <div className="grid gap-2 md:grid-cols-3">
                {Object.entries(form)
                  .filter(
                    ([, value]) =>
                      !Array.isArray(value) && typeof value !== "object",
                  )
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800"
                    >
                      <span className="text-slate-500">{key}</span>
                      <p className="mt-1 font-bold">{String(value)}</p>
                    </div>
                  ))}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <input
                  className={field}
                  placeholder="فیلدها با کاما"
                  value={correction.fields}
                  onChange={(e) =>
                    setCorrection({ ...correction, fields: e.target.value })
                  }
                />
                <input
                  className={field}
                  placeholder="دلیل اصلاح"
                  value={correction.reason}
                  onChange={(e) =>
                    setCorrection({ ...correction, reason: e.target.value })
                  }
                />
                <ErpButton
                  label="بازگرداندن برای اصلاح"
                  disabled={busy || !correction.fields || !correction.reason}
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.returnForm(id, {
                          fields: correction.fields
                            .split(",")
                            .map((x) => x.trim()),
                          reason: correction.reason,
                        }),
                      "فرم برای اصلاح بازگردانده شد.",
                    )
                  }
                  tone="warning"
                />
              </div>
            </ErpCard>
          </ErpSection>
          <ErpSection title="اسناد و تطبیق هویت">
            <div className="grid gap-4 xl:grid-cols-2">
              <ErpCard className="p-4">
                <h3 className="font-black">اسکن HR</h3>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <select
                    className={field}
                    value={document.category}
                    onChange={(e) =>
                      setDocument({ ...document, category: e.target.value })
                    }
                  >
                    {documentCategories.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                  <select
                    className={field}
                    value={document.inspectionSource}
                    onChange={(e) =>
                      setDocument({
                        ...document,
                        inspectionSource: e.target.value,
                      })
                    }
                  >
                    <option value="ORIGINAL_SEEN">اصل مشاهده شد</option>
                    <option value="COPY_RECEIVED">کپی دریافت شد</option>
                  </select>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className={field}
                    onChange={(e) =>
                      setDocument({ ...document, file: e.target.files?.[0] })
                    }
                  />
                  <ErpButton
                    label="بارگذاری سند"
                    icon={FaFileUpload}
                    disabled={busy || !document.file}
                    onClick={uploadDocument}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {data.documents.map((doc: any) => (
                    <div
                      key={doc.id}
                      className="flex justify-between rounded-lg border p-2 text-xs"
                    >
                      <span>
                        {doc.category} · نسخه {doc.version}
                      </span>
                      <span className="flex gap-2">
                        <button
                          onClick={() =>
                            download(
                              () => hiringAPI.downloadDocument(id, doc.id),
                              doc.originalName,
                            )
                          }
                          className="text-sky-700"
                        >
                          دریافت
                        </button>
                        <ErpBadge>{doc.status}</ErpBadge>
                      </span>
                    </div>
                  ))}
                </div>
              </ErpCard>
              <ErpCard className="p-4">
                <h3 className="font-black">کنترل فیلد به فیلد</h3>
                <div className="mt-3 space-y-2">
                  {identityFields.map((key) => {
                    const check = data.identityChecks.find(
                      (x: any) => x.fieldKey === key,
                    );
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between rounded-lg border p-2 text-sm"
                      >
                        <span>{key}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() =>
                              run(
                                () =>
                                  hiringAPI.setIdentityCheck(id, key, {
                                    status: "VERIFIED",
                                  }),
                                `${key} تأیید شد.`,
                              )
                            }
                            className="rounded bg-emerald-100 px-2 py-1"
                          >
                            مطابق
                          </button>
                          <button
                            onClick={() =>
                              run(
                                () =>
                                  hiringAPI.setIdentityCheck(id, key, {
                                    status: "MISMATCH",
                                    note: "نیازمند اصلاح متقاضی",
                                  }),
                                `${key} مغایر ثبت شد.`,
                              )
                            }
                            className="rounded bg-rose-100 px-2 py-1"
                          >
                            مغایرت
                          </button>
                          {[
                            "militaryStatus",
                            "birthCertificateExplanations",
                          ].includes(key) && (
                            <button
                              onClick={() =>
                                run(
                                  () =>
                                    hiringAPI.setIdentityCheck(id, key, {
                                      status: "NOT_APPLICABLE",
                                    }),
                                  `${key} غیرقابل اعمال ثبت شد.`,
                                )
                              }
                              className="rounded bg-slate-100 px-2 py-1"
                            >
                              ندارد/نامرتبط
                            </button>
                          )}
                          <small>{check?.status}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <ErpButton
                  className="mt-3"
                  label="تأیید نهایی مدیر HR"
                  icon={FaCheck}
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => hiringAPI.approveIdentity(id),
                      "هویت توسط مدیر HR تأیید شد.",
                    )
                  }
                  tone="success"
                />
              </ErpCard>
            </div>
          </ErpSection>
          <ErpSection title="ارزیابی‌های DISC / BIG FIVE / EQ">
            <ErpCard className="p-4">
              <div className="grid gap-2 md:grid-cols-4">
                <select
                  className={field}
                  value={assessment.assessmentType}
                  onChange={(e) =>
                    setAssessment({
                      ...assessment,
                      assessmentType: e.target.value,
                    })
                  }
                >
                  <option value="DISC">DISC</option>
                  <option value="BIG_FIVE">BIG FIVE</option>
                  <option value="EQ">EQ</option>
                  <option value="OTHER">سایر</option>
                </select>
                <textarea
                  className={field}
                  value={assessment.resultJson}
                  onChange={(e) =>
                    setAssessment({ ...assessment, resultJson: e.target.value })
                  }
                  placeholder='نتیجه JSON مانند {"score": 80}'
                />
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className={field}
                  onChange={(e) =>
                    setAssessment({ ...assessment, file: e.target.files?.[0] })
                  }
                />
                <ErpButton
                  label="ثبت ارزیابی"
                  onClick={addAssessment}
                  disabled={busy || !assessment.resultJson}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(data.assessments || []).map((item: any) => (
                  <span key={item.id} className="flex items-center gap-2">
                    <ErpBadge>{item.assessmentType}</ErpBadge>
                    {item.originalName && (
                      <button
                        onClick={() =>
                          download(
                            () => hiringAPI.downloadAssessment(id, item.id),
                            item.originalName,
                          )
                        }
                        className="text-xs text-sky-700"
                      >
                        دریافت فایل
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </ErpCard>
          </ErpSection>
        </>
      )}
      {hasAuthority(
        "HIRING_MANAGER",
        "HR_PAYROLL_PROCESSOR",
        "HR_PAYROLL_MANAGER",
        "FINANCE_MANAGER",
        "HR_MANAGER",
      ) && (
        <>
          <ErpSection title="پیشنهاد حقوق و مزایا">
            <ErpCard className="p-4">
              <div className="space-y-2">
                {components.map((item, i) => (
                  <div key={i} className="grid gap-2 md:grid-cols-3">
                    <input
                      className={field}
                      value={item.label}
                      onChange={(e) =>
                        setComponents(
                          components.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <select
                      className={field}
                      value={item.category || ""}
                      onChange={(e) =>
                        setComponents(
                          components.map((x, j) =>
                            j === i ? { ...x, category: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">طبقه‌بندی Payroll</option>
                      <option value="BASE_SALARY">حقوق پایه</option>
                      <option value="FIXED_BENEFIT">مزایای ثابت</option>
                      <option value="VARIABLE_BENEFIT">مزایای متغیر</option>
                      <option value="ALLOWANCE">کمک‌هزینه</option>
                      <option value="OTHER">سایر</option>
                    </select>
                    <input
                      className={field}
                      inputMode="numeric"
                      placeholder="مبلغ ریال"
                      value={item.amountRials}
                      onChange={(e) =>
                        setComponents(
                          components.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  amountRials: e.target.value.replace(
                                    /\D/g,
                                    "",
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border px-3 py-2 text-sm"
                  onClick={() =>
                    setComponents([
                      ...components,
                      { label: "", category: "", amountRials: "" },
                    ])
                  }
                >
                  افزودن ردیف
                </button>
                <ErpButton
                  label="پیشنهاد Hiring Manager"
                  onClick={() =>
                    run(
                      () => hiringAPI.createCompensation(id, { components }),
                      "پیشنهاد ثبت شد.",
                    )
                  }
                  disabled={busy}
                />
                <ErpButton
                  label="آماده‌سازی HR/Payroll"
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.prepareCompensation(id, compensation.id, {
                          components,
                        }),
                      "نسخه توسط Payroll آماده شد.",
                    )
                  }
                  disabled={busy || !compensation}
                />
                <ErpButton
                  label="تأیید مدیر HR/Payroll"
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.approveCompensationHr(id, compensation.id),
                      "تأیید HR انجام شد.",
                    )
                  }
                  disabled={busy || !compensation}
                  tone="success"
                />
                <ErpButton
                  label="تأیید مدیر مالی"
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.approveCompensationFinance(
                          id,
                          compensation.id,
                        ),
                      "تأیید مالی انجام شد.",
                    )
                  }
                  disabled={busy || !compensation}
                  tone="success"
                />
              </div>
              {compensation && (
                <p className="mt-3 font-black">
                  جمع: {Number(compensation.totalRials).toLocaleString("fa-IR")}{" "}
                  ریال · آماده‌سازی Payroll:{" "}
                  {compensation.preparedBy ? "بله" : "خیر"} · پذیرش متقاضی:{" "}
                  {compensation.candidateAcceptedAt ? "بله" : "خیر"}
                </p>
              )}
            </ErpCard>
          </ErpSection>
        </>
      )}
      {canFinance && (
        <>
          <ErpSection title="وثیقه و تعهدات امور مالی">
            <ErpCard className="mb-4 grid gap-2 p-4 md:grid-cols-3">
              <select
                className={field}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">انتخاب قالب چک‌لیست</option>
                {templates
                  .filter((item) => item.isActive)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · نسخه {item.version}
                    </option>
                  ))}
              </select>
              <ErpButton
                label="اعمال قالب پس از پذیرش پیشنهاد"
                disabled={
                  !templateId || busy || data.collateralItems.length > 0
                }
                onClick={() =>
                  run(
                    () => hiringAPI.applyCollateralTemplate(id, templateId),
                    "چک‌لیست وثیقه ایجاد شد.",
                  )
                }
              />
            </ErpCard>
            <div className="grid gap-4 xl:grid-cols-2">
              <ErpCard className="grid gap-2 p-4 md:grid-cols-2">
                <select
                  className={field}
                  value={collateral.type}
                  onChange={(e) =>
                    setCollateral({ ...collateral, type: e.target.value })
                  }
                >
                  <option value="PROMISSORY_NOTE">سفته</option>
                  <option value="CHEQUE">چک</option>
                  <option value="GUARANTEE">ضمانت‌نامه</option>
                  <option value="UNDERTAKING">تعهدنامه</option>
                  <option value="OTHER">سایر</option>
                </select>
                <input
                  className={field}
                  placeholder="مبلغ ریال"
                  value={collateral.amountRials}
                  onChange={(e) =>
                    setCollateral({
                      ...collateral,
                      amountRials: e.target.value.replace(/\D/g, ""),
                    })
                  }
                />
                <input
                  className={field}
                  placeholder="شناسه/سریال"
                  value={collateral.identifier}
                  onChange={(e) =>
                    setCollateral({ ...collateral, identifier: e.target.value })
                  }
                />
                <input
                  className={field}
                  placeholder="صادرکننده/ضامن"
                  value={collateral.issuerOrGuarantor}
                  onChange={(e) =>
                    setCollateral({
                      ...collateral,
                      issuerOrGuarantor: e.target.value,
                    })
                  }
                />
                <input
                  className={field}
                  placeholder="محل نگهداری اصل"
                  value={collateral.custodyLocation}
                  onChange={(e) =>
                    setCollateral({
                      ...collateral,
                      custodyLocation: e.target.value,
                    })
                  }
                />
                <input
                  type="date"
                  className={field}
                  value={collateral.receivedAt}
                  onChange={(e) =>
                    setCollateral({ ...collateral, receivedAt: e.target.value })
                  }
                />
                <input
                  type="file"
                  className={field}
                  onChange={(e) =>
                    setCollateral({ ...collateral, file: e.target.files?.[0] })
                  }
                />
                <ErpButton
                  label="ثبت توسط امور مالی"
                  onClick={addCollateral}
                  disabled={
                    busy ||
                    !collateral.type ||
                    !collateral.file ||
                    !collateral.receivedAt ||
                    !collateral.custodyLocation
                  }
                />
              </ErpCard>
              <ErpCard className="p-4">
                <div className="mb-3 grid gap-2 md:grid-cols-4">
                  <input
                    className={field}
                    placeholder="دلیل هماهنگی قلم ناقص/ردشده"
                    value={collateralIssue}
                    onChange={(e) => setCollateralIssue(e.target.value)}
                  />
                  <input
                    className={field}
                    placeholder="تحویل‌گیرنده اصل وثیقه"
                    value={handover.returnedTo}
                    onChange={(e) =>
                      setHandover({ ...handover, returnedTo: e.target.value })
                    }
                  />
                  <input
                    className={field}
                    placeholder="مدرک/شرح تحویل"
                    value={handover.returnEvidenceNote}
                    onChange={(e) =>
                      setHandover({
                        ...handover,
                        returnEvidenceNote: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  {data.collateralItems.map((item: any) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex justify-between">
                        <b>{item.type}</b>
                        <ErpBadge>{item.status}</ErpBadge>
                      </div>
                      <p className="text-xs">
                        {item.identifier} · {item.custodyLocation}
                      </p>
                      {item.originalName && (
                        <button
                          className="mt-2 rounded bg-slate-100 px-2 py-1 text-xs"
                          onClick={() =>
                            download(
                              () => hiringAPI.downloadCollateral(id, item.id),
                              item.originalName,
                            )
                          }
                        >
                          دریافت اسکن
                        </button>
                      )}
                      {["MISSING", "MISMATCH", "UNREADABLE"].includes(
                        item.status,
                      ) && (
                        <button
                          className="mt-2 rounded bg-sky-100 px-2 py-1 text-xs"
                          onClick={() =>
                            setCollateral({
                              ...collateral,
                              itemId: item.id,
                              type: item.type,
                              amountRials: item.amountRials || "",
                            })
                          }
                        >
                          {item.status === "MISSING"
                            ? "ثبت دریافت این قلم"
                            : "ثبت نسخه جایگزین"}
                        </button>
                      )}
                      <button
                        className="mt-2 rounded bg-emerald-100 px-2 py-1 text-xs"
                        onClick={() =>
                          run(
                            () =>
                              hiringAPI.reviewCollateral(id, item.id, {
                                status: "VERIFIED",
                              }),
                            "قلم وثیقه تأیید شد.",
                          )
                        }
                      >
                        تأیید مدیر مالی
                      </button>
                      <button
                        className="mr-2 mt-2 rounded bg-rose-100 px-2 py-1 text-xs"
                        disabled={!collateralIssue}
                        onClick={() =>
                          run(
                            () =>
                              hiringAPI.reviewCollateral(id, item.id, {
                                status: "MISMATCH",
                                coordinationReason: collateralIssue,
                              }),
                            "قلم برای پیگیری رد شد.",
                          )
                        }
                      >
                        نیازمند پیگیری
                      </button>
                      {item.receivedAt && !item.returnedAt && (
                        <button
                          className="mr-2 mt-2 rounded bg-amber-100 px-2 py-1 text-xs"
                          disabled={
                            !handover.returnedTo ||
                            !handover.returnEvidenceNote ||
                            !handover.file
                          }
                          onClick={() =>
                            run(
                              () => returnCollateral(item.id),
                              "بازگشت وثیقه ثبت شد.",
                            )
                          }
                        >
                          ثبت تحویل اصل
                        </button>
                      )}
                      {item.returnedAt && !item.returnConfirmedAt && (
                        <button
                          className="mr-2 mt-2 rounded bg-violet-100 px-2 py-1 text-xs"
                          onClick={() =>
                            run(
                              () =>
                                hiringAPI.confirmCollateralReturn(id, item.id),
                              "بازگشت توسط مدیر مالی تأیید شد.",
                            )
                          }
                        >
                          تأیید مدیر مالی بازگشت
                        </button>
                      )}
                      {item.returnEvidenceOriginalName && (
                        <button
                          className="mr-2 mt-2 rounded bg-slate-100 px-2 py-1 text-xs"
                          onClick={() =>
                            download(
                              () =>
                                hiringAPI.downloadCollateralReturnEvidence(
                                  id,
                                  item.id,
                                ),
                              item.returnEvidenceOriginalName,
                            )
                          }
                        >
                          دریافت مدرک تحویل
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <ErpButton
                  className="mt-3"
                  label="تأیید نهایی وثیقه"
                  onClick={() =>
                    run(
                      () => hiringAPI.approveCollateral(id),
                      "وثیقه نهایی تأیید شد.",
                    )
                  }
                  tone="success"
                />
              </ErpCard>
            </div>
          </ErpSection>
        </>
      )}
      {hasAuthority("HR_MANAGER") && (
        <>
          <ErpSection title="تبدیل به پرسنل برنامه‌ریزی‌شده">
            <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
              <input
                type="date"
                className={field}
                value={conversion.scheduledStartDate}
                onChange={(e) =>
                  setConversion({
                    ...conversion,
                    scheduledStartDate: e.target.value,
                  })
                }
              />
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className={field}
                onChange={(e) =>
                  setHandover({
                    ...handover,
                    file: e.target.files?.[0] || null,
                  })
                }
              />
              <input
                type="date"
                className={field}
                value={conversion.insuranceDueDate}
                onChange={(e) =>
                  setConversion({
                    ...conversion,
                    insuranceDueDate: e.target.value,
                  })
                }
              />
              <ErpButton
                label="تبدیل Candidate به Personnel"
                disabled={
                  busy || !conversion.scheduledStartDate || !!data.convertedAt
                }
                onClick={() =>
                  run(
                    () => hiringAPI.convert(id, conversion),
                    "پرسنل و رابطه استخدامی برنامه‌ریزی‌شده ساخته شد.",
                  )
                }
                tone="success"
              />
            </ErpCard>
          </ErpSection>
        </>
      )}
      <ErpSection
        title="وظایف موقت پیش از فعال‌سازی"
        description="وظیفه به Personnel برنامه‌ریزی‌شده متصل می‌شود و هیچ User یا شناسه ورود ایجاد نمی‌کند."
      >
        <ErpCard className="grid gap-2 p-4 md:grid-cols-4">
          <input
            className={field}
            placeholder="عنوان وظیفه"
            value={task.title}
            onChange={(e) => setTask({ ...task, title: e.target.value })}
          />
          <select
            className={field}
            value={task.ownerAuthority}
            onChange={(e) =>
              setTask({ ...task, ownerAuthority: e.target.value })
            }
          >
            <option value="HR_MANAGER">مدیر HR</option>
            <option value="HIRING_MANAGER">مدیر استخدام‌کننده</option>
            <option value="HR_PROCESSOR">کارشناس HR</option>
            <option value="FINANCE_MANAGER">مدیر مالی</option>
          </select>
          <input
            type="date"
            className={field}
            value={task.dueDate}
            onChange={(e) => setTask({ ...task, dueDate: e.target.value })}
          />
          <ErpButton
            label="واگذاری وظیفه"
            disabled={!task.title || !data.convertedAt}
            onClick={() =>
              run(
                () => hiringAPI.addOnboardingTask(id, task),
                "وظیفه به پرسنل برنامه‌ریزی‌شده واگذار شد.",
              )
            }
          />
        </ErpCard>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {(data.onboardingTasks || []).map((item: any) => (
            <ErpCard
              key={item.id}
              className="flex items-center justify-between p-3"
            >
              <span>
                <b>{item.title}</b>
                <small className="block text-slate-500">
                  {item.ownerAuthority} · {item.status}
                </small>
              </span>
              {item.status !== "COMPLETE" && (
                <button
                  className="rounded bg-emerald-100 px-2 py-1 text-xs"
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.updateOnboardingTask(id, item.id, {
                          status: "COMPLETE",
                          evidenceNote: "تکمیل و مشاهده شد",
                        }),
                      "وظیفه تکمیل شد.",
                    )
                  }
                >
                  تکمیل
                </button>
              )}
            </ErpCard>
          ))}
        </div>
      </ErpSection>
      {(canFinance || canHrSensitive) && (
        <>
          <ErpSection title="قرارداد کاغذی">
            <div className="grid gap-3 md:grid-cols-4">
              <input
                className={field}
                placeholder="شماره قرارداد"
                value={contract.contractNumber}
                onChange={(e) =>
                  setContract({ ...contract, contractNumber: e.target.value })
                }
              />
              <input
                type="date"
                className={field}
                value={contract.effectiveFrom}
                onChange={(e) =>
                  setContract({ ...contract, effectiveFrom: e.target.value })
                }
              />
              <input
                type="date"
                className={field}
                value={contract.effectiveTo}
                onChange={(e) =>
                  setContract({ ...contract, effectiveTo: e.target.value })
                }
              />
              <input
                type="file"
                className={field}
                onChange={(e) =>
                  setContract({ ...contract, file: e.target.files?.[0] })
                }
              />
              <ErpButton
                label="بارگذاری توسط امور مالی"
                disabled={busy || !contract.file || !contract.contractNumber}
                onClick={uploadContract}
              />
              <ErpButton
                label="تأیید مدیر مالی"
                disabled={busy || !latestContract}
                onClick={() =>
                  run(
                    () => hiringAPI.approveContract(id, latestContract.id),
                    "قرارداد تأیید شد.",
                  )
                }
                tone="success"
              />
              {latestContract?.originalName && (
                <button
                  className="rounded-lg border px-3 py-2 text-sm"
                  onClick={() =>
                    download(
                      () => hiringAPI.downloadContract(id, latestContract.id),
                      latestContract.originalName,
                    )
                  }
                >
                  دریافت قرارداد
                </button>
              )}
            </div>
          </ErpSection>
        </>
      )}
      {hasAuthority("HR_PROCESSOR", "HR_MANAGER", "HR_PAYROLL_MANAGER") && (
        <>
          <ErpSection title="بیمه، حقوق و فعال‌سازی">
            <div className="grid gap-3 xl:grid-cols-3">
              <ErpCard className="space-y-2 p-4">
                <select
                  className={field}
                  value={insurance.status}
                  onChange={(e) =>
                    setInsurance({ ...insurance, status: e.target.value })
                  }
                >
                  <option value="NOT_STARTED">شروع نشده</option>
                  <option value="IN_PROGRESS">در حال پیگیری</option>
                  <option value="ACTIVE">فعال</option>
                  <option value="EXEMPT">معاف/غیرقابل اعمال</option>
                </select>
                <input
                  type="date"
                  className={field}
                  value={insurance.effectiveDate}
                  onChange={(e) =>
                    setInsurance({
                      ...insurance,
                      effectiveDate: e.target.value,
                    })
                  }
                />
                <input
                  type="date"
                  className={field}
                  value={insurance.dueDate}
                  onChange={(e) =>
                    setInsurance({ ...insurance, dueDate: e.target.value })
                  }
                />
                <textarea
                  className={field}
                  placeholder="یادداشت"
                  value={insurance.note}
                  onChange={(e) =>
                    setInsurance({ ...insurance, note: e.target.value })
                  }
                />
                <ErpButton
                  label="ذخیره وضعیت بیمه"
                  onClick={() =>
                    run(
                      () => hiringAPI.setInsurance(id, insurance),
                      "بیمه به‌روزرسانی شد.",
                    )
                  }
                />
              </ErpCard>
              <ErpCard className="space-y-2 p-4">
                <p className="font-bold">مشارکت حقوق و دستمزد</p>
                <input
                  type="date"
                  className={field}
                  value={payrollDate}
                  onChange={(e) => setPayrollDate(e.target.value)}
                />
                <ErpButton
                  label="تنظیم Payroll Participation"
                  disabled={!payrollDate}
                  onClick={() =>
                    run(
                      () =>
                        hiringAPI.setPayroll(id, {
                          effectiveFrom: payrollDate,
                        }),
                      "مشارکت حقوق تنظیم شد.",
                    )
                  }
                />
              </ErpCard>
              <ErpCard className="p-4">
                <p className="text-sm">
                  فعال‌سازی فقط پس از رسیدن تاریخ شروع و تکمیل همه مسدودکننده‌ها
                  ممکن است.
                </p>
                <ErpButton
                  className="mt-4"
                  label="تأیید و فعال‌سازی مدیر HR"
                  onClick={() =>
                    run(() => hiringAPI.activate(id), "استخدام فعال شد.")
                  }
                  tone="success"
                />
              </ErpCard>
            </div>
          </ErpSection>
        </>
      )}
      {hasAuthority("HR_MANAGER") && (
        <>
          <ErpSection
            title="بستن یا لغو پرونده"
            description="اطلاعات عادی در بانک متقاضیان قابل جست‌وجو می‌ماند؛ داده‌ها و اسناد حساس فقط تحت دسترسی محدود نگهداری می‌شوند."
          >
            <ErpCard className="grid gap-3 p-4 md:grid-cols-3">
              <select
                className={field}
                value={closure.outcome}
                onChange={(e) =>
                  setClosure({ ...closure, outcome: e.target.value })
                }
              >
                <option value="REJECTED">رد شده</option>
                <option value="WITHDRAWN">انصراف متقاضی</option>
                <option value="REQUEST_CANCELLED">لغو درخواست</option>
              </select>
              <input
                className={field}
                placeholder="دلیل الزامی"
                value={closure.reason}
                onChange={(e) =>
                  setClosure({ ...closure, reason: e.target.value })
                }
              />
              <ErpButton
                label="بستن پرونده توسط مدیر HR"
                tone="danger"
                disabled={busy || !closure.reason || data.outcome === "HIRED"}
                onClick={() =>
                  run(() => hiringAPI.close(id, closure), "پرونده بسته شد.")
                }
              />
            </ErpCard>
          </ErpSection>
        </>
      )}
    </ErpPage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <ErpCard className="p-3 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <b className="mt-1 block text-xs">{value}</b>
    </ErpCard>
  );
}
