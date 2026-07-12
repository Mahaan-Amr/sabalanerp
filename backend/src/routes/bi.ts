import express, { Response } from 'express';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { protect, authorize } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, WorkspaceRequest } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { generatePdfFromHtml } from '../utils/pdf';
import { renderReportPdfHeaderTemplate } from '../utils/printTemplate';

const router = express.Router();
const prisma = new PrismaClient();

const REALIZED_STATUSES = new Set(['SIGNED', 'PRINTED']);
const PIPELINE_STATUSES = new Set(['PENDING_APPROVAL', 'APPROVED']);
const LOST_STATUSES = new Set(['CANCELLED', 'EXPIRED']);
const CURRENCY = 'تومان';

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object' && 'toString' in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatFaDate = (date: Date) =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

const formatFaDateTime = (date: Date) =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);

const parseDateParam = (value: unknown): Date | null => {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const resolvePeriod = (query: any) => {
  const today = startOfDay(new Date());
  const requestedFrom = parseDateParam(query.from);
  const requestedTo = parseDateParam(query.to);
  let from = requestedFrom || new Date(today.getFullYear(), today.getMonth(), 1);
  let to = requestedTo || endOfDay(today);

  if (!requestedFrom || !requestedTo) {
    switch (query.period) {
      case 'today':
        from = today;
        to = endOfDay(today);
        break;
      case 'yesterday':
        from = addDays(today, -1);
        to = endOfDay(addDays(today, -1));
        break;
      case 'week':
        from = addDays(today, -6);
        to = endOfDay(today);
        break;
      case 'quarter':
        from = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
        to = endOfDay(today);
        break;
      case 'year':
        from = new Date(today.getFullYear(), 0, 1);
        to = endOfDay(today);
        break;
      case 'last12':
        from = new Date(today.getFullYear(), today.getMonth() - 11, 1);
        to = endOfDay(today);
        break;
      case 'month':
      default:
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = endOfDay(today);
        break;
    }
  }

  from = startOfDay(from);
  to = endOfDay(to);
  const periodMs = Math.max(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000);
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - periodMs);

  return { from, to, previousFrom: startOfDay(previousFrom), previousTo: endOfDay(previousTo) };
};

const inRange = (date: Date | string | null | undefined, from: Date, to: Date) => {
  if (!date) return false;
  const value = new Date(date).getTime();
  return value >= from.getTime() && value <= to.getTime();
};

const getRealizedDate = (contract: any) => contract.signedAt || contract.createdAt;
const getPipelineDate = (contract: any) => contract.createdAt;
const isRealized = (contract: any) => REALIZED_STATUSES.has(contract.status);
const isPipeline = (contract: any) => PIPELINE_STATUSES.has(contract.status);
const isLost = (contract: any) => LOST_STATUSES.has(contract.status);

const getDiscount = (contract: any) => {
  const discount = contract.contractData?.discount || {};
  return {
    amount: toNumber(discount.amount),
    percent: toNumber(discount.percent)
  };
};

const getPaidAmount = (contract: any) => {
  return (contract.payments || []).reduce((sum: number, payment: any) => {
    if (payment.status === 'CANCELLED') return sum;
    const installments = payment.installments || [];
    if (installments.length > 0) {
      return sum + installments
        .filter((installment: any) => installment.status === 'PAID')
        .reduce((inner: number, installment: any) => inner + toNumber(installment.amount), 0);
    }
    return payment.status === 'COMPLETED' ? sum + toNumber(payment.totalAmount) : sum;
  }, 0);
};

const getOverdueAmount = (contract: any, today: Date) => {
  if (!isRealized(contract)) return 0;
  return (contract.payments || []).reduce((sum: number, payment: any) => {
    if (payment.status === 'CANCELLED') return sum;
    const installments = payment.installments || [];
    if (installments.length > 0) {
      return sum + installments
        .filter((installment: any) => installment.status !== 'PAID' && installment.status !== 'CANCELLED' && installment.dueDate && new Date(installment.dueDate) < today)
        .reduce((inner: number, installment: any) => inner + toNumber(installment.amount), 0);
    }
    return payment.status !== 'COMPLETED' && payment.paymentDate && new Date(payment.paymentDate) < today
      ? sum + toNumber(payment.totalAmount)
      : sum;
  }, 0);
};

