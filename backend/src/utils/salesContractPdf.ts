import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { generatePdfFromHtml } from './pdf';
import { ContractCustomPrintOptions, ContractPrintVariant, renderContractHtml, renderContractPdfHeaderTemplate } from './printTemplate';

export const SALES_CONTRACT_PDF_TEMPLATE_VERSION = 'sales-contract-consumed-stone-pricing-v22-2026-08-08';
const prisma = new PrismaClient();

export const salesContractPrintableInclude = {
  productGraphState: true,
  customer: {
    include: {
      phoneNumbers: true,
      primaryContact: true
    }
  },
  department: true,
  createdByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      profile: {
        select: {
          phone: true
        }
      }
    }
  },
  approvedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  signedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true
    }
  },
  items: {
    include: {
      product: true
    }
  },
  deliveries: {
    include: {
      products: {
        include: {
          product: true
        }
      }
    }
  },
  payments: {
    include: {
      installments: {
        orderBy: {
          installmentNumber: 'asc' as const
        }
      }
    }
  }
};

export const resolveSalesContractPdfUrl = (req: Request, pdfPath: string): string | null => {
  if (!pdfPath) return null;
  if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
    return pdfPath;
  }

  const fileName = path.basename(pdfPath);
  if (!fileName) return null;

  const host = req.get('host');
  const protocol = req.protocol || 'http';
  const encodedFileName = encodeURIComponent(fileName);
  return `${protocol}://${host}/files/contracts/${encodedFileName}`;
};

export const ensureStoredSalesContractPdfExists = (pdfPath: string): boolean => {
  if (!pdfPath) return false;
  if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) return true;

  const resolvedPath = resolveStoredSalesContractPdfPath(pdfPath);

  return fs.existsSync(resolvedPath);
};

export const resolveStoredSalesContractPdfPath = (pdfPath: string): string => {
  return path.isAbsolute(pdfPath)
    ? pdfPath
    : path.join(process.cwd(), 'storage', 'contracts', path.basename(pdfPath));
};

export const buildSalesContractPdfDownloadName = (contract: any): string => {
  const safeNumber = String(contract?.contractNumber || contract?.id || 'contract')
    .replace(/[^\w.-]+/g, '_');
  return `sales_contract_${safeNumber}.pdf`;
};

const normalizeForFingerprint = (value: any): any => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForFingerprint);
  }

  if (typeof value.toJSON === 'function') {
    return normalizeForFingerprint(value.toJSON());
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, any>>((normalized, key) => {
      normalized[key] = normalizeForFingerprint(value[key]);
      return normalized;
    }, {});
};

const removePdfCacheSignatures = (signatures: any): any => {
  if (!signatures || typeof signatures !== 'object' || Array.isArray(signatures)) {
    return signatures || null;
  }

  const { print, accountingSalesPdf, accountingSalesPdfAccounting, accountingSalesPdfWorkshop, ...printableSignatures } = signatures;
  return printableSignatures;
};

export const buildSalesContractPdfFingerprint = (
  contract: any,
  variant: ContractPrintVariant = 'original',
  customPrint?: ContractCustomPrintOptions
): string => {
  const printableContract = {
    templateVersion: SALES_CONTRACT_PDF_TEMPLATE_VERSION,
    variant,
    customPrint: variant === 'custom' ? customPrint : undefined,
    id: contract?.id,
    contractNumber: contract?.contractNumber,
    title: contract?.title,
    titlePersian: contract?.titlePersian,
    status: contract?.status,
    type: contract?.type,
    totalAmount: contract?.totalAmount,
    currency: contract?.currency,
    contractData: contract?.contractData,
    customer: contract?.customer,
    department: contract?.department,
    createdByUser: contract?.createdByUser,
    approvedByUser: contract?.approvedByUser,
    signedByUser: contract?.signedByUser,
    items: contract?.items,
    deliveries: contract?.deliveries,
    payments: contract?.payments,
    signatures: removePdfCacheSignatures(contract?.signatures)
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizeForFingerprint(printableContract)))
    .digest('hex');
};

export const isSalesContractPdfCacheFresh = (
  contract: any,
  cachedFingerprint: unknown,
  currentFingerprint = buildSalesContractPdfFingerprint(contract)
): boolean => {
  return typeof cachedFingerprint === 'string' && cachedFingerprint === currentFingerprint;
};

