import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import { generatePdfFromHtml } from './pdf';
import { renderContractHtml } from './printTemplate';

export const salesContractPrintableInclude = {
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
      username: true
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

export const generateSalesContractPdf = async (contract: any) => {
  const timestamp = Date.now();
  const fileName = `sales_contract_${contract.contractNumber}_${timestamp}`;
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
    snapshotPaymentsCount
  });

  const html = renderContractHtml({
    ...contract,
    contractData: contract.contractData
  });

  return generatePdfFromHtml({
    htmlContent: html,
    fileName,
    landscape: false,
    scale: 1,
    widthMm: 210,
    heightMm: 297
  });
};