const getProductTypeLabel = (value: unknown) => {
  const text = String(value || '').toLowerCase();
  if (text.includes('stair') || text.includes('پله')) return 'پله';
  if (text.includes('slab') || text.includes('اسلب')) return 'اسلب';
  if (text.includes('prepared') || text.includes('cubic') || text.includes('ready') || text.includes('کیوبیک') || text.includes('قطعات')) return 'کیوبیک و قطعات آماده';
  if (text.includes('volumetric')) return 'حجمی';
  if (text.includes('service')) return 'خدمات';
  return 'طولی';
};

const getCustomerName = (customer: any) => {
  const fullName = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim();
  return fullName || customer?.companyName || 'مشتری نامشخص';
};

const getUserName = (user: any) => {
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return fullName || user?.username || 'کاربر نامشخص';
};

const buildSeries = (contracts: any[], from: Date, to: Date) => {
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  const monthly = days > 62;
  const buckets = new Map<string, { label: string; realized: number; pipeline: number; collected: number }>();

  const keyFor = (date: Date) => monthly
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    : date.toISOString().slice(0, 10);

  const cursor = new Date(from);
  while (cursor <= to) {
    const key = keyFor(cursor);
    if (!buckets.has(key)) buckets.set(key, { label: monthly ? formatFaDate(new Date(cursor.getFullYear(), cursor.getMonth(), 1)).slice(0, 7) : formatFaDate(cursor), realized: 0, pipeline: 0, collected: 0 });
    cursor.setDate(cursor.getDate() + (monthly ? 32 : 1));
    if (monthly) cursor.setDate(1);
  }

  contracts.forEach((contract) => {
    if (isRealized(contract) && inRange(getRealizedDate(contract), from, to)) {
      const bucket = buckets.get(keyFor(new Date(getRealizedDate(contract))));
      if (bucket) bucket.realized += toNumber(contract.totalAmount);
    }
    if (isPipeline(contract) && inRange(getPipelineDate(contract), from, to)) {
      const bucket = buckets.get(keyFor(new Date(getPipelineDate(contract))));
      if (bucket) bucket.pipeline += toNumber(contract.totalAmount);
    }
    (contract.payments || []).forEach((payment: any) => {
      if (payment.status === 'COMPLETED' && inRange(payment.paymentDate || payment.updatedAt, from, to)) {
        const bucket = buckets.get(keyFor(new Date(payment.paymentDate || payment.updatedAt)));
        if (bucket) bucket.collected += toNumber(payment.totalAmount);
      }
      (payment.installments || []).forEach((installment: any) => {
        if (installment.status === 'PAID' && inRange(installment.paidAt, from, to)) {
          const bucket = buckets.get(keyFor(new Date(installment.paidAt)));
          if (bucket) bucket.collected += toNumber(installment.amount);
        }
      });
    });
  });

  return Array.from(buckets.values());
};

const sortDesc = <T>(items: T[], getter: (item: T) => number) => [...items].sort((a, b) => getter(b) - getter(a));

