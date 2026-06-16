import fs from 'fs';
import path from 'path';

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

interface NormalizedProductTool {
  name: string;
  amount: number;
  amountLabel: string;
  rate: number;
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
  isMandatory: boolean;
  mandatoryPercentage: number;
  totalPrice: number;
  description: string;
  cuts: NormalizedCut[];
  services: NormalizedService[];
  tools: NormalizedProductTool[];
  layerSummary: string;
  finishingSummary: string;
  remainingSummary: string;
}

interface FlatProductRow {
  indexLabel: string;
  code: string;
  description: string;
  category: string;
  dimensionsOrAmount: string;
  quantityOrArea: string;
  rate: string;
  total: string;
  className?: string;
}

interface NormalizedDelivery {
  index: number;
  date: string;
  address: string;
  manager: string;
  receiver: string;
  notes: string;
  products: Array<{ name: string; quantity: number; amountLabel: string }>;
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
const SELLER_ADDRESS = 'شیراز، بزرگراه دکتر حسابی، بعد از کوچه 46';
const COMPANY_PHONE = '071-91010900';
const DELIVERY_NOTE = 'برنامه تحویل با توجه به شرایط اجرایی و با هماهنگی خریدار، ممکن است تغییر یابد';
const PAYMENT_NOTE = 'در صورت عدم پرداخت، تأمین کالا به میزان وجوه پرداختی و مانده سفارش با نرخ روز خواهد بود';

const publicAssetPath = (...segments: string[]): string => {
  const candidates = [
    process.env.SABALAN_LOGO_PATH || '',
    path.resolve(process.cwd(), 'public', ...segments),
    path.resolve(process.cwd(), 'backend', 'public', ...segments),
    path.resolve(process.cwd(), '..', 'backend', 'public', ...segments),
    path.resolve(process.cwd(), '..', 'frontend', 'public', ...segments),
    path.resolve(process.cwd(), 'frontend', 'public', ...segments)
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
};

const fileToDataUri = (filePath: string, mimeType: string): string => {
  if (!fs.existsSync(filePath)) return '';
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
};

const logoUrl = fileToDataUri(publicAssetPath('brand', 'sabalan-logo.jpg'), 'image/jpeg');
const yekanRegularUrl = fileToDataUri(publicAssetPath('yekan-bakh', 'YekanBakh-Regular.woff2'), 'font/woff2');
const yekanSemiBoldUrl = fileToDataUri(publicAssetPath('yekan-bakh', 'YekanBakh-SemiBold.woff2'), 'font/woff2');
const yekanBoldUrl = fileToDataUri(publicAssetPath('yekan-bakh', 'YekanBakh-Bold.woff2'), 'font/woff2');

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

const latinDigits = (value: string): string => value
  .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
  .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));

const toFaDigits = (value: string): string => value.replace(/\d/g, (char) => '۰۱۲۳۴۵۶۷۸۹'[Number(char)]);

