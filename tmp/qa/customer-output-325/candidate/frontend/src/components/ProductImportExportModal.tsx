'use client';

import React from 'react';
import CatalogExcelSyncModal from './CatalogExcelSyncModal';
import { salesAPI } from '@/lib/api';
import { User as PermissionUser } from '@/lib/permissions';

interface ProductImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: (results: any) => void;
  currentFilters?: any;
  currentUser?: PermissionUser | null;
}

const ProductImportExportModal: React.FC<ProductImportExportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  currentFilters
}) => {
  return (
    <CatalogExcelSyncModal
      isOpen={isOpen}
      title="ورود و خروج اطلاعات محصول"
      onClose={onClose}
      onComplete={onImportComplete}
      downloadTemplate={() => salesAPI.downloadProductTemplate()}
      exportData={() => salesAPI.exportProducts(currentFilters)}
      previewImport={(file) => salesAPI.previewProductImport(file)}
      applyImport={(importId) => salesAPI.applyProductImport(importId)}
      filenamePrefix="products"
    />
  );
};

export default ProductImportExportModal;