const buildOverview = async (req: WorkspaceRequest) => {
  const { from, to, previousFrom, previousTo } = resolvePeriod(req.query);
  const today = startOfDay(new Date());
  const canSeeAll = req.user?.role === 'ADMIN' || req.workspacePermission === WORKSPACE_PERMISSIONS.ADMIN;
  const departmentId = canSeeAll ? null : req.user?.departmentId || '__no_department__';
  const whereClause = departmentId ? { departmentId } : {};

  const [contracts, products] = await Promise.all([
    prisma.salesContract.findMany({
      where: whereClause,
      include: {
        customer: true,
        department: true,
        createdByUser: {
          select: { id: true, firstName: true, lastName: true, username: true }
        },
        items: {
          include: { product: true }
        },
        deliveries: {
          include: { products: { include: { product: true } } }
        },
        payments: {
          include: { installments: true }
        }
      }
    }),
    prisma.product.findMany({
      where: { isAvailable: true, isActive: true, deletedAt: null },
      select: { id: true, name: true, namePersian: true, code: true }
    })
  ]);

  const realizedCurrent = contracts.filter((contract) => isRealized(contract) && inRange(getRealizedDate(contract), from, to));
  const realizedPrevious = contracts.filter((contract) => isRealized(contract) && inRange(getRealizedDate(contract), previousFrom, previousTo));
  const pipelineCurrent = contracts.filter((contract) => isPipeline(contract) && inRange(getPipelineDate(contract), from, to));
  const lostCurrent = contracts.filter((contract) => isLost(contract) && inRange(contract.updatedAt || contract.createdAt, from, to));

  const realizedSales = realizedCurrent.reduce((sum, contract) => sum + toNumber(contract.totalAmount), 0);
  const previousRealizedSales = realizedPrevious.reduce((sum, contract) => sum + toNumber(contract.totalAmount), 0);
  const pipelineSales = pipelineCurrent.reduce((sum, contract) => sum + toNumber(contract.totalAmount), 0);
  const lostSales = lostCurrent.reduce((sum, contract) => sum + toNumber(contract.totalAmount), 0);
  const paidAmount = realizedCurrent.reduce((sum, contract) => sum + getPaidAmount(contract), 0);
  const receivableAmount = Math.max(realizedSales - paidAmount, 0);
  const overdueAmount = realizedCurrent.reduce((sum, contract) => sum + getOverdueAmount(contract, today), 0);
  const averageContractValue = realizedCurrent.length ? Math.round(realizedSales / realizedCurrent.length) : 0;
  const growthPercent = previousRealizedSales > 0
    ? Math.round(((realizedSales - previousRealizedSales) / previousRealizedSales) * 100)
    : realizedSales > 0 ? 100 : 0;

  const allDeliveries = contracts.flatMap((contract) => (contract.deliveries || []).map((delivery: any) => ({ ...delivery, contract })));
  const deliveryRisk = {
    overdue: allDeliveries.filter((delivery) => delivery.deliveryDate && new Date(delivery.deliveryDate) < today && !['DELIVERED', 'CANCELLED'].includes(delivery.status)),
    upcoming: allDeliveries.filter((delivery) => delivery.deliveryDate && new Date(delivery.deliveryDate) >= today && new Date(delivery.deliveryDate) <= addDays(today, 7) && delivery.status === 'SCHEDULED'),
    deliveredUnconfirmed: allDeliveries.filter((delivery) => delivery.status === 'DELIVERED' && !delivery.customerConfirmation),
    completed: allDeliveries.filter((delivery) => delivery.status === 'DELIVERED' && (delivery.customerConfirmation || delivery.deliveredAt)),
    cancelled: allDeliveries.filter((delivery) => delivery.status === 'CANCELLED')
  };

  const sellerMap = new Map<string, any>();
  contracts.forEach((contract) => {
    const seller = contract.createdByUser;
    const key = seller?.id || 'unknown';
    if (!sellerMap.has(key)) {
      sellerMap.set(key, {
        id: key,
        name: getUserName(seller),
        realizedSales: 0,
        realizedContracts: 0,
        averageContractValue: 0,
        pipelineAmount: 0,
        discountAmount: 0,
        discountPercent: 0,
        receivableAmount: 0,
        overdueAmount: 0,
        lostAmount: 0,
        lostContracts: 0,
        createdContracts: 0,
        draftContracts: 0,
        pendingContracts: 0,
        approvedUnsignedContracts: 0,
        printedContracts: 0,
        deliveryPlans: 0,
        paymentRows: 0
      });
    }
    const row = sellerMap.get(key);
    if (inRange(contract.createdAt, from, to)) row.createdContracts += 1;
    if (contract.status === 'DRAFT' && inRange(contract.createdAt, from, to)) row.draftContracts += 1;
    if (contract.status === 'PENDING_APPROVAL' && inRange(contract.createdAt, from, to)) row.pendingContracts += 1;
    if (contract.status === 'APPROVED' && inRange(contract.createdAt, from, to)) row.approvedUnsignedContracts += 1;
    if (contract.status === 'PRINTED' && inRange(contract.printedAt || contract.updatedAt, from, to)) row.printedContracts += 1;
    row.deliveryPlans += (contract.deliveries || []).filter((delivery: any) => inRange(delivery.createdAt, from, to)).length;
    row.paymentRows += (contract.payments || []).filter((payment: any) => inRange(payment.createdAt, from, to)).length;

    if (isRealized(contract) && inRange(getRealizedDate(contract), from, to)) {
      const amount = toNumber(contract.totalAmount);
      row.realizedSales += amount;
      row.realizedContracts += 1;
      row.discountAmount += getDiscount(contract).amount;
      row.receivableAmount += Math.max(amount - getPaidAmount(contract), 0);
      row.overdueAmount += getOverdueAmount(contract, today);
    }
    if (isPipeline(contract) && inRange(getPipelineDate(contract), from, to)) row.pipelineAmount += toNumber(contract.totalAmount);
    if (isLost(contract) && inRange(contract.updatedAt || contract.createdAt, from, to)) {
      row.lostAmount += toNumber(contract.totalAmount);
      row.lostContracts += 1;
    }
  });

  const sellers = sortDesc(Array.from(sellerMap.values()).map((row) => ({
    ...row,
    averageContractValue: row.realizedContracts ? Math.round(row.realizedSales / row.realizedContracts) : 0,
    discountPercent: row.realizedSales > 0 ? Number(((row.discountAmount / row.realizedSales) * 100).toFixed(2)) : 0,
    conversionRate: row.createdContracts > 0 ? Math.round((row.realizedContracts / Math.max(row.createdContracts - row.lostContracts, 1)) * 100) : 0
  })), (row) => row.realizedSales);

  const productMap = new Map<string, any>();
  const productTypeMap = new Map<string, any>();
  realizedCurrent.forEach((contract) => {
    (contract.items || []).forEach((item: any) => {
      const product = item.product;
      const key = product?.id || item.productId || 'unknown';
      const amount = toNumber(item.totalPrice);
      const quantity = toNumber(item.quantity);
      const contractData = (contract.contractData || {}) as any;
      const type = getProductTypeLabel(item.productType || contractData.products?.[0]?.productType);
      if (!productMap.has(key)) {
        productMap.set(key, { id: key, name: product?.namePersian || product?.name || 'محصول نامشخص', code: product?.code || '', realizedSales: 0, quantity: 0, contracts: 0 });
      }
      const row = productMap.get(key);
      row.realizedSales += amount;
      row.quantity += quantity;
      row.contracts += 1;

      if (!productTypeMap.has(type)) productTypeMap.set(type, { type, value: 0, count: 0 });
      const typeRow = productTypeMap.get(type);
      typeRow.value += amount;
      typeRow.count += 1;
    });

    const contractData = (contract.contractData || {}) as any;
    const services = Array.isArray(contractData.serviceRows) ? contractData.serviceRows : [];
    services.forEach((service: any) => {
      const amount = toNumber(service.totalPrice);
      if (!productTypeMap.has('خدمات')) productTypeMap.set('خدمات', { type: 'خدمات', value: 0, count: 0 });
      const typeRow = productTypeMap.get('خدمات');
      typeRow.value += amount;
      typeRow.count += 1;
    });
  });

  const soldProductIds = new Set(Array.from(productMap.keys()));
  const customerMap = new Map<string, any>();
  contracts.forEach((contract) => {
    const customer = contract.customer;
    const key = customer?.id || contract.customerId || 'unknown';
    if (!customerMap.has(key)) {
      customerMap.set(key, { id: key, name: getCustomerName(customer), realizedSales: 0, realizedContracts: 0, allRealizedContracts: 0, receivableAmount: 0, overdueAmount: 0, firstRealizedAt: null as Date | null });
    }
    const row = customerMap.get(key);
    if (isRealized(contract)) {
      row.allRealizedContracts += 1;
      const realizedDate = new Date(getRealizedDate(contract));
      if (!row.firstRealizedAt || realizedDate < row.firstRealizedAt) row.firstRealizedAt = realizedDate;
    }
    if (isRealized(contract) && inRange(getRealizedDate(contract), from, to)) {
      const amount = toNumber(contract.totalAmount);
      row.realizedSales += amount;
      row.realizedContracts += 1;
      row.receivableAmount += Math.max(amount - getPaidAmount(contract), 0);
      row.overdueAmount += getOverdueAmount(contract, today);
    }
  });

  const customers = Array.from(customerMap.values()).filter((row) => row.realizedSales > 0);
  const topCustomers = sortDesc(customers, (row) => row.realizedSales);
  const topFiveCustomerShare = realizedSales > 0
    ? Number(((topCustomers.slice(0, 5).reduce((sum, row) => sum + row.realizedSales, 0) / realizedSales) * 100).toFixed(2))
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    currency: CURRENCY,
    scope: {
      mode: canSeeAll ? 'company' : 'department',
      label: canSeeAll ? 'کل شرکت' : 'بخش کاربر'
    },
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: `${formatFaDate(from)} تا ${formatFaDate(to)}`,
      previousLabel: `${formatFaDate(previousFrom)} تا ${formatFaDate(previousTo)}`
    },
    cards: {
      realizedSales,
      growthPercent,
      pipelineSales,
      receivableAmount,
      overdueAmount,
      realizedContractCount: realizedCurrent.length,
      averageContractValue,
      deliveryRiskCount: deliveryRisk.overdue.length + deliveryRisk.upcoming.length + deliveryRisk.deliveredUnconfirmed.length
    },
    comparison: {
      previousRealizedSales,
      realizedSalesDelta: realizedSales - previousRealizedSales
    },
    trend: buildSeries(contracts, from, to),
    statusDistribution: [
      { status: 'فروش قطعی', value: realizedSales, count: realizedCurrent.length },
      { status: 'پایپ‌لاین', value: pipelineSales, count: pipelineCurrent.length },
      { status: 'ازدست‌رفته', value: lostSales, count: lostCurrent.length },
      { status: 'دریافت‌شده', value: paidAmount, count: realizedCurrent.length },
      { status: 'مانده دریافت', value: receivableAmount, count: realizedCurrent.length }
    ],
    sellers,
    finance: {
      paidAmount,
      receivableAmount,
      overdueAmount,
      paymentMethodMix: ['CASH', 'RECEIPT', 'CHECK'].map((method) => ({
        method,
        amount: realizedCurrent.reduce((sum, contract) => sum + (contract.payments || []).filter((payment: any) => payment.paymentMethod === method).reduce((inner: number, payment: any) => inner + toNumber(payment.totalAmount), 0), 0)
      }))
    },
    delivery: {
      overdue: deliveryRisk.overdue.length,
      upcoming: deliveryRisk.upcoming.length,
      deliveredUnconfirmed: deliveryRisk.deliveredUnconfirmed.length,
      completed: deliveryRisk.completed.length,
      cancelled: deliveryRisk.cancelled.length,
      rows: [...deliveryRisk.overdue, ...deliveryRisk.upcoming, ...deliveryRisk.deliveredUnconfirmed].slice(0, 20).map((delivery) => ({
        id: delivery.id,
        contractNumber: delivery.contract.contractNumber,
        customer: getCustomerName(delivery.contract.customer),
        deliveryDate: delivery.deliveryDate,
        status: delivery.status,
        customerConfirmation: delivery.customerConfirmation
      }))
    },
    products: {
      topProducts: sortDesc(Array.from(productMap.values()), (row) => row.realizedSales).slice(0, 20),
      productTypeMix: sortDesc(Array.from(productTypeMap.values()), (row) => row.value),
      lowPerformingProducts: products.filter((product) => !soldProductIds.has(product.id)).slice(0, 20)
    },
    customers: {
      topCustomers: topCustomers.slice(0, 20),
      repeatCustomers: topCustomers.filter((row) => row.allRealizedContracts > 1).slice(0, 20),
      concentrationTop5Percent: topFiveCustomerShare,
      receivableExposure: sortDesc(customers, (row) => row.receivableAmount).slice(0, 20),
      newCustomers: customers.filter((row) => row.firstRealizedAt && inRange(row.firstRealizedAt, from, to)).slice(0, 20)
    }
  };
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const renderBiReportHtml = (overview: any) => {
  const cardRows = [
    ['فروش قطعی', overview.cards.realizedSales],
    ['رشد فروش', `${overview.cards.growthPercent}%`],
    ['پایپ‌لاین فروش', overview.cards.pipelineSales],
    ['مانده قابل دریافت', overview.cards.receivableAmount],
    ['پرداخت‌های معوق', overview.cards.overdueAmount],
    ['تعداد قرارداد قطعی', overview.cards.realizedContractCount],
    ['میانگین ارزش قرارداد', overview.cards.averageContractValue],
    ['ریسک تحویل', overview.cards.deliveryRiskCount]
  ];

  const renderRows = (rows: Array<Array<unknown>>) => rows.map((row) => `
    <tr>${row.map((cell) => `<td>${typeof cell === 'number' ? cell.toLocaleString('fa-IR') : escapeHtml(cell)}</td>`).join('')}</tr>
  `).join('');

  return `
    <style>
      body { margin: 0; color: #1f2937; font-family: 'Yekan Bakh', Tahoma, Arial, sans-serif; }
      .sheet { padding: 8mm; padding-top: 2mm; direction: rtl; }
      h1 { margin: 0 0 10px; font-size: 18px; color: #074747; }
      h2 { margin: 18px 0 8px; font-size: 13px; color: #074747; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
      th, td { border: 1px solid #d1d5db; padding: 7px; font-size: 10px; text-align: right; }
      th { background: #f3f4f6; font-weight: 800; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
      .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 9px; background: #fbfdff; }
      .label { color: #64748b; font-size: 9px; }
      .value { color: #074747; font-size: 14px; font-weight: 900; margin-top: 4px; }
    </style>
    <div class="sheet">
      <h1>گزارش مدیریتی BI فروش</h1>
      <div class="summary">
        ${cardRows.map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${typeof value === 'number' ? value.toLocaleString('fa-IR') : escapeHtml(value)}</div></div>`).join('')}
      </div>
      <h2>عملکرد فروشندگان</h2>
      <table>
        <thead><tr><th>فروشنده</th><th>فروش قطعی</th><th>قرارداد قطعی</th><th>پایپ‌لاین</th><th>مانده</th><th>معوق</th></tr></thead>
        <tbody>${renderRows(overview.sellers.slice(0, 10).map((row: any) => [row.name, row.realizedSales, row.realizedContracts, row.pipelineAmount, row.receivableAmount, row.overdueAmount]))}</tbody>
      </table>
      <h2>محصولات برتر</h2>
      <table>
        <thead><tr><th>محصول</th><th>کد</th><th>فروش قطعی</th><th>مقدار</th><th>تعداد ردیف</th></tr></thead>
        <tbody>${renderRows(overview.products.topProducts.slice(0, 10).map((row: any) => [row.name, row.code, row.realizedSales, row.quantity, row.contracts]))}</tbody>
      </table>
      <h2>مشتریان برتر</h2>
      <table>
        <thead><tr><th>مشتری</th><th>فروش قطعی</th><th>قرارداد قطعی</th><th>مانده</th><th>معوق</th></tr></thead>
        <tbody>${renderRows(overview.customers.topCustomers.slice(0, 10).map((row: any) => [row.name, row.realizedSales, row.realizedContracts, row.receivableAmount, row.overdueAmount]))}</tbody>
      </table>
    </div>
  `;
};

const requireBiAccess = [
  protect,
  authorize('ADMIN', 'MANAGER'),
  requireWorkspaceAccess(WORKSPACES.BI, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.BI_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW)
];

router.get('/sales/overview', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildOverview(req);
    res.json({ success: true, data: overview });
  } catch (error) {
    console.error('BI sales overview error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/sales/export/:table', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildOverview(req);
    const table = req.params.table;
    const rowsByTable: Record<string, any[]> = {
      sellers: overview.sellers,
      products: overview.products.topProducts,
      customers: overview.customers.topCustomers,
      receivables: overview.customers.receivableExposure,
      delivery: overview.delivery.rows
    };
    const rows = rowsByTable[table] || overview.sellers;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'BI');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sabalan-bi-${table}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('BI sales export error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/sales/summary.pdf', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildOverview(req);
    const filePath = await generatePdfFromHtml({
      htmlContent: renderBiReportHtml(overview),
      outputDir: path.join(process.cwd(), 'storage', 'bi-reports'),
      fileName: `bi-sales-${Date.now()}`,
      displayHeaderFooter: true,
      headerTemplate: renderReportPdfHeaderTemplate({
        title: 'گزارش مدیریتی BI فروش',
        reportRange: overview.period.label,
        scopeLabel: overview.scope.label,
        generatedAt: formatFaDateTime(new Date(overview.generatedAt))
      }),
      margin: { top: '34mm', right: '5mm', bottom: '8mm', left: '5mm' }
    });
    res.download(filePath, `sabalan-bi-sales-${Date.now()}.pdf`);
  } catch (error) {
    console.error('BI sales PDF error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