const formatPersianDate = (value: unknown): string => {
  if (!value) return EMPTY;
  const raw = String(value).trim();
  if (!raw) return EMPTY;

  const persianDateLike = latinDigits(raw).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (persianDateLike) {
    const parts = persianDateLike.slice(1).map((part) => Number(part.trim()));
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return EMPTY;
    const [year, month, day] = parts;
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return EMPTY;
    return toFaDigits(`${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`);
  }

  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const storedYear = date.getFullYear();
  if (storedYear >= 1300 && storedYear <= 1600) {
    return toFaDigits(`${String(storedYear).padStart(4, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`);
  }
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}/${month}/${day}` : EMPTY;
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

const getSellerPhone = (createdByUser: any): string => {
  const phone = createdByUser?.profile?.phone;
  return typeof phone === 'string' && phone.trim() ? phone.trim() : EMPTY;
};

const getUserName = (user: any): string =>
  [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || EMPTY;

const deliveryUnitLabel = (unit: unknown): string => {
  if (unit === 'meter') return 'متر طول';
  if (unit === 'squareMeter') return 'متر مربع';
  return 'عدد';
};

const inferDeliveryUnit = (product: NormalizedProduct | undefined, deliveryProduct: any): string => {
  if (deliveryProduct?.unit) return String(deliveryProduct.unit);
  if (product?.productType === 'طولی') return 'meter';
  if (product?.productType === 'اسلب') return 'squareMeter';
  return 'count';
};

const formatDeliveryAmount = (
  deliveryProduct: any,
  product: NormalizedProduct | undefined,
  fallbackQuantity: unknown
): string => {
  const unit = inferDeliveryUnit(product, deliveryProduct);
  const amount = toNumber(deliveryProduct?.amount || deliveryProduct?.quantity || fallbackQuantity);
  const fractionDigits = unit === 'count' ? 0 : 2;
  return `${toFaNumber(amount, fractionDigits)} ${deliveryUnitLabel(unit)}`;
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

      const tools: NormalizedProductTool[] = [
        ...(Array.isArray(product?.tools) ? product.tools : []),
        ...(Array.isArray(product?.meta?.tools) ? product.meta.tools : [])
      ].map((tool: any) => {
        const amount = toNumber(tool?.computedMeters || tool?.meters || tool?.amount);
        const rate = toNumber(tool?.pricePerMeter || tool?.rate || tool?.unitPrice);
        const cost = toNumber(tool?.totalPrice || tool?.cost);
        return {
          name: tool?.namePersian || tool?.name || EMPTY,
          amount,
          amountLabel: amount > 0 ? `${toFaNumber(amount, 2)} متر طول` : EMPTY,
          rate,
          rateLabel: rate > 0 ? `${toFaNumber(rate)} تومان / متر طول` : EMPTY,
          cost
        };
      });

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
        isMandatory: Boolean(product?.isMandatory ?? relationItem?.isMandatory),
        mandatoryPercentage: toNumber(product?.mandatoryPercentage),
        totalPrice: toNumber(product?.totalPrice || relationItem?.totalPrice),
        description: product?.description || relationItem?.description || EMPTY,
        cuts: [...cutsFromBreakdown, ...cutsFromDetails],
        services,
        tools,
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
    isMandatory: Boolean(item?.isMandatory),
    mandatoryPercentage: toNumber(item?.mandatoryPercentage),
    totalPrice: toNumber(item?.totalPrice),
    description: item?.description || EMPTY,
    cuts: [],
    services: [],
    tools: [],
    layerSummary: EMPTY,
    finishingSummary: EMPTY,
    remainingSummary: EMPTY
  }));
};

const normalizeDeliveries = (contract: RenderableContract, products: NormalizedProduct[]): NormalizedDelivery[] => {
  const relationDeliveries = Array.isArray(contract.deliveries) ? contract.deliveries : [];
  const contractDataDeliveries = Array.isArray(contract.contractData?.deliveries) ? contract.contractData.deliveries : [];
  if (contractDataDeliveries.length > 0) {
    return contractDataDeliveries.map((snapshot: any, index: number) => {
      const snapshotProducts = Array.isArray(snapshot?.products)
        ? snapshot.products.map((deliveryProduct: any) => {
            const productIndex = toNumber(deliveryProduct?.productIndex);
            const product = products[productIndex] ||
              products.find((candidate) => candidate.id.startsWith(`${deliveryProduct?.productId || ''}-`));
            return {
              name: product?.name || EMPTY,
              quantity: toNumber(deliveryProduct?.quantity),
              amountLabel: formatDeliveryAmount(deliveryProduct, product, deliveryProduct?.quantity)
            };
          })
        : [];

      return {
        index: index + 1,
        date: formatPersianDate(snapshot?.deliveryDate),
        address: String(snapshot?.deliveryAddress || contract.contractData?.project?.address || EMPTY),
        manager: String(snapshot?.projectManagerName || EMPTY),
        receiver: String(snapshot?.receiverName || EMPTY),
        notes: String(snapshot?.notes || EMPTY),
        products: snapshotProducts
      };
    });
  }
  const length = Math.max(relationDeliveries.length, contractDataDeliveries.length);

  const rows: NormalizedDelivery[] = [];
  for (let index = 0; index < length; index += 1) {
    const relation = relationDeliveries[index] || {};
    const snapshot = contractDataDeliveries[index] || {};

    const relationProducts = Array.isArray(relation?.products)
      ? relation.products.map((deliveryProduct: any) => ({
          name: deliveryProduct?.product?.namePersian || deliveryProduct?.product?.name || EMPTY,
          quantity: toNumber(deliveryProduct?.quantity),
          amountLabel: formatDeliveryAmount(deliveryProduct, undefined, deliveryProduct?.quantity)
        }))
      : [];

    const snapshotProducts = Array.isArray(snapshot?.products)
      ? snapshot.products.map((deliveryProduct: any) => ({
          name: products.find((product) => product.id.startsWith(`${deliveryProduct?.productId || ''}-`))?.name || `محصول ${toNumber(deliveryProduct?.productIndex) + 1}`,
          quantity: toNumber(deliveryProduct?.quantity),
          amountLabel: formatDeliveryAmount(
            deliveryProduct,
            products.find((product) => product.id.startsWith(`${deliveryProduct?.productId || ''}-`)),
            deliveryProduct?.quantity
          )
        }))
      : [];

    rows.push({
      index: index + 1,
      date: formatPersianDate(snapshot?.deliveryDate || relation?.deliveryDate),
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
  const snapshotPayments = Array.isArray(contract.contractData?.payment?.payments)
    ? contract.contractData.payment.payments
    : (Array.isArray(contract.contractData?.payment?.installments) ? contract.contractData.payment.installments : []);
  if (snapshotPayments.length > 0) {
    return snapshotPayments.map((snapshot: any, index: number) => ({
      index: index + 1,
      methodLabel: paymentMethodLabel(snapshot?.method, snapshot?.cashType),
      amount: toNumber(snapshot?.amount),
      statusLabel: paymentStatusLabel(snapshot?.status),
      paymentDate: formatDate(snapshot?.paymentDate),
      checkNumber: String(snapshot?.checkNumber || EMPTY),
      checkOwnerName: String(snapshot?.checkOwnerName || EMPTY),
      handoverDate: formatDate(snapshot?.handoverDate),
      notes: String(snapshot?.description || EMPTY),
      installments: []
    }));
  }
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

const isMeaningfulCut = (cut: NormalizedCut): boolean =>
  cut.meters > 0 || cut.rate > 0 || cut.cost > 0;

const isMeaningfulService = (service: NormalizedService): boolean =>
  hasTextValue(service.name) || service.amount > 0 || service.rate > 0 || service.cost > 0;

const isMeaningfulTool = (tool: NormalizedProductTool): boolean =>
  hasTextValue(tool.name) || tool.amount > 0 || tool.rate > 0 || tool.cost > 0;

const buildFlatProductRows = (products: NormalizedProduct[], currency: string, grandTotal: number): FlatProductRow[] => {
  const rows: FlatProductRow[] = [];

  products.forEach((product, productIndex) => {
    const addOnsTotal =
      product.cuts.reduce((sum, cut) => sum + toNumber(cut.cost), 0) +
      product.tools.reduce((sum, tool) => sum + toNumber(tool.cost), 0) +
      product.services.reduce((sum, service) => sum + toNumber(service.cost), 0);
    const baseAmount = product.originalTotalPrice > 0
      ? product.originalTotalPrice
      : Math.max(product.totalPrice - addOnsTotal, 0) || product.totalPrice;
    rows.push({
      indexLabel: toFaNumber(productIndex + 1),
      code: product.code,
      description: product.name,
      category: 'محصول',
      dimensionsOrAmount: product.dimensions,
      quantityOrArea: `${toFaNumber(product.quantity, 2)} عدد / ${toFaNumber(product.squareMeters, 3)} متر مربع`,
      rate: product.unitPrice > 0 ? formatAmount(product.unitPrice, currency) : EMPTY,
      total: formatAmount(baseAmount, currency)
    });

    if (product.isMandatory && product.mandatoryPercentage > 0 && product.originalTotalPrice > 0) {
      const mandatoryAmount = product.originalTotalPrice * (product.mandatoryPercentage / 100);
      rows.push({
        indexLabel: '',
        code: '',
        description: `حکمی ${toFaNumber(product.mandatoryPercentage)}٪`,
        category: 'حکمی',
        dimensionsOrAmount: formatAmount(product.originalTotalPrice, currency),
        quantityOrArea: '',
        rate: `${toFaNumber(product.mandatoryPercentage)}٪`,
        total: formatAmount(mandatoryAmount, currency)
      });
    }

    product.cuts.filter(isMeaningfulCut).forEach((cut) => {
      rows.push({
        indexLabel: '',
        code: '',
        description: cut.type,
        category: 'برش',
        dimensionsOrAmount: `${toFaNumber(cut.meters, 2)} متر`,
        quantityOrArea: '',
        rate: cut.rate > 0 ? formatAmount(cut.rate, currency) : EMPTY,
        total: formatAmount(cut.cost, currency)
      });
    });

    product.tools.filter(isMeaningfulTool).forEach((tool) => {
      rows.push({
        indexLabel: '',
        code: '',
        description: tool.name,
        category: 'ابزار',
        dimensionsOrAmount: tool.amountLabel,
        quantityOrArea: '',
        rate: tool.rateLabel,
        total: formatAmount(tool.cost, currency)
      });
    });

    product.services.filter(isMeaningfulService).forEach((service) => {
      rows.push({
        indexLabel: '',
        code: '',
        description: service.name,
        category: service.category,
        dimensionsOrAmount: service.amountLabel,
        quantityOrArea: '',
        rate: service.rateLabel || EMPTY,
        total: formatAmount(service.cost, currency)
      });
    });
  });

  rows.push({
    indexLabel: '',
    code: '',
    description: 'جمع کل فاکتور',
    category: '',
    dimensionsOrAmount: '',
    quantityOrArea: '',
    rate: '',
    total: formatAmount(grandTotal, currency),
    className: 'total-row'
  });

  return rows;
};

const renderProductMainRows = (products: NormalizedProduct[], currency: string, grandTotal: number): string => {
  if (!products.length) {
    return `<tr><td colspan="8" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;
  }

  return buildFlatProductRows(products, currency, grandTotal).map((row) => {
    const classAttribute = row.className ? ` class="${row.className}"` : '';
    return `
      <tr${classAttribute}>
        <td>${escapeHtml(row.indexLabel)}</td>
        <td>${escapeHtml(row.code || EMPTY)}</td>
        <td>${escapeHtml(row.description || EMPTY)}</td>
        <td>${escapeHtml(row.category || EMPTY)}</td>
        <td>${escapeHtml(row.dimensionsOrAmount || EMPTY)}</td>
        <td>${escapeHtml(row.quantityOrArea || EMPTY)}</td>
        <td>${escapeHtml(row.rate || EMPTY)}</td>
        <td>${escapeHtml(row.total || EMPTY)}</td>
      </tr>
    `;
  }).join('');
};

