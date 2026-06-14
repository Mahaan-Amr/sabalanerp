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
  amount: number;
  amountLabel: string;
  rateLabel: string;
  rate: number;
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

const hasTextValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  return text.length > 0 && text !== EMPTY;
};

const formatAmount = (value: unknown, currency = 'تومان'): string => {
  return `${toFaNumber(value)} ${escapeHtml(currency || 'تومان')}`;
};

const getFinishingBase = (product: any): 'length' | 'squareMeters' => {
  const base = product?.finishingCalculationBase || product?.meta?.finishing?.calculationBase;
  return base === 'length' ? 'length' : 'squareMeters';
};

const getFinishingUnitLabel = (base: 'length' | 'squareMeters') =>
  base === 'length' ? 'متر طول' : 'متر مربع';

const getFinishingQuantity = (product: any, base: 'length' | 'squareMeters'): number => {
  const quantity =
    toNumber(product?.finishingQuantity) ||
    toNumber(product?.meta?.finishing?.quantity) ||
    toNumber(product?.finishingSquareMeters) ||
    toNumber(product?.meta?.finishing?.squareMeters);
  if (quantity > 0) return quantity;
  return base === 'squareMeters' ? toNumber(product?.squareMeters) : 0;
};

const getFinishingUnitPrice = (product: any): number =>
  toNumber(product?.finishingUnitPrice) ||
  toNumber(product?.meta?.finishing?.unitPrice) ||
  toNumber(product?.finishingPricePerSquareMeter) ||
  toNumber(product?.meta?.finishing?.pricePerSquareMeter);

