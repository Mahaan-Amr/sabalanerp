// Contract HTML Generator
// Generates HTML representation of contract for printing/PDF

import { formatQuantity, formatSquareMeters, formatPrice } from '@/lib/numberFormat';

/**
 * Generate HTML representation of contract data
 * @param data Contract wizard data
 * @returns HTML string for contract printing
 */
export const generateContractHTML = (data: any): string => {
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
        ${data.products.map((product: any) => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.namePersian || product.product?.name || product.namePersian || product.name || '???'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.product?.widthValue && product.product?.thicknessValue ? `${product.product.widthValue} ? ${product.product.thicknessValue}` : product.length && product.width ? `${product.length} ? ${product.width}` : '???'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatQuantity(product.quantity || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatSquareMeters(product.product?.squareMeter || product.squareMeter || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.unitPrice ? formatPrice(product.unitPrice, product.currency || '???') : '???'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${product.totalPrice ? formatPrice(product.totalPrice, product.currency || '???') : '???'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const deliveriesSection = data.deliveries && data.deliveries.length > 0 ? `
    <h3>??? ???:</h3>
    <ul>
      ${data.deliveries.map((delivery: any) => `
        <li>???: ${delivery.deliveryDate} - ${delivery.notes || '?? ??'}</li>
      `).join('')}
    </ul>
  ` : '';

  return `
    <div style="font-family: 'Tahoma', sans-serif; direction: rtl; text-align: right;">
      <h1 style="text-align: center; color: #333;">?? ?? ??? ???</h1>

      <div style="margin: 20px 0;">
        <p><strong>??? ??:</strong> ${data.contractNumber}</p>
        <p><strong>??? ??:</strong> ${data.contractDate}</p>
      </div>

      <div style="margin: 20px 0;">
        <h3>?? ???:</h3>
        <p><strong>??:</strong> ${data.customer?.firstName} ${data.customer?.lastName}</p>
        ${data.customer?.companyName ? `<p><strong>?? ??:</strong> ${data.customer.companyName}</p>` : ''}
        ${data.customer?.phoneNumbers && data.customer.phoneNumbers.length > 0 ? `<p><strong>??? ??:</strong> ${data.customer.phoneNumbers[0].number}</p>` : ''}
      </div>

      ${data.project ? `
        <div style="margin: 20px 0;">
          <h3>?? ???:</h3>
          <p><strong>?? ???:</strong> ${data.project.address || '???'}</p>
          <p><strong>?? ???:</strong> ${data.project.name || '???'}</p>
        </div>
      ` : ''}

      <div style="margin: 20px 0;">
        <h3>??? ??:</h3>
        ${productsTable}
      </div>

      ${data.payment ? `
        <div style="margin: 20px 0;">
          <h3>?? ???:</h3>
          <p><strong>?? ???:</strong> ${data.payment.method}</p>
          <p><strong>?? ?:</strong> ${data.payment.totalAmount ? formatPrice(data.payment.totalAmount, data.payment.currency || '???') : '???'}</p>
        </div>
      ` : ''}

      ${deliveriesSection}

      <div style="margin-top: 40px; text-align: center;">
        <p>?? ?? ? ??? ${data.contractDate} ??? ?? ??.</p>
      </div>
    </div>
  `;
};

