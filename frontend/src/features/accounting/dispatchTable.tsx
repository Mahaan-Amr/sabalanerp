import { ErpBadge, type ErpColumn, type ErpFilter, type ErpTone } from "@/components/erp";
import { dispatchCaseReference, dispatchDriverName } from "@/features/dispatch-case/dispatchCasePresentation";
import { operationalStatusLabel } from "@/features/dispatch/operationalStatusPresentation";
import { normalizeDigits } from "@/lib/numberFormat";
import { SepidarInvoiceNumbers, sepidarInvoiceLabel, sepidarInvoicesOf, type SepidarInvoiceOwner } from "./SepidarDispatchInvoices";

export type DispatchTableCandidate = SepidarInvoiceOwner & {
  queueTurnId?: string;
  revisionNumber?: number;
  loadingStatus?: string;
  status: string;
  summary?: {
    loadingNumber?: string | null;
    driverName?: string | null;
    plate?: string | null;
    customerName?: string | null;
    projectName?: string | null;
    projectAddress?: string | null;
    personalPickup?: { contracts: { number: string }[]; partners: { name: string }[] };
  };
  contractNumbers?: string[];
  partnerCaseNumber?: string | null;
  lines?: { contractNumber?: string | null }[];
  waybills?: { id: string; number: string; status: string }[];
  currentSalesInvoice?: { number: string } | null;
};
export type DispatchTableRow = {
  id: string;
  owner: DispatchTableCandidate;
  members: DispatchTableCandidate[];
  statuses: string[];
};

export const candidateDispatchTableRow = (candidate: DispatchTableCandidate): DispatchTableRow => ({
  id: candidate.id, owner: candidate, members: [candidate],
  statuses: [candidate.loadingStatus === "CANCELLED" ? "CANCELLED" : candidate.status],
});

const statusLabels: Record<string, string> = {
  PENDING: "در انتظار بررسی",
  ACCEPTED: "پذیرفته‌شده",
  REJECTED: "برای اصلاح بازگردانده‌شده",
  RETURNED: "برای اصلاح بازگردانده‌شده",
  CANCELLED: "بارگیری لغوشده",
};
export const candidateStatusLabel = (status: string) => statusLabels[status] || operationalStatusLabel(status);
const statusTone = (status: string): ErpTone => ["ACCEPTED", "EXIT_RECORDED"].includes(status) ? "success"
  : ["REJECTED", "RETURNED", "CANCELLED", "EVIDENCE_CONFLICT"].includes(status) ? "danger" : "warning";
const unique = (values: (string | null | undefined)[]) => Array.from(new Set(values.filter((value): value is string => Boolean(value))));
const isCurrentWaybill = (status: string) => status === "ISSUED" || status === "EXIT_RECORDED";
const loadingReference = ({ owner }: DispatchTableRow) => dispatchCaseReference(owner.summary?.loadingNumber);
const waybillsOf = ({ members }: DispatchTableRow) => members.flatMap(member => {
  const current = member.waybills?.find(waybill => isCurrentWaybill(waybill.status));
  const latest = current ?? member.waybills?.at(-1);
  return latest ? [latest] : [];
});
export const contractsOf = (members: DispatchTableCandidate[]) => unique(members.flatMap(candidate => [
  ...(candidate.contractNumbers ?? []), ...(candidate.lines ?? []).map(line => line.contractNumber),
  ...(candidate.summary?.personalPickup?.contracts ?? []).map(contract => contract.number),
]));

export function currentLoadingCandidates<T extends DispatchTableCandidate>(candidates: T[]) {
  const latest = new Map<string, T>();
  for (const candidate of candidates) {
    const key = candidate.queueTurnId ?? candidate.id;
    if (!latest.has(key) || (candidate.revisionNumber ?? 0) > (latest.get(key)?.revisionNumber ?? 0)) latest.set(key, candidate);
  }
  return Array.from(latest.values());
}