const getFinishingAmountLabel = (product: any): string => {
  const base = getFinishingBase(product);
  const unitLabel = getFinishingUnitLabel(base);
  const quantity = getFinishingQuantity(product, base);
  return `${toFaNumber(quantity, base === 'squareMeters' ? 3 : 2)} ${unitLabel}`;
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
        const amount = toNumber(service?.meter);
        const rate = toNumber(service?.subService?.pricePerMeter);
        services.push({
          category: 'خدمات',
          name: service?.subService?.namePersian || service?.subService?.name || EMPTY,
          amount,
          amountLabel: `${toFaNumber(amount, 2)} ${service?.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر'}`,
          rate,
          rateLabel: rate ? `${toFaNumber(rate)} تومان` : EMPTY,
          cost: toNumber(service?.cost)
        });
      });

      if (product?.finishingId || product?.finishingCost) {
        const finishingBase = getFinishingBase(product);
        const finishingUnitLabel = getFinishingUnitLabel(finishingBase);
        const finishingQuantity = getFinishingQuantity(product, finishingBase);
        const finishingUnitPrice = getFinishingUnitPrice(product);
        services.push({
          category: 'فرآوری سنگ',
          name: product?.finishingName || EMPTY,
          amount: finishingQuantity,
          amountLabel: getFinishingAmountLabel(product),
          rate: finishingUnitPrice,
          rateLabel: finishingUnitPrice ? `${toFaNumber(finishingUnitPrice)} تومان / ${finishingUnitLabel}` : EMPTY,
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
        finishingSummary: product?.finishingName ? `${product.finishingName} (${getFinishingAmountLabel(product)})` : EMPTY,
        remainingSummary: remainingCount > 0 || usedRemainingCount > 0
          ? `باقی‌مانده: ${toFaNumber(remainingCount)} | مصرف‌شده: ${toFaNumber(usedRemainingCount)}`
          : EMPTY
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
  const servicesTotal = products.reduce((sum, product) => {
    const services = product.services
      .filter((service) => service.category !== 'فرآوری سنگ')
      .reduce((serviceSum, service) => serviceSum + toNumber(service.cost), 0);
    return sum + services;
  }, 0);
  const cutsTotal = products.reduce((sum, product) => sum + product.cuts.reduce((cutSum, cut) => cutSum + toNumber(cut.cost), 0), 0);
  const finishingTotal = products.reduce((sum, product) => {
    const finishing = product.services
      .filter((service) => service.category === 'فرآوری سنگ')
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

  return products.map((product, index) => {
    const meaningfulCuts = product.cuts.filter((cut) =>
      cut.meters > 0 || cut.rate > 0 || cut.cost > 0
    );

    const meaningfulServices = product.services.filter((service) =>
      hasTextValue(service.name) ||
      service.amount > 0 ||
      service.rate > 0 ||
      service.cost > 0
    );

    const summaryItems = [
      hasTextValue(product.description) ? `<span><strong>شرح:</strong> ${escapeHtml(product.description)}</span>` : '',
      product.mandatoryPercentage > 0 ? `<span><strong>اطلاعات حکمی:</strong> ${toFaNumber(product.mandatoryPercentage)}%</span>` : '',
      product.originalTotalPrice > 0 ? `<span><strong>قیمت پایه:</strong> ${formatAmount(product.originalTotalPrice, currency)}</span>` : '',
      hasTextValue(product.layerSummary) ? `<span><strong>لایه:</strong> ${escapeHtml(product.layerSummary)}</span>` : '',
      hasTextValue(product.remainingSummary) ? `<span><strong>وضعیت باقی‌مانده سنگ:</strong> ${escapeHtml(product.remainingSummary)}</span>` : ''
    ].filter(Boolean);

    const cutsBlock = meaningfulCuts.length > 0
      ? `
        <div class="detail-block">
          <h4>جزئیات برش</h4>
          <table class="nested-table">
            <thead>
              <tr>
                <th>نوع</th>
                <th>طول/مقدار</th>
                <th>نرخ</th>
                <th>هزینه</th>
              </tr>
            </thead>
            <tbody>
              ${meaningfulCuts.map((cut) => `
          <tr>
            <td>${escapeHtml(cut.type)}</td>
            <td>${toFaNumber(cut.meters, 2)} متر</td>
            <td>${cut.rate > 0 ? formatAmount(cut.rate, currency) : escapeHtml(EMPTY)}</td>
            <td>${formatAmount(cut.cost, currency)}</td>
          </tr>
        `).join('')}
            </tbody>
          </table>
        </div>
      `
      : '';

    const servicesBlock = meaningfulServices.length > 0
      ? `
        <div class="detail-block">
          <h4>جزئیات خدمات و فرآوری</h4>
          <table class="nested-table">
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
              ${meaningfulServices.map((service) => `
          <tr>
            <td>${escapeHtml(service.category)}</td>
            <td>${escapeHtml(service.name)}</td>
            <td>${escapeHtml(service.amountLabel)}</td>
            <td>${escapeHtml(service.rateLabel || EMPTY)}</td>
            <td>${formatAmount(service.cost, currency)}</td>
          </tr>
        `).join('')}
            </tbody>
          </table>
        </div>
      `
      : '';

    const detailRow = summaryItems.length || cutsBlock || servicesBlock
      ? `
        <tr class="product-detail-row">
          <td colspan="10">
            <div class="product-detail-inline">
              <h3>جزئیات محصول</h3>
              ${summaryItems.length ? `<div class="detail-strip">${summaryItems.join('')}</div>` : ''}
              ${cutsBlock}
              ${servicesBlock}
            </div>
          </td>
        </tr>
      `
      : '';

    return `
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
      ${detailRow}
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

const renderFinancialSummary = (financials: NormalizedFinancials): string => {
  const rows = [
    `<div><strong>جمع محصولات:</strong> ${formatAmount(financials.productsTotal, financials.currency)}</div>`,
    financials.servicesTotal > 0 ? `<div><strong>جمع خدمات:</strong> ${formatAmount(financials.servicesTotal, financials.currency)}</div>` : '',
    financials.cutsTotal > 0 ? `<div><strong>جمع برش:</strong> ${formatAmount(financials.cutsTotal, financials.currency)}</div>` : '',
    financials.finishingTotal > 0 ? `<div><strong>جمع فرآوری سنگ:</strong> ${formatAmount(financials.finishingTotal, financials.currency)}</div>` : '',
    `<div><strong>مبلغ نهایی قرارداد:</strong> ${formatAmount(financials.grandTotal, financials.currency)}</div>`,
    `<div><strong>واحد پول:</strong> ${escapeHtml(financials.currency)}</div>`
  ].filter(Boolean);

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

    <section class="section">
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

    <section class="section">
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

    <section class="section">
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
        ${renderFinancialSummary(financials)}
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
      ${contract.notes ? `<p class="notes">${escapeHtml(contract.notes)}</p>` : ''}
      <ol class="legal-list">
        <li>خریدار با امضای این قرارداد، نوع سنگ، ابعاد، ضخامت، متراژ، تعداد، کیفیت، فرآوری، قیمت و سایر مشخصات مندرج در قرارداد را تأیید می‌نماید.</li>
        <li>با توجه به ماهیت طبیعی سنگ، تفاوت‌های متعارف در رنگ، طرح، رگه، بافت، خلل و فرج و سایر ویژگی‌های طبیعی، مغایرت یا عیب محسوب نمی‌شود.</li>
        <li>خریدار موظف است کالا را هنگام تحویل از نظر نوع، تعداد، متراژ، سلامت ظاهری و انطباق با سفارش بررسی نماید. هرگونه ادعای مغایرت یا کسری باید حداکثر ظرف ۲۴ ساعت اعلام گردد؛ در غیر این صورت کالا مورد تأیید خریدار تلقی خواهد شد.</li>
        <li>تحویل‌گیرنده کالا، امضاکننده اسناد حمل یا هر شخص معرفی‌شده از سوی خریدار، نماینده قانونی خریدار محسوب می‌گردد و تأیید وی به منزله تأیید خریدار خواهد بود.</li>
        <li>هزینه حمل، تخلیه، جابجایی، انبارش، برش و نصب کالا بر عهده خریدار بوده و مسئولیت کالا پس از تحویل به خریدار یا نماینده وی منتقل می‌گردد.</li>
        <li>کالاهای فرآوری‌شده، برش‌خورده، تولیدی یا سفارشی پس از تأیید سفارش توسط خریدار، قابل مرجوع یا استرداد نمی‌باشند.</li>
        <li>در صورت عدم پرداخت هر یک از تعهدات مالی در سررسید مقرر، فروشنده حق توقف تحویل سفارش، مطالبه کلیه مطالبات، خسارات قانونی، هزینه‌های دادرسی و حق‌الوکاله را خواهد داشت.</li>
        <li>اعتبار این قرارداد منوط به تسویه کامل و به‌موقع کلیه تعهدات مالی خریدار در مواعد مقرر می‌باشد و عدم پرداخت، موجب سلب حقوق قانونی فروشنده در مطالبه مطالبات و خسارات نخواهد بود.</li>
        <li>امضای این قرارداد به منزله مطالعه، پذیرش و تأیید کامل مفاد آن توسط خریدار می‌باشد.</li>
      </ol>
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
      break-inside: auto;
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

    .product-detail-row td {
      background: #fafafa;
      padding: 6px 8px;
    }

    .product-detail-inline {
      display: grid;
      gap: 6px;
    }

    .product-detail-inline h3 {
      margin: 0;
      font-size: 11px;
      color: #374151;
    }

    .detail-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      font-size: 9.5px;
    }

    .detail-block h4 {
      margin: 0 0 4px;
      font-size: 10px;
      color: #374151;
    }

    .nested-table {
      font-size: 9px;
      background: #ffffff;
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

    .legal-list {
      margin: 0;
      padding-right: 18px;
      text-align: justify;
    }

    .legal-list li {
      margin-bottom: 4px;
    }

    .contract-header,
    .signatures,
    .footer {
      break-inside: avoid;
      page-break-inside: avoid;
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

  </style>
  `;
}
