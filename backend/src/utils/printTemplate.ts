interface RenderableContract {
  id?: string;
  contractNumber?: string;
  title?: string;
  titlePersian?: string;
  status?: string;
  totalAmount?: number | null;
  currency?: string | null;
  notes?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  signedAt?: Date | string | null;
  printedAt?: Date | string | null;
  contractData?: any;
  signatures?: any;
  customer?: any;
  department?: any;
  createdByUser?: any;
  approvedByUser?: any;
  signedByUser?: any;
  items?: any[];
  deliveries?: any[];
  payments?: any[];
}

interface NormalizedCut {
  type: string;
  meters: number;
  rate: number;
  cost: number;
}

interface NormalizedService {
  category: string;
  name: string;
  amountLabel: string;
  rateLabel: string;
  cost: number;
}

interface NormalizedProduct {
  id: string;
  code: string;
  name: string;
  productType: string;
  stairPart: string;
  dimensions: string;
  quantity: number;
  squareMeters: number;
  unitPrice: number;
  originalTotalPrice: number;
  mandatoryPercentage: number;
  totalPrice: number;
  description: string;
  cuts: NormalizedCut[];
  services: NormalizedService[];
  layerSummary: string;
  finishingSummary: string;
  remainingSummary: string;
}

interface NormalizedDelivery {
  index: number;
  date: string;
  address: string;
  manager: string;
  receiver: string;
  notes: string;
  products: Array<{ name: string; quantity: number }>;
}

interface NormalizedPayment {
  index: number;
  methodLabel: string;
  amount: number;
  statusLabel: string;
  paymentDate: string;
  checkNumber: string;
  checkOwnerName: string;
  handoverDate: string;
  notes: string;
  installments: Array<{
    index: number;
    amount: number;
    dueDate: string;
    status: string;
    notes: string;
  }>;
}

interface NormalizedFinancials {
  productsTotal: number;
  servicesTotal: number;
  cutsTotal: number;
  finishingTotal: number;
  grandTotal: number;
  currency: string;
}

const EMPTY = '—';