export const generateSalesContractPdf = async (
  contract: any,
  variant: ContractPrintVariant = 'original',
  customPrint?: ContractCustomPrintOptions
) => {
  const usesCustomerFacingHeader = variant === 'original' || variant === 'summary';
  const timestamp = Date.now();
  const fileNamePrefix = variant === 'accounting'
    ? 'sales_contract_accounting'
    : variant === 'workshop'
      ? 'sales_contract_workshop'
      : variant === 'custom'
        ? 'sales_contract_custom'
        : variant === 'summary'
          ? 'sales_contract_summary'
          : 'sales_contract';
  const fileName = `${fileNamePrefix}_${contract.contractNumber}_${timestamp}`;
  const contractData = contract?.contractData || {};
  const relationItemsCount = Array.isArray(contract?.items) ? contract.items.length : 0;
  const relationDeliveriesCount = Array.isArray(contract?.deliveries) ? contract.deliveries.length : 0;
  const relationPaymentsCount = Array.isArray(contract?.payments) ? contract.payments.length : 0;
  const snapshotProductsCount = Array.isArray(contractData?.products) ? contractData.products.length : 0;
  const snapshotDeliveriesCount = Array.isArray(contractData?.deliveries) ? contractData.deliveries.length : 0;
  const snapshotPaymentsCount = Array.isArray(contractData?.payment?.payments) ? contractData.payment.payments.length : 0;

  console.info('[sales-pdf] generating contract pdf', {
    contractId: contract?.id,
    contractNumber: contract?.contractNumber,
    relationItemsCount,
    relationDeliveriesCount,
    relationPaymentsCount,
    snapshotProductsCount,
    snapshotDeliveriesCount,
    snapshotPaymentsCount,
    variant
  });

  const finishingIds = new Set<string>();
  if (Array.isArray(contractData?.products)) {
    contractData.products.forEach((product: any) => {
      const finishingId = String(product?.finishingId || product?.meta?.finishing?.id || '').trim();
      const finishingCode = String(product?.finishingCode || product?.meta?.finishing?.code || '').trim();
      if (finishingId && !finishingCode) finishingIds.add(finishingId);
    });
  }
  const finishingCodeById = finishingIds.size > 0
    ? Object.fromEntries((await prisma.stoneFinishing.findMany({
        where: { id: { in: Array.from(finishingIds) } },
        select: { id: true, code: true }
      })).map((finishing) => [finishing.id, finishing.code]))
    : {};
  const subServiceIds = new Set<string>();
  if (Array.isArray(contractData?.products)) {
    contractData.products.forEach((product: any) => {
      (Array.isArray(product?.appliedSubServices) ? product.appliedSubServices : [])
        .forEach((service: any) => {
          const id = String(service?.subServiceId || service?.subService?.id || '').trim();
          if (id && !service?.subService?.namePersian && !service?.subService?.name) {
            subServiceIds.add(id);
          }
        });
    });
  }
  const subServiceById = subServiceIds.size > 0
    ? Object.fromEntries((await prisma.subService.findMany({
        where: { id: { in: Array.from(subServiceIds) } },
        select: {
          id: true,
          code: true,
          name: true,
          namePersian: true,
          pricePerMeter: true,
          calculationBase: true
        }
      })).map((service) => [service.id, {
        code: service.code,
        name: service.namePersian || service.name || service.code,
        pricePerMeter: Number(service.pricePerMeter),
        calculationBase: service.calculationBase
      }]))
    : {};

  const html = renderContractHtml({
    ...contract,
    contractData: contract.contractData
  }, {
    reservePdfHeaderSpace: usesCustomerFacingHeader,
    variant,
    customPrint,
    finishingCodeById,
    subServiceById
  });

  return generatePdfFromHtml({
    htmlContent: html,
    headerTemplate: usesCustomerFacingHeader ? renderContractPdfHeaderTemplate(contract) : '<div></div>',
    footerTemplate: '<div></div>',
    displayHeaderFooter: usesCustomerFacingHeader,
    fileName,
    landscape: false,
    scale: 1,
    widthMm: 210,
    heightMm: 297,
    margin: usesCustomerFacingHeader
      ? { top: '50mm', right: '5mm', bottom: '5mm', left: '5mm' }
      : { top: '5mm', right: '5mm', bottom: '5mm', left: '5mm' }
  });
};