const renderDeliveryRows = (deliveries: NormalizedDelivery[]): string => {
  if (!deliveries.length) {
    return `<tr><td colspan="6" class="empty-cell">${escapeHtml(EMPTY)}</td></tr>`;
  }

  return deliveries.map((delivery) => {
    const productsLabel = delivery.products.length > 0
      ? delivery.products.map((product) => product.name).join('، ')
      : EMPTY;
    const amountLabel = delivery.products.length > 0
      ? delivery.products.map((product) => product.amountLabel).join('، ')
      : EMPTY;

    return `
      <tr class="delivery-row">
        <td>${toFaNumber(delivery.index)}</td>
        <td>${escapeHtml(productsLabel)}</td>
        <td>${escapeHtml(amountLabel)}</td>
        <td>${escapeHtml(delivery.date)}</td>
        <td>${escapeHtml(delivery.receiver)}</td>
        <td>${escapeHtml(delivery.notes)}</td>
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

const getContractHeaderMeta = (contract: RenderableContract) => {
  const contractData = contract.contractData || {};
  return {
    contractNumber: contract.contractNumber || contractData.contractNumber || EMPTY,
    contractDate: contractData.contractDate || formatDate(contract.createdAt),
    statusLabel: statusLabelMap[String(contract.status || '')] || String(contract.status || 'DRAFT')
  };
};

export function renderContractPdfHeaderTemplate(contract: RenderableContract): string {
  const { contractNumber, contractDate, statusLabel } = getContractHeaderMeta(contract);
  const logoMarkup = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" style="width:170px;height:38px;object-fit:contain;display:block;" />`
    : '';

  return `
    <div style="width:100%;height:30mm;padding:4mm 5mm 0;box-sizing:border-box;font-family:'Yekan Bakh',Tahoma,Arial,sans-serif;font-size:9px;color:#1f2937;direction:rtl;">
      <div style="height:24mm;border:1px solid #d1d5db;border-radius:8px;padding:4px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;direction:ltr;background:#fff;box-sizing:border-box;overflow:hidden;">
        <div style="flex:1;display:flex;align-items:center;justify-content:flex-start;height:100%;direction:ltr;">${logoMarkup}</div>
        <div style="min-width:210px;text-align:right;direction:rtl;line-height:1.55;">
          <div><strong>شماره قرارداد:</strong> ${escapeHtml(contractNumber)}</div>
          <div><strong>تاریخ تنظیم:</strong> ${escapeHtml(contractDate)}</div>
          <div><strong>وضعیت هنگام چاپ:</strong> ${escapeHtml(statusLabel)}</div>
          <div><strong>صفحه:</strong> <span class="pageNumber"></span></div>
        </div>
      </div>
    </div>
  `;
}

type RenderContractHtmlOptions = {
  reservePdfHeaderSpace?: boolean;
};

export function renderContractHtml(contract: RenderableContract, options: RenderContractHtmlOptions = {}): string {
  const contractData = contract.contractData || {};
  const customer = contract.customer || contractData.customer || {};
  const project = contractData.project || {};

  const normalizedProducts = normalizeProducts(contract);
  const normalizedDeliveries = normalizeDeliveries(contract, normalizedProducts);
  const normalizedPayments = normalizePayments(contract);
  const financials = normalizeFinancials(contract, normalizedProducts);

  const { contractNumber } = getContractHeaderMeta(contract);
  const sellerName = getUserName(contract.createdByUser);
  const sellerPhone = getSellerPhone(contract.createdByUser);

  const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.companyName || EMPTY;
  const customerPhone = getCustomerPhone(customer, contractData);
  const customerNationalCode = customer.nationalCode || contractData.customer?.nationalCode || EMPTY;
  const customerAddress = project.address || customer.workAddress || customer.homeAddress || customer.address || EMPTY;
  const projectManagerName = project.projectManagerName || customer.projectManagerName || EMPTY;
  const projectManagerNumber = project.projectManagerNumber || customer.projectManagerNumber || EMPTY;

  const digitalConfirmation = contract.signatures?.digitalConfirmation || null;

  return `
  <div class="sheet">
    <section class="section">
      <h2>قرارداد رسمی فروش و اجرای خدمات سنگ</h2>
      <div class="grid two-col balanced-info">
        <div><strong>آدرس مجموعه:</strong> ${escapeHtml(SELLER_ADDRESS)}</div>
        <div><strong>شماره تماس فروشنده:</strong> <span class="ltr-value">${escapeHtml(sellerPhone)}</span></div>
        <div><strong>شماره تماس مجموعه:</strong> <span class="ltr-value">${escapeHtml(COMPANY_PHONE)}</span></div>
        <div><strong>ایجاد کننده:</strong> ${escapeHtml(sellerName)}</div>
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
            <th>شرح</th>
            <th>دسته</th>
            <th>ابعاد/مقدار</th>
            <th>تعداد/متراژ</th>
            <th>نرخ</th>
            <th>مبلغ کل</th>
          </tr>
        </thead>
        <tbody>
          ${renderProductMainRows(normalizedProducts, financials.currency, financials.grandTotal)}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>برنامه تحویل</h2>
      <table class="delivery-table">
        <colgroup>
          <col class="delivery-index-col" />
          <col class="delivery-items-col" />
          <col class="delivery-amount-col" />
          <col class="delivery-date-col" />
          <col class="delivery-receiver-col" />
          <col class="delivery-notes-col" />
        </colgroup>
        <thead>
          <tr>
            <th>ردیف</th>
            <th>اقلام</th>
            <th>متراژ</th>
            <th>تاریخ تحویل</th>
            <th>تحویل‌گیرنده</th>
            <th>توضیحات</th>
          </tr>
        </thead>
        <tbody>
          ${renderDeliveryRows(normalizedDeliveries)}
        </tbody>
      </table>
      <p class="section-note">${escapeHtml(DELIVERY_NOTE)}</p>
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
      <p class="section-note">${escapeHtml(PAYMENT_NOTE)}</p>
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
      <h2>توضیحات</h2>
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
    @font-face {
      font-family: 'Yekan Bakh';
      src: url('${escapeHtml(yekanRegularUrl)}') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: 'Yekan Bakh';
      src: url('${escapeHtml(yekanSemiBoldUrl)}') format('woff2');
      font-weight: 600;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: 'Yekan Bakh';
      src: url('${escapeHtml(yekanBoldUrl)}') format('woff2');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }

    @page {
      size: A4 portrait;
      margin: ${options.reservePdfHeaderSpace ? '50mm 5mm 5mm 5mm' : '0'};
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
      font-family: 'Yekan Bakh', Tahoma, Arial, sans-serif;
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
      align-items: center;
      gap: 12px;
      direction: ltr;
    }

    .brand-logo {
      flex: 1;
      display: flex;
      justify-content: flex-start;
      align-items: center;
      min-height: 58px;
      direction: ltr;
    }

    .brand-logo img {
      max-width: 190px;
      max-height: 58px;
      object-fit: contain;
    }

    .meta {
      min-width: 190px;
      text-align: right;
      direction: rtl;
      font-size: 10px;
      color: #374151;
      line-height: 1.7;
    }

    .ltr-value {
      direction: ltr;
      unicode-bidi: isolate;
      display: inline-block;
      white-space: nowrap;
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

    .grid {
      display: grid;
      gap: 5px 12px;
    }

    .two-col {
      grid-template-columns: 1fr 1fr;
    }

    .balanced-info > div {
      min-width: 0;
      line-height: 1.8;
      overflow-wrap: anywhere;
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

    .delivery-index-col {
      width: 6%;
    }

    .delivery-items-col {
      width: 38%;
    }

    .delivery-amount-col {
      width: 13%;
    }

    .delivery-date-col {
      width: 15%;
    }

    .delivery-receiver-col {
      width: 14%;
    }

    .delivery-notes-col {
      width: 14%;
    }

    .delivery-table th,
    .delivery-table td {
      vertical-align: middle;
    }

    .delivery-row td:nth-child(2) {
      text-align: right;
      line-height: 1.7;
    }

    .delivery-row td:nth-child(3),
    .delivery-row td:nth-child(4) {
      white-space: normal;
      text-align: center;
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

    .total-row td {
      background: #f3f4f6;
      font-weight: 700;
    }

    .section-note {
      margin: 6px 0 0;
      color: #4b5563;
      font-size: 9.5px;
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
