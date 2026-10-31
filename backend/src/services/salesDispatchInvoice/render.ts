import { Prisma } from "@prisma/client";
import { renderContractHtml, renderContractPdfHeaderTemplate } from "../../utils/printTemplate";
import type { InvoiceSource } from "./source";
import { pricingCurrencyKind } from '../approvedPricing/domain';
const ExactDecimal = Prisma.Decimal.clone({ precision: 100 });
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const digits = (v: string) => v.replace(/\d/g, (n) => "۰۱۲۳۴۵۶۷۸۹"[Number(n)]);
export const invoiceNumber = (v: string) =>
  digits(v.replace(/\B(?=(\d{3})+(?!\d))/g, "٬"));
const units: Record<string, string> = {
  meter: "متر طول",
  m: "متر طول",
  squareMeter: "مترمربع",
  squareMeters: "مترمربع",
  m2: "مترمربع",
  count: "عدد",
  piece: "عدد",
  ton: "تن",
};
export type IssuedInvoiceSnapshot = InvoiceSource & {
  number: string;
  issuedAt: string;
  replacesNumber: string | null;
};
/** Same typography, sections, grids, tables and money currency as Accounting print. */
export function renderSalesInvoice(
  snapshot: IssuedInvoiceSnapshot,
  voidReason?: string,
) {
  const base = renderContractHtml(
    { id: "invoice", contractNumber: snapshot.number, items: [] } as any,
    { variant: "accounting" },
  );
  const styles = base.slice(base.indexOf("<style>"));
  const currencyCode = snapshot.currency.trim().toUpperCase();
  const currencyKind = currencyCode === 'IRT' ? 'TOMAN' : currencyCode === 'IRR' ? 'RIAL' : pricingCurrencyKind(snapshot.currency);
  const money = (v: string) =>
    invoiceNumber(
      new ExactDecimal(v)
        .mul(currencyKind === 'TOMAN' ? 10 : 1)
        .toFixed(0),
    ) + " ریال";
  const date = new Date(snapshot.issuedAt).toLocaleDateString("fa-IR", {
    timeZone: "Asia/Tehran",
  });
  const firstPageHeader = renderContractPdfHeaderTemplate({ contractNumber: snapshot.number,
    createdAt: snapshot.issuedAt, status: 'APPROVED' }, undefined, { number: 'شماره فاکتور', date: 'تاریخ صدور' })
    .replace('<span class="pageNumber"></span>', '<span>۱</span>');
  const lineHtml = snapshot.lines
    .map(
      (
        line,
        index,
      ) => `<tbody class="product-group"><tr class="invoice-reference"><td colspan="9">قرارداد ${escape(line.contractNumber)} | پروژه ${escape(line.project)} | ردیف قرارداد ${line.contractRowNumber ? invoiceNumber(String(line.contractRowNumber)) : "—"}</td></tr>
    <tr><td>${invoiceNumber(String(index + 1))}</td><td>${escape(line.code || "—")}</td><td>${escape(line.label)}</td><td>${escape(digits(line.length || "—"))}</td><td>${escape(digits(line.width || "—"))}</td><td>${escape(digits(line.quantity))} ${escape(units[line.unit] || line.unit)}</td><td>${money(new ExactDecimal(line.quantity).gt(0) ? new ExactDecimal(line.grossAmount).div(line.quantity).toFixed(12) : "0")}</td><td>${money(line.grossAmount)}</td><td>${money(line.netAmount)}</td></tr>
    ${line.details.length ? `<tr><td colspan="2">جزئیات</td><td colspan="7" style="text-align:right">${line.details.map(escape).join("، ")}</td></tr>` : ""}</tbody>`,
    )
    .join("");
  const driverRows = snapshot.drivers
    .map((driver) => {
      const assigned = snapshot.lines
        .map((line, index) => ({ line, index }))
        .filter((item) => item.line.driverId === driver.id);
      const totals = new Map<string, InstanceType<typeof ExactDecimal>>();
      for (const { line } of assigned)
        totals.set(
          line.unit,
          (totals.get(line.unit) || new ExactDecimal(0)).add(line.quantity),
        );
      const references = assigned
        .map((item) => invoiceNumber(String(item.index + 1)))
        .join("، ");
      const shares = [...totals]
        .map(
          ([unit, total]) =>
            `${escape(digits(total.toFixed()))} ${escape(units[unit] || unit)}`,
        )
        .join("، ");
      return `<tr><td>${escape(driver.name)}</td><td>${escape(driver.plate)}</td><td>${invoiceNumber(driver.waybillNumber)}</td><td>ردیف‌ها: ${references}<br>${shares}</td></tr>`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فاکتور فروش ${escape(snapshot.number)}</title></head><body><div class="sheet">
    <div class="invoice-first-page-header" style="height:34mm;break-inside:avoid;page-break-inside:avoid">${firstPageHeader}</div>
    <section class="section"><h2>فاکتور فروش${voidReason ? " - باطل‌شده" : ""}</h2><div class="grid two-col balanced-info">
    <div><strong>شماره فاکتور:</strong> ${invoiceNumber(snapshot.number)}</div><div><strong>تاریخ صدور:</strong> ${escape(date)}</div>
    <div><strong>شماره بارگیری:</strong> ${escape(snapshot.loadingNumber)}</div><div><strong>وضعیت:</strong> ${voidReason ? "باطل‌شده" : "صادرشده"}</div>
    ${snapshot.replacesNumber ? `<div><strong>جایگزین فاکتور:</strong> ${invoiceNumber(snapshot.replacesNumber)}</div>` : ""}</div>
    ${voidReason ? `<p class="void-status">باطل‌شده: ${escape(voidReason)}</p>` : ""}</section>
    <section class="section"><h2>مشتری و طرف‌حساب</h2><div class="grid two-col balanced-info"><div><strong>مشتری:</strong> ${escape(snapshot.customerName)}</div><div><strong>طرف‌حساب:</strong> ${escape(snapshot.counterparty)}</div></div></section>
    <section class="section"><h2>اقلام بارگیری‌شده</h2><table class="main-products-table"><colgroup><col style="width:4%"><col style="width:7%"><col style="width:25%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:12%"><col style="width:14%"><col style="width:14%"></colgroup><thead><tr><th>ردیف</th><th>کد</th><th>شرح</th><th>طول - متر</th><th>عرض - متر</th><th>مقدار</th><th>نرخ با خدمات - ریال</th><th>مبلغ کل - ریال</th><th>خالص - ریال</th></tr></thead>${lineHtml}
    <tbody><tr><td colspan="8">جمع اقلام</td><td>${money(snapshot.grossAmount)}</td></tr><tr><td colspan="8">تخفیف تخصیص‌یافته</td><td>${money(snapshot.discountAmount)}</td></tr><tr class="invoice-total"><td colspan="8">جمع کل فاکتور</td><td>${money(snapshot.netAmount)}</td></tr></tbody></table></section>
    <section class="section"><h2>مشخصات راننده‌ها و سهم بار</h2><table><thead><tr><th>راننده</th><th>پلاک</th><th>بارنامه</th><th>اقلام و مقدار بار</th></tr></thead><tbody>${driverRows}</tbody></table></section>
    <footer class="footer">فاکتور فروش ${invoiceNumber(snapshot.number)} | بارگیری ${escape(snapshot.loadingNumber)}</footer></div>${styles}
    <style>@page{size:A4;margin:8mm 6mm 10mm} .section:has(> .grid),.product-group{break-inside:avoid} thead{display:table-header-group;break-inside:avoid;page-break-inside:avoid} .section:has(>.main-products-table){border:0;padding:0}.section h2{break-after:avoid} .section:last-of-type{break-inside:avoid} .invoice-reference td{background:#f3f4f6;text-align:right;font-size:9px}.invoice-total{font-weight:700;background:#f3f4f6}.void-status{border:2px solid #991b1b;color:#991b1b;padding:10px;font-size:16px} td{overflow-wrap:anywhere}.footer{position:fixed;bottom:0;left:0;right:0;margin-top:0;padding-top:1mm}</style></body></html>`;
}
