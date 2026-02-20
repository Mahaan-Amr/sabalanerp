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
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">?? ???</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">???</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">???</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">?? ??</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">?</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">?? ?</th>
        </tr>
      </thead>
      <tbody>
        ${data.products.map((product: ContractProduct) => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.namePersian || product.product?.name || product.stoneName || '???'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.widthValue && product.product?.thicknessValue ? `${product.product.widthValue} ? ${product.product.thicknessValue}` : product.length && product.width ? `${product.length} ? ${product.width}` : '???'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatQuantity(product.quantity || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatSquareMeters(product.squareMeters || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.pricePerSquareMeter ? formatPrice(product.pricePerSquareMeter, product.currency || '???') : '???'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.totalPrice ? formatPrice(product.totalPrice, product.currency || '???') : '???'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const deliveriesSection = data.deliveries && data.deliveries.length > 0 ? `
    <h3>??? ???:</h3>
    <ul>
      ${data.deliveries.map((delivery: DeliverySchedule) => `
        <li>???: ${delivery.deliveryDate} - ${delivery.notes || '?? ??'}</li>
      `).join('')}
    </ul>
  ` : '';

  const totalAmount = data.payment?.totalContractAmount || 
    data.products.reduce((sum, product) => sum + (product.totalPrice || 0), 0);

  return `
    <div style="font-family: 'Tahoma', sans-serif; direction: rtl; text-align: right;">
      <h1 style="text-align: center; color: #333;">?? ?? ??? ???</h1>
      
      <div style="margin: 20px 0;">
        <p><strong>??? ??:</strong> ${data.contractNumber}</p>
        <p><strong>??? ??:</strong> ${data.contractDate}</p>
      </div>

      <div style="margin: 20px 0;">
        <h3>?? ???:</h3>
        <p><strong>??:</strong> ${data.customer?.firstName || ''} ${data.customer?.lastName || ''}</p>
        ${data.customer?.companyName ? `<p><strong>?? ??:</strong> ${data.customer.companyName}</p>` : ''}
        ${data.customer?.phoneNumbers && data.customer.phoneNumbers.length > 0 ? `<p><strong>??? ??:</strong> ${data.customer.phoneNumbers[0].number}</p>` : ''}
      </div>

      ${data.project ? `
        <div style="margin: 20px 0;">
          <h3>?? ???:</h3>
          <p><strong>?? ???:</strong> ${data.project.address || '???'}</p>
          <p><strong>?? ???:</strong> ${data.project.projectName || '???'}</p>
        </div>
      ` : ''}

      <div style="margin: 20px 0;">
        <h3>??? ??:</h3>
        ${productsTable}
      </div>

      ${data.payment ? `
        <div style="margin: 20px 0;">
          <h3>?? ???:</h3>
          <p><strong>?? ?:</strong> ${formatPrice(totalAmount, data.payment.currency || '???')}</p>
          ${data.payment.payments && data.payment.payments.length > 0 ? `
            <h4>??? ???:</h4>
            <ul>
              ${data.payment.payments.map((payment: any) => {
                const methodLabel = payment.method === 'CASH_CARD' ? '?? (??)' : payment.method === 'CASH_SHIBA' ? '?? (??)' : payment.method === 'CHECK' ? '?' : payment.method === 'CASH' ? '??' : payment.method || '???';
                return `
                <li>
                  ${methodLabel} - 
                  ${formatPrice(payment.amount, data.payment.currency || '???')} - 
                  ${payment.status === 'PAID' ? '??? ??' : '? ??? ???'}
                </li>
              `;
              }).join('')}
            </ul>
          ` : ''}
        </div>
      ` : ''}

      ${deliveriesSection}

      <div style="margin-top: 40px; text-align: center;">
        <p>?? ?? ? ??? ${data.contractDate} ??? ?? ??.</p>
      </div>
    </div>
  `;
};