export function dispatchTableColumns(showHistoricalWaybills: boolean): ErpColumn<DispatchTableRow>[] {
  const shownWaybills = (row: DispatchTableRow) => waybillsOf(row).filter(waybill => showHistoricalWaybills || isCurrentWaybill(waybill.status));
  return [
    { id: "loading", header: "بارگیری", priority: "primary",
      sortValue: row => row.owner.summary?.loadingNumber,
      cell: row => loadingReference(row) },
    { id: "sepidar", header: sepidarInvoiceLabel,
      sortValue: row => sepidarInvoicesOf(row.owner).map(invoice => invoice.number).join("، "),
      cell: row => <SepidarInvoiceNumbers invoices={sepidarInvoicesOf(row.owner)} showAmounts={showHistoricalWaybills} /> },
    { id: "driver", header: "راننده و پلاک",
      sortValue: row => row.members.map(candidate => candidate.summary?.driverName).filter(Boolean).join("، "),
      cell: row => <ul className="space-y-2">{row.members.map(candidate => <li key={candidate.id}>
        <strong>{dispatchDriverName(candidate.summary?.driverName ?? undefined)}</strong>
        <div className="sds-text-secondary">{candidate.summary?.plate || "—"}</div>
      </li>)}</ul> },
    { id: "customer", header: "مشتری و پروژه",
      sortValue: row => unique(row.members.flatMap(candidate => [candidate.summary?.customerName, candidate.summary?.projectName])).join("، "),
      cell: row => <>
        <div>{unique(row.members.map(candidate => candidate.summary?.customerName)).join("، ") || "—"}</div>
        <div className="sds-text-secondary">{unique(row.members.map(candidate => candidate.summary?.projectName)).join("، ") || "—"}</div>
        {contractsOf(row.members).length > 0 && <div className="text-xs sds-text-secondary">قرارداد {contractsOf(row.members).join("، ")}</div>}
        {unique(row.members.flatMap(candidate => candidate.summary?.personalPickup?.partners.map(partner => partner.name) ?? [])).map(name =>
          <div key={name} className="text-xs sds-text-secondary">{name}</div>)}
      </> },
    { id: "status", header: "وضعیت", sortValue: row => row.statuses.map(candidateStatusLabel).join("، "),
      cell: row => <div className="flex flex-wrap gap-1">{row.statuses.map(status =>
        <ErpBadge key={status} tone={statusTone(status)}><span className="whitespace-nowrap">{candidateStatusLabel(status)}</span></ErpBadge>)}</div> },
    showHistoricalWaybills ? { id: "waybill", header: "بارنامه", sortValue: row => shownWaybills(row).map(waybill => waybill.number).join("، "),
      cell: row => shownWaybills(row).length ? <ul className="space-y-1">{shownWaybills(row).map(waybill =>
        <li key={waybill.id}><bdi>{waybill.number.replace(/[0-9]/g, digit => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])}</bdi>
          {waybill.status === "VOIDED" && <span className="ms-1 text-xs sds-text-secondary">باطل‌شده</span>}</li>)}</ul> : "—" }
      : { id: "sales-invoice", header: "شماره فاکتور فروش", sortValue: row => row.owner.currentSalesInvoice?.number,
          cell: row => <bdi>{row.owner.currentSalesInvoice?.number.replace(/[0-9]/g, digit => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]) ?? "—"}</bdi> },
  ];
}

const searchText = (value: unknown) => normalizeDigits(String(value ?? "")).toLowerCase()
  .replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u200f\u200e]/g, " ").replace(/\s+/g, " ").trim();
const invoiceState = (row: DispatchTableRow) => {
  const invoices = sepidarInvoicesOf(row.owner);
  if (!invoices.length) return "missing";
  return invoices.some(invoice => invoice.amountRial === null) ? "legacy" : "registered";
};

export function matchDispatchTableRow(row: DispatchTableRow, query: string, status: string, sepidar: string) {
  if (status && !row.statuses.some(value => filterStatus(value) === status)) return false;
  if (sepidar && invoiceState(row) !== sepidar) return false;
  const tokens = searchText(query).split(/[\s،,]+/).filter(Boolean);
  if (!tokens.length) return true;
  const values = [
    loadingReference(row), row.owner.currentSalesInvoice?.number, ...sepidarInvoicesOf(row.owner).map(invoice => invoice.number),
    ...row.statuses.map(candidateStatusLabel), ...contractsOf(row.members),
    ...row.members.flatMap(({ summary, waybills, partnerCaseNumber }) => [partnerCaseNumber, summary?.loadingNumber, summary?.driverName, summary?.plate,
      summary?.customerName, summary?.projectName, summary?.projectAddress,
      ...(summary?.personalPickup?.partners ?? []).map(partner => partner.name), ...(waybills ?? []).map(waybill => waybill.number)]),
  ].map(searchText);
  return tokens.every(token => values.some(value => value.includes(token)));
}

type FilterControl = Pick<ErpFilter, "id" | "label" | "value" | "onChange">;
const filterStatus = (status: string) => status === "RETURNED" ? "REJECTED" : status;
const dispatchStatuses = ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN", "STALE_REQUIRES_SUCCESSOR", "EVIDENCE_CONFLICT", "CANCELLED"];

export function dispatchTableFilters(rows: DispatchTableRow[], search: ErpFilter, status: FilterControl, invoice: FilterControl): ErpFilter[] {
  return [search, { ...status, type: "select", options: [
    { value: "", label: "همه وضعیت‌ها" },
    ...unique([...dispatchStatuses, ...rows.flatMap(row => row.statuses.map(filterStatus))])
      .map(value => ({ value, label: candidateStatusLabel(value) })),
  ] }, { ...invoice, type: "select", options: [
    { value: "", label: "همه فاکتورها" },
    { value: "registered", label: "ثبت‌شده" },
    { value: "legacy", label: "شمارهٔ قدیمی بدون مبلغ" },
    { value: "missing", label: "بدون فاکتور" },
  ] }];
}
