import { Contract } from '@prisma/client';

interface RenderableContract extends Partial<Contract> {
  contractData?: any;
  customer?: any;
}

export function renderContractHtml(contract: RenderableContract): string {
  const d = contract.contractData || {};
  const buyerName = d.buyerName || `${contract.customer?.firstName || ''} ${contract.customer?.lastName || ''}`.trim();
  const buyerNationalId = d.buyerNationalId || '';
  const buyerPhone = d.buyerPhone || contract.customer?.phone || '';
  const projectAddress = d.projectAddress || contract.customer?.address || '';
  const formDate = d.formDate || '';
  const contractNumber = contract.contractNumber || d.contractNumber || d.formNumber || '';
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const totalAmount = d.totalAmount ?? contract.totalAmount ?? 0;
  const totalAmountWords = d.totalAmountWords || '';
  const paymentMethod = d.paymentMethod || '';

  const rows = new Array(9).fill(null).map((_, idx) => {
    const item = items[idx] || {};
    return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="t">${item.code || ''}</td>
        <td class="t">${item.stoneType || ''}</td>
        <td class="n">${item.thickness || ''}</td>
        <td class="n">${item.length || ''}</td>
        <td class="n">${item.width || ''}</td>
        <td class="n">${item.quantity || ''}</td>
        <td class="n">${item.squareMeter || ''}</td>
        <td class="n">${item.unitPrice ? Number(item.unitPrice).toLocaleString('fa-IR') : ''}</td>
        <td class="n">${item.totalPrice ? Number(item.totalPrice).toLocaleString('fa-IR') : ''}</td>
        <td class="t">${item.description || ''}</td>
      </tr>`;
  }).join('');

  return `
  <div class="sheet">
    <header class="hdr">
      <div class="meta">
        <div><span>تاریخ:</span><span>${formDate}</span></div>
        <div><span>شماره:</span><span>${contractNumber}</span></div>
        <div><span>نام و نام خانوادگی خریدار:</span><span>${buyerName}</span></div>
      </div>
      <div class="brand">sabalān natural stone</div>
    </header>
    <section class="sub">
      <div><span>کد ملی:</span><span>${buyerNationalId}</span></div>
      <div><span>شماره تماس:</span><span>${buyerPhone}</span></div>
      <div class="full"><span>آدرس پروژه:</span><span>${projectAddress}</span></div>
    </section>
    <table class="tbl" cellspacing="0" cellpadding="0">
      <thead>
        <tr>
          <th>ردیف</th>
          <th>کد</th>
          <th>نوع سنگ</th>
          <th>قطر</th>
          <th>طول</th>
          <th>عرض</th>
          <th>تعداد</th>
          <th>متر مربع</th>
          <th>فی</th>
          <th>قیمت کل</th>
          <th>توضیحات</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="sum">
      <div class="pill">مبلغ کل به حروف / عدد: ${totalAmountWords} — ${Number(totalAmount || 0).toLocaleString('fa-IR')} ریال</div>
    </div>
    <div class="pay">
      <span>نحوه تسویه حساب:</span>
      <div class="line">${paymentMethod}</div>
    </div>
    <div class="notes">
      <p>هزینه ارسال بار بر عهده خریدار می باشد. تحویل گیرنده فاکتورهای ارسالی به پروژه، به عنوان نماینده قانونی خریدار محسوب می شود.</p>
      <p>در صورت بروز هرگونه اشکال قابل برگشت ، سالم بودن و تطابق سنگ تحویلی با سفارشات فوق توسط اطمینان حاصل فرمایید. تمامی سفارشات فوق تا تسویه حساب نهایی نزد خریدار به امانت می باشد.</p>
      <p>قرارداد فوق صرفاً در صورت مهر و امضای خریدار دارای اعتبار می باشد؛ هر گونه دخل و تصرف بدون قید مهر فروشنده فاقد اعتبار است.</p>
    </div>
    
  </div>

  <style>
    @page { size: A4 landscape; margin: 3mm 5px 3mm 3mm; }
    html, body { direction: rtl; font-family: Vazirmatn, Vazir, Samim, Tahoma, Arial, sans-serif; margin: 0; padding: 0; }
    .sheet { color: #000; font-size: 11px; margin: 0; padding: 0; }
    .hdr { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:4mm; }
    .brand { font-weight:700; text-transform:lowercase; letter-spacing:0.5px; }
    .meta { display:grid; grid-template-columns:auto auto; gap:1mm 4mm; }
    .meta span:first-child { color:#333; margin-left:1mm; }
    .sub { display:grid; grid-template-columns: 1fr 1fr; gap:1mm 4mm; margin-bottom:2mm; }
    .sub .full { grid-column: 1 / -1; }
    .tbl { width:100%; border-collapse:collapse; border-spacing:0; table-layout:fixed; box-sizing:border-box; }
    .tbl thead th { background:#333; color:#fff; font-weight:600; padding:1mm 0.2mm; border-top-right-radius:3px; font-size:10px; box-sizing:border-box; }
    .tbl thead th:last-child { border-top-left-radius:3px; }
    .tbl td, .tbl th { border:1px solid #ddd; padding:0.5mm 0.2mm; font-variant-numeric: tabular-nums; font-size:9px; box-sizing:border-box; }
    .tbl td.n { text-align:right; }
    .tbl td.c { text-align:center; }
    .tbl td.t { word-wrap: break-word; }
    .tbl thead th:nth-child(1) { width:6%; }
    .tbl thead th:nth-child(2) { width:8%; }
    .tbl thead th:nth-child(3) { width:10%; }
    .tbl thead th:nth-child(4) { width:3%; }
    .tbl thead th:nth-child(5) { width:4%; }
    .tbl thead th:nth-child(6) { width:4%; }
    .tbl thead th:nth-child(7) { width:2.4%; }
    .tbl thead th:nth-child(8) { width:3%; }
    .tbl thead th:nth-child(9) { width:12%; }
    .tbl thead th:nth-child(10) { width:14%; }
    .tbl thead th:nth-child(11) { width:32.6%; }
    .sum { margin:3mm 0 2mm 0; }
    .sum .pill { background:#eee; border-radius:10px; padding:2mm 3mm; display:inline-block; font-size:10px; }
    .pay { display:flex; align-items:center; gap:3mm; margin-bottom:3mm; }
    .pay .line { border-bottom:1px solid #bbb; flex:1; min-height:4mm; }
    .notes { font-size:9px; color:#333; line-height:1.5; text-align:justify; margin-top:1mm; }
    
  </style>
  `;
}


