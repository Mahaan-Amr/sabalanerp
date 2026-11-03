// Contract HTML Generator
// Generates HTML representation of contract for printing/PDF

import { formatDisplayNumber, formatQuantity, formatSquareMeters, formatPrice } from '@/lib/numberFormat';
import { getServiceRowSourceLabel, getServiceRowUnitLabel } from './contractServiceRows';
import { restoreLongitudinalCustomerRequest } from './longitudinalOptimizerGeometry';

/**
 * Generate HTML representation of contract data
 * @param data Contract wizard data
 * @returns HTML string for contract printing
 */
export const generateContractHTML = (data: any): string => {
  const discount = data.discount || data.contractData?.discount || null;
  const getSourceMaterialSummary = (product: any): string => {
    const layerSourcePlan = product?.meta?.layerSourcePlan;
    if (product?.meta?.isLayer && layerSourcePlan) {
      const paidSets = Number(layerSourcePlan.fromAlreadyPaidSets || 0);
      const newSets = Number(layerSourcePlan.fromNewSets || 0);
      const sourceQuantity = Number(layerSourcePlan.sourceStoneQuantity || 0);
      const sourceAreaSqm = Number(layerSourcePlan.sourceAreaSqm || 0);
      return [
        paidSets > 0 ? `لایه از سنگ قبلاً محاسبه‌شده: ${formatDisplayNumber(paidSets)} ست` : '',
        newSets > 0 ? `لایه از سنگ جدید: ${formatDisplayNumber(newSets)} ست` : '',
        sourceQuantity > 0 ? `سنگ جدید مصرفی: ${formatDisplayNumber(sourceQuantity)} عدد / ${formatSquareMeters(sourceAreaSqm)}` : ''
      ].filter(Boolean).join('، ');
    }
    const smartCutPlan = product?.smartCutPlan || {};
    const stairMeta = product?.meta?.stair || {};
    const sourceWidthCm = Number(smartCutPlan.sourceWidthCm || product?.originalWidth || 0);
    const smartSourceQuantity = Number(smartCutPlan.sourceBandsNeeded || 0);
    const stairSourceQuantity = Number(stairMeta.baseStoneQuantity || 0);
    const sourceQuantity = smartCutPlan.enabled
      ? Math.max(1, smartSourceQuantity || 1)
      : (stairSourceQuantity > 0 ? stairSourceQuantity : Math.max(1, Number(product?.quantity || 1)));
    const smartTotalLengthM = Number(smartCutPlan.sourceLengthConsumedM || 0);
    const sourceLengthM = smartCutPlan.enabled && smartTotalLengthM > 0
      ? smartTotalLengthM / sourceQuantity
      : Number(stairMeta.standardLength?.meters || product?.originalLength || product?.actualLengthMeters || 0);
    const sourceAreaSqm = Number(
      smartCutPlan.consumedAreaSqm ||
      stairMeta.pricingSquareMeters ||
      (sourceWidthCm > 0 && sourceLengthM > 0 ? (sourceWidthCm / 100) * sourceLengthM * sourceQuantity : 0)
    );
    const productWidthCm = Number(product?.width || 0);
    const kerfNote = product?.sawKerfEnabled ? `، خوراک اره ${product?.sawKerfCm || 0.3}cm` : '';
    const hasSourceMaterial =
      sourceWidthCm > 0 &&
      sourceLengthM > 0 &&
      (Boolean(smartCutPlan.enabled) || stairSourceQuantity > 0 || Boolean(product?.isCut) || (productWidthCm > 0 && sourceWidthCm > productWidthCm));
    if (!hasSourceMaterial) return '';
    return `عرض ${formatDisplayNumber(sourceWidthCm)}cm × طول ${formatDisplayNumber(sourceLengthM)}m × ${formatDisplayNumber(sourceQuantity)} عدد، جمع ${formatSquareMeters(sourceAreaSqm)}${kerfNote}`;
  };
  const getPhysicalProductionSummary = (product: any): string => {
    if (product?.smartCutDerivedQuantity) return '';
    const pieces = Array.isArray(product?.smartCutPlan?.productionPieces)
      ? product.smartCutPlan.productionPieces
      : [];
    if (pieces.length === 0) return '';
    return pieces.map((piece: any) =>
      `${formatDisplayNumber(piece.quantity || 0)} عدد × عرض ${formatDisplayNumber(piece.widthCm || 0)}cm × طول ${formatDisplayNumber(piece.lengthM || 0)}m`
    ).join('، ');
  };
  const productsTable = data.products && data.products.length > 0 ? `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background-color: #f5f5f5;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">نام محصول</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">ابعاد</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">تعداد</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">متراژ کل</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">قیمت واحد</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">قیمت کل</th>
        </tr>
      </thead>
      <tbody>
        ${data.products.map((savedProduct: any) => {
          const product: any = restoreLongitudinalCustomerRequest(savedProduct);
          const sourceMaterialSummary = getSourceMaterialSummary(product);
          const physicalProductionSummary = getPhysicalProductionSummary(product);
          const isLayer = Boolean(product?.meta?.isLayer);
          const layerSourcePlan = product?.meta?.layerSourcePlan || {};
          const isEntirelyAlreadyPaidMaterial = Boolean(product?.meta?.remainingSource) || (
            isLayer &&
            Number(layerSourcePlan.fromAlreadyPaidSets || 0) > 0 &&
            Number(layerSourcePlan.sourceStoneQuantity || 0) <= 0 &&
            Number(layerSourcePlan.sourceAreaSqm || 0) <= 0
          );
          const materialUnitRate = isEntirelyAlreadyPaidMaterial
            ? 0
            : Number(product.pricePerSquareMeter ?? product.unitPrice ?? 0);
          const hasMaterialTotalSnapshot =
            product.originalTotalPrice !== undefined &&
            product.originalTotalPrice !== null &&
            Number.isFinite(Number(product.originalTotalPrice));
          const materialTotal = isEntirelyAlreadyPaidMaterial
            ? 0
            : hasMaterialTotalSnapshot
              ? Number(product.originalTotalPrice)
              : Number(product.totalPrice || 0);
          const productName = product.stoneName || product.product?.namePersian || product.product?.name || product.namePersian || product.name || 'نامشخص';
          const kerfNote = product.sawKerfEnabled ? ' - خوراک اره لحاظ شده' : '';
          const requestedDimensions = product.length && product.width
            ? `${formatDisplayNumber(product.length)}${product.lengthUnit || ''} × ${formatDisplayNumber(product.width)}${product.widthUnit || ''}`
            : 'نامشخص';
          return `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${isLayer ? '↳ ' : ''}${productName}${product.description ? ` - ${product.description}` : ''}${kerfNote}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${requestedDimensions}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatQuantity(product.quantity || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatSquareMeters(product.squareMeters || product.product?.squareMeter || product.squareMeter || 0)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${sourceMaterialSummary ? '' : (product.unitPrice ? formatPrice(product.unitPrice, product.currency || 'تومان') : 'نامشخص')}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${sourceMaterialSummary ? '' : (product.totalPrice ? formatPrice(product.totalPrice, product.currency || 'تومان') : 'نامشخص')}</td>
          </tr>
          ${sourceMaterialSummary ? `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;">سنگ مصرفی برای ${productName}${isEntirelyAlreadyPaidMaterial ? ' - محاسبه‌شده در محصول منبع' : ''}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${sourceMaterialSummary}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">-</td>
              <td style="border: 1px solid #ddd; padding: 8px;">-</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${formatPrice(materialUnitRate, product.currency || 'تومان')}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${formatPrice(materialTotal, product.currency || 'تومان')}</td>
            </tr>
          ` : ''}
          ${physicalProductionSummary ? `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;">خروجی فیزیکی تولید برای ${productName}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${physicalProductionSummary}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">-</td>
              <td style="border: 1px solid #ddd; padding: 8px;">-</td>
              <td style="border: 1px solid #ddd; padding: 8px;">-</td>
              <td style="border: 1px solid #ddd; padding: 8px;">-</td>
            </tr>
          ` : ''}
        `;
        }).join('')}
      </tbody>
    </table>
  ` : '';

  const serviceRowsTable = data.serviceRows && data.serviceRows.length > 0 ? `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background-color: #f5f5f5;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">نوع خدمت</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">عنوان</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">مقدار</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">قیمت واحد</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">قیمت کل</th>
        </tr>
      </thead>
      <tbody>
        ${data.serviceRows.map((row: any) => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${getServiceRowSourceLabel(row.sourceType)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${row.title || 'نامشخص'}${row.description ? ` - ${row.description}` : ''}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatQuantity(row.quantity || 0)} ${getServiceRowUnitLabel(row.unit)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatPrice(row.unitPrice || 0, row.currency || 'تومان')}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${formatPrice(row.totalPrice || 0, row.currency || 'تومان')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const deliveriesSection = data.deliveries && data.deliveries.length > 0 ? `
    <h3>برنامه تحویل:</h3>
    <ul>
      ${data.deliveries.map((delivery: any) => `
        <li>تاریخ: ${delivery.deliveryDate} - ${delivery.notes || 'بدون توضیح'}</li>
      `).join('')}
    </ul>
  ` : '';

  return `
    <div style="font-family: 'Tahoma', sans-serif; direction: rtl; text-align: right;">
      <h1 style="text-align: center; color: #333;">قرارداد فروش سبلان استون</h1>

      <div style="margin: 20px 0;">
        <p><strong>شماره قرارداد:</strong> ${data.contractNumber}</p>
        <p><strong>تاریخ قرارداد:</strong> ${data.contractDate}</p>
      </div>

      <div style="margin: 20px 0;">
        <h3>اطلاعات مشتری:</h3>
        <p><strong>نام:</strong> ${data.customer?.firstName} ${data.customer?.lastName}</p>
        ${data.customer?.companyName ? `<p><strong>نام شرکت:</strong> ${data.customer.companyName}</p>` : ''}
        ${data.customer?.phoneNumbers && data.customer.phoneNumbers.length > 0 ? `<p><strong>شماره تماس:</strong> ${data.customer.phoneNumbers[0].number}</p>` : ''}
      </div>

      ${data.project ? `
        <div style="margin: 20px 0;">
          <h3>اطلاعات پروژه:</h3>
          <p><strong>آدرس پروژه:</strong> ${data.project.address || 'نامشخص'}</p>
          <p><strong>نام پروژه:</strong> ${data.project.name || 'نامشخص'}</p>
        </div>
      ` : ''}

      <div style="margin: 20px 0;">
        <h3>اقلام قرارداد:</h3>
        ${productsTable}
        ${serviceRowsTable}
      </div>

      ${data.payment ? `
        <div style="margin: 20px 0;">
          <h3>روش پرداخت:</h3>
          <p><strong>روش پرداخت:</strong> ${data.payment.method}</p>
          <p><strong>مبلغ کل:</strong> ${data.payment.totalAmount ? formatPrice(data.payment.totalAmount, data.payment.currency || 'تومان') : 'نامشخص'}</p>
          ${discount?.amount > 0 ? `<p><strong>تخفیف قرارداد${discount.percent ? ` (${discount.percent}٪)` : ''}:</strong> -${formatPrice(discount.amount, data.payment.currency || 'تومان')}</p>` : ''}
        </div>
      ` : ''}

      ${deliveriesSection}

      <div style="margin-top: 40px; text-align: center;">
        <p>این قرارداد در تاریخ ${data.contractDate} تنظیم شده است.</p>
      </div>
    </div>
  `;
};