const escapeHtml = (value: unknown): string => {
  const input = value === null || value === undefined ? '' : String(value);
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const toNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toFaNumber = (value: unknown, fractionDigits = 0): string => {
  const numeric = toNumber(value);
  return new Intl.NumberFormat('fa-IR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(numeric);
};

const formatAmount = (value: unknown, currency = 'تومان'): string => {
  return `${toFaNumber(value)} ${escapeHtml(currency || 'تومان')}`;
};

const formatDate = (value: unknown): string => {
  if (!value) return EMPTY;
  const raw = String(value);
  if (raw.includes('/')) return escapeHtml(raw);
  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return escapeHtml(raw);
  return date.toLocaleDateString('fa-IR');
};

const formatDateTime = (value: unknown): string => {
  if (!value) return EMPTY;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString('fa-IR');
};

const statusLabelMap: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده'
};

const productTypeLabel = (value: unknown): string => {
  if (value === 'longitudinal') return 'طولی';
  if (value === 'stair') return 'پله';
  if (value === 'slab') return 'اسلب';
  return EMPTY;
};

const stairPartLabel = (value: unknown): string => {
  if (value === 'tread') return 'کف پله';
  if (value === 'riser') return 'قائمه';
  if (value === 'landing') return 'پاگرد';
  return EMPTY;
};

const paymentMethodLabel = (value: unknown, cashType: unknown): string => {
  if (value === 'CASH_CARD') return 'نقدی (کارت)';
  if (value === 'CASH_SHIBA') return 'نقدی (شبا)';
  if (value === 'CHECK') return 'چک';
  if (value === 'CHECK') return 'چک';
  if (value === 'CASH') {
    if (cashType === 'CARD') return 'نقدی (کارت)';
    return 'نقدی';
  }
  if (value === 'RECEIPT') return 'رسید';
  return EMPTY;
};

const paymentStatusLabel = (value: unknown): string => {
  if (value === 'PAID') return 'پرداخت شده';
  if (value === 'WILL_BE_PAID') return 'پرداخت خواهد شد';
  if (value === 'PENDING') return 'در انتظار';
  if (value === 'PARTIAL') return 'بخشی';
  if (value === 'COMPLETED') return 'تکمیل شده';
  if (value === 'CANCELLED') return 'لغو شده';
  return EMPTY;
};

const getCustomerPhone = (customer: any, contractData: any): string => {
  const phoneCandidates = [
    contractData?.customer?.homeNumber,
    contractData?.customer?.workNumber,
    contractData?.customer?.projectManagerNumber,
    customer?.homeNumber,
    customer?.workNumber,
    customer?.projectManagerNumber,
    customer?.phoneNumbers?.find((p: any) => p?.isPrimary)?.number,
    customer?.phoneNumbers?.[0]?.number,
    customer?.primaryContact?.mobile,
    customer?.primaryContact?.phone
  ];

  const phone = phoneCandidates.find((value) => typeof value === 'string' && value.trim());
  return phone ? String(phone).trim() : EMPTY;
};

const normalizeProducts = (contract: RenderableContract): NormalizedProduct[] => {
  const contractDataProducts = Array.isArray(contract.contractData?.products) ? contract.contractData.products : [];
  const relationItems = Array.isArray(contract.items) ? contract.items : [];

  if (contractDataProducts.length > 0) {
    return contractDataProducts.map((product: any, index: number) => {
      const relationItem = relationItems.find((item: any) =>
        item?.productId === product?.productId &&
        (item?.stairPartType || null) === (product?.stairPartType || null)
      ) || relationItems[index];

      const cutsFromBreakdown: NormalizedCut[] = Array.isArray(product?.cuttingBreakdown)
        ? product.cuttingBreakdown.map((cut: any) => ({
            type: cut?.type === 'cross' ? 'برش عرضی' : 'برش طولی',
            meters: toNumber(cut?.meters),
            rate: toNumber(cut?.rate),
            cost: toNumber(cut?.cost)
          }))
        : [];

      const cutsFromDetails: NormalizedCut[] = cutsFromBreakdown.length > 0
        ? []
        : (Array.isArray(product?.cutDetails)
          ? product.cutDetails.map((cut: any) => ({
              type: cut?.type === 'cross' ? 'برش عرضی' : 'برش طولی',
              meters: toNumber(cut?.meters || cut?.length),
              rate: toNumber(cut?.rate || cut?.cuttingCostPerMeter),
              cost: toNumber(cut?.cost || cut?.cuttingCost)
            }))
          : []);

      const services: NormalizedService[] = [];
      (product?.appliedSubServices || []).forEach((service: any) => {
        services.push({
          category: 'خدمات',
          name: service?.subService?.namePersian || service?.subService?.name || EMPTY,
          amountLabel: `${toFaNumber(service?.meter || 0, 2)} ${service?.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر'}`,
          rateLabel: service?.subService?.pricePerMeter ? `${toFaNumber(service.subService.pricePerMeter)} تومان` : EMPTY,
          cost: toNumber(service?.cost)
        });
      });

      if (product?.finishingId || product?.finishingCost) {
        services.push({
          category: 'فینیشینگ',
          name: product?.finishingName || EMPTY,
          amountLabel: `${toFaNumber(product?.finishingSquareMeters || product?.squareMeters || 0, 3)} متر مربع`,
          rateLabel: product?.finishingPricePerSquareMeter ? `${toFaNumber(product.finishingPricePerSquareMeter)} تومان` : EMPTY,
          cost: toNumber(product?.finishingCost)
        });
      }

      const width = product?.width ? `${product.width}${product?.widthUnit || ''}` : null;
      const length = product?.length ? `${product.length}${product?.lengthUnit || ''}` : null;
      const thickness = product?.thicknessCm ? `${product.thicknessCm}cm` : null;
      const dimensions = [
        length ? `طول: ${length}` : null,
        width ? `عرض: ${width}` : null,
        thickness ? `ضخامت: ${thickness}` : null
      ].filter(Boolean).join(' | ') || EMPTY;

      const remainingCount = Array.isArray(product?.remainingStones) ? product.remainingStones.length : 0;
      const usedRemainingCount = Array.isArray(product?.usedRemainingStones) ? product.usedRemainingStones.length : 0;

      return {
        id: `${product?.productId || 'product'}-${index}`,
        code: product?.stoneCode || product?.product?.code || relationItem?.product?.code || EMPTY,
        name: product?.stoneName || product?.product?.namePersian || product?.product?.name || relationItem?.product?.namePersian || relationItem?.product?.name || EMPTY,
        productType: productTypeLabel(product?.productType || relationItem?.productType),
        stairPart: stairPartLabel(product?.stairPartType || relationItem?.stairPartType),
        dimensions,
        quantity: toNumber(product?.quantity || relationItem?.quantity),
        squareMeters: toNumber(product?.squareMeters),
        unitPrice: toNumber(product?.pricePerSquareMeter || product?.unitPrice || relationItem?.unitPrice),
        originalTotalPrice: toNumber(product?.originalTotalPrice),
        mandatoryPercentage: toNumber(product?.mandatoryPercentage),
        totalPrice: toNumber(product?.totalPrice || relationItem?.totalPrice),
        description: product?.description || relationItem?.description || EMPTY,
        cuts: [...cutsFromBreakdown, ...cutsFromDetails],
        services,
        layerSummary: product?.layerTypeName
          ? `${product.layerTypeName}${product?.layerUseMandatory ? ` / حکمی ${toFaNumber(product?.layerMandatoryPercentage || 0)}%` : ''}`
          : EMPTY,
        finishingSummary: product?.finishingName ? `${product.finishingName} (${toFaNumber(product?.finishingSquareMeters || 0, 3)} متر مربع)` : EMPTY,
        remainingSummary: `باقی‌مانده: ${toFaNumber(remainingCount)} | مصرف‌شده: ${toFaNumber(usedRemainingCount)}`
      };
    });
  }

  return relationItems.map((item: any, index: number) => ({
    id: item?.id || `item-${index}`,
    code: item?.product?.code || EMPTY,
    name: item?.product?.namePersian || item?.product?.name || EMPTY,
    productType: productTypeLabel(item?.productType),
    stairPart: stairPartLabel(item?.stairPartType),
    dimensions: EMPTY,
    quantity: toNumber(item?.quantity),
    squareMeters: 0,
    unitPrice: toNumber(item?.unitPrice),
    originalTotalPrice: toNumber(item?.originalTotalPrice),
    mandatoryPercentage: toNumber(item?.mandatoryPercentage),
    totalPrice: toNumber(item?.totalPrice),
    description: item?.description || EMPTY,
    cuts: [],
    services: [],
    layerSummary: EMPTY,
    finishingSummary: EMPTY,
    remainingSummary: EMPTY
  }));
};

const normalizeDeliveries = (contract: RenderableContract, products: NormalizedProduct[]): NormalizedDelivery[] => {
  const relationDeliveries = Array.isArray(contract.deliveries) ? contract.deliveries : [];
  const contractDataDeliveries = Array.isArray(contract.contractData?.deliveries) ? contract.contractData.deliveries : [];
  const length = Math.max(relationDeliveries.length, contractDataDeliveries.length);

  const rows: NormalizedDelivery[] = [];
  for (let index = 0; index < length; index += 1) {
    const relation = relationDeliveries[index] || {};
    const snapshot = contractDataDeliveries[index] || {};

    const relationProducts = Array.isArray(relation?.products)
      ? relation.products.map((deliveryProduct: any) => ({
          name: deliveryProduct?.product?.namePersian || deliveryProduct?.product?.name || EMPTY,
          quantity: toNumber(deliveryProduct?.quantity)
        }))
      : [];

    const snapshotProducts = Array.isArray(snapshot?.products)
      ? snapshot.products.map((deliveryProduct: any) => ({
          name: products.find((product) => product.id.startsWith(`${deliveryProduct?.productId || ''}-`))?.name || `محصول ${toNumber(deliveryProduct?.productIndex) + 1}`,
          quantity: toNumber(deliveryProduct?.quantity)
        }))
      : [];

    rows.push({
      index: index + 1,
      date: formatDate(relation?.deliveryDate || snapshot?.deliveryDate),
      address: String(relation?.deliveryAddress || snapshot?.deliveryAddress || contract.contractData?.project?.address || EMPTY),
      manager: String(snapshot?.projectManagerName || relation?.driver || EMPTY),
      receiver: String(snapshot?.receiverName || relation?.vehicle || EMPTY),
      notes: String(relation?.notes || snapshot?.notes || EMPTY),
      products: relationProducts.length > 0 ? relationProducts : snapshotProducts
    });
  }

  return rows;
};

const normalizePayments = (contract: RenderableContract): NormalizedPayment[] => {
  const relationPayments = Array.isArray(contract.payments) ? contract.payments : [];
  const snapshotPayments = Array.isArray(contract.contractData?.payment?.payments) ? contract.contractData.payment.payments : [];
  const length = Math.max(relationPayments.length, snapshotPayments.length);

  const rows: NormalizedPayment[] = [];
  for (let index = 0; index < length; index += 1) {
    const relation = relationPayments[index] || {};
    const snapshot = snapshotPayments[index] || {};

    const installments = Array.isArray(relation?.installments)
      ? relation.installments.map((installment: any, installmentIndex: number) => ({
          index: installment?.installmentNumber || installmentIndex + 1,
          amount: toNumber(installment?.amount),
          dueDate: formatDate(installment?.dueDate),
          status: paymentStatusLabel(installment?.status || 'PENDING'),
          notes: String(installment?.notes || EMPTY)
        }))
      : [];

    rows.push({
      index: index + 1,
      methodLabel: paymentMethodLabel(relation?.paymentMethod || snapshot?.method, relation?.cashType || snapshot?.cashType),
      amount: toNumber(relation?.totalAmount || snapshot?.amount),
      statusLabel: paymentStatusLabel(relation?.status || snapshot?.status),
      paymentDate: formatDate(relation?.paymentDate || snapshot?.paymentDate),
      checkNumber: String(relation?.checkNumber || snapshot?.checkNumber || EMPTY),
      checkOwnerName: String(relation?.checkOwnerName || snapshot?.checkOwnerName || EMPTY),
      handoverDate: formatDate(relation?.handoverDate || snapshot?.handoverDate),
      notes: String(relation?.notes || snapshot?.description || EMPTY),
      installments
    });
  }

  return rows;
};

const normalizeFinancials = (contract: RenderableContract, products: NormalizedProduct[]): NormalizedFinancials => {
  const currency = String(contract.currency || contract.contractData?.payment?.currency || 'تومان');
  const productsTotal = products.reduce((sum, product) => sum + toNumber(product.totalPrice), 0);
  const servicesTotal = products.reduce((sum, product) => sum + product.services.reduce((serviceSum, service) => serviceSum + toNumber(service.cost), 0), 0);
  const cutsTotal = products.reduce((sum, product) => sum + product.cuts.reduce((cutSum, cut) => cutSum + toNumber(cut.cost), 0), 0);
  const finishingTotal = products.reduce((sum, product) => {
    const finishing = product.services
      .filter((service) => service.category === 'فینیشینگ')
      .reduce((serviceSum, service) => serviceSum + toNumber(service.cost), 0);
    return sum + finishing;
  }, 0);

  const relationGrandTotal = toNumber(contract.totalAmount);
  return {
    productsTotal,
    servicesTotal,
    cutsTotal,
    finishingTotal,
    grandTotal: relationGrandTotal > 0 ? relationGrandTotal : productsTotal,
    currency
  };
};

const renderProductMainRows = (products: NormalizedProduct[], currency: string): string => {
  if (!products.length) {
    return `<tr><td colspan="10" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;
  }

  return products.map((product, index) => `
    <tr>
      <td>${toFaNumber(index + 1)}</td>
      <td>${escapeHtml(product.code)}</td>
      <td>${escapeHtml(product.name)}</td>
      <td>${escapeHtml(product.productType)}</td>
      <td>${escapeHtml(product.stairPart)}</td>
      <td>${escapeHtml(product.dimensions)}</td>
      <td>${toFaNumber(product.quantity, 2)}</td>
      <td>${toFaNumber(product.squareMeters, 3)}</td>
      <td>${formatAmount(product.unitPrice, currency)}</td>
      <td>${formatAmount(product.totalPrice, currency)}</td>
    </tr>
  `).join('');
};

const renderProductDetails = (products: NormalizedProduct[], currency: string): string => {
  if (!products.length) {
    return `<p class="empty">${escapeHtml(EMPTY)}</p>`;
  }

  return products.map((product, index) => {
    const cutRows = product.cuts.length > 0
      ? product.cuts.map((cut) => `
          <tr>
            <td>${escapeHtml(cut.type)}</td>
            <td>${toFaNumber(cut.meters, 2)} متر</td>
            <td>${cut.rate > 0 ? formatAmount(cut.rate, currency) : escapeHtml(EMPTY)}</td>
            <td>${formatAmount(cut.cost, currency)}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="4" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;

    const serviceRows = product.services.length > 0
      ? product.services.map((service) => `
          <tr>
            <td>${escapeHtml(service.category)}</td>
            <td>${escapeHtml(service.name)}</td>
            <td>${escapeHtml(service.amountLabel)}</td>
            <td>${escapeHtml(service.rateLabel || EMPTY)}</td>
            <td>${formatAmount(service.cost, currency)}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="5" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;

    return `
      <section class="section product-detail ${index > 0 ? 'page-break' : ''}">
        <h3>جزئیات فنی و خدمات - ${escapeHtml(product.name)}</h3>
        <div class="grid two-col">
          <div><strong>شرح:</strong> ${escapeHtml(product.description || EMPTY)}</div>
          <div><strong>اطلاعات حکمی:</strong> ${product.mandatoryPercentage > 0 ? `${toFaNumber(product.mandatoryPercentage)}%` : escapeHtml(EMPTY)}</div>
          <div><strong>قیمت پایه:</strong> ${product.originalTotalPrice > 0 ? formatAmount(product.originalTotalPrice, currency) : escapeHtml(EMPTY)}</div>
          <div><strong>قیمت نهایی:</strong> ${formatAmount(product.totalPrice, currency)}</div>
          <div><strong>لایه:</strong> ${escapeHtml(product.layerSummary || EMPTY)}</div>
          <div><strong>فینیشینگ:</strong> ${escapeHtml(product.finishingSummary || EMPTY)}</div>
          <div class="full"><strong>وضعیت باقی‌مانده سنگ:</strong> ${escapeHtml(product.remainingSummary || EMPTY)}</div>
        </div>

        <h4>جزئیات برش</h4>
        <table>
          <thead>
            <tr>
              <th>نوع</th>
              <th>طول/مقدار</th>
              <th>نرخ</th>
              <th>هزینه</th>
            </tr>
          </thead>
          <tbody>
            ${cutRows}
          </tbody>
        </table>

        <h4>جزئیات خدمات</h4>
        <table>
          <thead>
            <tr>
              <th>دسته</th>
              <th>شرح</th>
              <th>مقدار</th>
              <th>نرخ</th>
              <th>هزینه</th>
            </tr>
          </thead>
          <tbody>
            ${serviceRows}
          </tbody>
        </table>
      </section>
    `;
  }).join('');
};

const renderDeliveryRows = (deliveries: NormalizedDelivery[]): string => {
  if (!deliveries.length) {
    return `<tr><td colspan="7" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;
  }

  return deliveries.map((delivery) => {
    const productsLabel = delivery.products.length > 0
      ? delivery.products.map((product) => `${product.name} (${toFaNumber(product.quantity, 2)})`).join('، ')
      : EMPTY;

    return `
      <tr>
        <td>${toFaNumber(delivery.index)}</td>
        <td>${escapeHtml(delivery.date)}</td>
        <td>${escapeHtml(delivery.address)}</td>
        <td>${escapeHtml(delivery.manager)}</td>
        <td>${escapeHtml(delivery.receiver)}</td>
        <td>${escapeHtml(delivery.notes)}</td>
        <td>${escapeHtml(productsLabel)}</td>
      </tr>
    `;
  }).join('');
};

const renderPaymentRows = (payments: NormalizedPayment[], currency: string): string => {
  if (!payments.length) {
    return `<tr><td colspan="9" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;
  }

  const rows: string[] = [];
  payments.forEach((payment) => {
    rows.push(`
      <tr>
        <td>${toFaNumber(payment.index)}</td>
        <td>${escapeHtml(payment.methodLabel)}</td>
        <td>${formatAmount(payment.amount, currency)}</td>
        <td>${escapeHtml(payment.statusLabel)}</td>
        <td>${escapeHtml(payment.paymentDate)}</td>
        <td>${escapeHtml(payment.checkNumber)}</td>
        <td>${escapeHtml(payment.checkOwnerName)}</td>
        <td>${escapeHtml(payment.handoverDate)}</td>
        <td>${escapeHtml(payment.notes)}</td>
      </tr>
    `);

    payment.installments.forEach((installment) => {
      rows.push(`
        <tr class="sub-row">
          <td>—</td>
          <td>قسط ${toFaNumber(installment.index)}</td>
          <td>${formatAmount(installment.amount, currency)}</td>
          <td>${escapeHtml(installment.status)}</td>
          <td>${escapeHtml(installment.dueDate)}</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>${escapeHtml(installment.notes)}</td>
        </tr>
      `);
    });
  });

  return rows.join('');
};

export function renderContractHtml(contract: RenderableContract): string {
  const contractData = contract.contractData || {};
  const customer = contract.customer || contractData.customer || {};
  const project = contractData.project || {};

  const normalizedProducts = normalizeProducts(contract);
  const normalizedDeliveries = normalizeDeliveries(contract, normalizedProducts);
  const normalizedPayments = normalizePayments(contract);
  const financials = normalizeFinancials(contract, normalizedProducts);

  const title = contract.titlePersian || contract.title || 'قرارداد فروش';
  const contractNumber = contract.contractNumber || contractData.contractNumber || EMPTY;
  const contractDate = contractData.contractDate || formatDate(contract.createdAt);
  const statusLabel = statusLabelMap[String(contract.status || '')] || String(contract.status || 'DRAFT');

  const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.companyName || EMPTY;
  const customerPhone = getCustomerPhone(customer, contractData);
  const customerNationalCode = customer.nationalCode || contractData.customer?.nationalCode || EMPTY;
  const customerAddress = project.address || customer.workAddress || customer.homeAddress || customer.address || EMPTY;
  const projectManagerName = project.projectManagerName || customer.projectManagerName || EMPTY;
  const projectManagerNumber = project.projectManagerNumber || customer.projectManagerNumber || EMPTY;

  const digitalConfirmation = contract.signatures?.digitalConfirmation || null;

  return `
  <div class="sheet">
    <header class="contract-header">
      <div class="company">
        <h1>مجموعه سنگ طبیعی سبلان</h1>
        <p>قرارداد رسمی فروش و اجرای خدمات سنگ</p>
      </div>
      <div class="meta">
        <div><strong>شماره قرارداد:</strong> ${escapeHtml(contractNumber)}</div>
        <div><strong>تاریخ تنظیم:</strong> ${escapeHtml(contractDate)}</div>
        <div><strong>وضعیت:</strong> ${escapeHtml(statusLabel)}</div>
      </div>
    </header>

    <section class="section">
      <h2>مشخصات قرارداد</h2>
      <div class="grid two-col">
        <div><strong>عنوان قرارداد:</strong> ${escapeHtml(title)}</div>
        <div><strong>بخش:</strong> ${escapeHtml(contract.department?.namePersian || contract.department?.name || EMPTY)}</div>
        <div><strong>ایجاد کننده:</strong> ${escapeHtml([contract.createdByUser?.firstName, contract.createdByUser?.lastName].filter(Boolean).join(' ') || EMPTY)}</div>
        <div><strong>تایید کننده:</strong> ${escapeHtml([contract.approvedByUser?.firstName, contract.approvedByUser?.lastName].filter(Boolean).join(' ') || EMPTY)}</div>
        <div><strong>امضا کننده:</strong> ${escapeHtml([contract.signedByUser?.firstName, contract.signedByUser?.lastName].filter(Boolean).join(' ') || EMPTY)}</div>
        <div><strong>آخرین بروزرسانی:</strong> ${escapeHtml(formatDateTime(contract.updatedAt || contract.createdAt))}</div>
      </div>
    </section>

    <section class="section">
      <h2>مشخصات مشتری و پروژه</h2>
      <div class="grid two-col">
        <div><strong>نام مشتری:</strong> ${escapeHtml(customerName)}</div>
        <div><strong>کد ملی:</strong> ${escapeHtml(customerNationalCode)}</div>
        <div><strong>شماره تماس:</strong> ${escapeHtml(customerPhone)}</div>
        <div><strong>نام برند/شرکت:</strong> ${escapeHtml(customer.companyName || customer.brandName || EMPTY)}</div>
        <div><strong>مدیر پروژه:</strong> ${escapeHtml(projectManagerName)}</div>
        <div><strong>شماره مدیر پروژه:</strong> ${escapeHtml(projectManagerNumber)}</div>
        <div class="full"><strong>آدرس پروژه:</strong> ${escapeHtml(customerAddress)}</div>
      </div>
    </section>

    <section class="section page-break">
      <h2>جدول اصلی محصولات</h2>
      <table>
        <thead>
          <tr>
            <th>ردیف</th>
            <th>کد</th>
            <th>نام</th>
            <th>نوع محصول</th>
            <th>بخش</th>
            <th>ابعاد</th>
            <th>تعداد</th>
            <th>متراژ</th>
            <th>فی</th>
            <th>مبلغ کل</th>
          </tr>
        </thead>
        <tbody>
          ${renderProductMainRows(normalizedProducts, financials.currency)}
        </tbody>
      </table>
    </section>

    ${renderProductDetails(normalizedProducts, financials.currency)}

    <section class="section page-break">
      <h2>برنامه تحویل</h2>
      <table>
        <thead>
          <tr>
            <th>ردیف</th>
            <th>تاریخ تحویل</th>
            <th>آدرس</th>
            <th>مدیر پروژه</th>
            <th>تحویل‌گیرنده</th>
            <th>توضیحات</th>
            <th>اقلام</th>
          </tr>
        </thead>
        <tbody>
          ${renderDeliveryRows(normalizedDeliveries)}
        </tbody>
      </table>
    </section>

    <section class="section page-break">
      <h2>برنامه پرداخت</h2>
      <table>
        <thead>
          <tr>
            <th>ردیف</th>
            <th>روش پرداخت</th>
            <th>مبلغ</th>
            <th>وضعیت</th>
            <th>تاریخ پرداخت/سررسید</th>
            <th>شماره چک</th>
            <th>صاحب چک</th>
            <th>تاریخ تحویل چک</th>
            <th>توضیحات</th>
          </tr>
        </thead>
        <tbody>
          ${renderPaymentRows(normalizedPayments, financials.currency)}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>جمع‌بندی مالی</h2>
      <div class="grid two-col">
        <div><strong>جمع محصولات:</strong> ${formatAmount(financials.productsTotal, financials.currency)}</div>
        <div><strong>جمع خدمات:</strong> ${formatAmount(financials.servicesTotal, financials.currency)}</div>
        <div><strong>جمع برش:</strong> ${formatAmount(financials.cutsTotal, financials.currency)}</div>
        <div><strong>جمع فینیشینگ:</strong> ${formatAmount(financials.finishingTotal, financials.currency)}</div>
        <div><strong>مبلغ نهایی قرارداد:</strong> ${formatAmount(financials.grandTotal, financials.currency)}</div>
        <div><strong>واحد پول:</strong> ${escapeHtml(financials.currency)}</div>
      </div>
    </section>

    <section class="section">
      <h2>وضعیت تایید دیجیتال</h2>
      <div class="grid two-col">
        <div><strong>وضعیت:</strong> ${escapeHtml(digitalConfirmation?.status || EMPTY)}</div>
        <div><strong>شماره تایید:</strong> ${escapeHtml(digitalConfirmation?.phoneNumber || EMPTY)}</div>
        <div><strong>زمان ارسال:</strong> ${escapeHtml(formatDateTime(digitalConfirmation?.sentAt))}</div>
        <div><strong>زمان تایید:</strong> ${escapeHtml(formatDateTime(digitalConfirmation?.verifiedAt))}</div>
      </div>
    </section>

    <section class="section">
      <h2>توضیحات و بند حقوقی</h2>
      <p class="notes">${escapeHtml(contract.notes || EMPTY)}</p>
      <p class="legal">
        این قرارداد بر اساس اطلاعات ثبت شده در سامانه تهیه شده است. تمامی مشخصات فنی، مالی، زمان‌بندی تحویل و روش‌های پرداخت پس از تایید طرفین ملاک اجرا خواهد بود.
      </p>
      <p class="legal">
        هرگونه تغییر در مفاد قرارداد صرفاً با ثبت الحاقیه رسمی معتبر است و مسئولیت تطابق خدمات تحویلی با مفاد قرارداد بر عهده فروشنده و تایید دریافت بر عهده خریدار خواهد بود.
      </p>
    </section>

    <section class="section signatures">
      <div class="sign-box"><strong>امضا و مهر فروشنده</strong></div>
      <div class="sign-box"><strong>امضا و اثر انگشت خریدار</strong></div>
      <div class="sign-box"><strong>تایید نهایی اجرا</strong></div>
    </section>

    <footer class="footer">
      <span>نسخه چاپی قرارداد - سامانه سبلان</span>
      <span>تاریخ چاپ: ${escapeHtml(formatDateTime(new Date()))}</span>
      <span>شماره قرارداد: ${escapeHtml(contractNumber)}</span>
    </footer>
  </div>

  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: #111827;
      direction: rtl;
      font-size: 11px;
      line-height: 1.7;
      font-family: Vazirmatn, Vazir, Tahoma, Arial, sans-serif;
      background: #ffffff;
    }

    .sheet {
      width: 100%;
    }

    .contract-header {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .contract-header h1 {
      margin: 0 0 4px;
      font-size: 20px;
    }

    .contract-header p {
      margin: 0;
      color: #4b5563;
      font-size: 11px;
    }

    .meta {
      text-align: left;
      direction: ltr;
      font-size: 10px;
      color: #374151;
      line-height: 1.7;
    }

    .section {
      margin-bottom: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 8px 10px;
      page-break-inside: avoid;
    }

    .section h2 {
      margin: 0 0 8px;
      font-size: 13px;
      border-bottom: 1px dashed #d1d5db;
      padding-bottom: 3px;
    }

    .section h3 {
      margin: 0 0 6px;
      font-size: 12px;
    }

    .section h4 {
      margin: 8px 0 6px;
      font-size: 11px;
    }

    .grid {
      display: grid;
      gap: 5px 12px;
    }

    .two-col {
      grid-template-columns: 1fr 1fr;
    }

    .full {
      grid-column: 1 / -1;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10px;
    }

    thead {
      display: table-header-group;
    }

    tbody {
      display: table-row-group;
    }

    th,
    td {
      border: 1px solid #d1d5db;
      padding: 4px 5px;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    th {
      background: #f3f4f6;
      font-weight: 700;
    }

    .empty,
    .empty-cell {
      color: #6b7280;
      text-align: center;
    }

    .sub-row td {
      background: #fafafa;
      color: #374151;
    }

    .notes,
    .legal {
      margin: 0 0 6px;
      text-align: justify;
    }

    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      min-height: 80px;
      align-items: stretch;
    }

    .sign-box {
      border: 1px dashed #9ca3af;
      border-radius: 4px;
      padding: 8px;
      min-height: 70px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      text-align: center;
    }

    .footer {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #d1d5db;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #6b7280;
    }

    .page-break {
      break-before: page;
      page-break-before: always;
    }
  </style>
  `;
}
