import type { ContractProduct } from '../types/contract.types';

export interface ProductGraphConflict {
  rowId?: string;
  message: string;
}

const isLayer = (product: ContractProduct) => Boolean((product.meta as any)?.isLayer);

export const reconcileContractProductGraph = (products: ContractProduct[]): ProductGraphConflict[] => {
  const conflicts: ProductGraphConflict[] = [];
  const rowsById = new Map<string, ContractProduct>();

  products.forEach((product) => {
    if (!product.rowId) {
      conflicts.push({ message: 'یک ردیف محصول شناسه پایدار ندارد.' });
      return;
    }
    if (rowsById.has(product.rowId)) {
      conflicts.push({ rowId: product.rowId, message: 'شناسه ردیف محصول تکراری است.' });
      return;
    }
    rowsById.set(product.rowId, product);
  });

  products.filter(isLayer).forEach((layer) => {
    const layerInfo = (layer.meta as any)?.layerInfo || {};
    const sourcePlan = (layer.meta as any)?.layerSourcePlan || {};
    const parent = layer.parentProductRowId ? rowsById.get(layer.parentProductRowId) : undefined;
    if (!parent || isLayer(parent) || parent.productType !== 'stair') {
      conflicts.push({ rowId: layer.rowId, message: 'لایه به یک ردیف پله معتبر و دقیق متصل نیست.' });
      return;
    }

    const expectedSets = Number(parent.quantity || 0) * Number(layerInfo.numberOfLayersPerStair || 0);
    const savedSets = Number(layerInfo.layerSetQuantity ?? layer.quantity ?? 0);
    if (Math.abs(expectedSets - savedSets) > 0.000001) {
      conflicts.push({ rowId: layer.rowId, message: 'تعداد ست لایه با تعداد پله والد سازگار نیست.' });
    }

    const edgeCount = layerInfo?.edges?.perimeter
      ? 1
      : ['front', 'back', 'left', 'right'].filter((edge) => layerInfo?.edges?.[edge]).length;
    const expectedPhysicalPieces = savedSets * edgeCount;
    const savedPhysicalPieces = Number(layerInfo.physicalPieceQuantity || 0);
    if (edgeCount <= 0 || Math.abs(expectedPhysicalPieces - savedPhysicalPieces) > 0.000001) {
      conflicts.push({ rowId: layer.rowId, message: 'تعداد نوار فیزیکی لایه با ست‌ها و لبه‌های انتخاب‌شده سازگار نیست.' });
    }

    const newPhysicalPieces = Number(sourcePlan.fromNewStone || 0);
    if (newPhysicalPieces > 0 && (
      Number(sourcePlan.sourceStoneQuantity || 0) <= 0 ||
      Number(sourcePlan.sourceAreaSqm || 0) <= 0
    )) {
      conflicts.push({ rowId: layer.rowId, message: 'لایه از سنگ جدید است اما مقدار سنگ منبع ذخیره نشده است.' });
    }
  });

  return conflicts;
};
