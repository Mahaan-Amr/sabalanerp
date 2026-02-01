// Contract HTML Service
// Generates HTML content for contract documents

import type { ContractWizardData, CrmCustomer, ProjectAddress, ContractProduct, DeliverySchedule, PaymentMethod } from '../types/contract.types';
import { formatPrice, formatQuantity, formatSquareMeters } from '@/lib/numberFormat';

interface ContractHTMLData {
  contractNumber: string;
  contractDate: string;
  customer: CrmCustomer | null;
  project: ProjectAddress | null;
  products: ContractProduct[];
  deliveries: DeliverySchedule[];
  payment: PaymentMethod;
}

/**
 * Generate HTML content for contract document
 */
export const generateContractHTML = (data: ContractHTMLData): string => {
  const productsTable = data.products && data.products.length > 0 ? `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background-color: #f5f5f5;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">نام محصول</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">ابعاد</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">تعداد</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">متر مربع</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">فی</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">قیمت کل</th>
        </tr>
      </thead>
      <tbody>
        ${data.products.map((product: ContractProduct) => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.namePersian || product.product?.name || product.stoneName || 'نامشخص'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.widthValue && product.product?.thicknessValue ? `${product.product.widthValue} × ${product.product.thicknessValue}` : product.length && product.width ? `${product.length} × ${product.width}` : 'نامشخص'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatQuantity(product.quantity || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatSquareMeters(product.squareMeters || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.pricePerSquareMeter ? formatPrice(product.pricePerSquareMeter, product.currency || 'تومان') : 'نامشخص'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.totalPrice ? formatPrice(product.totalPrice, product.currency || 'تومان') : 'نامشخص'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const deliveriesSection = data.deliveries && data.deliveries.length > 0 ? `
    <h3>برنامه تحویل:</h3>
    <ul>
      ${data.deliveries.map((delivery: DeliverySchedule) => `
        <li>تاریخ: ${delivery.deliveryDate} - ${delivery.notes || 'بدون توضیحات'}</li>
      `).join('')}
    </ul>
  ` : '';

  const totalAmount = data.payment?.totalContractAmount || 
    data.products.reduce((sum, product) => sum + (product.totalPrice || 0), 0);

  return `
    <div style="font-family: 'Tahoma', sans-serif; direction: rtl; text-align: right;">
      <h1 style="text-align: center; color: #333;">قرارداد فروش سبلان استون</h1>
      
      <div style="margin: 20px 0;">
        <p><strong>شماره قرارداد:</strong> ${data.contractNumber}</p>
        <p><strong>تاریخ قرارداد:</strong> ${data.contractDate}</p>
      </div>

      <div style="margin: 20px 0;">
        <h3>اطلاعات مشتری:</h3>
        <p><strong>نام:</strong> ${data.customer?.firstName || ''} ${data.customer?.lastName || ''}</p>
        ${data.customer?.companyName ? `<p><strong>نام شرکت:</strong> ${data.customer.companyName}</p>` : ''}
        ${data.customer?.phoneNumbers && data.customer.phoneNumbers.length > 0 ? `<p><strong>شماره تماس:</strong> ${data.customer.phoneNumbers[0].number}</p>` : ''}
      </div>

      ${data.project ? `
        <div style="margin: 20px 0;">
          <h3>اطلاعات پروژه:</h3>
          <p><strong>آدرس پروژه:</strong> ${data.project.address || 'نامشخص'}</p>
          <p><strong>نام پروژه:</strong> ${data.project.projectName || 'نامشخص'}</p>
        </div>
      ` : ''}

      <div style="margin: 20px 0;">
        <h3>اقلام قرارداد:</h3>
        ${productsTable}
      </div>

      ${data.payment ? `
        <div style="margin: 20px 0;">
          <h3>اطلاعات پرداخت:</h3>
          <p><strong>مبلغ کل:</strong> ${formatPrice(totalAmount, data.payment.currency || 'تومان')}</p>
          ${data.payment.payments && data.payment.payments.length > 0 ? `
            <h4>جزئیات پرداخت:</h4>
            <ul>
              ${data.payment.payments.map((payment: any) => `
                <li>
                  ${payment.method === 'CASH' ? 'نقدی' : 'چک'} - 
                  ${formatPrice(payment.amount, data.payment.currency || 'تومان')} - 
                  ${payment.status === 'PAID' ? 'پرداخت شده' : 'در انتظار پرداخت'}
                </li>
              `).join('')}
            </ul>
          ` : ''}
        </div>
      ` : ''}

      ${deliveriesSection}

      <div style="margin-top: 40px; text-align: center;">
        <p>این قرارداد در تاریخ ${data.contractDate} منعقد شده است.</p>
      </div>
    </div>
  `;
};

